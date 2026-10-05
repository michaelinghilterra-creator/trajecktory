#!/usr/bin/env node
/**
 * verify-scorer-version.test.mjs - pure scorer stamp guard.
 */
import { SCORER_VERSION } from '../lib/score.mjs';
import { findScorerVersionIssues } from '../verify-scorer-version.mjs';

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('verify-scorer-version.test.mjs');

let r = findScorerVersionIssues({
  reports: [
    { id: '900001', data: { scoreSource: 'derived', scorerVersion: SCORER_VERSION } },
    { id: '900002', data: { scoreSource: 'derived', scorerVersion: SCORER_VERSION } },
  ],
});
check(r.ok && r.checked === 2 && r.missing.length === 0 && r.stale.length === 0, 'all current stamps are ok');

r = findScorerVersionIssues({
  reports: [
    { id: '900001', data: { scoreSource: 'derived', scorerVersion: SCORER_VERSION } },
    { id: '900002', data: { scoreSource: 'derived' } },
  ],
});
check(!r.ok && eq(r.missing, ['900002']), 'a missing stamp is reported by id');

r = findScorerVersionIssues({
  reports: [{ id: '900003', data: { scoreSource: 'derived', scorerVersion: '2030-01-01' } }],
  current: SCORER_VERSION,
});
check(!r.ok && eq(r.stale, [{ id: '900003', version: '2030-01-01' }]), 'a stale stamp is reported with its version');

r = findScorerVersionIssues({
  reports: [
    { id: '900004', data: { score: 4.1 } },
    { id: '900005', data: { scoreSource: 'legacy' } },
    { id: '900006', data: { scoreSource: 'derived', scorerVersion: SCORER_VERSION } },
  ],
});
check(r.ok && r.checked === 1, 'only derived reports are checked');

r = findScorerVersionIssues({ reports: [] });
check(r.ok && r.checked === 0, 'an empty report list is ok');

r = findScorerVersionIssues({
  reports: [{ id: '900007', data: { scoreSource: 'derived', scorerVersion: 'override-version' } }],
  current: 'override-version',
});
check(r.ok && r.checked === 1, 'the current argument overrides the default');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
