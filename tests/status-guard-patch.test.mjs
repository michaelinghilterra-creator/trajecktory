#!/usr/bin/env node
// E-5: the PATCH route enforces the status guards. Invented data in a sandbox.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('status-guard-patch');
process.env.TJK_DATA_DIR = sandbox;

const centralToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const daysBack = (n) => {
  const [y, m, d] = centralToday().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};

const row = (id, company, role, status) => `| ${id} | ${daysBack(30)} | ${company} | ${role} | 0.01/5 | ${status} | | | | | https://jobs.zorblax.example/${id} |\n`;
const applicationsPath = path.join(sandbox, 'applications.md');
const eventsPath = path.join(sandbox, 'status-events.tsv');
fs.writeFileSync(applicationsPath,
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
  row(900001, 'Zorblax Widgetry', 'Example Flange Engineer', 'Applied') +
  row(900002, 'Quennox Ratchet Works', 'Example Gear Manager', 'Applied') +
  row(900003, 'Vantrix Sprocketry', 'Example Sprocket Designer', 'Applied') +
  row(900004, 'Zorblax Widgetry', 'Example Widget Planner', 'Applied') +
  row(900005, 'Quennox Ratchet Works', 'Example Cog Lead', 'Rejected'),
  'utf8');
fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), JSON.stringify({ 900001: daysBack(30), 900002: daysBack(30), 900003: daysBack(30), 900004: daysBack(30), 900005: daysBack(30) }, null, 2) + '\n');
const reply = (dayBack, subject) => ({ timestamp: `${daysBack(dayBack)}T15:00:00.123Z`, text: `### Reply logged (${daysBack(dayBack)})\nexample.personone@example.test: ${subject} [negative]\n\nInvented body.` });
fs.writeFileSync(path.join(sandbox, 'app-notes.json'), JSON.stringify({
  900001: [reply(5, 'We will not be moving forward with your application')],
  900004: [reply(4, 'thanks for your time, let us know a good time to talk')],
}, null, 2) + '\n');

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
const patch = (id, body) => fetch(`${base}/api/applications/${id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(async response => ({ status: response.status, body: await response.json() }));
const statusOf = (id) => (fs.readFileSync(applicationsPath, 'utf8').split('\n').find(l => l.startsWith(`| ${id} |`)) || '').split('|')[6].trim();
const eventsFor = (id) => (fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, 'utf8').split('\n') : []).filter(l => l.startsWith(`${id}\t`)).map(l => l.split('\t'));

console.log('status-guard-patch.test.mjs');
try {
  // Rejected with no evidence is refused and writes nothing.
  let r = await patch(900002, { status: 'Rejected', company: 'Quennox Ratchet Works' });
  check(r.status === 409 && r.body.guard.reason === 'no_employer_evidence' && r.body.guard.allowed === false, 'Rejected with no evidence is a 409 with the reason');
  check(r.body.dialog && r.body.dialog.kind === 'ask_phone_date' && r.body.dialog.needsDate === true && r.body.dialog.text.includes('Quennox Ratchet Works'), 'the refusal carries the words to show, naming the company');
  check(statusOf(900002) === 'Applied' && eventsFor(900002).length === 0, 'a refused change writes no status and no event');

  // A non rejection human reply does not allow Rejected, and is listed.
  r = await patch(900004, { status: 'Rejected' });
  check(r.status === 409 && r.body.guard.show_first.length === 1, 'a human reply that is not a rejection is listed and does not allow Rejected');

  // A logged rejection allows it and dates the event by the message.
  r = await patch(900001, { status: 'Rejected', company: 'Zorblax Widgetry' });
  check(r.status === 200 && statusOf(900001) === 'Rejected', 'a logged rejection allows Rejected');
  check(eventsFor(900001).some(e => e[2] === 'Rejected' && e[1] === daysBack(5)), 'the event is dated by the rejection message');

  // A dated phone rejection allows it and dates the event by the phone date.
  r = await patch(900002, { status: 'Rejected', guard: { phoneRejectionOn: daysBack(2) } });
  check(r.status === 200 && statusOf(900002) === 'Rejected' && eventsFor(900002).some(e => e[2] === 'Rejected' && e[1] === daysBack(2)), 'a dated phone rejection allows Rejected and dates the event');

  // A future phone date is refused.
  r = await patch(900003, { status: 'Rejected', guard: { phoneRejectionOn: '2099-01-01' } });
  check(r.status === 409 && r.body.guard.reason === 'future_phone_date' && statusOf(900003) === 'Applied', 'a phone rejection dated in the future is refused');

  // An explicit event date wins over the evidence date.
  fs.writeFileSync(path.join(sandbox, 'app-notes.json'), JSON.stringify({ 900003: [reply(6, 'We will not be moving forward with your application')], 900004: [reply(4, 'thanks for your time, let us know a good time to talk')] }, null, 2) + '\n');
  r = await patch(900003, { status: 'Rejected', eventDate: daysBack(3) });
  check(r.status === 200 && eventsFor(900003).some(e => e[2] === 'Rejected' && e[1] === daysBack(3)), 'an explicit event date wins over the message date');

  // No Response is only set by hand.
  r = await patch(900004, { status: 'No Response' });
  check(r.status === 409 && r.body.guard.reason === 'must_be_set_by_hand' && statusOf(900004) === 'Applied', 'No Response without the by hand answer is refused');
  r = await patch(900004, { status: 'No Response', guard: { byHand: true } });
  check(r.status === 409 && r.body.guard.reason === 'employer_message_exists' && r.body.guard.show_first.length === 1, 'No Response is refused when an employer message exists, and the message is listed');

  fs.writeFileSync(path.join(sandbox, 'app-notes.json'), '{}\n');
  r = await patch(900004, { status: 'No Response', guard: { byHand: true } });
  check(r.status === 200 && statusOf(900004) === 'No Response', 'No Response by hand with no employer message is allowed');

  // Not guarded: same status again, other statuses, notes only.
  r = await patch(900005, { status: 'Rejected' });
  check(r.status === 200, 'setting the status a row already has is not guarded');
  r = await patch(900005, { status: 'Discarded' });
  check(r.status === 200 && statusOf(900005) === 'Discarded', 'other statuses are not guarded');
  r = await patch(900005, { notes: 'Invented note.' });
  check(r.status === 200, 'a notes only edit is not guarded');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\nstatus-guard-patch: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
