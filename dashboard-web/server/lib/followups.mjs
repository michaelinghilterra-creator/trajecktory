import fs from 'fs';
import path from 'path';
import { FOLLOWUPS_MD } from '../config.mjs';
import { parseApplicationsMd } from './applications.mjs';
import { parseTargetTalentMd, readTTCorrespondence } from './target-talent.mjs';
import { readApplyDates } from './sidecars.mjs';

// Per-status stale thresholds (days since last touch). Tier reflects how
// quickly each stage cools: warm Responded threads cool fastest, post-
// interview windows tighter still, cold Applied gets the longest leash.
const STALE_THRESHOLD_BY_STATUS = {
  Applied:   2,
  Responded: 5,
  Interview: 3,
};

function parseFollowupsMd() {
  if (!fs.existsSync(FOLLOWUPS_MD)) return [];
  const text = fs.readFileSync(FOLLOWUPS_MD, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(p => p.trim());
    if (parts.length < 10) continue;  // | n | app# | date | company | role | channel | contact | notes |
    const n = parseInt(parts[1], 10);
    if (isNaN(n)) continue;
    out.push({
      n,
      appNum:  parseInt(parts[2], 10),
      date:    parts[3],
      company: parts[4],
      role:    parts[5],
      channel: parts[6],
      contact: parts[7],
      notes:   parts[8],
    });
  }
  return out;
}

function appendFollowupRow({ appNum, date, company, role, channel, contact, notes }) {
  fs.mkdirSync(path.dirname(FOLLOWUPS_MD), { recursive: true });
  let existingText = '';
  if (fs.existsSync(FOLLOWUPS_MD)) existingText = fs.readFileSync(FOLLOWUPS_MD, 'utf8');
  const existing = parseFollowupsMd();
  const nextN = existing.length ? Math.max(...existing.map(r => r.n)) + 1 : 1;
  const esc = s => (s || '').toString().replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
  const row = `| ${nextN} | ${appNum} | ${date} | ${esc(company)} | ${esc(role)} | ${esc(channel)} | ${esc(contact)} | ${esc(notes)} |`;
  // If file is empty or missing header, write the full header + row
  if (!/^\|.*\|$/m.test(existingText) || !existingText.includes('|-')) {
    const header = '# Follow-Ups\n\n| # | app# | date | company | role | channel | contact | notes |\n|---|------|------|---------|------|---------|---------|-------|\n';
    fs.writeFileSync(FOLLOWUPS_MD, (existingText || '') + (existingText ? '\n' : '') + header + row + '\n', 'utf8');
  } else {
    fs.writeFileSync(FOLLOWUPS_MD, existingText.replace(/\s*$/, '') + '\n' + row + '\n', 'utf8');
  }
  return nextN;
}

