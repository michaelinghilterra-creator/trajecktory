// Shared status source-of-truth for the dashboard SERVER, derived from
// templates/states.yml so the round ladder is defined in exactly one place and
// the server's status lists can never drift from the canonical states (the
// problem the pre-refactor code had: the same list hardcoded in ~8 spots).
//
// Mirrors the frontend helpers in dashboard-web/src/data.js (INTERVIEW_STAGES,
// FUNNEL_ORDER, isInterviewStage, reachedStage, appReached).
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { ROOT_DIR } from '../config.mjs';

const STATES_FILE = path.join(ROOT_DIR, 'templates', 'states.yml');

let _states = [];
let _recruiterStates = [];
let _talentStates = [];
try {
  const doc = yaml.load(fs.readFileSync(STATES_FILE, 'utf8'));
  _states = Array.isArray(doc?.states) ? doc.states : [];
  _recruiterStates = Array.isArray(doc?.recruiter_states) ? doc.recruiter_states : [];
  _talentStates = Array.isArray(doc?.talent_states) ? doc.talent_states : [];
} catch (e) {
  console.warn('[statuses] could not load templates/states.yml:', e.message);
}

// Every canonical status label.
export const ALL_STATUSES = _states.map(s => s.label);

// Interview-family rungs, in funnel order (group: interview in states.yml).
export const INTERVIEW_STAGES = _states
  .filter(s => s.group === 'interview')
  .sort((a, b) => (a.funnel_order ?? 0) - (b.funnel_order ?? 0))
  .map(s => s.label);

// Full left-to-right pipeline funnel (states carrying a funnel_order).
export const FUNNEL_ORDER = _states
  .filter(s => Number.isFinite(s.funnel_order))
  .sort((a, b) => a.funnel_order - b.funnel_order)
  .map(s => s.label);

// Active = anything still on the funnel (Evaluated .. Offer). Closed/terminal =
// everything else (Rejected, Discarded, SKIP, Closed, Not a Fit, No Response).
export const ACTIVE_STATUSES = FUNNEL_ORDER.slice();
export const CLOSED_STATUSES = ALL_STATUSES.filter(s => !FUNNEL_ORDER.includes(s));

// Did this row enter the funnel at all, i.e. reach the FIRST rung?
//
// Every row in applications.md was evaluated: an evaluation is what creates the
// row and its report. So the Evaluated rung is not a stage a row can fail to
// reach by having a terminal status — Discarded, SKIP and Not a Fit are all
// decisions taken AFTER an evaluation, and they belong in the first rung's count.
//
// Asking `reached >= Evaluated` instead gets this exactly backwards, because none
// of those statuses sit on FUNNEL_ORDER: every evaluated-then-declined row scored
// as never-evaluated, the first rung collapsed onto the second (both reporting the
// same count), and the chart reported a 100% evaluate-to-apply conversion while
// hiding the largest drop in the whole pipeline.
//
// `Closed` is the one exclusion, consistent with every other denominator in the
// app: the posting closed before the user could act, so counting it as a role
// they chose not to apply to blames them for someone else's timing. It is
// surfaced as its own count instead, never silently folded in.
export function enteredFunnel(app) {
  return app?.status !== 'Closed';
}

// ─── Outreach ladders (recruiters + target talent) ──────────────────────────
// Separate vocabularies from the application funnel, but loaded from the SAME
// file so they cannot drift the way the hardcoded arrays did. `contacted` is
// intentionally not derived from `stage`: Dormant and Bounced are entered after
// a message goes out yet sit off the ladder, so a stage comparison erases them.
export const RECRUITER_STATES = _recruiterStates;
export const TALENT_STATES = _talentStates;
export const RECRUITER_STATUS_LABELS = _recruiterStates.map(s => s.label);
export const TALENT_STATUS_LABELS = _talentStates.map(s => s.label);
export const RECRUITER_CONTACTED = new Set(_recruiterStates.filter(s => s.contacted).map(s => s.label));
export const TALENT_CONTACTED = new Set(_talentStates.filter(s => s.contacted).map(s => s.label));
export const RECRUITER_REPLIED = new Set(_recruiterStates.filter(s => s.replied).map(s => s.label));
export const TALENT_REPLIED = new Set(_talentStates.filter(s => s.replied).map(s => s.label));

