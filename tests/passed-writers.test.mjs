#!/usr/bin/env node
// Passed step 2: the status route writes Passed with a reason tag, leaving Passed drops it, and the readers that
// still need the old distinction get it back. Invented data in a sandbox.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('passed-writers');
process.env.TJK_DATA_DIR = sandbox;

const row = (id, company, role, status, score, notes = '') => `| ${id} | 2030-03-01 | ${company} | ${role} | ${score} | ${status} | | | | ${notes} | https://jobs.zorblax.example/${id} |\n`;
const applicationsPath = path.join(sandbox, 'applications.md');
fs.writeFileSync(applicationsPath,
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
  row(900001, 'Zorblax Widgetry', 'Example Flange Engineer', 'Evaluated', '3.4/5', 'Wrong level') +
  row(900002, 'Quennox Ratchet Works', 'Example Gear Manager', 'Evaluated', '3.6/5') +
  row(900003, 'Vantrix Sprocketry', 'Example Sprocket Designer', 'Passed', '2.8/5', '[passed: low_score] auto-discarded: score 2.8 < 3.0.') +
  row(900004, 'Zorblax Widgetry', 'Example Widget Planner', 'Passed', '2.8/5', '[passed: posting_closed] gone') +
  row(900005, 'Quennox Ratchet Works', 'Example Cog Lead', 'Discarded', '2.8/5', 'auto-discarded: score 2.8 < 3.0.'),
  'utf8');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/applications.mjs');
const { parseApplicationsMd } = await import('../dashboard-web/server/lib/applications.mjs');
const { isRequeueableDiscard } = await import('../lib/discard.mjs');
const { isPostingClosed } = await import('../lib/passed.mjs');
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const patch = (id, body) => fetch(`${base}/api/applications/${id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(async response => ({ status: response.status, body: await response.json() }));
// The parsed tracker is cached on the file's mtime; writes in the same millisecond would look unchanged, so move it on.
let tick = Date.now();
const rowOf = (id) => { tick += 2000; fs.utimesSync(applicationsPath, tick / 1000, tick / 1000); return parseApplicationsMd().find(r => r.id === id); };

console.log('passed-writers.test.mjs');
try {
  // Writing Passed with a reason puts the tag at the front and keeps the rest of the notes.
  let r = await patch(900001, { status: 'Passed', passedReason: 'not_a_fit' });
  check(r.status === 200 && rowOf(900001).status === 'Passed' && rowOf(900001).notes === '[passed: not_a_fit] Wrong level', 'Passed with a reason tags the notes and keeps the existing text');
  check(rowOf(900001).passedReason === 'not_a_fit', 'the parsed row carries passedReason');

  // No reason sent: discarded.
  r = await patch(900002, { status: 'Passed' });
  check(r.status === 200 && rowOf(900002).notes === '[passed: discarded]' && rowOf(900002).passedReason === 'discarded', 'Passed with no reason is discarded');

  // An unknown reason is refused and writes nothing.
  r = await patch(900002, { status: 'Passed', passedReason: 'bogus' });
  check(r.status === 400 && /passedReason/.test(r.body.error) && rowOf(900002).notes === '[passed: discarded]', 'an unknown reason is a 400 and changes nothing');

  // Changing the reason replaces the tag, never doubles it.
  r = await patch(900002, { status: 'Passed', passedReason: 'skip' });
  check(rowOf(900002).notes === '[passed: skip]', 'a second reason replaces the first');

  // Notes sent with the change are tagged too.
  r = await patch(900002, { status: 'Passed', passedReason: 'skip', notes: 'New note' });
  check(rowOf(900002).notes === '[passed: skip] New note', 'notes sent with the change are kept and tagged');

  // Leaving Passed drops the tag and keeps the text.
  r = await patch(900001, { status: 'Evaluated' });
  check(r.status === 200 && rowOf(900001).status === 'Evaluated' && rowOf(900001).notes === 'Wrong level' && rowOf(900001).passedReason === null, 'reopening a Passed row drops the tag and keeps the note');

  // Only Passed rows have a reason.
  check(rowOf(900005).passedReason === null, 'a row that is not Passed has no passedReason');

  // Readers that need the old distinction.
  check(isRequeueableDiscard({ status: rowOf(900003).status, score: rowOf(900003).score, notes: rowOf(900003).notes }) === true, 'a near threshold low_score Passed row can be re-queued, as Discarded could');
  check(isRequeueableDiscard({ status: rowOf(900004).status, score: rowOf(900004).score, notes: rowOf(900004).notes }) === false, 'a posting_closed Passed row cannot, as Closed could not');
  check(isRequeueableDiscard({ status: 'Discarded', score: 2.8, notes: '' }) === true, 'a legacy Discarded row still can');
  check(isPostingClosed(rowOf(900004)) && !isPostingClosed(rowOf(900003)) && !isPostingClosed(rowOf(900005)), 'the closed posting reads as closed from its parsed row');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\npassed-writers: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
