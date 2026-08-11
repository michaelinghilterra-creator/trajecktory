import fs from 'fs';
import path from 'path';
import { FOLLOWUPS_MD } from '../config.mjs';
import { parseApplicationsMd } from './applications.mjs';
import { parseTargetTalentMd, readTTCorrespondence, matchByCompany, getNewBaselineId } from './target-talent.mjs';
import { parseRecruitersMd, readRecruiterCorrespondence } from './recruiters.mjs';
import { readApplyDates, readMute, parseStatusEvents } from './sidecars.mjs';
import { INTERVIEW_STAGES, isInterviewStage, OUTREACH_ELIGIBLE_STATUSES } from './statuses.mjs';
import { isSendable } from '../../../lib/email-verify.mjs';
import { normalizeCompany } from '../../../lib/identity.mjs';
import { isLinkedInInvite } from './channels.mjs';

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
  // "today" must be LOCAL midnight, not the UTC date: `toISOString().slice(0,10)`
  // is already tomorrow during the US evening, which inflated the day count and
  // tripped stale thresholds a day early. (cadence.mjs documents the same hazard.)
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate());
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

// ─── Contact channel bucket classifier ───────────────────────────────────────
// Classifies a single contact by which outreach channels are actually available:
//   Bucket 1 — LinkedIn only (handle present, no sendable email)
//   Bucket 2 — Email only (sendable email, no LinkedIn handle)
//   Bucket 3 — Both (sendable email AND LinkedIn handle) — high-priority multithread candidate
//   Bucket 0 — Neither (not reachable via either channel here)
//
// Per-CONTACT classifier; not the same as channelFor() which is per-company.
// channelFor() continues to drive the warm/cold split in computeStaleApps()
// (aggregating across all contacts at a company). This one drives per-contact
// routing in computeStaleContacts() and will later gate bucket-3 multithread
// logic for high-priority contacts (item 5 of the design).
function contactChannelBucket(contact) {
  const hasEmail    = isSendable(contact);
  const hasLinkedIn = !!((contact.linkedin || '').trim());
  let bucket;
  if (hasEmail && hasLinkedIn) bucket = 3;
  else if (hasEmail)           bucket = 2;
  else if (hasLinkedIn)        bucket = 1;
  else                         bucket = 0;
  return { bucket, hasEmail, hasLinkedIn };
}

// ─── Unified contact-keyed stale engine ──────────────────────────────────────
// The contact-centric model: the cadence clock lives on the CONTACT (their
// lastTouch), not on the application. This covers both the target-talent and
// recruiter books. Only contacts at companies with a CURRENTLY-LIVE application
// surface — a contact at a dead opportunity (Rejected, Discarded…) is noise.
//
// `computeStaleTA()` stays intact for backward compatibility (tests depend on
// it). This function is the target state and supersedes it in the route.
const CONTACT_STALE_THRESHOLD_DAYS = 14; // calendar-threshold before we check business-days
const CONTACT_FU_CAP = 1;               // nudge cap; more than one follow-up burns warm contacts
// Active-thread statuses that carry a real follow-up clock. 'Connected' (invite
// accepted, no ongoing message thread) and dead-end states (Dormant/Bounced/
// Blocked/Archived) are excluded: they have no thread to keep warm.
const CONTACT_TRACKED_STATUSES = new Set(['Sent', 'Replied', 'Meeting Scheduled']);