// A status seen in the data that no ladder knows about is a silent data-quality
// hole — it is how `Bounced` rendered as "Not Contacted" for a month. Warn on it
// the same way logStatusEvent does, rather than coercing it to a default rung.
export function warnUnknownStatus(kind, status, labels, id) {
  if (!status || labels.includes(status)) return false;
  console.warn(`[statuses] unknown ${kind} status "${status}"${id ? ` on ${id}` : ''} — not in templates/states.yml, so every ladder-based metric will skip it`);
  return true;
}

const _interviewSet = new Set(INTERVIEW_STAGES);
export function isInterviewStage(status) { return _interviewSet.has(status); }

export function funnelIndex(status) { return FUNNEL_ORDER.indexOf(status); }

// `[reached: <stage>]` notes tag parser — multi-word labels ("2nd Interview").
export function reachedStage(notes) {
  const m = (notes || '').match(/\[reached:\s*([^\]]+)\]/i);
  return m ? m[1].trim() : null;
}

// `[inbound]` notes tag: the recruiter reached out BEFORE any application, so
// this row's "response" was never a response to something the user sent. Kept in
// every count for now, but surfaced so the mix is visible — an inbound-heavy
// period makes the application response rate look better than it is.
//
// The signature is an invite dated at or before the application. Left untagged,
// those rows read as unusually fast outbound replies and drag the average
// days-to-response down.
export function isInbound(notes) {
  return /\[inbound\]/i.test(notes || '');
}

// The user reached a PERSON before or alongside the application, rather than
// posting into a portal and waiting. The mirror of isInbound: same warm channel,
// opposite direction.
//
// This distinction is the most load-bearing one in the tracker, because the two
// halves of "warm" have completely different strategic value. Inbound cannot be
// manufactured: you cannot make people find you on demand. Outbound can be run to
// a weekly floor, which is exactly what the 40-touch test measures. The relaunch
// plan rests the scalable half of its case on a single outbound data point, so
// pooling it with inbound would erase the only evidence the test is designed to
// grow. A cold portal application is NOT outbound in this sense and stays
// untagged: the tag marks contact with a person, not who initiated the paperwork.
export function isOutbound(notes) {
  return /\[outbound\]/i.test(notes || '');
}

// Furthest funnel rung an app EVER reached: the max of its live status, any
// dated status-event, and the [reached:] notes tag. Terminal rows (Rejected /
// No Response) imply they at least Applied. Credits history rather than only
// the live status, which otherwise drops anyone who replied and was later
// rejected out of the numerator while keeping them in the denominator.
//
// Events are passed in rather than read here so this module stays I/O-free.
// parseApplicationsMd stamps the result onto each row as `reached`, which is
// what the browser reads (it has no access to the event log).
export function makeFurthestIdx(events) {
  const eventsByApp = new Map();
  for (const e of events) {
    if (!eventsByApp.has(e.app)) eventsByApp.set(e.app, []);
    eventsByApp.get(e.app).push(e);
  }
  const idxOf = s => FUNNEL_ORDER.indexOf(s);
  const APPLIED_IDX = idxOf('Applied');
  const furthestIdx = (a) => {
    let idx = idxOf(a.status);
    if (a.status === 'Rejected' || a.status === 'No Response') idx = Math.max(idx, APPLIED_IDX);
    for (const e of (eventsByApp.get(String(a.id)) || [])) idx = Math.max(idx, idxOf(e.status));
    const r = reachedStage(a.notes);
    if (r) idx = Math.max(idx, idxOf(r));
    return idx;
  };
  return { furthestIdx, idxOf, eventsByApp };
}

// Did this app reach `stage`? Prefers the server-stamped `reached` rung; falls
// back to the tag-only rule for rows parsed without it.
export function appReached(app, stage) {
  const idx = FUNNEL_ORDER.indexOf(stage);
  if (idx < 0) return false;
  if (app.reached != null) return FUNNEL_ORDER.indexOf(app.reached) >= idx;
  if (FUNNEL_ORDER.indexOf(app.status) >= idx) return true;
  const r = reachedStage(app.notes);
  if (!r) return false;
  return FUNNEL_ORDER.indexOf(r) >= idx;
}
