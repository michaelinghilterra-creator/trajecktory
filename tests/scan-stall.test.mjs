#!/usr/bin/env node
/**
 * scan-stall.test.mjs — pin the Agent Scan "narrate-and-quit" detector.
 *
 * WHY THIS EXISTS:
 * The scan discovery step stalled on 2026-08-21: Haiku ran the deterministic prep
 * steps, then echoed "Performing discovery searches for emerging companies.." and
 * ended its turn without issuing a single WebSearch. The run exited clean, so the
 * only symptom was a generic "wrote nothing" warning. scanDiscoveryStalled is the
 * enforced detector that fires the automatic Sonnet retry.
 *
 * The one distinction that MUST hold: a zero-search run is a stall (retry it); a
 * run that searched and simply found no new company is honest work (leave it).
 * If those two collapse, the guard either misses the real stall or wrongly
 * retries every empty widen — both regressions, neither caught by any type check.
 *
 * Run: node tests/scan-stall.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { scanDiscoveryStalled } from '../lib/scan-stall.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('scan-stall.test.mjs');

// STALL: never searched, produced nothing → true (the 2026-08-21 signature).
check(scanDiscoveryStalled({ webSearchCount: 0, added: 0, rolesAdded: 0 }) === true,
  'zero searches + nothing produced is a stall');
check(scanDiscoveryStalled({ webSearchCount: 0 }) === true,
  'zero searches with omitted counts defaults to a stall');

// NORMAL empty widen: it SEARCHED and found no new company → NOT a stall. This is
// the common, legitimate case (narrow title filter, already-swept universe) and
// must never trigger a retry.
check(scanDiscoveryStalled({ webSearchCount: 9, added: 0, rolesAdded: 0 }) === false,
  'searched-but-found-nothing is NOT a stall (must not retry)');
check(scanDiscoveryStalled({ webSearchCount: 1, added: 0, rolesAdded: 0 }) === false,
  'even a single real search clears the stall signature');

// Produced something → never a stall, regardless of how the search count reads.
check(scanDiscoveryStalled({ webSearchCount: 0, added: 3, rolesAdded: 0 }) === false,
  'companies added means not a stall');
check(scanDiscoveryStalled({ webSearchCount: 0, added: 0, rolesAdded: 5 }) === false,
  'roles added means not a stall');

// Robustness: undefined/garbage inputs must not throw and must not falsely fire
// a retry on a run we know nothing about (fail toward doing nothing).
check(scanDiscoveryStalled({}) === true,
  'empty object → treated as a stall (no evidence of search)');
check(scanDiscoveryStalled(undefined) === true,
  'undefined arg does not throw and defaults to a stall');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
