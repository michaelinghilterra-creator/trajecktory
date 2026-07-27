#!/usr/bin/env node
/**
 * hunter-budget.test.mjs — unit tests for the Hunter Email Finder budget guard.
 *
 * WHY THIS EXISTS
 * The Finder spends ONE Hunter search credit per contact whether or not it finds
 * an address, and the free tier is only 50/month. A no-cap run once drained the
 * whole month's allocation in a single click. planFindBudget is the ONE place
 * that decides how many lookups a run may make; both the CLI (find-contacts.mjs)
 * and the dashboard find-emails endpoint route through it, so it must never let
 * a run exceed remaining credits and must bound a bare run by a small default.
 *
 * Run: node tests/hunter-budget.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { planFindBudget, DEFAULT_FIND_LIMIT, mapHunterFind } from '../find-contacts.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('hunter-budget.test.mjs');

// ── The core guarantee: never exceed remaining credits ───────────────────────
check(planFindBudget({ needed: 100, limit: 0, creditsLeft: 3 }) === 3,
  'caps to remaining credits even with many needing and no limit');
check(planFindBudget({ needed: 100, limit: 40, creditsLeft: 3 }) === 3,
  'remaining credits beat an explicit larger --limit');
check(planFindBudget({ needed: 100, limit: 0, creditsLeft: 0 }) === 0,
  'zero credits → zero lookups');

// ── The default cap: a bare run can't drain the month ────────────────────────
check(planFindBudget({ needed: 100, limit: 0, creditsLeft: null }) === DEFAULT_FIND_LIMIT,
  'no --limit + unknown credits → falls back to the small default cap');
check(planFindBudget({ needed: 3, limit: 0, creditsLeft: null }) === 3,
  'never returns more than actually needed');

// ── Explicit --limit is honored under the credit ceiling ─────────────────────
check(planFindBudget({ needed: 100, limit: 25, creditsLeft: 50 }) === 25,
  'explicit --limit honored when credits allow');
check(planFindBudget({ needed: 100, limit: 25, creditsLeft: null }) === 25,
  'explicit --limit honored when credits unknown');

// ── Never negative ───────────────────────────────────────────────────────────
check(planFindBudget({ needed: 0, limit: 0, creditsLeft: 10 }) === 0,
  'nothing needed → zero');
check(planFindBudget({ needed: 5, limit: 0, creditsLeft: -4 }) === 0,
  'a negative credit reading floors at zero, never negative');

// ── mapHunterFind sanity (found vs nothing) ──────────────────────────────────
check(mapHunterFind({ data: { email: 'A.B@Example.com', score: 88 } })?.email === 'a.b@example.com',
  'mapHunterFind lowercases the found address');
check(mapHunterFind({ data: { email: '', score: 0 } }) === null,
  'mapHunterFind returns null when nothing found');

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
