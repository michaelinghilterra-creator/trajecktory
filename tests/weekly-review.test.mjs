#!/usr/bin/env node
/**
 * weekly-review.test.mjs — the weekly-review engine's pure core.
 *
 * Pins: week windowing, the metric availability rule (not-logged is unknown, not
 * zero), floor evaluation, and the build-lock decision (2 consecutive genuine
 * outreach misses, a not-logged week never trips it).
 *
 * Run: node tests/weekly-review.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { weeklyMetrics, weekBounds } from '../dashboard-web/server/lib/weekly-metrics.mjs';
import { evaluateFloors, lockDecision, FLOORS } from '../dashboard-web/server/lib/review-thresholds.mjs';

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

// ── lockDecision ─────────────────────────────────────────────────────────────
check(lockDecision([{ outreachMet: false }, { outreachMet: false }]).locked === true, 'two consecutive misses → lock');
check(lockDecision([{ outreachMet: false }, { outreachMet: true }]).locked === false, 'a met week clears the lock');
check(lockDecision([{ outreachMet: false }, { outreachMet: null }]).locked === false, 'a not-logged week does not trip the lock');
check(lockDecision([{ outreachMet: false }]).locked === false, 'a single miss only flags, does not lock');
check(lockDecision([]).locked === false, 'no history → no lock');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
