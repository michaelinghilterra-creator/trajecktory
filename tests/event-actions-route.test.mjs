#!/usr/bin/env node
// D-1 and D-10 actions: confirm that an interview was held, and void a recording. Invented data in a sandbox.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';
import { localToday } from '../lib/log-writes.mjs';

const sandbox = makeSandbox('event-actions-route');
process.env.TJK_DATA_DIR = sandbox;

// The route under test stamps dates with lib/log-writes.mjs's localToday, which reads the
// machine's own local clock (getFullYear/getMonth/getDate), not any fixed IANA zone. Anchoring
// this test to a hardcoded 'America/Chicago' "today" broke on any machine whose local date
// differs from Central's right now - true for part of every day on a UTC CI runner - so this
// uses the same function the route itself uses instead of a second, drifting notion of "today".
const daysBack = (n) => {
  const [y, m, d] = localToday().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};

const row = (id, company, role) => `| ${id} | ${daysBack(30)} | ${company} | ${role} | 0.01/5 | Phone Screen | | | | | https://jobs.zorblax.example/${id} |\n`;
fs.writeFileSync(path.join(sandbox, 'applications.md'),
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
  row(900001, 'Zorblax Widgetry', 'Example Cog Lead') +
  row(900002, 'Quennox Ratchet Works', 'Example Gear Manager'),
  'utf8');
fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), JSON.stringify({ 900001: daysBack(30), 900002: daysBack(30) }, null, 2) + '\n');
fs.writeFileSync(path.join(sandbox, 'status-events.tsv'), `app#\tdate\tstatus\tcompany\tlogged\n900001\t${daysBack(10)}\tPhone Screen\tZorblax Widgetry\t${daysBack(10)}\n`);
fs.writeFileSync(path.join(sandbox, 'app-notes.json'), '{}\n');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/event-actions.mjs');
const { readInterviewRecords } = await import('../dashboard-web/server/lib/interview-events.mjs');
const { buildActivities } = await import('../dashboard-web/server/lib/twc.mjs');
const { openEventStore, appendEvents, readEvents } = await import('../lib/event-store.mjs');
const { interviewKey } = await import('../lib/interview-store.mjs');
const { resetLogWritesCache } = await import('../lib/log-writes.mjs');

