#!/usr/bin/env node
/**
 * metrics-scorer-version.test.mjs - metrics keep scorer versions traceable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { makeRepoSandbox } from './helpers/sandbox.mjs';
import { TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { scoreBands } from '../lib/metrics/core.mjs';

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('metrics-scorer-version.test.mjs');

{
  const apps = [
    { id: 1, score: 3, scorerVersion: 'X' },
    { id: 2, score: 4, scorerVersion: 'X' },
    { id: 3, score: 5, scorerVersion: 'X' },
    { id: 4, score: 1, scorerVersion: 'authored' },
    { id: 5, score: 1, scorerVersion: 'authored' },
    { id: 6, score: 1, scorerVersion: 'authored' },
    { id: 7, score: 1, scorerVersion: 'authored' },
    { id: 8, score: 1, scorerVersion: 'authored' },
  ];
  const sb = scoreBands(apps, new Set(apps.map(a => String(a.id))));
  check(eq(sb.appliedAvg, { value: 4, n: 3, version: 'X' }), 'stamped version beats authored majority');
}

{
  const apps = [
    { id: 1, score: 3, scorerVersion: null },
    { id: 2, score: 5, scorerVersion: null },
    { id: 3, score: 4, scorerVersion: 'X' },
  ];
  const sb = scoreBands(apps, new Set(['1', '2', '3']));
  check(eq(sb.appliedAvg, { value: 4, n: 1, version: 'X' }), 'stamped version beats null-version rows');
}

{
  const apps = [
    { id: 1, score: 3, scorerVersion: 'authored' },
    { id: 2, score: 5, scorerVersion: 'authored' },
    { id: 3, score: 1, scorerVersion: null },
  ];
  const sb = scoreBands(apps, new Set(['1', '2', '3']));
  check(eq(sb.appliedAvg, { value: 4, n: 2, version: 'authored' }), 'authored majority still wins when no stamped version exists');
}

{
  const apps = [{ id: 1, score: 3 }, { id: 2, score: 5 }];
  const sb = scoreBands(apps, new Set(['1', '2']));
  check(eq(sb.appliedAvg, { value: 4, n: 2, version: null }), 'all null keeps old average behavior');
}

{
  const sandbox = makeRepoSandbox(path.resolve('.'), 'metrics-scorer-version');
  process.env.TJK_DATA_DIR = sandbox;
  process.env.TZ = 'America/Chicago';
  fs.writeFileSync(path.join(sandbox, 'applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
    TRACKER_SEPARATOR,
    '| 900001 | 2030-03-01 | Zorblax Widgetry | Example Cog Lead | 4.1/5 | Applied | | | | | https://jobs.zorblax.example/900001 |',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), JSON.stringify({ 900001: '2030-03-01' }), 'utf8');
  fs.writeFileSync(path.join(sandbox, 'status-events.tsv'), [
    'app#\tdate\tstatus\tcompany\tlogged',
    '900001\t2030-03-01\tApplied\tZorblax Widgetry\t2030-03-01',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(sandbox, 'app-notes.json'), '{}\n', 'utf8');
  const { collectCoreMetrics } = await import(`../dashboard-web/server/lib/metrics-collect.mjs?scorerVersion=${Date.now()}`);
  const result = collectCoreMetrics({ today: '2030-03-10' });
  check(eq(result.scoreBands.appliedAvg, { value: 4.1, n: 1, version: null }), 'collectCoreMetrics passes scorerVersion through when it is null');
}

const charts = fs.readFileSync(path.resolve('dashboard-web/src/charts.jsx'), 'utf8');
check(charts.includes(' rules'), 'chart caption contains the rules phrase');
check(/version\s*!==\s*'authored'/.test(charts), 'chart caption suppresses authored versions');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
