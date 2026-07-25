#!/usr/bin/env node
/**
 * rate-confidence.test.mjs — pins the sample-size gate + Wilson interval that
 * back the Insights "stop manufacturing false confidence" work.
 *
 * No fixtures, no files: the module is pure math. These checks pin the three
 * properties the UI relies on — the gate fires below MIN_SAMPLE, the interval
 * stays inside [0,100] at the extremes, and it tightens as n grows.
 *
 * Run: node tests/rate-confidence.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { wilson, rateStat, MIN_SAMPLE } from '../dashboard-web/server/lib/rate-confidence.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}
function eq(actual, expected, msg) {
  check(actual === expected, `${msg} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

console.log('rate-confidence.test.mjs');

// ── wilson: degenerate + extremes never escape [0,100] or divide by zero ──────
const w00 = wilson(0, 0);
eq(w00.rate, 0, 'wilson(0,0) rate is 0 (no divide-by-zero)');
eq(w00.lo, 0, 'wilson(0,0) lo is 0');
eq(w00.hi, 0, 'wilson(0,0) hi is 0');

const w11 = wilson(1, 1);
eq(w11.rate, 100, 'wilson(1,1) point estimate is 100%');
eq(w11.hi, 100, 'wilson(1,1) upper bound caps at 100');
check(w11.lo >= 0 && w11.lo < 100, `wilson(1,1) lower bound is honest, not 100 (got ${w11.lo})`);

const w01 = wilson(0, 1);
eq(w01.rate, 0, 'wilson(0,1) point estimate is 0%');
eq(w01.lo, 0, 'wilson(0,1) lower bound floors at 0');
check(w01.hi > 0 && w01.hi <= 100, `wilson(0,1) upper bound is not 0 — 0 of 1 does not prove 0% (got ${w01.hi})`);

// ── wilson: a thin sample yields a WIDE band; a fat one a tight band ──────────
const wThin = wilson(2, 7);     // ~29%
const wFat  = wilson(50, 100);  // 50%
eq(wThin.rate, 29, 'wilson(2,7) rounds to 29%');
eq(wFat.rate, 50, 'wilson(50,100) is 50%');
check(wThin.hi - wThin.lo > 40, `2 of 7 is a wide band, i.e. barely knowable (width ${wThin.hi - wThin.lo})`);
check(wFat.hi - wFat.lo < 25, `50 of 100 is a tighter band (width ${wFat.hi - wFat.lo})`);

// same proportion (0.1), more data → strictly tighter interval
const wSmall = wilson(1, 10);
const wLarge = wilson(10, 100);
check((wLarge.hi - wLarge.lo) < (wSmall.hi - wSmall.lo),
  `more data tightens the band at fixed p (10/100 width ${wLarge.hi - wLarge.lo} < 1/10 width ${wSmall.hi - wSmall.lo})`);

// bounds + ordering hold across a sweep
for (const [k, n] of [[0, 3], [1, 4], [3, 5], [7, 9], [4, 12], [25, 40], [160, 161]]) {
  const w = wilson(k, n);
  check(w.lo >= 0 && w.hi <= 100 && w.lo <= w.hi && w.lo <= w.rate && w.rate <= w.hi,
    `wilson(${k},${n}) stays in [0,100] and lo<=rate<=hi (${w.lo}/${w.rate}/${w.hi})`);
}

// ── rateStat: the gate fires exactly at MIN_SAMPLE ────────────────────────────
eq(MIN_SAMPLE, 10, 'MIN_SAMPLE is the agreed strict gate of 10');
check(rateStat(3, 7).sufficient === false, '7 applications is below the gate → insufficient');
check(rateStat(4, 9).sufficient === false, '9 applications is still below the gate');
check(rateStat(4, 10).sufficient === true, 'exactly 10 clears the gate');
check(rateStat(0, 50).sufficient === true, '0 of 50 is sufficient data for a real 0% (it is knowable)');
const rs = rateStat(3, 47);
check(rs.k === 3 && rs.n === 47, 'rateStat exposes the raw k of n so the UI can show the fraction');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