function computeStaleContacts({ apps } = {}) {
  const appList = apps ?? (() => { try { return parseApplicationsMd(); } catch { return []; } })();
  const eligible = outreachEligibleCompanies(appList);

  let taContacts = [];
  try { taContacts = parseTargetTalentMd(); } catch { /* */ }
  let recruiterContacts = [];
  try { recruiterContacts = parseRecruitersMd(); } catch { /* */ }

  const stale = [];

  const processContact = (c, source) => {
    const company = source === 'recruiter' ? c.firm : c.company;
    if (!CONTACT_TRACKED_STATUSES.has(c.status)) return;
    if (!c.lastTouch) return;
    if (!eligible.has(normalizeCompany(company))) return;

    const daysSinceLastTouch = _businessDaysAgo(c.lastTouch);
    if (daysSinceLastTouch == null || daysSinceLastTouch < CONTACT_STALE_THRESHOLD_DAYS) return;

    const corr = source === 'recruiter'
      ? readRecruiterCorrespondence(c.id)
      : readTTCorrespondence(c.id);
    const sentCount = corr.filter(m => m.direction === 'Sent').length;
    const fuCount = Math.max(0, sentCount - 1); // first send = original touch, not a follow-up
    const overCap = fuCount >= CONTACT_FU_CAP;

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
      source,
      id: c.id,
      company: company || '',
      role: c.title || '',
      score: null,
      status: c.status,
      applyDate: null,
      lastTouchDate: c.lastTouch,
      daysSinceLastTouch,
      daysSinceApply: null,
      fuCount,
      cap: CONTACT_FU_CAP,
      coachVerdict,
      coachLevel,
      klass: 'warm',           // engaged threads are always warm
      muted: false,
      ...(() => { const b = contactChannelBucket(c); return { channelBucket: b.bucket, channel: b.hasEmail ? 'email' : b.hasLinkedIn ? 'linkedin' : 'none' }; })(),
      sector: null,
      notes: c.notes || '',
      followups: [],
      taFirst: c.first || '',
      taLast: c.last || '',
      taEmail: c.email || '',
      // Hiring-principal flag: true when the contact carries the [principal] tag
      // in their notes (TA contacts only; recruiter contacts are never principals).
      isPrincipal: source === 'ta' ? (c.isPrincipal ?? false) : false,
    });
  };

  for (const c of taContacts)        processContact(c, 'ta');
  for (const c of recruiterContacts) processContact(c, 'recruiter');

  stale.sort((a, b) => {
    if (a.coachLevel !== b.coachLevel) return a.coachLevel === 'give-up' ? -1 : 1;
    return b.daysSinceLastTouch - a.daysSinceLastTouch;
  });

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
// Only contacts still needing a request belong in the queue. Anything at or past
// "Sent" has already been actioned (or the contact was archived as stale), so it
// drops out — the queue is a to-do list, not a history. Sent/Replied/Meeting are
// tracked on the Network tab; Connected means they accepted.
const CONNECT_QUEUE_EXCLUDE_STATUS = new Set(['Archived', 'Connected', 'Sent', 'Replied', 'Meeting Scheduled']);
// The email queue mirrors it: once you've emailed a contact (Sent) or they moved
// past it, they leave the "to email" list; Archived stays out either way.
const EMAIL_QUEUE_EXCLUDE_STATUS = new Set(['Archived', 'Sent', 'Replied', 'Meeting Scheduled', 'Connected']);

function _hasLinkedIn(row) {
  return !!(row && (row.linkedin || '').trim());
}

// Companies with a CURRENTLY-LIVE application, the only ones worth spending an
// outreach contact on. Uses the shared OUTREACH_ELIGIBLE_STATUSES (live funnel
// Applied..Offer + No Response) from statuses.mjs, matched on CURRENT status —
// NOT the furthest rung ever reached. That distinction is the whole point of this
// change: the old `reached >= Applied` test kept an applied-then-Rejected company
// in the queues forever (its furthest rung was still Applied), so a dead
// opportunity kept surfacing contacts to chase. Current-status gating drops it
// the moment the row goes terminal, while No Response (a chase-worthy ghost)
// stays. Evaluated-only and Triage-only companies never qualify (no live app).
// Matched on the normalized company name (the one identity engine).
function outreachEligibleCompanies(apps) {
  const set = new Set();
  for (const a of (apps || [])) {
    if (OUTREACH_ELIGIBLE_STATUSES.includes(a.status)) set.add(normalizeCompany(a.company));
  }
  return set;
}

