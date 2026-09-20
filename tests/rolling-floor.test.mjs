#!/usr/bin/env node
/**
 * rolling-floor.test.mjs — the pure compute half of the rolling outreach floor.
 * No IO: computeRollingFloor takes a pinned `now` and explicit inputs, so the
 * window/PTO/grace/ramp logic is exercised deterministically. Every count is in
 * calendar days (Definitions v1 section 2); a PTO day is skipped, never demanded.
 */
import assert from 'node:assert/strict';
import { computeRollingFloor } from '../dashboard-web/server/lib/rolling-floor.mjs';

let n = 0;
const ok = (m) => { n++; console.log('  ok ' + m); };

// A helper to make N touch dates all on the same day.
const rep = (date, k) => Array.from({ length: k }, () => date);

// Fri 2026-07-24. Its trailing 7 calendar days are Sat 18 .. Fri 24.
const FRI = '2026-07-24';

// 1) The window is the trailing 7 calendar days, weekends included.
{
  const st = computeRollingFloor({ now: FRI, touchDates: [], floor: 13 });
  assert.deepEqual(st.window, ['2026-07-18', '2026-07-19', '2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']);
  assert.equal(st.windowStart, '2026-07-18');
  assert.equal(st.windowDays, 7);
  ok('window is the trailing 7 calendar days (weekend days included)');
}

// 2) Met vs behind, and the gate + gap.
{
  const met = computeRollingFloor({ now: FRI, touchDates: rep('2026-07-22', 13), floor: 13 });
  assert.equal(met.trailingCount, 13);
  assert.equal(met.met, true);
  assert.equal(met.state, 'met');
  assert.equal(met.unlocked, true);
  assert.equal(met.gap, 0);

  // include an old touch so the account is past ramp-in (established history).
  const behind = computeRollingFloor({ now: FRI, touchDates: ['2026-07-01', ...rep('2026-07-22', 9)], floor: 13 });
  assert.equal(behind.state, 'behind');
  assert.equal(behind.unlocked, false);
  assert.equal(behind.gap, 4);
  ok('met unlocks, behind locks, gap = floor - count');
}

// 3) The window edges: the oldest day in the window counts, the day before it does not.
{
  const edge = computeRollingFloor({ now: FRI, touchDates: [...rep('2026-07-18', 6), ...rep('2026-07-17', 7)], floor: 13 });
  assert.equal(edge.trailingCount, 6, 'only the touches on or after the window start count');
  assert.equal(edge.met, false);
  const today = computeRollingFloor({ now: FRI, touchDates: rep(FRI, 13), floor: 13 });
  assert.equal(today.met, true, 'touches on today count');
  const future = computeRollingFloor({ now: FRI, touchDates: rep('2026-07-25', 13), floor: 13 });
  assert.equal(future.trailingCount, 0, 'a touch dated after today does not count');
  ok('window edges: first day in, day before out, today in, tomorrow out');
}

// 4) A weekend day is an ordinary day: a touch on a Sunday counts, and a window that ends
//    on a Monday reaches back to the Tuesday before.
{
  const MON = '2026-07-27';
  const wk = computeRollingFloor({ now: MON, touchDates: rep('2026-07-26', 13), floor: 13 }); // all on Sunday
  assert.equal(wk.windowStart, '2026-07-21');
  assert.equal(wk.trailingCount, 13);
  assert.equal(wk.met, true);
  assert.deepEqual(wk.perDay.find(p => p.day === '2026-07-26'), { day: '2026-07-26', count: 13 });
  ok('weekend days are ordinary calendar days: they count and appear in the day strip');
}

// 5) PTO: a marked day off is skipped in the window (reaches further back), and no
//    lock pressure comes from it.
{
  // today Fri 07-24, mark Wed 07-22 as PTO: the window skips it, reaching Fri 07-17.
  const st = computeRollingFloor({ now: FRI, touchDates: [], pto: ['2026-07-22'], floor: 13 });
  assert.ok(!st.window.includes('2026-07-22'), 'PTO day not in the window');
  assert.deepEqual(st.window, ['2026-07-17', '2026-07-18', '2026-07-19', '2026-07-20', '2026-07-21', '2026-07-23', '2026-07-24']);
  // a touch made ON the PTO day still counts as credit
  const credit = computeRollingFloor({ now: FRI, touchDates: rep('2026-07-22', 13), pto: ['2026-07-22'], floor: 13 });
  assert.equal(credit.trailingCount, 13);
  assert.equal(credit.met, true);
  ok('PTO day is skipped, the window reaches one day further back, and a touch on it still counts');
}

