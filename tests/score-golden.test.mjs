#!/usr/bin/env node
/**
 * score-golden.test.mjs - literal outputs for the current scoring rules.
 *
 * These values are tied to SCORER_VERSION. If any scoring rule changes, bump the
 * version, re-derive these constants with the current engine, and re-stamp the
 * reports in the same change.
 */
import { deriveScore, DEFAULT_WEIGHTS, SCORER_VERSION, applyLevelFloor } from '../lib/score.mjs';

const GOLDEN_FOR_VERSION = '2026-09-22';

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};

console.log('score-golden.test.mjs');

check(SCORER_VERSION === GOLDEN_FOR_VERSION,
  'scoring rules changed: bump SCORER_VERSION in lib/score.mjs, update these golden values and GOLDEN_FOR_VERSION together, then re-derive and re-stamp the reports');

const fixtures = [
  {
    name: 'all fives',
    dims: [{ key: 'fit', val: 5 }, { key: 'northStar', val: 5 }, { key: 'level', val: 5 }, { key: 'comp', val: 5 }, { key: 'location', val: 5 }, { key: 'redFlags', val: 5 }],
    expected: 5,
  },
  {
    name: 'mixed ratings',
    dims: [{ key: 'fit', val: 4 }, { key: 'northStar', val: 3 }, { key: 'level', val: 5 }, { key: 'comp', val: 2 }, { key: 'location', val: 4 }, { key: 'redFlags', val: 5 }],
    expected: 3.9,
  },
  {
    name: 'red flag penalty',
    dims: [{ key: 'fit', val: 5 }, { key: 'northStar', val: 5 }, { key: 'level', val: 5 }, { key: 'location', val: 5 }, { key: 'redFlags', val: 0 }],
    expected: 3.5,
  },
  {
    name: 'missing dimensions renormalize',
    dims: [{ key: 'fit', val: 4 }, { key: 'northStar', val: 5 }, { key: 'redFlags', val: 5 }],
    expected: 4.4,
  },
  {
    name: 'ceiling applies',
    dims: [{ key: 'fit', val: 5 }, { key: 'northStar', val: 5 }, { key: 'level', val: 5 }, { key: 'location', val: 5 }, { key: 'redFlags', val: 5 }],
    opts: { ceiling: 3.2 },
    expected: 3.2,
    ceilingApplied: true,
  },
  {
    name: 'ceiling does not apply',
    dims: [{ key: 'fit', val: 3 }, { key: 'northStar', val: 3 }, { key: 'level', val: 3 }, { key: 'location', val: 3 }, { key: 'redFlags', val: 5 }],
    opts: { ceiling: 4 },
    expected: 3,
    ceilingApplied: false,
  },
  {
    name: 'default weights leave comp out',
    dims: [{ key: 'fit', val: 4 }, { key: 'northStar', val: 4 }, { key: 'level', val: 4 }, { key: 'comp', val: 0 }, { key: 'location', val: 4 }, { key: 'redFlags', val: 5 }],
    expected: 4,
  },
  {
    name: 'level floor raises manager title',
    dims: applyLevelFloor([{ key: 'fit', val: 4 }, { key: 'northStar', val: 4 }, { key: 'level', val: 2 }, { key: 'location', val: 4 }, { key: 'redFlags', val: 5 }], 'Senior Manager').dims,
    expected: 4.2,
  },
];

for (const f of fixtures) {
  const r = deriveScore(f.dims, { weights: DEFAULT_WEIGHTS, ...(f.opts || {}) });
  check(r.derivable === true && r.score === f.expected, `${f.name} score is ${f.expected}`);
  if ('ceilingApplied' in f) check(r.ceilingApplied === f.ceilingApplied, `${f.name} ceiling flag is ${f.ceilingApplied}`);
}

check(deriveScore([{ key: 'comp', val: 5 }], { weights: DEFAULT_WEIGHTS }).derivable === false, 'unweighted comp alone is excluded from golden derivability cases');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
