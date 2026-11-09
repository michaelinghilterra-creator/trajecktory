#!/usr/bin/env node
// Covers recording spot checks and the checker accuracy report.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { makeSandbox } from './helpers/sandbox.mjs';
import { formatTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'liveness-truth.mjs');
const dir = makeSandbox('liveness-truth');
const urlA = 'https://jobs.example.test/zorblax-widgetry/900001';
const urlB = 'https://jobs.example.test/quennox-ratchet-works/900002';
const urlC = 'https://jobs.example.test/zorblax-widgetry/900003';
const urlD = 'https://jobs.example.test/quennox-ratchet-works/900004';
const urlE = 'https://jobs.example.test/zorblax-widgetry/900005';

function run(...args) {
  return spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, TJK_DATA_DIR: dir },
    encoding: 'utf8',
  });
}

const trackerRow = formatTrackerLine({
  num: 900001,
  date: '2031-01-01',
  company: 'Zorblax Widgetry',
  role: 'Widget Liveness Engineer',
  score: '4.0/5',
  status: 'Evaluated',
  pdf: '',
  resume: '',
  report: '',
  notes: '',
  url: urlA,
});
fs.writeFileSync(path.join(dir, 'applications.md'), `${TRACKER_HEADER}\n${TRACKER_SEPARATOR}\n${trackerRow}\n`);

const byUrl = run('record', urlB, 'live', '--note', 'checked\tin browser');
check(byUrl.status === 0 && byUrl.stdout.includes(`Recorded live for ${urlB}`), 'record by url succeeds');

const byId = run('record', '900001', 'dead');
check(byId.status === 0 && byId.stdout.includes(`Recorded dead for ${urlA}`), 'record by tracker id resolves the url');

const badTruth = run('record', urlA, 'maybe');
check(badTruth.status === 2, 'bad truth value exits 2');

const unknownId = run('record', '900999', 'live');
check(unknownId.status === 2, 'unknown tracker id exits 2');

const recorded = fs.readFileSync(path.join(dir, 'liveness-truth.tsv'), 'utf8');
check(recorded.split('\n').filter(line => line === 'date\turl\tid\ttruth\tnote').length === 1, 'header is written once');
check(recorded.includes('checked in browser') && !recorded.includes('checked\tin browser'), 'tabs in notes are replaced');
check(recorded.includes(`\t${urlA}\t900001\tdead\t`), 'tracker id is stored with its resolved url');

fs.writeFileSync(path.join(dir, 'liveness-truth.tsv'), [
  'date\turl\tid\ttruth\tnote',
  `2031-01-01\t${urlA}?utm_source=first\t\tlive\tfirst check`,
  `2031-01-02\t${urlB}\t\tdead\tconfirmed`,
  `2031-01-03\t${urlC}\t\tlive\tinitial check`,
  `2031-01-04\t${urlC}\t\tdead\tlatest check`,
  `2031-01-05\t${urlD}\t\tlive\tno checker row`,
  `2031-01-06\t${urlE}\t\tlive\toverride check`,
  '',
].join('\n'));

fs.writeFileSync(path.join(dir, 'gate-history.tsv'), [
  'date\turl\tcompany\trole\tresult\treason',
  `2031-01-02\t${urlA}\tZorblax Widgetry\tWidget Engineer\texpired\tremoved`,
  `2031-01-03\t${urlB}\tQuennox Ratchet Works\tRatchet Engineer\texpired\tremoved`,
  `2031-01-04\t${urlC}\tZorblax Widgetry\tWidget Engineer\tactive\tapply found`,
  `2031-01-07\t${urlE}\tZorblax Widgetry\tWidget Engineer\tactive\tapply found`,
  '',
].join('\n'));

fs.writeFileSync(path.join(dir, 'liveness-observations.tsv'), [
  'date\tsource\tid\tcompany\tscore\turl\tverdict\treason',
  `2031-01-08\tspot\t900005\tZorblax Widgetry\t4.0\t${urlE}\tuncertain\tchallenge page`,
  '',
].join('\n'));

const report = run('report', '--json');
check(report.status === 0, 'report json exits 0');
let result = null;
try { result = JSON.parse(report.stdout); } catch {}
check(result?.byVerdict?.active?.live === 0 && result?.byVerdict?.active?.dead === 1, 'report counts active verdicts');
check(result?.byVerdict?.expired?.live === 1 && result?.byVerdict?.expired?.dead === 1, 'report counts false dead and correct dead');
check(result?.byVerdict?.uncertain?.live === 1 && result?.byVerdict?.uncertain?.dead === 0, 'later observations verdict overrides gate history');
check(result?.falseDead === 1 && result?.falseLive === 1 && result?.unmatched === 1, 'report counts false results and unmatched truth');
check(result?.byVerdict?.active?.dead === 1, 'last truth row wins for a repeated url');


console.log(`\nliveness-truth: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