// 6) Reset grace period unlocks even when behind, through graceDays calendar days.
{
  // Reset on Mon 07-20, graceDays 3: grace covers the reset day + 3 days = through Thu 07-23.
  // Old touch establishes history so the state is grace, not ramp-in.
  const HIST = '2026-07-01';
  const inGrace = computeRollingFloor({ now: '2026-07-23', touchDates: [HIST], resets: ['2026-07-20'], floor: 13, graceDays: 3 });
  assert.equal(inGrace.inGrace, true);
  assert.equal(inGrace.graceUntil, '2026-07-23');
  assert.equal(inGrace.state, 'grace');
  assert.equal(inGrace.unlocked, true);

  // The next day (Fri 07-24) is past the grace window: behind again.
  const afterGrace = computeRollingFloor({ now: '2026-07-24', touchDates: [HIST], resets: ['2026-07-20'], floor: 13, graceDays: 3 });
  assert.equal(afterGrace.inGrace, false);
  assert.equal(afterGrace.state, 'behind');
  assert.equal(afterGrace.unlocked, false);

  // Grace runs through a weekend: a Thursday reset with 3 days ends on Sunday, not Monday.
  const weekend = computeRollingFloor({ now: '2026-07-26', touchDates: [HIST], resets: ['2026-07-23'], floor: 13, graceDays: 3 });
  assert.equal(weekend.graceUntil, '2026-07-26');
  assert.equal(weekend.inGrace, true);
  const next = computeRollingFloor({ now: '2026-07-27', touchDates: [HIST], resets: ['2026-07-23'], floor: 13, graceDays: 3 });
  assert.equal(next.inGrace, false);

  // A PTO day is skipped when counting grace days.
  const pto = computeRollingFloor({ now: '2026-07-24', touchDates: [HIST], resets: ['2026-07-20'], pto: ['2026-07-21'], floor: 13, graceDays: 3 });
  assert.equal(pto.graceUntil, '2026-07-24');
  ok('reset grace unlocks through graceDays calendar days (weekends included, PTO skipped), then normal rolling resumes');
}

// 7) Monthly reset availability.
{
  const used = computeRollingFloor({ now: '2026-07-24', touchDates: rep('2026-07-20', 1), resets: ['2026-07-20'], floor: 13 });
  assert.equal(used.reset.availableThisMonth, false, 'a July reset makes July unavailable');
  const fresh = computeRollingFloor({ now: '2026-08-03', touchDates: rep('2026-08-01', 1), resets: ['2026-07-20'], floor: 13 });
  assert.equal(fresh.reset.availableThisMonth, true, 'August is available again');
  ok('reset is rate-limited to once per calendar month');
}

// 8) Ramp-in: a brand-new user with less than a full window of history is not locked.
{
  const ramp = computeRollingFloor({ now: FRI, touchDates: ['2026-07-23'], floor: 13 }); // first touch yesterday
  assert.equal(ramp.state, 'ramp-in');
  assert.equal(ramp.unlocked, true);

  // A first touch on 07-19 gives 6 days of history: still inside the ramp.
  const sixDays = computeRollingFloor({ now: FRI, touchDates: ['2026-07-19'], floor: 13 });
  assert.equal(sixDays.state, 'ramp-in');
  // A first touch on 07-18 gives a full 7 day window of history: established, behind, locked.
  const sevenDays = computeRollingFloor({ now: FRI, touchDates: ['2026-07-18'], floor: 13 });
  assert.equal(sevenDays.state, 'behind');
  assert.equal(sevenDays.unlocked, false);

  const noData = computeRollingFloor({ now: FRI, touchDates: [], floor: 13 });
  assert.equal(noData.state, 'no-data');
  assert.equal(noData.unlocked, true);
  ok('ramp-in / no-data never lock a new user, and ramp-in ends once a full 7 day window of history exists');
}

console.log(`\n  ${n} rolling-floor checks passed`);
