#!/usr/bin/env node
/**
 * weekly-run.test.mjs — the pure core of the shared weekly-review WRITE engine
 * (lib/weekly-run.mjs), the one both the CLI and the dashboard "Run weekly review"
 * button drive.
 *
 * Pins the two pure pieces: buildWeekEntry (freeze a week's numbers into a log
 * row) and upsertWeek (idempotent, sorted history). The I/O orchestrator
 * runWeeklyReview is exercised end to end by the CLI dry run; here we lock the
 * shapes that make a frozen, re-runnable log possible.
 *
 * All inputs are invented. No files are read or written.
 *
 * Run: node tests/weekly-run.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { buildWeekEntry, upsertWeek } from '../dashboard-web/server/lib/weekly-run.mjs';
import { evaluateFloors } from '../dashboard-web/server/lib/review-thresholds.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('weekly-run.test.mjs');

// ── buildWeekEntry: freeze a week ────────────────────────────────────────────
// A metrics object shaped like weeklyMetrics output, including the weekStart/
// weekEnd scalars that must NOT bleed into the frozen metrics map.
const metrics = {
  weekStart: '2026-07-20', weekEnd: '2026-07-26',
  verifiedTouches:  { value: 15, available: true, source: 'correspondence' },
  linkedinConnects: { value: 40, available: true, source: 'connects log' },
  cadencePct:       { value: 72, available: true, source: 'cadence log' },
  replies:          { value: 3,  available: true, source: 'correspondence' },
};
const floors = evaluateFloors(metrics);
const entry = buildWeekEntry({ weekStart: '2026-07-20', weekEnd: '2026-07-26', metrics, floors });

check(entry.week === '2026-07-20' && entry.weekEnd === '2026-07-26', 'entry carries the week window');
check(entry.outreachMet === true, 'outreachMet is the verified-touches floor result (15 >= 13 → true)');
check(Array.isArray(entry.floors) && entry.floors.length === 3, 'entry snapshots all three floor rows');
const vt = entry.floors.find(f => f.key === 'verifiedTouches');
check(vt && vt.value === 15 && vt.floor === 13 && vt.met === true && vt.available === true,
  'a floor row freezes value, floor, met, and available');
check(!('weekStart' in entry.metrics) && !('weekEnd' in entry.metrics),
  'the week scalars are stripped from the frozen metrics map');
check(entry.metrics.verifiedTouches && entry.metrics.verifiedTouches.value === 15 && entry.metrics.verifiedTouches.available === true,
  'a frozen metric keeps only value + available');
check(entry.metrics.replies && entry.metrics.replies.value === 3, 'non-floor indicators are frozen too');

// A not-logged outreach floor freezes as unknown, never as a passed/failed zero.
const blankFloors = evaluateFloors({ verifiedTouches: { available: false }, linkedinConnects: { available: false }, cadencePct: { available: false } });
const blankEntry = buildWeekEntry({ weekStart: '2026-07-27', weekEnd: '2026-08-02', metrics: { verifiedTouches: { value: null, available: false } }, floors: blankFloors });
check(blankEntry.outreachMet === null, 'a not-logged outreach floor freezes outreachMet as null, not false');

// ── upsertWeek: idempotent, sorted history ───────────────────────────────────
const w13 = { week: '2026-07-13', weekEnd: '2026-07-19', outreachMet: true };
const w20 = { week: '2026-07-20', weekEnd: '2026-07-26', outreachMet: false };

let hist = upsertWeek([], w13);
check(hist.length === 1 && hist[0].week === '2026-07-13', 'insert into empty history');
hist = upsertWeek(hist, w20);
check(hist.length === 2 && hist[1].week === '2026-07-20', 'a second, later week appends in order');

// Re-running the same week OVERWRITES its row (a review is idempotent).
const w20again = { week: '2026-07-20', weekEnd: '2026-07-26', outreachMet: true };
hist = upsertWeek(hist, w20again);
check(hist.length === 2, 're-running a week does not grow the history');
check(hist.find(h => h.week === '2026-07-20').outreachMet === true, 're-running a week overwrites its row');

// An out-of-order insert is sorted oldest → newest, so index order is trustworthy.
const w06 = { week: '2026-07-06', weekEnd: '2026-07-12', outreachMet: null };
hist = upsertWeek(hist, w06);
check(hist[0].week === '2026-07-06' && hist[hist.length - 1].week === '2026-07-20', 'history stays sorted after an out-of-order insert');

// Null / missing history is safe (first-ever run).
check(upsertWeek(null, w13).length === 1, 'null history → a single-entry history, no throw');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
