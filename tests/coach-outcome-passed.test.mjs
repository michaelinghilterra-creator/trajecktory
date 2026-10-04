#!/usr/bin/env node
// Coach logOutcome writes Passed with a reason tag and refuses the retired Discarded label.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';
import { formatTrackerLine, parseTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';

const sandbox = makeSandbox('coach-outcome-passed');
process.env.TJK_DATA_DIR = sandbox;

const appsPath = path.join(sandbox, 'applications.md');
const row = (id, company, role, status, notes = '') => `${formatTrackerLine({
  num: id,
  date: '2030-03-01',
  company,
  role,
  score: '0.01/5',
  status,
  pdf: '',
  resume: '',
  report: '',
  notes,
  url: `https://jobs.example.invalid/${id}`,
})}\n`;
fs.writeFileSync(appsPath,
  '# Applications Tracker\n\n' +
  `${TRACKER_HEADER}\n` +
  `${TRACKER_SEPARATOR}\n` +
  row(900001, 'Zorblax Widgetry', 'Example Cog Lead', 'Applied') +
  row(900003, 'Quennox Ratchet Works', 'Example Gear Manager', 'Applied', 'Invented existing note'),
  'utf8');
fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), '{}\n');
fs.writeFileSync(path.join(sandbox, 'status-events.tsv'), 'app#\tdate\tstatus\tcompany\tlogged\n');
fs.writeFileSync(path.join(sandbox, 'app-notes.json'), '{}\n');

const { executeAction } = await import('../dashboard-web/server/lib/coach.mjs');
const { parseApplicationsMd } = await import('../dashboard-web/server/lib/applications.mjs');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

let tick = Date.now();
function bumpTrackerMtime() {
  tick += 2000;
  fs.utimesSync(appsPath, tick / 1000, tick / 1000);
}

function rows() {
  bumpTrackerMtime();
  return parseApplicationsMd();
}

function rawRow(id) {
  const text = fs.readFileSync(appsPath, 'utf8');
  const needle = `| ${id} |`;
  const line = text.split('\n').find((candidate) => candidate.indexOf(needle) >= 0);
  return line ? parseTrackerLine(line) : null;
}

function writeRow(id, updates) {
  const lines = fs.readFileSync(appsPath, 'utf8').split('\n');
  const needle = `| ${id} |`;
  const idx = lines.findIndex((line) => line.indexOf(needle) >= 0);
  if (idx < 0) throw new Error(`fixture row ${id} not found`);
  const current = parseTrackerLine(lines[idx]);
  lines[idx] = formatTrackerLine({ ...current, ...updates });
  fs.writeFileSync(appsPath, lines.join('\n'), 'utf8');
  bumpTrackerMtime();
}

function throwsMessage(fn, message) {
  try {
    fn();
  } catch (error) {
    return error.message === message;
  }
  return false;
}

console.log('coach-outcome-passed.test.mjs');

let result = executeAction({ kind: 'logOutcome', appId: 900001, status: 'Passed', company: 'Zorblax Widgetry', label: 'Mark as Passed' });
let parsed = rows().find((r) => r.id === 900001);
check(result?.ok === true, 'Passed outcome returns ok');
check(parsed?.status === 'Passed', 'Passed outcome writes status Passed');
check(rawRow(900001)?.notes.startsWith('[passed: discarded]'), 'Passed outcome writes the discarded reason tag first');
check(parsed?.passedReason === 'discarded', 'Passed outcome parses passedReason as discarded');

result = executeAction({ kind: 'logOutcome', appId: 900003, status: 'Passed', company: 'Quennox Ratchet Works', label: 'Mark as Passed' });
check(result?.ok === true && rawRow(900003)?.notes === '[passed: discarded] Invented existing note', 'Passed outcome preserves existing notes after the tag');

const beforeDiscarded = fs.readFileSync(appsPath, 'utf8');
const discardedThrows = throwsMessage(
  () => executeAction({ kind: 'logOutcome', appId: 900001, status: 'Discarded', company: 'Zorblax Widgetry' }),
  'Unrecognized or invalid action.',
);
const afterDiscarded = fs.readFileSync(appsPath, 'utf8');
check(discardedThrows, 'Discarded outcome is refused');
check(afterDiscarded === beforeDiscarded, 'Discarded refusal leaves the tracker unchanged');

writeRow(900003, { status: 'Applied', notes: 'Invented existing note' });
result = executeAction({ kind: 'logOutcome', appId: 900003, status: 'Rejected', company: 'Quennox Ratchet Works', label: 'Mark as Rejected' });
parsed = rows().find((r) => r.id === 900003);
check(result?.ok === true && parsed?.status === 'Rejected', 'Rejected outcome still writes status Rejected');
check(!rawRow(900003)?.notes.includes('[passed:'), 'Rejected outcome adds no passed reason tag');

check(throwsMessage(
  () => executeAction({ kind: 'logOutcome', appId: 900099, status: 'Passed', company: 'No Such Example' }),
  'No application #900099 found.',
), 'Passed outcome on an unknown application id throws');

console.log(`\ncoach-outcome-passed: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
