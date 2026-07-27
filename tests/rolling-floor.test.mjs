#!/usr/bin/env node
/**
 * rolling-floor.test.mjs — the pure compute half of the rolling outreach floor.
 * No IO: computeRollingFloor takes a pinned `now` and explicit inputs, so the
 * window/PTO/weekend/grace/ramp logic is exercised deterministically.
 */
import assert from 'node:assert/strict';
import { computeRollingFloor } from '../dashboard-web/server/lib/rolling-floor.mjs';

let n = 0;
const ok = (m) => { n++; console.log('  ok ' + m); };

// A helper to make N touch dates all on the same day.
const rep = (date, k) => Array.from({ length: k }, () => date);

// Fri 2026-07-24 is a working day. Its trailing 5 working days are
// Mon 20 .. Fri 24 (weekend 18/19 excluded from the *requirement*).
const FRI = '2026-07-24';

// 1) Weekends are excluded from the requirement window (5 working days ≠ 5 calendar days).
{
  const st = computeRollingFloor({ now: FRI, touchDates: [], floor: 13 });
  assert.deepEqual(st.window, ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']);
  assert.equal(st.windowStart, '2026-07-20');
  ok('window is the trailing 5 WORKING days (weekend skipped)');
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

// 3) Credit counts on a WEEKEND day inside the span (weekends contribute).
{
  // Touches on Sun 2026-07-19 fall inside [2026-07-20? no]. Use a weekend INSIDE the span:
  // span is 07-20..07-24, which contains no weekend. Push today to Mon 07-27 so the
  // span 07-21..07-27 contains Sat 07-25 / Sun 07-26.
  const MON = '2026-07-27';
  const wk = computeRollingFloor({ now: MON, touchDates: rep('2026-07-26', 13), floor: 13 }); // all on Sunday
  assert.equal(wk.window[wk.window.length - 1], '2026-07-27');
  assert.ok(wk.windowStart <= '2026-07-26' && '2026-07-26' <= MON, 'sunday is in span');
  assert.equal(wk.trailingCount, 13, 'weekend touches counted as credit');
  assert.equal(wk.met, true);
  ok('weekend touches count as credit even though weekends are not required days');
}

// 4) PTO: a marked day off is skipped in the window (reaches further back), and no
//    lock pressure comes from it.
{
  // today Fri 07-24, mark Wed 07-22 as PTO → window skips it, reaching Fri 07-17.
  const st = computeRollingFloor({ now: FRI, touchDates: [], pto: ['2026-07-22'], floor: 13 });
  assert.ok(!st.window.includes('2026-07-22'), 'PTO day not in the working window');
  assert.deepEqual(st.window, ['2026-07-17', '2026-07-20', '2026-07-21', '2026-07-23', '2026-07-24']);
  ok('PTO day is skipped; window reaches one working day further back');
}

// 5) Reset grace period unlocks even when behind, through graceDays working days.
{
  // Reset on Mon 07-20, graceDays 3 → grace covers 07-20 + Tue,Wed,Thu = through 07-23.
  // Old touch establishes history so the state is grace, not ramp-in.
  const HIST = '2026-07-01';
  const inGrace = computeRollingFloor({ now: '2026-07-23', touchDates: [HIST], resets: ['2026-07-20'], floor: 13, graceDays: 3 });
  assert.equal(inGrace.inGrace, true);
  assert.equal(inGrace.graceUntil, '2026-07-23');
  assert.equal(inGrace.state, 'grace');
  assert.equal(inGrace.unlocked, true);

  // The next working day (Fri 07-24) is past the grace window → behind again.
  const afterGrace = computeRollingFloor({ now: '2026-07-24', touchDates: [HIST], resets: ['2026-07-20'], floor: 13, graceDays: 3 });
  assert.equal(afterGrace.inGrace, false);
  assert.equal(afterGrace.state, 'behind');
  assert.equal(afterGrace.unlocked, false);
  ok('reset grace unlocks through graceDays working days, then normal rolling resumes');
}

// 6) Monthly reset availability.
{
  const used = computeRollingFloor({ now: '2026-07-24', touchDates: rep('2026-07-20', 1), resets: ['2026-07-20'], floor: 13 });
  assert.equal(used.reset.availableThisMonth, false, 'a July reset makes July unavailable');
  const fresh = computeRollingFloor({ now: '2026-08-03', touchDates: rep('2026-08-01', 1), resets: ['2026-07-20'], floor: 13 });
  assert.equal(fresh.reset.availableThisMonth, true, 'August is available again');
  ok('reset is rate-limited to once per calendar month');
}

// 7) Ramp-in: a brand-new user with < 5 working days of history is not locked.
{
  const ramp = computeRollingFloor({ now: FRI, touchDates: ['2026-07-23'], floor: 13 }); // first touch yesterday
  assert.equal(ramp.state, 'ramp-in');
  assert.equal(ramp.unlocked, true);

  const noData = computeRollingFloor({ now: FRI, touchDates: [], floor: 13 });
  assert.equal(noData.state, 'no-data');
  assert.equal(noData.unlocked, true);
  ok('ramp-in / no-data never lock a new user');
}

console.log(`\n  ${n} rolling-floor checks passed`);
