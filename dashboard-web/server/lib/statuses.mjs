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

// Did this app reach `stage` — currently at it / past it, or tagged
// [reached: <stage-or-later>] after the row closed (Rejected / No Response).
export function appReached(app, stage) {
  const idx = FUNNEL_ORDER.indexOf(stage);
  if (idx < 0) return false;
  if (FUNNEL_ORDER.indexOf(app.status) >= idx) return true;
  const r = reachedStage(app.notes);
  if (!r) return false;
  return FUNNEL_ORDER.indexOf(r) >= idx;
}
