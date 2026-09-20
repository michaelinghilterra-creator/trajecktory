#!/usr/bin/env node
/**
 * weekly-review.test.mjs — the weekly-review engine's pure core.
 *
 * Pins: week windowing, the metric availability rule (not-logged is unknown, not
 * zero), and floor evaluation. The weekly build-lock decision was retired in
 * favour of the live rolling floor (see tests/rolling-floor.test.mjs).
 *
 * Run: node tests/weekly-review.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { weeklyMetrics, weekBounds } from '../dashboard-web/server/lib/weekly-metrics.mjs';
import { evaluateFloors, FLOORS } from '../dashboard-web/server/lib/review-thresholds.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('weekly-review.test.mjs');

// ── weekBounds ───────────────────────────────────────────────────────────────
// 2026-07-23 is a Thursday → week runs Mon 2026-07-20 to Sun 2026-07-26.
const wb = weekBounds(new Date(2026, 6, 23));
check(wb.weekStart === '2026-07-20', `Thursday maps to its Monday (got ${wb.weekStart})`);
check(wb.weekEnd === '2026-07-26', `week ends the following Sunday (got ${wb.weekEnd})`);
const wbSun = weekBounds(new Date(2026, 6, 26)); // Sunday stays in the same week
check(wbSun.weekStart === '2026-07-20', 'Sunday maps back to the same Monday');
const wbMon = weekBounds(new Date(2026, 6, 20));
check(wbMon.weekStart === '2026-07-20', 'Monday maps to itself');

// ── weeklyMetrics windowing + availability ───────────────────────────────────
const start = '2026-07-20', end = '2026-07-26';
const correspondence = [
  { direction: 'Sent', date: '2026-07-21' },       // in
  { direction: 'Sent', date: '2026-07-24' },       // in
  { direction: 'Sent', date: '2026-07-13' },       // prior week, out
  { direction: 'Received', date: '2026-07-22' },   // in
  { direction: 'Received', date: '2026-07-27' },   // next week, out
];
const m = weeklyMetrics({
  weekStart: start, weekEnd: end,
  correspondence,
  deliveredReplyRatePct: 18,
  statusEvents: [{ status: 'Phone Screen', date: '2026-07-23' }, { status: 'Phone Screen', date: '2026-07-10' }, { status: 'Applied', date: '2026-07-22' }],
  debriefs: [{ date: '2026-07-23', hasObjection: true }, { date: '2026-07-23', hasObjection: false }, { date: '2026-07-01', hasObjection: true }],
  connects: [{ date: '2026-07-21' }, { date: '2026-07-25' }, { date: '2026-06-30' }],
  cadencePct: 80,
  unservicedApplications: 12,
});
check(m.verifiedTouches.value === 2 && m.verifiedTouches.available, 'touches counted within the week only');

// Channel split: a LinkedIn connection request shares the correspondence log but
// is a connect, not a verified (email) touch. It must not book as a touch.
const mixed = weeklyMetrics({
  weekStart: start, weekEnd: end,
  correspondence: [
    { direction: 'Sent', date: '2026-07-21', subject: 'Re: your RevOps opening' },       // email touch
    { direction: 'Sent', date: '2026-07-22', subject: 'LinkedIn connection request' },    // connect, not a touch
    { direction: 'Sent', date: '2026-07-23', subject: 'LinkedIn connection request (2nd try)' }, // still a connect
  ],
  connects: [{ date: '2026-07-21' }, { date: '2026-07-22' }, { date: '2026-07-23' }],
});
check(mixed.verifiedTouches.value === 1, 'LinkedIn invites are excluded from verified (email) touches');
check(mixed.linkedinConnects.value === 3, 'connects come from the connects log, counted separately');
check(m.replies.value === 1, 'replies counted within the week only');
check(m.deliveredReplyRatePct.value === 18 && m.deliveredReplyRatePct.available, 'delivered reply rate is the injected cumulative number, not a same-week ratio');
check(weeklyMetrics({ weekStart: start, weekEnd: end, correspondence }).deliveredReplyRatePct.available === false, 'no reply rate provided → not logged (never a same-week ratio)');
check(m.screensBooked.value === 1, 'only in-week Phone Screen events count as screens');
check(m.objectionsLogged.value === 1, 'only in-week debriefs WITH an objection count');
check(m.linkedinConnects.value === 2, 'only in-week connects count');
check(m.cadencePct.value === 80 && m.cadencePct.available, 'cadence passed through');
check(m.unservicedApplications.value === 12, 'unserviced applications passed through');

// not-logged vs zero
const blank = weeklyMetrics({ weekStart: start, weekEnd: end });
check(blank.verifiedTouches.available === false, 'no correspondence → touches not-logged');
check(blank.linkedinConnects.available === false, 'null connects (no log) → not-logged, not a zero');
check(blank.cadencePct.available === false, 'no cadence → not-logged');
const emptyConnects = weeklyMetrics({ weekStart: start, weekEnd: end, connects: [] });
check(emptyConnects.linkedinConnects.available === true && emptyConnects.linkedinConnects.value === 0,
  'an existing-but-empty connects log reads a real zero');

// ── evaluateFloors ───────────────────────────────────────────────────────────
const metA = { verifiedTouches: { value: 15, available: true }, linkedinConnects: { value: 40, available: true }, cadencePct: { value: 72, available: true } };
const fe = evaluateFloors(metA);
check(fe.results.find(r => r.key === 'verifiedTouches').met === true, '15 >= 13 floor → met');
check(fe.results.find(r => r.key === 'linkedinConnects').met === false, '40 < 50 floor → missed');
check(fe.missed.includes('linkedinConnects'), 'missed list names the connects floor');
check(fe.allMet === false, 'allMet false when one floor missed');
const feBlank = evaluateFloors({ verifiedTouches: { available: false } });
check(feBlank.results.find(r => r.key === 'verifiedTouches').met === null, 'not-logged floor is null, not a fail');
check(feBlank.notLogged.includes('verifiedTouches'), 'notLogged names the missing floor');
check(FLOORS.verifiedTouches.min === 13, 'outreach floor is 13/wk per the plan');

// The weekly build-lock (lockDecision) was retired; the build cap is now the live
// rolling floor, covered by tests/rolling-floor.test.mjs.

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
