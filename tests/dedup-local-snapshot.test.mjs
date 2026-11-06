#!/usr/bin/env node

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from './helpers/sandbox.mjs';
import { TRACKER_HEADER, TRACKER_SEPARATOR, formatTrackerLine, parseTrackerLine } from '../lib/tracker.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function check(fn, message) {
  try {
    fn();
    console.log(`  PASS ${message}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${message}: ${error.message}`);
    failed += 1;
  }
}

function makeRow({ num, score, url, report = null }) {
  return formatTrackerLine({
    num,
    date: '2030-04-01',
    company: 'Acme Example',
    role: 'Invented Systems Engineer',
    score: `${score}/5`,
    status: 'Evaluated',
    pdf: 'No',
    resume: null,
    report,
    notes: 'Invented fixture',
    url,
  });
}

function tracker(rows) {
  return ['# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, ...rows, ''].join('\n');
}

function setup(name, rows) {
  const root = makeSandbox(name);
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'jds'), { recursive: true });
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dashboard-web/server'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'lib'), path.join(root, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'dedup-tracker.mjs'), path.join(root, 'dedup-tracker.mjs'));
  fs.copyFileSync(path.join(ROOT, 'dashboard-web/server/v1-loader.mjs'), path.join(root, 'dashboard-web/server/v1-loader.mjs'));
  fs.writeFileSync(path.join(root, 'data/applications.md'), tracker(rows));
  return root;
}

function run(root, args = []) {
  return spawnSync(process.execPath, [path.join(root, 'dedup-tracker.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TZ: 'UTC', TJK_DATA_DIR: path.join(root, 'data') },
  });
}

function rowsIn(root) {
  return fs.readFileSync(path.join(root, 'data/applications.md'), 'utf8')
    .split(/\r?\n/)
    .map(line => parseTrackerLine(line))
    .filter(Boolean);
}

console.log('dedup-local-snapshot.test.mjs');

const localRef = 'local:jds/900001-invented.md';
const reportRef = '[900001](reports/900001-invented.md)';
const postingUrl = 'https://job-boards.greenhouse.io/acmeexample/jobs/900101';

{
  const root = setup('dedup-local-snapshot', [
    makeRow({ num: 900001, score: 3.1, url: localRef, report: reportRef }),
    makeRow({ num: 900002, score: 4.2, url: postingUrl }),
  ]);
  fs.writeFileSync(path.join(root, 'jds/900001-invented.md'), `# Invented posting\n\nSource: ${postingUrl}\n`);
  fs.writeFileSync(path.join(root, 'reports/900001-invented.md'), `---\n{"url":"${localRef}"}\n---\n# Invented report\n`);
  const apps = path.join(root, 'data/applications.md');
  const before = fs.readFileSync(apps);

  check(() => assert.strictEqual(rowsIn(root).length, 2), 'fixture starts with exactly two rows');
  const reportOnly = run(root);
  check(() => assert.strictEqual(reportOnly.status, 0), 'report-only run succeeds');
  check(() => assert.match(reportOnly.stdout, /1 duplicate found/), 'report-only run finds exactly one duplicate');
  check(() => assert.deepStrictEqual(fs.readFileSync(apps), before), 'report-only run writes nothing');

  const applied = run(root, ['--apply']);
  const afterRows = rowsIn(root);
  const backups = fs.readdirSync(path.join(root, 'data')).filter(name => name.startsWith('applications.md.bak-'));
  check(() => assert.strictEqual(applied.status, 0), 'apply run succeeds');
  check(() => assert.match(applied.stdout, /1 duplicate removed/), 'apply run removes exactly one duplicate');
  check(() => assert.strictEqual(afterRows.length, 1), 'apply run changes the row count from two to one');
  check(() => assert.deepStrictEqual(afterRows.map(row => row.num), [900002]), 'apply run keeps the higher-score row');
  check(() => assert.strictEqual(backups.length, 1), 'apply run leaves one timestamped backup');
}

{
  const root = setup('dedup-local-snapshot-control', [
    makeRow({ num: 900001, score: 3.1, url: localRef, report: reportRef }),
    makeRow({ num: 900003, score: 4.2, url: 'https://job-boards.greenhouse.io/acmeexample/jobs/900102' }),
  ]);
  fs.writeFileSync(path.join(root, 'jds/900001-invented.md'), `# Invented posting\n\nSource: ${postingUrl}\n`);
  fs.writeFileSync(path.join(root, 'reports/900001-invented.md'), `---\n{"url":"${localRef}"}\n---\n# Invented report\n`);
  const applied = run(root, ['--apply']);
  const rows = rowsIn(root);
  check(() => assert.strictEqual(applied.status, 0), 'different posting control succeeds');
  check(() => assert.strictEqual(rows.length, 2), 'different Greenhouse job id leaves the row count unchanged');
  check(() => assert.deepStrictEqual(rows.map(row => row.num).sort(), [900001, 900003]), 'different posting control keeps both ids');
}

{
  const root = setup('dedup-missing-local-snapshot', [
    makeRow({ num: 900001, score: 3.1, url: 'local:jds/missing.md', report: '[900001](reports/900001-missing.md)' }),
    makeRow({ num: 900002, score: 4.2, url: postingUrl }),
  ]);
  fs.writeFileSync(path.join(root, 'reports/900001-missing.md'), '---\n{"url":"local:jds/missing.md"}\n---\n# Invented report\n');
  const applied = run(root, ['--apply']);
  const rows = rowsIn(root);
  check(() => assert.strictEqual(applied.status, 0), 'missing snapshot control succeeds');
  check(() => assert.strictEqual(rows.length, 2), 'missing snapshot is not clustered or removed');
  check(() => assert.deepStrictEqual(rows.map(row => row.num).sort(), [900001, 900002]), 'missing snapshot control keeps both ids');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
