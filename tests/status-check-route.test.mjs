#!/usr/bin/env node
// E-5: the read only status check route. Invented data; nothing is written.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('status-check-route');
process.env.TJK_DATA_DIR = sandbox;

const row = (id, company, role, status) => `| ${id} | 2030-03-01 | ${company} | ${role} | 0.01/5 | ${status} | | | | | https://jobs.zorblax.example/${id} |\n`;
const applicationsPath = path.join(sandbox, 'applications.md');
fs.writeFileSync(applicationsPath,
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
  row(900001, 'Zorblax Widgetry', 'Example Cog Lead', 'Applied') +
  row(900002, 'Zorblax Widgetry', 'Example Pulley Director', 'Applied') +
  row(900003, 'Quennox Ratchet Works', 'Example Gear Manager', 'Applied'),
  'utf8');
fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), JSON.stringify({ 900001: '2030-03-01', 900002: '2030-03-01', 900003: '2030-03-01' }, null, 2) + '\n');
const notes = {
  900001: [{ timestamp: '2030-03-10T15:00:00.123Z', text: '### Reply logged (2030-03-10)\nexample.personone@zorblax.example: We will not be moving forward with your application [negative]\n\nInvented rejection body.' }],
  900002: [{ timestamp: '2030-03-02T15:00:00.123Z', text: '### Reply logged (2030-03-02)\nno-reply@zorblax.example: Confirmation of your application [neutral]\n\nInvented receipt body.' }],
};
const notesPath = path.join(sandbox, 'app-notes.json');
fs.writeFileSync(notesPath, JSON.stringify(notes, null, 2) + '\n');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/applications.mjs');
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const get = (url) => fetch(`${base}${url}`).then(async response => ({ status: response.status, body: await response.json() }));

console.log('status-check-route.test.mjs');
try {
  const trackerBefore = fs.readFileSync(applicationsPath, 'utf8');
  const notesBefore = fs.readFileSync(notesPath, 'utf8');

  let r = await get('/api/applications/900001/status-check?to=Rejected');
  check(r.status === 200 && r.body.allowed === true && r.body.dated_on === '2030-03-10' && r.body.evidence_ref.startsWith('note:900001:'), 'a logged rejection allows Rejected and dates it');

  r = await get('/api/applications/900002/status-check?to=Rejected');
  check(r.status === 200 && r.body.allowed === false && r.body.reason === 'no_employer_evidence', 'a receipt alone does not allow Rejected');

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayText = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  r = await get(`/api/applications/900003/status-check?to=Rejected&phoneOn=${yesterdayText}`);
  check(r.body.allowed === true && r.body.evidence_ref === 'said_no_by_phone' && r.body.dated_on === yesterdayText, 'a dated phone rejection allows Rejected');

  r = await get('/api/applications/900003/status-check?to=Rejected&phoneOn=2099-01-01');
  check(r.body.allowed === false && r.body.reason === 'future_phone_date', 'a phone rejection dated in the future is refused');

  r = await get('/api/applications/900001/status-check?to=No%20Response&byHand=1');
  check(r.body.allowed === false && r.body.reason === 'employer_message_exists' && r.body.show_first.length === 1, 'No Response is refused when a rejection is on record, and the message is listed');
  check(r.body.dialog.kind === 'read_first' && r.body.dialog.text.includes('Zorblax Widgetry'), 'the answer carries the words to show');
  r = await get('/api/applications/900001/status-check?to=Applied');
  check(r.body.allowed === true && r.body.dialog.kind === 'proceed', 'an allowed change carries a proceed dialog');

  r = await get('/api/applications/900003/status-check?to=No%20Response');
  check(r.body.allowed === false && r.body.reason === 'must_be_set_by_hand', 'No Response without the by hand flag is refused');

  r = await get('/api/applications/900003/status-check?to=No%20Response&byHand=1');
  check(r.body.allowed === true, 'No Response by hand with no messages is allowed');

  r = await get('/api/applications/900003/status-check?to=Passed');
  check(r.status === 200 && r.body.allowed === false && r.body.suggest === 'Discarded', 'Passed is not live and Discarded is suggested');

  r = await get('/api/applications/900003/status-check?to=Nonsense');
  check(r.status === 400, 'an unknown status is a 400');
  r = await get('/api/applications/abc/status-check?to=Rejected');
  check(r.status === 400, 'a bad id is a 400');
  r = await get('/api/applications/999999/status-check?to=Rejected');
  check(r.status === 404, 'an unknown application is a 404');

  check(fs.readFileSync(applicationsPath, 'utf8') === trackerBefore && fs.readFileSync(notesPath, 'utf8') === notesBefore, 'the check changed no file');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\nstatus-check-route: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
