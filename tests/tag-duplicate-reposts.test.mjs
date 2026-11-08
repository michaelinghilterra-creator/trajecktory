#!/usr/bin/env node

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { passedReasonOf } from '../lib/passed.mjs';
import { formatTrackerLine, parseTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

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

const words = [
  'amber', 'birch', 'cobalt', 'delta', 'ember', 'fable', 'garnet', 'harbor',
  'indigo', 'juniper', 'kepler', 'lumen', 'marble', 'nectar', 'opal', 'prairie',
  'quartz', 'ripple', 'saffron', 'timber', 'umber', 'velvet', 'willow', 'xenon',
  'yarrow', 'zephyr', 'acorn', 'brisk', 'cedar', 'drift', 'elmwood', 'frost',
  'grove', 'hearth', 'islet', 'jigsaw', 'kernel', 'lagoon', 'meadow', 'north',
];

function dutySentence(word, index) {
  return `The ${word} team designs invented workflow ${index} with careful planning metrics reviews documentation testing feedback and reliable delivery.`;
}

function alternateSentence(word, index) {
  return `Specialists cultivate ${word} habitat ${index} through botanical sampling seasonal mapping soil observations field journals and conservation exercises.`;
}

function body(replaceCount = 0) {
  return words.map((word, index) => (
    index < replaceCount ? alternateSentence(word, index) : dutySentence(word, index)
  )).join(' ');
}

function unrelatedBody() {
  return words.map((word, index) => (
    `A fictional ${word} orchestra ${index} rehearses melodies rhythms harmonies acoustics instruments concerts scores and audience programs nightly.`
  )).join(' ');
}

function row({ num, company = 'Acme Example', role = 'Principal Widget Architect', status = 'Evaluated', notes = 'Invented fixture', url }) {
  return formatTrackerLine({
    num,
    date: `203${num - 900000}-01-01`,
    company,
    role,
    score: '4.0/5',
    status,
    pdf: '-',
    resume: null,
    report: `[${num}](reports/${num}-invented-report.md)`,
    notes,
    url,
  });
}

function writeFixture(root, fixture) {
  const snapshotName = `${fixture.num}-invented-role.md`;
  fs.writeFileSync(path.join(root, 'jds', snapshotName), `# Invented Role\nSource: ${fixture.url}\nPulled: 2035-05-05\n${fixture.body}`, 'utf8');
  fs.writeFileSync(path.join(root, 'reports', `${fixture.num}-invented-report.md`),
    JSON.stringify({ url: fixture.url, jdSnapshot: `jds/${snapshotName}` }, null, 2), 'utf8');
}

function run(root, args = []) {
  return spawnSync(process.execPath, [path.join(root, 'tag-duplicate-reposts.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TZ: 'UTC', TJK_DATA_DIR: path.join(root, 'data') },
  });
}

console.log('tag-duplicate-reposts.test.mjs');

const root = makeSandbox('tag-duplicate-reposts');
for (const dir of ['data', 'jds', 'reports', 'lib', 'dashboard-web/server']) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
}
fs.cpSync(path.join(ROOT, 'lib'), path.join(root, 'lib'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'tag-duplicate-reposts.mjs'), path.join(root, 'tag-duplicate-reposts.mjs'));
fs.copyFileSync(path.join(ROOT, 'dashboard-web/server/v1-loader.mjs'), path.join(root, 'dashboard-web/server/v1-loader.mjs'));

const firstUrl = 'https://careers.acme.example.test/jobs/widget?gh_jid=990001';
const fixtures = [
  { num: 900001, status: 'Passed', notes: '[passed: skip] Earlier fixture', url: firstUrl, body: body() },
  { num: 900002, url: 'https://boards.acme.example.test/jobs/widget-repost?gh_jid=990002', body: body(4) },
  { num: 900003, url: 'https://boards.acme.example.test/jobs/unrelated?gh_jid=990003', body: unrelatedBody() },
  { num: 900004, role: 'Network Steward', url: 'https://boards.acme.example.test/jobs/network?gh_jid=990004', body: body() },
  { num: 900005, company: 'Globex Sample', url: 'https://careers.globex.example.test/jobs/widget?gh_jid=990005', body: body() },
  { num: 900006, notes: '[self-sourced] Invented fixture', url: 'https://boards.acme.example.test/jobs/sourced?gh_jid=990006', body: body() },
  { num: 900007, status: 'Applied', url: 'https://boards.acme.example.test/jobs/applied?gh_jid=990007', body: body() },
  { num: 900008, url: 'https://jobs.acme.example.test/alternate?gh_jid=990001', body: body() },
];

for (const fixture of fixtures) writeFixture(root, fixture);
const trackerLines = fixtures.map((fixture) => row(fixture));
const apps = path.join(root, 'data', 'applications.md');
fs.writeFileSync(apps, ['# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, ...trackerLines, ''].join('\n'), 'utf8');

const before = fs.readFileSync(apps, 'utf8');
const beforeRows = before.split(/\r?\n/).map((line) => parseTrackerLine(line)).filter(Boolean);
const beforeByNum = new Map(beforeRows.map((item) => [item.num, item.raw]));
const reportOnly = run(root);

check(() => assert.strictEqual(reportOnly.status, 0), 'report-only run succeeds');
check(() => assert.match(reportOnly.stdout, /1 rows to tag/), 'report-only run finds one row to tag');
check(() => assert.match(reportOnly.stdout, /#900002 .*dup-of #900001/), 'report names the earlier duplicate row');
check(() => assert.match(reportOnly.stdout, /same posting, use dedup-tracker: #900008 -> #900001/),
  'report directs an identical posting to dedup-tracker');
check(() => assert.match(reportOnly.stdout, /Skipped: 1 user-sourced rows/), 'report counts the user-sourced row');
check(() => assert.strictEqual(fs.readFileSync(apps, 'utf8'), before), 'report-only run leaves file bytes unchanged');

const applied = run(root, ['-'.repeat(2) + 'apply']);
const after = fs.readFileSync(apps, 'utf8');
const afterRows = after.split(/\r?\n/).map((line) => parseTrackerLine(line)).filter(Boolean);
const afterByNum = new Map(afterRows.map((item) => [item.num, item]));
const backups = fs.readdirSync(path.join(root, 'data')).filter((name) => /^applications\.md\.bak-.*-dupe-tag$/.test(name));

check(() => assert.strictEqual(applied.status, 0), 'apply run succeeds');
check(() => assert.strictEqual(backups.length, 1), 'apply leaves exactly one timestamped backup');
check(() => assert.strictEqual(afterRows.length, beforeRows.length), 'apply leaves the row count unchanged');
check(() => assert.strictEqual(afterByNum.get(900002).status, 'Passed'), 'apply sets row 900002 to Passed');
check(() => assert.strictEqual(passedReasonOf(afterByNum.get(900002).notes), 'duplicate'), 'apply sets the duplicate passed reason');
check(() => assert.match(afterByNum.get(900002).notes, /dup-of #900001/), 'apply records the earlier row pointer');
check(() => {
  for (const fixture of fixtures.filter((item) => item.num !== 900002)) {
    assert.strictEqual(afterByNum.get(fixture.num).raw, beforeByNum.get(fixture.num));
  }
}, 'every other tracker row is byte for byte unchanged');
check(() => assert.strictEqual(afterByNum.get(900001).raw, beforeByNum.get(900001)),
  'an earlier row is never tagged by a later row');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