function _bothBooks({ taRows, recruiterRows }) {
  const ta  = taRows        ?? (() => { try { return parseTargetTalentMd(); } catch { return []; } })();
  const rec = recruiterRows ?? (() => { try { return parseRecruitersMd();  } catch { return []; } })();
  return { ta, rec };
}

// One row shape for both queues. `email` is the clean address (verified.address),
// empty on connect-queue rows. hasEmail/emailState keep the connect UI's "no email
// on file" vs "email unverified" distinction.
// baselineId is the "NEW since last reconcile" watermark (see target-talent.mjs).
// isNew flags a contact added after the last reconcile opened; notContacted flags
// one you have not reached out to yet. They are independent signals — a contact can
// be new, not-contacted, both, or neither — so the UI badges them separately.
// Today as a LOCAL calendar date (YYYY-MM-DD), matching how correspondence dates
// are stamped, so "same day" means the same day the user is actually living in.
function _localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Every outbound touch (email OR LinkedIn invite), grouped by normalized company,
// so a queue row can show when anyone at that company was last reached — the thing
// you otherwise had to leave the queue and reconcile by hand across the Pipeline
// drawer and the Network tab. Sourced from the correspondence logs (both books):
// a LinkedIn invite is logged there too, with a subject isLinkedInInvite detects,
// so this one pass covers both channels. Each company's list is sorted newest-first.
function buildCompanyTouchIndex({ ta, rec }) {
  const idx = new Map();
  const add = (companyRaw, key, name, msgs) => {
    const co = normalizeCompany(companyRaw);
    if (!co) return;
    for (const m of (msgs || [])) {
      // Include BOTH directions now: the queue shows last comms (sent OR received),
      // for this contact and for the org. The Sent-only "reached out today" hold-off
      // warning is preserved by filtering on direction where it is computed.
      if (m.direction !== 'Sent' && m.direction !== 'Received') continue;
      const date = (m.timestamp || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!idx.has(co)) idx.set(co, []);
      idx.get(co).push({ key, name, date, direction: m.direction, channel: isLinkedInInvite(m.subject) ? 'linkedin' : 'email' });
    }
  };
  for (const r of (ta || []))  { try { add(r.company, `ta:${r.id}`, `${r.first || ''} ${r.last || ''}`.trim(), readTTCorrespondence(r.id)); } catch { /* skip unreadable */ } }
  for (const r of (rec || [])) { try { add(r.firm, `recruiter:${r.id}`, `${r.first || ''} ${r.last || ''}`.trim(), readRecruiterCorrespondence(r.id)); } catch { /* skip unreadable */ } }
  for (const arr of idx.values()) arr.sort((a, b) => b.date.localeCompare(a.date));
  return idx;
}

