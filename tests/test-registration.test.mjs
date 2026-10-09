#!/usr/bin/env node
/**
 * test-registration.test.mjs - every tests/*.test.mjs must be named in test-all.mjs.
 *
 * test-all.mjs runs an EXPLICIT list of suites. A suite that is not named there
 * never runs, in CI or locally, and its absence looks exactly like a passing run.
 * Five suites sat unregistered until this guard was written (the second time this
 * happened; the first time a comment was left in the list, which did not stop it).
 *
 * Run: node tests/test-registration.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ok ${msg}`); passed++; }
  else { console.log(`  fail ${msg}`); failed++; }
}

console.log('test-registration.test.mjs');

const registry = readFileSync(join(ROOT, 'test-all.mjs'), 'utf-8');
const suites = readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.test.mjs')).sort();

// Suites that are deliberately NOT run by test-all (each needs a reason on the line).
const NOT_RUN_BY_TEST_ALL = new Map([
  // ['name.test.mjs', 'reason'],
]);

const missing = suites.filter((f) => !NOT_RUN_BY_TEST_ALL.has(f) && !registry.includes(`'tests/${f}'`));
check(suites.length > 0, `found ${suites.length} test suites`);
check(missing.length === 0, missing.length === 0
  ? 'every test suite is registered in test-all.mjs'
  : `unregistered suites (add them to the list in test-all.mjs): ${missing.join(', ')}`);

// A suite named twice would run twice and double its cost.
const listed = [...registry.matchAll(/'tests\/([A-Za-z0-9._-]+\.test\.mjs)'/g)].map((m) => m[1]);
const dupes = listed.filter((f, i) => listed.indexOf(f) !== i);
check(dupes.length === 0, dupes.length === 0 ? 'no suite is registered twice' : `registered twice: ${[...new Set(dupes)].join(', ')}`);

// A listed suite that does not exist is skipped with a warning, which hides a rename.
const gone = [...new Set(listed)].filter((f) => !suites.includes(f));
check(gone.length === 0, gone.length === 0 ? 'every registered suite exists' : `registered but missing from tests/: ${gone.join(', ')}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
