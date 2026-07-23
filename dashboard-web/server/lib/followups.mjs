import fs from 'fs';
import path from 'path';
import { FOLLOWUPS_MD } from '../config.mjs';
import { parseApplicationsMd } from './applications.mjs';
import { parseTargetTalentMd, readTTCorrespondence, matchByCompany } from './target-talent.mjs';
import { parseRecruitersMd } from './recruiters.mjs';
import { readApplyDates, readMute, parseStatusEvents } from './sidecars.mjs';
import { INTERVIEW_STAGES, isInterviewStage } from './statuses.mjs';
import { isSendable } from '../../../lib/email-verify.mjs';

// Per-status stale thresholds (days since last touch). Tier reflects how
// quickly each stage cools: warm Responded threads cool fastest, post-
// interview windows tighter still, cold Applied gets the longest leash.
// Applied is intentionally generous (7 business days, ~10 calendar): chasing a
// cold portal application 2 days after applying just manufactures noise.
const STALE_THRESHOLD_BY_STATUS = {
  Applied:   7,
  Responded: 5,
  // Interview rounds cool fast — chase within a few business days of going quiet.
  'Phone Screen':  3,
  '1st Interview': 3,
  '2nd Interview': 3,
  '3rd Interview': 3,
  '4th Interview': 3,
};

// An Applied application with no reply this many CALENDAR days after applying is
// treated as ghosted — a candidate to archive to the "No Response" outcome.
const GHOST_DAYS = 45;

// Is this contact's email actually usable for outreach? This defers to the ONE
// send gate (isSendable in email-verify.mjs): only a verified-deliverable state
// (ok / risky) with a real address counts. It reads the structured `verified`
// tag the parsers attach, NOT a free-text notes scan — the old notes-regex
// version could not see the `[v:…]` verification tag and treated an unverified
// first.last@company GUESS as usable, which is exactly what sent mail into the
// void in June. An unverified or observed-dead (invalid / blocked / bounced)
// address is not a channel, so a company whose only contact is one of those is
// treated as having no email channel and routes to LinkedIn or nothing instead.
function _isUsableEmail(row) {
  return isSendable(row);
}

// Best available outreach channel for a company across its non-archived TA
// contacts: a verified email beats a LinkedIn-only contact, which beats nothing.
// Email ranks first only because it needs no acceptance step, NOT because
// LinkedIn is unreliable: connection invitations run ~100 per rolling 7-day
// window and messaging is unlimited once accepted. (The ~15/mo figure older
// comments cited is the InMail cap for messaging NON-connections, a different
// mechanism this flow never uses.) A LinkedIn-only contact routes to the connect
// queue instead. Drives the warm/cold split and the per-row channel badge.
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
  const esc = s => (s || '').toString().replace(/[|\r\n]+/g, ' ').trim();
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

  const TRACKED_STATUSES = ['Applied', 'Responded', ...INTERVIEW_STAGES];
  const CAP_BY_STATUS = {
    Applied: 2, Responded: 1,
    'Phone Screen': 1, '1st Interview': 1, '2nd Interview': 1, '3rd Interview': 1, '4th Interview': 1,
  };

  // Cadence resets each interview round: the date an app ENTERED its current
  // status (from the dashboard-driven status-event log) re-anchors the stale
  // clock and the follow-up cap, so a long loop doesn't go quiet after one nudge.
  // Falls back to the apply date when the row predates the event log (hand-edited
  // or pre-rollout), so older rows keep their prior behavior.
  const events = (() => { try { return parseStatusEvents(); } catch { return []; } })();
  const stageEnteredOn = (app) => {
    let best = null;
    for (const e of events) {
      if (e.app !== String(app.id) || e.status !== app.status) continue;
      if (!best || e.date > best) best = e.date;
    }
    return best;
  };

  const stale = [];
  for (const a of apps) {
    if (!TRACKED_STATUSES.includes(a.status)) continue;
    const allFus = followupsByApp.get(a.id) || [];
    // Apply-date baseline: a recorded apply date beats the Date column (which is
    // the eval/scrape date). Follow-ups, when present, still win as the latest touch.
    const appliedOn = applyDates[String(a.id)] || a.date;
    // For interview rounds, reset the window to when the app entered THIS round:
    // only follow-ups since then count toward the cap, and the clock anchors on
    // the round-entry date (or a later follow-up).
    const enteredOn = isInterviewStage(a.status) ? stageEnteredOn(a) : null;
    const fus = enteredOn ? allFus.filter(f => (f.date || '') >= enteredOn) : allFus;
    const fuCount = fus.length;
    const baseAnchor = enteredOn || appliedOn;
    const lastTouchDate = fus[0]?.date || baseAnchor;
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

    // Warm vs cold. Responded / any interview round always count as warm (a human
    // engaged, nudging pays off). An Applied app is warm only when there's a
    // usable EMAIL channel; a LinkedIn-only contact routes to the connect queue
    // (a separate manual motion) rather than the email follow-up nudge here, so
    // it stays a cold "application out" that sits in a calm ledger rather than
    // nagging. A muted app is always cold ("done for now").
    const channel = channelFor(a.company, taRows);
    const isMutedApp = !!muted[String(a.id)];
    let klass;
    if (isMutedApp) klass = 'cold';
    else if (a.status === 'Responded' || isInterviewStage(a.status)) klass = 'warm';
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
      coachVerdict = `Already nudged ${fuCount}×. Let this contact cool.`;
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
// ago, no advancement to Responded / an interview round (implied by status === 'Applied').
// These are candidates for the one-click "archive to No Response" bulk action so
// the user clears the backlog honestly instead of closing things prematurely.
// Anchor priority mirrors rejectionTimingStats: the recorded apply date, else the
// earliest logged Applied event, else the tracker Date column. That last one is
// the EVALUATION date (see the apply-date store comment in sidecars.mjs), which
// on self-sourced rows routinely predates the real application by days — so
// anchoring on it declares rows ghosted before they have actually been silent
// 45 days. It stays as a last resort rather than dropping the row, but every
// candidate now carries `anchorSource` so the UI can disclose which are estimates
// instead of presenting all of them as measured. This list gates a bulk
// destructive write, so an over-count here costs real applications.
function computeGhostedCandidates() {
  const apps = parseApplicationsMd();
  const applyDates = readApplyDates();
  const events = (() => { try { return parseStatusEvents(); } catch { return []; } })();
  const earliestApplied = new Map();
  for (const e of events) {
    if (e.status !== 'Applied') continue;
    const prev = earliestApplied.get(e.app);
    if (!prev || e.date < prev) earliestApplied.set(e.app, e.date);
  }
  const out = [];
  for (const a of apps) {
    if (a.status !== 'Applied') continue;
    const key = String(a.id);
    const appliedOn = applyDates[key] || earliestApplied.get(key) || a.date;
    const anchorSource = applyDates[key] ? 'apply-date'
      : earliestApplied.get(key) ? 'event'
      : 'row-date';
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
      anchorSource,
      estimated: anchorSource === 'row-date',
    });
  }
  out.sort((x, y) => y.daysSinceApply - x.daysSinceApply);
  return out;
}


