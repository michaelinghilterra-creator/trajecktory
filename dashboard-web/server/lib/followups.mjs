import fs from 'fs';
import path from 'path';
import { FOLLOWUPS_MD } from '../config.mjs';
import { parseApplicationsMd } from './applications.mjs';
import { parseTargetTalentMd, readTTCorrespondence, matchByCompany } from './target-talent.mjs';
import { readApplyDates, readMute } from './sidecars.mjs';

// Per-status stale thresholds (days since last touch). Tier reflects how
// quickly each stage cools: warm Responded threads cool fastest, post-
// interview windows tighter still, cold Applied gets the longest leash.
// Applied is intentionally generous (7 business days, ~10 calendar): chasing a
// cold portal application 2 days after applying just manufactures noise.
const STALE_THRESHOLD_BY_STATUS = {
  Applied:   7,
  Responded: 5,
  Interview: 3,
};

// An Applied application with no reply this many CALENDAR days after applying is
// treated as ghosted — a candidate to archive to the "No Response" outcome.
const GHOST_DAYS = 45;

// Is this TA contact's email actually usable for outreach? Auto-synthesized /
// unverified / bounced addresses don't count (they read authoritative but fail
// in practice), so a company whose only contact has such an email is treated as
// having no usable email channel. Mirrors the bounce/unverified badge logic in
// the contact drawer.
function _isUsableEmail(row) {
  const email = (row.email || '').trim();
  if (!email || !email.includes('@')) return false;
  const notes = row.notes || '';
  if (/EMAIL BOUNCED|bounced/i.test(notes)) return false;
  if (/unverified|auto-synthesized|pattern-med|pattern-low/i.test(notes)) return false;
  return true;
}

// Best available outreach channel for a company across its non-archived TA
// contacts: a usable email beats a LinkedIn-only contact (LinkedIn messaging is
// rate-limited ~15/mo, so it's not a reliable follow-up channel), which beats
// nothing. Drives the warm/cold split and the per-row channel badge.
function channelFor(company, taRows) {
  const matches = matchByCompany(taRows || [], company, r => r.company)
    .filter(r => r.status !== 'Archived');
  if (matches.some(_isUsableEmail)) return 'email';
  if (matches.some(r => (r.linkedin || '').trim())) return 'linkedin';
  return 'none';
}

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
  const muted = readMute();
  const taRows = (() => { try { return parseTargetTalentMd(); } catch { return []; } })();
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

    // Warm vs cold. Responded/Interview always count as warm (a human engaged,
    // nudging pays off). An Applied app is warm only when there's a usable EMAIL
    // channel (LinkedIn-only is rate-limited, so it's not reliably actionable);
    // otherwise it's a cold "application out" that should sit in a calm ledger
    // rather than nag. A muted app is always cold (the user said "done for now").
    const channel = channelFor(a.company, taRows);
    const isMutedApp = !!muted[String(a.id)];
    let klass;
    if (isMutedApp) klass = 'cold';
    else if (a.status === 'Responded' || a.status === 'Interview') klass = 'warm';
    else klass = (channel === 'email') ? 'warm' : 'cold';

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
      channel,
      muted: isMutedApp,
      klass,
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
      // TA stale items are engaged relationships → always warm. Channel reflects
      // whether we hold a direct email vs only a LinkedIn handle.
      klass: 'warm',
      muted: false,
      channel: (c.email || '').includes('@') ? 'email' : 'linkedin',
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

// Ghosted applications: status still Applied, applied > GHOST_DAYS calendar days
// ago, no advancement to Responded/Interview (implied by status === 'Applied').
// These are candidates for the one-click "archive to No Response" bulk action so
// the user clears the backlog honestly instead of closing things prematurely.
function computeGhostedCandidates() {
  const apps = parseApplicationsMd();
  const applyDates = readApplyDates();
  const out = [];
  for (const a of apps) {
    if (a.status !== 'Applied') continue;
    const appliedOn = applyDates[String(a.id)] || a.date;
    const days = _daysAgo(appliedOn);
    if (days == null || days < GHOST_DAYS) continue;
    out.push({
      id: a.id,
      company: a.company,
      role: a.role,
      status: a.status,
      score: a.score,
      applyDate: appliedOn,
      daysSinceApply: days,
    });
  }
  out.sort((x, y) => y.daysSinceApply - x.daysSinceApply);
  return out;
}


export {
  parseFollowupsMd, appendFollowupRow, computeStaleApps, computeStaleTA,
  computeGhostedCandidates, channelFor, GHOST_DAYS,
  STALE_THRESHOLD_BY_STATUS, TA_STALE_THRESHOLD_DAYS, _daysAgo,
};

