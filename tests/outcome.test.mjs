#!/usr/bin/env node
/**
 * outcome.test.mjs — unit tests for lib/outcome.mjs, the status-to-outcome
 * classification behind the analytics. Pins the fix for the audit finding that
 * Closed and Not-a-Fit rows were bucketed as 'pending' and inflated the
 * conversion-rate denominator.
 *
 * Run: node tests/outcome.test.mjs   (exit 0 = pass, 1 = fail)
 */

import {
  normalizeStatus,
  classifyOutcome,
  OUTCOMES,
  zeroOutcomeCounts,
  conversionRate,
} from '../lib/outcome.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('outcome.test.mjs');

// ── classifyOutcome buckets ───────────────────────────────────────────────────
check(classifyOutcome('Applied') === 'positive', 'Applied is positive');
check(classifyOutcome('Interview') === 'positive', 'Interview is positive');
check(classifyOutcome('Offer') === 'positive', 'Offer is positive');

// ── Interview ladder: every round classifies as a positive outcome ──────────────
check(classifyOutcome('Phone Screen') === 'positive', 'Phone Screen is positive');
check(classifyOutcome('1st Interview') === 'positive', '1st Interview is positive');
check(classifyOutcome('2nd Interview') === 'positive', '2nd Interview is positive');
check(classifyOutcome('3rd Interview') === 'positive', '3rd Interview is positive');
check(classifyOutcome('4th Interview') === 'positive', '4th Interview is positive');
check(normalizeStatus('Interview') === '1st interview', 'legacy Interview folds into 1st interview');
check(normalizeStatus('Round 2') === '2nd interview', 'Round 2 alias maps to 2nd interview');
check(normalizeStatus('TA Screen') === 'phone screen', 'TA Screen alias maps to phone screen');

check(classifyOutcome('Rejected') === 'negative', 'Rejected is negative');
check(classifyOutcome('Discarded') === 'negative', 'Discarded is negative');
check(classifyOutcome('Evaluated') === 'pending', 'Evaluated is pending');
check(classifyOutcome('SKIP') === 'self_filtered', 'SKIP is self_filtered');

// ── The fix: Closed and Not a Fit no longer fall into 'pending' ─────────────────
check(classifyOutcome('Closed') === 'closed', 'Closed gets its own bucket (was pending)');
check(classifyOutcome('Not a Fit') === 'self_filtered', 'Not a Fit is self_filtered (was pending)');
check(classifyOutcome('not_a_fit') === 'self_filtered', 'not_a_fit underscore form is self_filtered');

// ── normalizeStatus ───────────────────────────────────────────────────────────
check(normalizeStatus('**Applied**') === 'applied', 'strips bold markers');
check(normalizeStatus('Cerrada') === 'discarded', 'Spanish alias cerrada maps to discarded');
check(normalizeStatus('Applied 2026-06-01 note') === 'applied', 'strips trailing date');
check(normalizeStatus(null) === '', 'null is safe');

// ── conversionRate excludes closed / self_filtered / pending from the denom ─────
check(conversionRate({ positive: 3, negative: 1, closed: 0, self_filtered: 0, pending: 0 }) === 75,
  '3 positive of 4 decided = 75%');
check(conversionRate({ positive: 3, negative: 1, closed: 10, self_filtered: 5, pending: 8 }) === 75,
  'closed/self_filtered/pending do NOT dilute the rate (still 75%)');
check(conversionRate({ positive: 0, negative: 0, closed: 5, self_filtered: 2, pending: 3 }) === 0,
  'no decided applications yields 0, not a divide-by-zero');
check(conversionRate({ positive: 2, negative: 0, closed: 0, self_filtered: 0, pending: 0 }) === 100,
  '2 positive of 2 decided = 100%');

// ── zeroOutcomeCounts / OUTCOMES shape ──────────────────────────────────────────
const z = zeroOutcomeCounts();
check(z.total === 0 && OUTCOMES.every(o => z[o] === 0), 'zeroOutcomeCounts has total + every outcome at 0');
check(OUTCOMES.includes('closed') && OUTCOMES.includes('self_filtered'), 'OUTCOMES includes closed and self_filtered');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
