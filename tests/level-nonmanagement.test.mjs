#!/usr/bin/env node
/**
 * level-nonmanagement.test.mjs — a level word used as a MODIFIER of a
 * non-management function must not satisfy the minimum level.
 *
 * WHY THIS EXISTS:
 * applyLevelFloor raises the `level` dimension to a perfect 5 for any JD title at
 * or above the configured minimum. levelRank found the whole word "manager" inside
 * "IC Product Manager" and ranked it as management, so a report whose own verdict
 * read "IC role... Below the Manager-level minimum" had its level floored 3 -> 5.
 *
 * NOT A WORD-BOUNDARY BUG. LEVEL_LADDER already uses \b on every pattern and they
 * are correct: "manager" IS a whole word in "Product Manager". Verified against the
 * cases that look like boundary failures and are not — AVP, SVP, EVP, Team Lead,
 * Leadership, Head of X — all of which classify correctly today and are asserted
 * below so a future "fix" to the boundaries cannot regress them.
 *
 * The policy lives in config/profile.yml (scoring.non_management_titles), not here,
 * for the same reason compensation.minimum does: what counts as management is a
 * judgment about the user's bar, and burying it in code makes changing it a code
 * change with tests instead of a config edit.
 *
 * Run: node tests/level-nonmanagement.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { levelRank, applyLevelFloor, DEFAULT_NON_MANAGEMENT_TITLES, DEFAULT_MINIMUM_LEVEL } from '../lib/score.mjs';

let passed = 0, failed = 0;
function check(cond, label) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${label}`);
}
function section(n) { console.log(`\n${n}`); }

section('THE REGRESSION: <function> Manager is not management');
for (const t of ['Product Manager', 'Senior Product Manager', 'IC Product Manager',
  'Program Manager', 'Project Manager', 'Account Manager',
  'Engagement Manager', 'Customer Success Manager']) {
  check(levelRank(t) === null, `${t} -> null (got ${levelRank(t)})`);
}
check(levelRank('IC Product Manager, reporting to Manager, Revenue Operations') === null,
  'the exact title from report 2933 ranks null');

section('genuine management titles are untouched');
check(levelRank('Manager') === 1, 'Manager -> 1');
check(levelRank('Senior Manager') === 1, 'Senior Manager -> 1');
check(levelRank('Manager, Revenue Operations') === 1, 'Manager, Revenue Operations -> 1');
check(levelRank('Director') === 2, 'Director -> 2');
check(levelRank('Head of Analytics') === 2, 'Head of Analytics -> 2');
check(levelRank('VP of Sales') === 3, 'VP of Sales -> 3');

section('the exclusion applies ONLY at the Manager rung');
// A Director or VP title states seniority whatever else is in it.
check(levelRank('Director of Product Management') === 2, 'Director of Product Management stays 2');
check(levelRank('VP Product') === 3, 'VP Product stays 3');

section('NOT boundary failures — these already classified correctly, assert they stay that way');
check(levelRank('AVP') === null, 'AVP -> null (\\bvp\\b cannot match inside "avp")');
check(levelRank('AVP of Sales') === null, 'AVP of Sales -> null');
check(levelRank('SVP') === 3, 'SVP -> 3');
check(levelRank('EVP') === 3, 'EVP -> 3');
check(levelRank('Team Lead') === null, 'Team Lead -> null (Lead is deliberately unranked)');
check(levelRank('Leadership') === null, 'Leadership -> null');
check(levelRank('Department Head') === 2, 'Department Head -> 2');
check(levelRank('Individual Contributor') === 0, 'Individual Contributor -> 0');

section('policy is configurable, not hardcoded');
check(levelRank('Product Manager', []) === 1,
  'an empty list restores the old behaviour (policy switched off from config)');
check(levelRank('Widget Wrangler Manager', ['widget wrangler manager']) === null,
  'a caller-supplied list is honoured');
check(Array.isArray(DEFAULT_NON_MANAGEMENT_TITLES) && DEFAULT_NON_MANAGEMENT_TITLES.length > 0,
  'a working default ships so the bug is fixed out of the box');

section('applyLevelFloor: the actual effect');
{
  const dims = [{ key: 'level', val: 3, max: 5 }, { key: 'fit', val: 4, max: 5 }];
  const bad = applyLevelFloor(dims, 'IC Product Manager', DEFAULT_MINIMUM_LEVEL);
  check(bad.floored === false, 'an IC Product Manager is NOT floored');
  check(bad.dims.find(d => d.key === 'level').val === 3, 'its level rating is left at 3');

  const good = applyLevelFloor(dims, 'Senior Manager', DEFAULT_MINIMUM_LEVEL);
  check(good.floored === true, 'a Senior Manager IS floored');
  check(good.dims.find(d => d.key === 'level').val === 5, 'its level is raised to 5');
}
{
  // Guard the threshold itself: configuring minimum_level "Manager" while listing
  // "Product Manager" must not nullify the minimum and disable all flooring.
  const dims = [{ key: 'level', val: 2, max: 5 }];
  const r = applyLevelFloor(dims, 'Director', 'Manager', ['product manager', 'manager']);
  check(r.floored === true, 'the minimum is ranked without the exclusion list');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