function _daysAgo(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// Business days (Mon-Fri) elapsed since `iso`, weekends excluded. Used for
// follow-up cadence so a Friday apply isn't "overdue" by Monday. Counts each
// weekday AFTER the anchor date up to and including today; same-day = 0.
// Weekends only — no holiday calendar.
function _businessDaysAgo(iso) {
  if (!iso) return null;
  const start = new Date(iso + 'T00:00:00');
  if (isNaN(start.getTime())) return null;
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00');
  if (today <= start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur < today) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay(); // 0 Sun … 6 Sat
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// Build the stale-apps list with per-row coaching from cadence rules
function computeStaleApps() {
  const apps = parseApplicationsMd();
  const followups = parseFollowupsMd();
  const applyDates = readApplyDates();
  const followupsByApp = new Map();
  for (const f of followups) {
    if (!followupsByApp.has(f.appNum)) followupsByApp.set(f.appNum, []);
    followupsByApp.get(f.appNum).push(f);
  }
  // sort each app's follow-ups by date desc
  for (const list of followupsByApp.values()) list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const TRACKED_STATUSES = ['Applied', 'Responded', 'Interview'];
  const CAP_BY_STATUS = { Applied: 2, Responded: 1, Interview: 1 };

  const stale = [];
  for (const a of apps) {
    if (!TRACKED_STATUSES.includes(a.status)) continue;
    const fus = followupsByApp.get(a.id) || [];
    const fuCount = fus.length;
    // Apply-date baseline: a recorded apply date beats the Date column (which is
    // the eval/scrape date). Follow-ups, when present, still win as the latest touch.
    const appliedOn = applyDates[String(a.id)] || a.date;
    const lastTouchDate = fus[0]?.date || appliedOn;
    // Cadence is measured in BUSINESS days (weekends excluded).
    const daysSinceLastTouch = _businessDaysAgo(lastTouchDate);
    const daysSinceApply = _businessDaysAgo(appliedOn);
    const statusThreshold = STALE_THRESHOLD_BY_STATUS[a.status] ?? 14;
    if (daysSinceLastTouch == null || daysSinceLastTouch < statusThreshold) continue;

    const cap = CAP_BY_STATUS[a.status] || 1;
    const overCap = fuCount >= cap;
    let coachVerdict, coachLevel;
    if (overCap) {
      coachVerdict = `You've followed up ${fuCount}× already. Time to mark as ghosted/closed.`;
      coachLevel = 'give-up';
    } else if (fuCount === 0) {
      coachVerdict = `${daysSinceLastTouch}d since application sent. 1st follow-up is overdue.`;
      coachLevel = 'overdue';
    } else {
      coachVerdict = `${daysSinceLastTouch}d since last follow-up. ${fuCount === 1 ? '2nd' : `${fuCount + 1}th`} follow-up due now.`;
      coachLevel = 'overdue';
    }

    stale.push({
      id: a.id,
      company: a.company,
      role: a.role,
      score: a.score,
      scoreRaw: a.scoreRaw,
      status: a.status,
      applyDate: appliedOn,
      lastTouchDate,
      daysSinceLastTouch,
      daysSinceApply,
      fuCount,
      cap,
      coachVerdict,
      coachLevel,
      sector: a.sector,
      report: a.report,
      url: a.url,
      notes: a.notes,
      followups: fus,
    });
  }
  // Sort: give-up first (act on this!), then overdue by days descending
  stale.sort((a, b) => {
    if (a.coachLevel !== b.coachLevel) {
      return a.coachLevel === 'give-up' ? -1 : 1;
    }
    return b.daysSinceLastTouch - a.daysSinceLastTouch;
  });
  return stale;
}

// ─── Talent Acquisition stale chases ──────────────────────────────────────
// Warm target-company relationships cool slower than cold applications.
// Tracked statuses are the "engaged" ones — Not Contacted / Drafted / Dormant
// / Connected / Archived are excluded.
const TA_STALE_THRESHOLD_DAYS = 14;
const TA_FU_CAP = 1; // cap nudges to avoid burning warm relationships
const TA_TRACKED_STATUSES = ['Sent', 'Replied', 'Meeting Scheduled'];

function computeStaleTA() {
  // Lazy require so apps-only environments (legacy fixtures) still boot.
  let contacts = [];
  try { contacts = parseTargetTalentMd(); } catch (_) { return []; }

  const stale = [];
  for (const c of contacts) {
    if (!TA_TRACKED_STATUSES.includes(c.status)) continue;
    if (!c.lastTouch) continue;
    const daysSinceLastTouch = _businessDaysAgo(c.lastTouch); // business days (weekends excluded)
    if (daysSinceLastTouch == null || daysSinceLastTouch < TA_STALE_THRESHOLD_DAYS) continue;

    // Count prior outbound nudges by walking the correspondence log.
    const corr = readTTCorrespondence(c.id);
    const sentCount = corr.filter(m => m.direction === 'Sent').length;
    const fuCount = Math.max(0, sentCount - 1); // first send = the original touch
    const overCap = fuCount >= TA_FU_CAP;

    let coachVerdict, coachLevel;
    if (overCap) {
      coachVerdict = `Already nudged ${fuCount}× — let this contact cool.`;
      coachLevel = 'give-up';
    } else if (fuCount === 0) {
      coachVerdict = `${daysSinceLastTouch}d since last touch · time to keep warm.`;
      coachLevel = 'overdue';
    } else {
      coachVerdict = `${daysSinceLastTouch}d since the nudge · final ping.`;
      coachLevel = 'overdue';
    }

    stale.push({
      source: 'ta',
      id: c.id,
      company: c.company,
      role: c.title,            // TA's analogue to the app's role
      score: null,              // TA has no score
      status: c.status,
      applyDate: null,
      lastTouchDate: c.lastTouch,
      daysSinceLastTouch,
      daysSinceApply: null,
      fuCount,
      cap: TA_FU_CAP,
      coachVerdict,
      coachLevel,
      sector: null,
      notes: c.notes,
      followups: [],            // surfaced via TA drawer when opened
      taFirst: c.first,
      taLast: c.last,
      taEmail: c.email,
    });
  }
  return stale;
}


export {
  parseFollowupsMd, appendFollowupRow, computeStaleApps, computeStaleTA,
  STALE_THRESHOLD_BY_STATUS, TA_STALE_THRESHOLD_DAYS, _daysAgo,
};

