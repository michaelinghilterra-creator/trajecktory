/**
 * lib/weekly-run.mjs — the WRITE side of the weekly review, factored out so the
 * CLI (weekly-review.mjs) and the dashboard's "Run weekly review" button drive
 * exactly ONE engine and can never disagree. This mirrors collectWeeklyMetrics
 * being the one READ side: the screen and the CLI already share the numbers, and
 * now they share the act of freezing a week and deciding the build lock too.
 *
 * WHY FREEZING MATTERS: buildWeekEntry snapshots the metrics AS REVIEWED into the
 * log. Once a week is logged, its numbers are fixed there, so a later week-over-
 * week view never moves — even though the live cadence adherence recomputes
 * against the CURRENT template and the live reply rate keeps climbing. The past is
 * the frozen log; only the in-progress (unlogged) week is still live. Running the
 * review IS the snapshot, which is why it is a deliberate button and not implicit.
 *
 * buildWeekEntry and upsertWeek are PURE (no fs) so they are unit-tested with no
 * files touched; runWeeklyReview does the I/O and is what both callers invoke.
 */
import fs from 'fs';
import { collectWeeklyMetrics } from './weekly-collect.mjs';
import { evaluateFloors, lockDecision, OUTREACH_FLOOR_KEY } from './review-thresholds.mjs';
import { REVIEW_LOG_PATH, BUILD_LOCK_PATH } from '../config.mjs';

// Shape ONE week's history row from its metrics + floor evaluation. Pure. Stores
// the floor results and the flattened metric values so a later view reads frozen
// numbers, never a recompute.
export function buildWeekEntry({ weekStart, weekEnd, metrics, floors }) {
  const outreachMet = floors.results.find(r => r.key === OUTREACH_FLOOR_KEY)?.met ?? null;
  return {
    week: weekStart, weekEnd, outreachMet,
    floors: floors.results.map(r => ({ key: r.key, value: r.value, floor: r.floor, met: r.met, available: r.available })),
    metrics: Object.fromEntries(Object.entries(metrics)
      .filter(([k]) => k !== 'weekStart' && k !== 'weekEnd')
      .map(([k, v]) => [k, { value: v.value, available: v.available }])),
  };
}

// Upsert a week into history: re-running the same week OVERWRITES its row (a
// review is idempotent), the rest are untouched, and the result is sorted oldest
// → newest so a reader can trust index order. Pure.
export function upsertWeek(history, entry) {
  const next = (history || []).filter(h => h.week !== entry.week);
  next.push(entry);
  next.sort((a, b) => (a.week || '').localeCompare(b.week || ''));
  return next;
}

const readLog = () => { try { return JSON.parse(fs.readFileSync(REVIEW_LOG_PATH, 'utf8')) || []; } catch { return []; } };

// Run the review for the week containing `now`: collect the metrics, evaluate the
// floors, freeze the week into the log, decide the build lock from the run of
// outreach results, and (unless write===false) persist the log + lock. Returns
// everything both callers need to print or render. `write:false` is the dry run.
export function runWeeklyReview({ now = new Date(), write = true } = {}) {
  const { weekStart, weekEnd, metrics } = collectWeeklyMetrics(now);
  const floors = evaluateFloors(metrics);
  const entry = buildWeekEntry({ weekStart, weekEnd, metrics, floors });
  const history = upsertWeek(readLog(), entry);
  const lock = lockDecision(history.map(h => ({ week: h.week, outreachMet: h.outreachMet })));
  if (write) {
    fs.writeFileSync(REVIEW_LOG_PATH, JSON.stringify(history, null, 2) + '\n');
    fs.writeFileSync(BUILD_LOCK_PATH, JSON.stringify(
      { locked: lock.locked, reason: lock.reason, since: lock.locked ? weekStart : null, week: weekStart }, null, 2) + '\n');
  }
  return { weekStart, weekEnd, metrics, floors, lock, history, entry };
}