// ─── LinkedIn connect queue ───────────────────────────────────────────────
// The fallback channel for people we cannot email but can still reach: a real
// LinkedIn handle and no sendable address. This is the home for the contacts
// whose email bounced, is org-blocked (talent_states `Blocked` literally means
// "reach on LinkedIn, not email"), or was never verifiable. Connection invites
// run ~100 per rolling 7-day window, so this is a real, high-capacity channel,
// not a rate-limited afterthought.
//
// Selection: a non-empty LinkedIn handle AND not isSendable (no live email) AND
// a status that is neither Archived (dead opportunity) nor Connected (already a
// 1st-degree connection — message directly, no request needed). Spans both
// target-talent.md and recruiters.md. Rows are injectable so this is unit-tested
// without reading the real (gitignored) contact files.
const CONNECT_QUEUE_EXCLUDE_STATUS = new Set(['Archived', 'Connected']);

function _hasLinkedIn(row) {
  return !!(row && (row.linkedin || '').trim());
}

function computeConnectQueue({ taRows, recruiterRows } = {}) {
  const ta  = taRows        ?? (() => { try { return parseTargetTalentMd(); } catch { return []; } })();
  const rec = recruiterRows ?? (() => { try { return parseRecruitersMd();  } catch { return []; } })();
  const out = [];
  const consider = (row, source) => {
    if (!_hasLinkedIn(row)) return;              // no LinkedIn handle → not reachable here
    if (isSendable(row)) return;                 // has a live email → belongs to the email motion
    if (CONNECT_QUEUE_EXCLUDE_STATUS.has(row.status)) return;
    const company = source === 'recruiter' ? row.firm : row.company;
    const name = `${row.first || ''} ${row.last || ''}`.trim();
    out.push({
      source,                                     // 'ta' | 'recruiter'
      id: row.id,
      name,
      firstName: row.first || '',
      role: row.title || '',
      company: company || '',
      linkedin: (row.linkedin || '').trim(),
      status: row.status || '',
      // Two distinct reasons a contact is unsendable, kept apart on purpose:
      // hasEmail=false means NO address is on file at all; hasEmail=true with a
      // non-sendable emailState means there IS an address, it just is not verified
      // deliverable (unverified / bounced / invalid / blocked). The UI labels them
      // differently so "find an address" and "verify the address" read as the
      // different next actions they are. `email` mirrors verified.address.
      hasEmail: !!(row.email || '').trim(),
      emailState: row.verified?.state || 'unverified', // why they landed here
      reason: (row.notes || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    });
  };
  for (const r of ta)  consider(r, 'ta');
  for (const r of rec) consider(r, 'recruiter');
  // Stable, readable order: by company, then by name.
  out.sort((a, b) =>
    (a.company || '').localeCompare(b.company || '') ||
    (a.name || '').localeCompare(b.name || ''));
  return out;
}

export {
  parseFollowupsMd, appendFollowupRow, computeStaleApps, computeStaleTA,
  computeGhostedCandidates, channelFor, computeConnectQueue, GHOST_DAYS,
  STALE_THRESHOLD_BY_STATUS, TA_STALE_THRESHOLD_DAYS, _daysAgo,
};