// One row shape for both queues. `email` is the clean address (verified.address),
// empty on connect-queue rows. hasEmail/emailState keep the connect UI's "no email
// on file" vs "email unverified" distinction.
// baselineId is the "NEW since last reconcile" watermark (see target-talent.mjs).
// isNew flags a contact added after the last reconcile opened; notContacted flags
// one you have not reached out to yet. They are independent signals — a contact can
// be new, not-contacted, both, or neither — so the UI badges them separately.
// companyOutreach carries three signals, all newest-first from the touch index:
//   lastTouch        — last SENT to SOMEONE ELSE at the company (drives touchedToday)
//   touchedToday     — you already reached out to someone else there today (hold-off)
//   selfLastTouch    — THIS contact's own most recent correspondence (sent OR received)
//   companyLastComms — most recent correspondence with ANYONE ELSE at the company
//                      (sent OR received), so the org's activity is visible even when
//                      it was a reply, not an outbound.
// The self signal fixes a real confusion: the org line could show an 8-week-old email
// to a different contact while you had emailed THIS person last week — invisible until
// you opened the card.
function _queueRow(row, source, baselineId = null, companyTouches = null, today = null) {
  const company = source === 'recruiter' ? row.firm : row.company;
  const status = row.status || '';
  const selfKey = `${source}:${row.id}`;
  let lastTouch = null;
  let selfLastTouch = null;
  let companyLastComms = null;
  let selfSentToday = null;   // { channel } when YOU sent to THIS contact today
  if (Array.isArray(companyTouches)) {
    // last SENT to someone else — keeps the "already reached out today" semantics
    const sent = companyTouches.find(x => x.key !== selfKey && x.direction === 'Sent');
    if (sent) lastTouch = { name: sent.name, date: sent.date, channel: sent.channel };
    // this contact's own last message, either direction
    const self = companyTouches.find(x => x.key === selfKey);
    if (self) selfLastTouch = { date: self.date, direction: self.direction, channel: self.channel };
    // last comms with anyone else at the org, either direction
    const other = companyTouches.find(x => x.key !== selfKey);
    if (other) companyLastComms = { name: other.name, date: other.date, direction: other.direction, channel: other.channel };
    // did YOU send to THIS contact today? (an OUTBOUND today — a received reply does
    // not count). Drives the per-contact same-day cross-channel hold-off: emailing and
    // LinkedIn-inviting the same person on the same day reads as over-contacting.
    if (today) {
      const st = companyTouches.find(x => x.key === selfKey && x.direction === 'Sent' && x.date === today);
      if (st) selfSentToday = { channel: st.channel };
    }
  }
  const touchedToday = (lastTouch && today && lastTouch.date === today)
    ? { name: lastTouch.name, channel: lastTouch.channel }
    : null;
  return {
    source,                                       // 'ta' | 'recruiter'
    id: row.id,
    name: `${row.first || ''} ${row.last || ''}`.trim(),
    firstName: row.first || '',
    role: row.title || '',
    company: company || '',
    linkedin: (row.linkedin || '').trim(),
    email: (row.email || '').trim(),
    status,
    hasEmail: !!(row.email || '').trim(),
    emailState: row.verified?.state || 'unverified',
    reason: (row.notes || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    isNew: baselineId != null && Number.isFinite(row.id) && row.id > baselineId,
    notContacted: !status.trim() || /^\s*not\s*contacted\s*$/i.test(status),
    companyOutreach: { lastTouch, touchedToday, selfLastTouch, companyLastComms, selfSentToday },
    // Hiring-principal flag (TA contacts only; recruiters are never principals).
    isPrincipal: source === 'ta' ? (row.isPrincipal ?? false) : false,
    // Channel bucket: 1 = LinkedIn only, 2 = email only, 3 = both, 0 = neither.
    channelBucket: contactChannelBucket(row).bucket,
  };
}

function _sortByCompanyName(out) {
  // Stable, readable order: by company, then by name.
  out.sort((a, b) =>
    (a.company || '').localeCompare(b.company || '') ||
    (a.name || '').localeCompare(b.name || ''));
  return out;
}

// LinkedIn lane: a real handle, at a company you've applied to, not yet actioned.
//
// Channel-gate rule: a non-principal contact with a sendable email routes to the
// EMAIL queue only (single best-channel). Exception: a hiring-principal contact
// (row.isPrincipal === true, TA contacts only) who has BOTH an email AND a LinkedIn
// handle (bucket 3) appears in BOTH queues — a double-touch that improves the odds
// of being seen by the decision-maker. LinkedIn invites are capped ~100/rolling
// 7-day window, so the double-touch is reserved for high-priority contacts only;
// non-principal bucket-3 contacts still route email-only.
//
// Reply-pause: a contact at status 'Replied' or 'Meeting Scheduled' is excluded
// from both queues by CONNECT_QUEUE_EXCLUDE_STATUS, so a reply on either channel
// automatically stops the other — the existing status-based gate serves as the
// reply-anywhere-pauses-all mechanism.
function computeConnectQueue({ taRows, recruiterRows, apps } = {}) {
  const { ta, rec } = _bothBooks({ taRows, recruiterRows });
  const applied = outreachEligibleCompanies(apps ?? (() => { try { return parseApplicationsMd(); } catch { return []; } })());
  const baselineId = getNewBaselineId();
  const touchIdx = buildCompanyTouchIndex({ ta, rec });
  const today = _localToday();
  const out = [];
  const consider = (row, source) => {
    if (!_hasLinkedIn(row)) return;              // no LinkedIn handle → not reachable here
    // LinkedIn-ONLY bucket. A contact who ALSO has a sendable email is high-value
    // (reachable both ways) and belongs in the Both queue, where both channels are
    // worked in parallel — not here. This keeps the three buckets mutually exclusive.
    if (isSendable(row)) return;
    if (CONNECT_QUEUE_EXCLUDE_STATUS.has(row.status)) return;
    const company = source === 'recruiter' ? row.firm : row.company;
    if (!applied.has(normalizeCompany(company))) return;   // only companies you've applied to
    out.push(_queueRow(row, source, baselineId, touchIdx.get(normalizeCompany(company)), today));
  };
  for (const r of ta)  consider(r, 'ta');
  for (const r of rec) consider(r, 'recruiter');
  return _sortByCompanyName(out);
}

// The email counterpart: contacts you CAN email (a sendable, verified address) at
// companies you've applied to, that you have not emailed yet. Working this list
// logs verified EMAIL touches (the 13/week floor) the same one-at-a-time way the
// connect queue logs LinkedIn connects.
function computeEmailQueue({ taRows, recruiterRows, apps } = {}) {
  const { ta, rec } = _bothBooks({ taRows, recruiterRows });
  const applied = outreachEligibleCompanies(apps ?? (() => { try { return parseApplicationsMd(); } catch { return []; } })());
  const baselineId = getNewBaselineId();
  const touchIdx = buildCompanyTouchIndex({ ta, rec });
  const today = _localToday();
  const out = [];
  const consider = (row, source) => {
    if (!isSendable(row)) return;                // MUST have a sendable email
    // Email-ONLY bucket. A contact who ALSO has a LinkedIn handle is high-value
    // (reachable both ways) and belongs in the Both queue, not here.
    if (_hasLinkedIn(row)) return;
    if (EMAIL_QUEUE_EXCLUDE_STATUS.has(row.status)) return;
    const company = source === 'recruiter' ? row.firm : row.company;
    if (!applied.has(normalizeCompany(company))) return;
    out.push(_queueRow(row, source, baselineId, touchIdx.get(normalizeCompany(company)), today));
  };
  for (const r of ta)  consider(r, 'ta');
  for (const r of rec) consider(r, 'recruiter');
  return _sortByCompanyName(out);
}

// The HIGH-VALUE bucket: contacts reachable BOTH ways (a verified email AND a
// LinkedIn handle) at a company you've applied to. These are worked on both
// channels in parallel — the multithread. Unlike the single-channel queues, a row
// here does NOT drop off after one touch: it stays until BOTH a LinkedIn invite and
// an email have gone out, or a reply/acceptance pauses it (BOTH_QUEUE_EXCLUDE_STATUS
// below). Each row carries linkedinDone / emailDone so the UI shows which channel is
// still open. 'Sent' is deliberately NOT an exclude status here — after one channel
// the status is Sent but the other channel is still owed, so inclusion is decided by
// the per-channel done flags, not the coarse status.
const BOTH_QUEUE_EXCLUDE_STATUS = new Set(['Archived', 'Replied', 'Meeting Scheduled', 'Connected']);
function _channelsDone(source, id) {
  let linkedinDone = false, emailDone = false;
  try {
    const corr = source === 'recruiter' ? readRecruiterCorrespondence(id) : readTTCorrespondence(id);
    for (const m of (corr || [])) {
      if (m.direction !== 'Sent') continue;
      if (isLinkedInInvite(m.subject)) linkedinDone = true;
      else emailDone = true;
    }
  } catch { /* unreadable log → treat as nothing done yet */ }
  return { linkedinDone, emailDone };
}
function computeBothQueue({ taRows, recruiterRows, apps } = {}) {
  const { ta, rec } = _bothBooks({ taRows, recruiterRows });
  const applied = outreachEligibleCompanies(apps ?? (() => { try { return parseApplicationsMd(); } catch { return []; } })());
  const baselineId = getNewBaselineId();
  const touchIdx = buildCompanyTouchIndex({ ta, rec });
  const today = _localToday();
  const out = [];
  const consider = (row, source) => {
    if (!(_hasLinkedIn(row) && isSendable(row))) return;   // must have BOTH channels
    if (BOTH_QUEUE_EXCLUDE_STATUS.has(row.status)) return; // a reply/acceptance pauses the multithread
    const company = source === 'recruiter' ? row.firm : row.company;
    if (!applied.has(normalizeCompany(company))) return;
    const { linkedinDone, emailDone } = _channelsDone(source, row.id);
    if (linkedinDone && emailDone) return;                 // both channels already touched → done
    out.push({ ..._queueRow(row, source, baselineId, touchIdx.get(normalizeCompany(company)), today), linkedinDone, emailDone });
  };
  for (const r of ta)  consider(r, 'ta');
  for (const r of rec) consider(r, 'recruiter');
  return _sortByCompanyName(out);
}

// ── Unified follow-up queue ──────────────────────────────────────────────────
// One ranked work queue that merges the three channel queues (LinkedIn-only,
// email-only, both) so the user works a single list instead of flipping between
// three tabs. The three are mutually exclusive by construction (see the bucket
// gates in each builder), so the union needs no dedup. Each row is tagged with
// `channel` ('linkedin' | 'email' | 'both') for the UI's filter chips, and a
// numeric `rank` (higher = do sooner) for the sort.
//
// RANK (importance first, then last-touch recency, per the agreed formula):
//   + hiring principal (decision-maker)         +50
//   + dual-channel "both" (multithread, high value) +20
//   + status weight (further in the process = more valuable to nudge)
//   + overdue: older last self-touch = higher; never-contacted = neutral middle
// The weights are intentionally simple and live here so they are easy to tune;
// changing them changes only the order, never which rows appear.
const _FUQ_STATUS_WEIGHT = {
  'Responded': 25, 'Phone Screen': 40,
  '1st Interview': 45, '2nd Interview': 50, '3rd Interview': 55, '4th Interview': 60,
  'Sent': 5, 'Drafted': 3,
};
function _followupRank(r) {
  let score = 0;
  if (r.isPrincipal) score += 50;
  if (r.channel === 'both') score += 20;
  score += _FUQ_STATUS_WEIGHT[r.status] || 0;
  // Recency: a contact you last touched long ago is more overdue. Never-contacted
  // rows (no prior self-touch) get a neutral middle so importance decides their
  // slot rather than floating them to either extreme.
  const d = r.companyOutreach?.selfLastTouch?.date;
  const days = d ? _businessDaysAgo(d) : null;
  score += (days == null) ? 15 : Math.min(days, 60) * 0.5;
  return score;
}
function computeFollowupQueue(opts = {}) {
  const rows = [
    ...computeConnectQueue(opts).map(r => ({ ...r, channel: 'linkedin' })),
    ...computeEmailQueue(opts).map(r => ({ ...r, channel: 'email' })),
    ...computeBothQueue(opts).map(r => ({ ...r, channel: 'both' })),
  ];
  for (const r of rows) r.rank = _followupRank(r);
  // Rank desc; company then name as a stable tiebreak so equal-rank rows don't
  // shuffle between reloads.
  rows.sort((a, b) =>
    (b.rank - a.rank) ||
    (a.company || '').localeCompare(b.company || '') ||
    (a.name || '').localeCompare(b.name || ''));
  return rows;
}

// "High value" = reachable BOTH ways (a verified/sendable email AND a LinkedIn
// handle). It was once its own Network directory page; now it is a per-contact
// SIGNAL (a star + filter) on the TA and Recruiter tables, computed by this one
// predicate so every surface agrees on what "high value" means. Same dual-channel
// criteria the both-queue uses (contactChannelBucket bucket 3).
function isHighValueContact(row) {
  return contactChannelBucket(row).bucket === 3;
}

// Applied roles in OUTREACH_ELIGIBLE_STATUSES that have ZERO contacts (no TA or
// recruiter row) at the same company. These are "fly-blind" applications: you have
// a live application but nobody to surface yourself to. Each row is a prompt to
// find a hiring-principal or TA contact for that company.
//
// Excludes any company where at least one row exists in either contact book,
// regardless of contact status (even Archived rows count — the user already mapped
// that company and chose not to pursue contacts there).
function computeContactlessApps({ apps, taRows, recruiterRows } = {}) {
  const appList = apps ?? (() => { try { return parseApplicationsMd(); } catch { return []; } })();
  const { ta, rec } = _bothBooks({ taRows, recruiterRows });
  const hasContact = new Set();
  for (const r of ta)  if ((r.company || '').trim()) hasContact.add(normalizeCompany(r.company));
  for (const r of rec) if ((r.firm   || '').trim()) hasContact.add(normalizeCompany(r.firm));
  const out = [];
  for (const a of appList) {
    if (!OUTREACH_ELIGIBLE_STATUSES.includes(a.status)) continue;
    const co = normalizeCompany(a.company);
    if (!co || hasContact.has(co)) continue;
    out.push({
      source: 'app',
      id: a.num,
      company: a.company || '',
      role: a.role || '',
      status: a.status,
      applyDate: a.date || null,
      score: a.score || null,
    });
  }
  out.sort((a, b) => (b.applyDate || '').localeCompare(a.applyDate || ''));
  return out;
}

// How many contacts are being held back purely because their address could not be
// checked. The send gate refusing an unverified address is correct, but its effect
// is INVISIBLE: the row simply does not appear, and fewer rows looks like a quiet
// week rather than a missing setting. This counts what the gate is withholding so
// the number can be shown instead of implied.
//
// Counted: a non-archived contact WITH an address on file that isSendable rejects.
// Not counted: contacts with no address at all (nothing is being withheld there,
// there is simply nothing to send to) and observed-dead states (bounced / invalid /
// blocked), where the address was checked and really is unusable. A key would not
// rescue either group, so including them would overstate what turning it on buys.
const _WITHHELD_STATES = new Set(['unverified', '', undefined, null]);
function countWithheldContacts({ taRows, recruiterRows } = {}) {
  const ta  = taRows        ?? (() => { try { return parseTargetTalentMd(); } catch { return []; } })();
  const rec = recruiterRows ?? (() => { try { return parseRecruitersMd();  } catch { return []; } })();
  let withheld = 0;
  for (const row of [...ta, ...rec]) {
    if (!row || row.status === 'Archived') continue;
    if (!(row.email || '').trim()) continue;
    if (isSendable(row)) continue;
    if (_WITHHELD_STATES.has(row.verified?.state)) withheld++;
  }
  return withheld;
}

export {
  parseFollowupsMd, appendFollowupRow, computeStaleApps, computeStaleTA, computeStaleContacts,
  computeGhostedCandidates, channelFor, contactChannelBucket, computeConnectQueue, computeEmailQueue, computeBothQueue,
  computeFollowupQueue, _followupRank,
  isHighValueContact, computeContactlessApps, countWithheldContacts,
  GHOST_DAYS, STALE_THRESHOLD_BY_STATUS, TA_STALE_THRESHOLD_DAYS, CONTACT_STALE_THRESHOLD_DAYS, _daysAgo,
};

