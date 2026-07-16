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
try {
  const doc = yaml.load(fs.readFileSync(STATES_FILE, 'utf8'));
  _states = Array.isArray(doc?.states) ? doc.states : [];
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

const _interviewSet = new Set(INTERVIEW_STAGES);
export function isInterviewStage(status) { return _interviewSet.has(status); }

export function funnelIndex(status) { return FUNNEL_ORDER.indexOf(status); }

// `[reached: <stage>]` notes tag parser — multi-word labels ("2nd Interview").
export function reachedStage(notes) {
  const m = (notes || '').match(/\[reached:\s*([^\]]+)\]/i);
  return m ? m[1].trim() : null;
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