const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = (url, body) => fetch(`${base}${url}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(async response => ({ status: response.status, body: await response.json() }));
const identity = { fullName: 'Rowan Vale', email: 'rowan@example.test' };
const interviewRows = () => buildActivities({ identity }).filter(a => a.kind === 'interview');
const unrecordedRows = () => buildActivities({ identity }).unrecordedInterviews;

console.log('event-actions-route.test.mjs');
try {
  // The event store is off.
  let r = await post('/api/interviews/confirm', { appId: 900001, stage: 'Phone Screen', heldOn: daysBack(10) });
  check(r.status === 409 && /event store is off/i.test(r.body.error), 'confirming is refused while the event store is off');
  r = await post('/api/events/1/void', { reason: 'wrong_record' });
  check(r.status === 409, 'voiding is refused while the event store is off');

  // Turn the store on.
  fs.writeFileSync(path.join(sandbox, 'event-store.json'), JSON.stringify({ writes: 'on', flipped_at: '2030-03-01T00:00:00.000Z' }));
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  appendEvents(store, [{ type: 'note_added', occurred_on: '2030-03-01', source: 'cli', application_id: '900001', payload: { text: 'Invented note.' }, definitions_version: 'v1' }]);
  const noteEventId = readEvents(store)[0].id;
  store.db.close();
  resetLogWritesCache();

  // Validation.
  r = await post('/api/interviews/confirm', { stage: 'Phone Screen', heldOn: daysBack(10) });
  check(r.status === 400, 'a missing application is a 400');
  r = await post('/api/interviews/confirm', { appId: 900001, stage: 'Applied', heldOn: daysBack(10) });
  check(r.status === 400, 'a stage that is not an interview stage is a 400');
  r = await post('/api/interviews/confirm', { appId: 900001, stage: 'Phone Screen', heldOn: '2030-02-30' });
  check(r.status === 400, 'an impossible date is a 400');
  r = await post('/api/interviews/confirm', { appId: 900001, stage: 'Phone Screen', heldOn: '2999-01-01' });
  check(r.status === 400 && /future/.test(r.body.error), 'a date in the future is a 400');
  r = await post('/api/interviews/confirm', { appId: 999999, stage: 'Phone Screen', heldOn: daysBack(10) });
  check(r.status === 404, 'an unknown application is a 404');
  check(readInterviewRecords(sandbox).size === 0, 'nothing was recorded by the refused requests');

  // Before confirming: the line is on the old rules.
  check(interviewRows().length === 0 && unrecordedRows().length === 1 && unrecordedRows()[0].date === daysBack(10), 'before confirming, with the store on, the line is not counted and is listed as having no recording');

  // Confirming.
  r = await post('/api/interviews/confirm', { appId: 900001, stage: 'Phone Screen', heldOn: daysBack(8) });
  check(r.status === 200 && r.body.ok === true && r.body.event_ids.length === 1, 'confirming records one event');
  const record = readInterviewRecords(sandbox).get(interviewKey(900001, 'Phone Screen'));
  check(record && record.held_on === daysBack(8) && record.evidence.length === 1 && record.evidence[0].kind === 'owner_confirmation' && record.evidence[0].confirmed_on === localToday(), 'the record holds the held day and an owner confirmation dated today');
  check(interviewRows().length === 1 && interviewRows()[0].evidenced === true && interviewRows()[0].date === daysBack(8), 'the log now counts the line, dated by the day it was held');
  const eventId = r.body.event_ids[0];

  // A confirmation of another day replaces the first.
  r = await post('/api/interviews/confirm', { appId: 900001, stage: 'Phone Screen', heldOn: daysBack(9) });
  check(r.status === 200 && interviewRows()[0].date === daysBack(9), 'confirming again with another day replaces the held day');

  // Voiding.
  r = await post('/api/events/abc/void', { reason: 'wrong_record' });
  check(r.status === 400, 'a bad event id is a 400');
  r = await post(`/api/events/${eventId}/void`, { reason: 'because' });
  check(r.status === 400 && /reason must be one of/.test(r.body.error), 'an unknown reason is a 400');
  r = await post('/api/events/999999/void', { reason: 'wrong_record' });
  check(r.status === 404, 'an unknown event is a 404');
  r = await post(`/api/events/${noteEventId}/void`, { reason: 'wrong_record' });
  check(r.status === 400 && /interview recordings/.test(r.body.error), 'an event that is not an interview recording cannot be voided here');
  r = await post(`/api/events/${eventId}/void`, { reason: 'wrong_record' });
  check(r.status === 200 && r.body.ok === true, 'voiding the older recording is accepted');
  check(interviewRows()[0].date === daysBack(9), 'voiding an older recording does not change the newer one');
  const newest = readInterviewRecords(sandbox).get(interviewKey(900001, 'Phone Screen')).event_id;
  r = await post(`/api/events/${newest}/void`, { reason: 'not_held' });
  check(r.status === 200, 'voiding the newest recording is accepted');
  check(readInterviewRecords(sandbox).size === 0 && interviewRows().length === 0 && unrecordedRows().length === 1, 'with every recording voided, the line is not counted again and is listed as having no recording');
  const verify = openEventStore(path.join(sandbox, 'trajecktory.db'));
  const all = readEvents(verify);
  const undone = all.filter(event => event.type === 'event_undone');
  check(all.filter(event => event.type === 'interview_recorded').length === 2 && undone.length === 2, 'the voided recordings stay in the log next to their void events');
  check(undone.every(event => event.payload.actor === 'owner' && event.corrects_event_id > 0 && event.evidence_ref === 'owner'), 'each void carries its reason, actor and target');
  const voidEventId = undone[0].id;
  verify.db.close();
  r = await post(`/api/events/${voidEventId}/void`, { reason: 'wrong_record' });
  check(r.status === 400, 'a void event itself cannot be voided here');

  // The stage may be typed loosely; the stored one is the canonical label.
  r = await post('/api/interviews/confirm', { appId: 900001, stage: '  phone   SCREEN ', heldOn: daysBack(8) });
  check(r.status === 200 && readInterviewRecords(sandbox).get(interviewKey(900001, 'Phone Screen')).stage === 'Phone Screen' && readInterviewRecords(sandbox).size === 1, 'a loosely typed stage is stored as the canonical label and replaces the same line');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\nevent-actions-route: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
