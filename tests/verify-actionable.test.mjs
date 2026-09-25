#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox } from './helpers/sandbox.mjs';
import { TRACKER_HEADER, TRACKER_SEPARATOR, formatTrackerLine, parseTrackerLine } from '../lib/tracker.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed += 1; }
  else { console.log(`  FAIL ${message}`); failed += 1; }
};

function row(num, kind) {
  return formatTrackerLine({
    num,
    date: '2030-05-01',
    company: `Fixture ${kind}`,
    role: 'Example Systems Lead',
    score: '4.2/5',
    status: 'Evaluated',
    pdf: null,
    resume: null,
    report: null,
    notes: 'Invented fixture',
    url: `https://jobs.example.test/${kind}`,
  });
}

function setup(name, rows, stub) {
  const sandbox = makeRepoSandbox(ROOT, name);
  fs.mkdirSync(path.join(sandbox, 'data'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'verify-actionable.mjs'), path.join(sandbox, 'verify-actionable.mjs'));
  fs.cpSync(path.join(ROOT, 'lib'), path.join(sandbox, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'data', 'applications.md'), [
    '# Applications Tracker',
    '',
    TRACKER_HEADER,
    TRACKER_SEPARATOR,
    ...rows,
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(sandbox, 'check-liveness.mjs'), stub);
  return sandbox;
}

function run(sandbox, args) {
  return spawnSync(process.execPath, [path.join(sandbox, 'verify-actionable.mjs'), ...args], {
    cwd: sandbox,
    encoding: 'utf8',
  });
}

function trackerRows(sandbox) {
  return fs.readFileSync(path.join(sandbox, 'data', 'applications.md'), 'utf8')
    .split(/\r?\n/)
    .map(parseTrackerLine)
    .filter(Boolean);
}

console.log('verify-actionable.test.mjs');

const confirmStub = `
import fs from 'node:fs';
const statePath = new URL('./liveness-count.txt', import.meta.url);
const pass = fs.existsSync(statePath) ? Number(fs.readFileSync(statePath, 'utf8')) : 0;
fs.writeFileSync(statePath, String(pass + 1));
for (const url of process.argv.slice(2)) {
  let status = 'expired';
  if (pass > 0 && url.includes('/live-on-confirm')) status = 'active';
  if (pass > 0 && url.includes('/changed-verdict')) status = 'uncertain';
  if (url.includes('/uncertain-twice')) status = 'uncertain';
  console.log('X ' + status + '    ' + url);
}
process.exitCode = 1;
`;

const confirmSandbox = setup('verify-actionable-confirm', [
  row(900101, 'expired-twice'),
  row(900102, 'live-on-confirm'),
  row(900103, 'changed-verdict'),
  row(900104, 'uncertain-twice'),
], confirmStub);
const confirmedRun = run(confirmSandbox, ['--apply', '--confirm-delay', '0']);
const confirmedRows = trackerRows(confirmSandbox);
const byId = new Map(confirmedRows.map(item => [item.num, item]));

check(confirmedRun.status === 0, 'apply completes without a network call');
check(fs.readFileSync(path.join(confirmSandbox, 'liveness-count.txt'), 'utf8') === '2',
  'apply invokes the liveness checker twice');
check(byId.get(900101)?.status === 'Passed' && /posting_closed/.test(byId.get(900101)?.notes || ''),
  'an expired verdict confirmed as expired is flipped');
check(byId.get(900104)?.status === 'Passed' && /passed: discarded/.test(byId.get(900104)?.notes || ''),
  'an uncertain verdict confirmed as uncertain is flipped');
check(byId.get(900102)?.status === 'Evaluated' && byId.get(900103)?.status === 'Evaluated',
  'active and changed confirmation verdicts keep their rows Evaluated');
check(/Unconfirmed, kept as Evaluated:/.test(confirmedRun.stdout)
  && /Flipped 2 entries to Passed; 2 unconfirmed\./.test(confirmedRun.stdout),
  'output identifies unconfirmed rows and summarizes both counts');

const dryStub = `
import fs from 'node:fs';
const statePath = new URL('./liveness-count.txt', import.meta.url);
const count = fs.existsSync(statePath) ? Number(fs.readFileSync(statePath, 'utf8')) : 0;
fs.writeFileSync(statePath, String(count + 1));
for (const url of process.argv.slice(2)) console.log('X expired    ' + url);
process.exitCode = 1;
`;
const drySandbox = setup('verify-actionable-dry', [row(900105, 'dry-run')], dryStub);
const before = fs.readFileSync(path.join(drySandbox, 'data', 'applications.md'), 'utf8');
const dryRun = run(drySandbox, []);
const after = fs.readFileSync(path.join(drySandbox, 'data', 'applications.md'), 'utf8');
check(dryRun.status === 1 && before === after, 'dry run remains the default and does not edit the tracker');
check(fs.readFileSync(path.join(drySandbox, 'liveness-count.txt'), 'utf8') === '1',
  'dry run performs only the initial liveness check');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
