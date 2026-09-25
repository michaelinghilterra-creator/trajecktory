#!/usr/bin/env node

import assert from 'node:assert/strict';
import { aggregateHealthChecks } from '../health-check.mjs';

const stubs = new Map([
  ['verify-reports.mjs', { status: 0, stdout: 'All reports valid\n', stderr: '' }],
  ['verify-score-drift.mjs', { status: 0, stdout: 'Warning: Example Co score drift\n', stderr: '' }],
  ['verify-report-derivation.mjs', { status: 1, stdout: 'Example Co derivation mismatch\n', stderr: '' }],
]);

const result = aggregateHealthChecks([...stubs.keys()], name => stubs.get(name));
assert.equal(result.results.length, 3, 'every check runs after an earlier flag');
assert.equal(result.ok, false);
assert.deepEqual(result.flagged.map(item => item.name), [
  'verify-score-drift.mjs',
  'verify-report-derivation.mjs',
]);
assert.match(result.summary, /verify-score-drift\.mjs: Warning: Example Co score drift/);
assert.match(result.summary, /verify-report-derivation\.mjs: Example Co derivation mismatch/);

const clean = aggregateHealthChecks(['verify-reports.mjs'], () => ({ status: 0, stdout: '0 warnings\n', stderr: '' }));
assert.equal(clean.ok, true, 'a zero warnings line is not treated as a warning');

console.log('health check aggregation tests passed');
