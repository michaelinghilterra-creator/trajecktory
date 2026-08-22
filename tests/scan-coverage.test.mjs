#!/usr/bin/env node
/**
 * scan-coverage.test.mjs — pin the pure coverage-folding logic in
 * lib/scan-coverage.mjs (updateCoverage), which turns silent coverage rot (a dead
 * ATS board looks identical to a board with no openings) into a visible alert.
 *
 * Run: node tests/scan-coverage.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { updateCoverage, GONE_QUIET_THRESHOLD } from '../lib/scan-coverage.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('scan-coverage.test.mjs');

// ── 1. found resets the zero counter and stamps lastFound ────────────────────
{
  const prev = { 'gh:acme': { name: 'Acme', ats: 'greenhouse', consecutiveZero: 4, lastFound: null } };
  const { coverage, alerts } = updateCoverage(prev, [
    { key: 'gh:acme', name: 'Acme', ats: 'greenhouse', result: 'found', found: 3 },
  ], '2026-08-22');
  check(coverage['gh:acme'].consecutiveZero === 0, 'found resets consecutiveZero to 0');
  check(coverage['gh:acme'].lastFound === '2026-08-22', 'found stamps lastFound');
  check(coverage['gh:acme'].found === 3, 'found records the count');
  check(alerts.length === 0, 'found raises no alert');
}

// ── 2. zero increments; alert only at the gone-quiet threshold ───────────────
{
  // One below the threshold: increments, no alert.
  const belowPrev = { 'gh:quiet': { name: 'Quiet', ats: 'ashby', consecutiveZero: GONE_QUIET_THRESHOLD - 2 } };
  const below = updateCoverage(belowPrev, [
    { key: 'gh:quiet', name: 'Quiet', ats: 'ashby', result: 'zero' },
  ], '2026-08-22');
  check(below.coverage['gh:quiet'].consecutiveZero === GONE_QUIET_THRESHOLD - 1, 'zero increments consecutiveZero');
  check(below.alerts.length === 0, 'below threshold: no gone-quiet alert');

  // Reaching the threshold fires exactly one gone-quiet alert.
  const atPrev = { 'gh:quiet': { name: 'Quiet', ats: 'ashby', consecutiveZero: GONE_QUIET_THRESHOLD - 1 } };
  const at = updateCoverage(atPrev, [
    { key: 'gh:quiet', name: 'Quiet', ats: 'ashby', result: 'zero' },
  ], '2026-08-22');
  check(at.coverage['gh:quiet'].consecutiveZero === GONE_QUIET_THRESHOLD, 'reaches threshold');
  check(at.alerts.length === 1 && /gone quiet/i.test(at.alerts[0].reason), 'threshold fires a gone-quiet alert');
}

// ── 3. http_404 alerts immediately and stamps last404 ────────────────────────
{
  const { coverage, alerts } = updateCoverage({}, [
    { key: 'lever:dead', name: 'DeadCo', ats: 'lever', result: 'http_404' },
  ], '2026-08-22');
  check(alerts.length === 1 && /404/.test(alerts[0].reason), '404 alerts on first occurrence');
  check(coverage['lever:dead'].last404 === '2026-08-22', '404 stamps last404');
}

// ── 4. error is transient: does NOT count toward gone-quiet ──────────────────
{
  const prev = { 'gh:blip': { name: 'Blip', ats: 'greenhouse', consecutiveZero: 3 } };
  const { coverage, alerts } = updateCoverage(prev, [
    { key: 'gh:blip', name: 'Blip', ats: 'greenhouse', result: 'error' },
  ], '2026-08-22');
  check(coverage['gh:blip'].consecutiveZero === 3, 'error leaves consecutiveZero unchanged');
  check(alerts.length === 0, 'a transient error raises no alert');
}

// ── 5. skipped_no_api is recorded but not alerted ────────────────────────────
{
  const { coverage, alerts } = updateCoverage({}, [
    { key: 'bespoke:x', name: 'BespokeCo', ats: 'iCIMS', result: 'skipped_no_api' },
  ], '2026-08-22');
  check(coverage['bespoke:x'].lastOutcome === 'skipped_no_api', 'skipped_no_api recorded');
  check(alerts.length === 0, 'skipped_no_api raises no per-company alert');
}

// ── 6. companies absent from this scan carry through untouched ───────────────
//     (so a --company run never skews everyone else's counters)
{
  const prev = {
    'gh:kept': { name: 'Kept', ats: 'greenhouse', consecutiveZero: 2, lastFound: '2026-08-01' },
  };
  const { coverage } = updateCoverage(prev, [
    { key: 'gh:other', name: 'Other', ats: 'ashby', result: 'found', found: 1 },
  ], '2026-08-22');
  check(coverage['gh:kept'].consecutiveZero === 2, 'untouched company keeps its counter');
  check(coverage['gh:kept'].lastFound === '2026-08-01', 'untouched company keeps its lastFound');
  check(coverage['gh:other'] != null, 'the scanned company is added');
}

// ── 7. null/empty inputs are safe ────────────────────────────────────────────
{
  const { coverage, alerts } = updateCoverage(null, null, '2026-08-22');
  check(typeof coverage === 'object' && alerts.length === 0, 'null prev + null outcomes is safe');
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
