#!/usr/bin/env node
// E-2: what happened to a scheduled interview. Invented data in a sandbox.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('interview-outcome-route');
process.env.TJK_DATA_DIR = sandbox;

const centralToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const daysBack = (n) => {
  const [y, m, d] = centralToday().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};

const row = (id, company, role) => `| ${id} | ${daysBack(30)} | ${company} | ${role} | 0.01/5 | Applied | | | | | https://jobs.zorblax.example/${id} |\n`;
fs.writeFileSync(path.join(sandbox, 'applications.md'),
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
  row(900001, 'Zorblax Widgetry', 'Example Cog Lead') +
  row(900002, 'Quennox Ratchet Works', 'Example Gear Manager') +
  row(900003, 'Vantrix Sprocketry', 'Example Sprocket Designer') +
  row(900004, 'Zorblax Widgetry', 'Example Widget Planner'),
  'utf8');
fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), JSON.stringify({ 900001: daysBack(30), 900002: daysBack(30), 900003: daysBack(30), 900004: daysBack(30) }, null, 2) + '\n');
fs.writeFileSync(path.join(sandbox, 'status-events.tsv'), 'app#\tdate\tstatus\tcompany\tlogged\n');
fs.writeFileSync(path.join(sandbox, 'app-notes.json'), '{}\n');
fs.writeFileSync(path.join(sandbox, 'event-store.json'), JSON.stringify({ writes: 'on', flipped_at: '2030-03-01T00:00:00.000Z' }));

const { openEventStore } = await import('../lib/event-store.mjs');
const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
{
  const out = path.join(sandbox, 'fixture-output');
  fs.mkdirSync(out);
  const st = openEventStore(path.join(sandbox, 'trajecktory.db'));
  importDataFolder(st, { dataDir: sandbox, outputDir: out, ownerName: 'Example Personone', definitionsVersion: 'v1', importedOn: '2030-04-01' });
  st.close();
}

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const express = (await import('express')).default;
const { router: appsRouter } = await import('../dashboard-web/server/routes/applications.mjs');
const { router: eventRouter } = await import('../dashboard-web/server/routes/event-actions.mjs');
const { readInterviewRecords } = await import('../dashboard-web/server/lib/interview-events.mjs');
const app = express();
app.use(express.json());
app.use(appsRouter);
app.use(eventRouter);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const send = (method, url, body) => fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, body: await r.json() }));
const notesFor = (id) => (JSON.parse(fs.readFileSync(path.join(sandbox, 'app-notes.json'), 'utf8'))[String(id)] || []);
const recordOf = (id, stage) => readInterviewRecords(sandbox).get(`${id}|${stage.toLowerCase()}`);

console.log('interview-outcome-route.test.mjs');
try {
  // Nothing pending yet.
  let r = await send('GET', '/api/interviews/pending-outcome');
  check(r.status === 200 && r.body.enabled === true && r.body.items.length === 0, 'nothing pending before any round is scheduled');

  // Schedule three rounds.
  const schedule = { date: '2030-04-01', time: '14:00', organizerName: 'Example Personone', organizerType: 'recruiter_ta', channel: 'Phone' };
  await send('PATCH', '/api/applications/900001', { status: 'Phone Screen', company: 'Zorblax Widgetry', schedule });
  await send('PATCH', '/api/applications/900002', { status: 'Phone Screen', company: 'Quennox Ratchet Works', schedule });
  await send('PATCH', '/api/applications/900003', { status: 'Phone Screen', company: 'Vantrix Sprocketry', schedule });

  // A fourth round, scheduled for a real hour already well past, so it is genuinely due right now — the only
  // way to test the `due` flag against a real clock without depending on today's date.
  await send('PATCH', '/api/applications/900004', { status: 'Phone Screen', company: 'Zorblax Widgetry', schedule: { date: daysBack(1), time: '09:00', organizerName: 'Example Personone', organizerType: 'recruiter_ta', channel: 'Phone' } });

  r = await send('GET', '/api/interviews/pending-outcome');
  check(r.status === 200 && r.body.items.length === 4 && r.body.items.every((it) => it.company && it.role), 'all four show up, each with the company and role');
  const found1 = r.body.items.find((it) => it.appId === 900001);
  check(found1 && found1.scheduledFor === '2030-04-01' && found1.due === false, 'a round scheduled well in the future is not due');
  const found4 = r.body.items.find((it) => it.appId === 900004);
  check(found4 && found4.due === true, 'a round whose slot ended over 30 minutes ago is due');
  const { isOutcomeDue } = await import('../lib/interview-schedule.mjs');
  check(r.body.items.every((it) => it.due === isOutcomeDue({ slot_end: it.slotEnd })), 'every item\'s due flag agrees with the same rule the pure lib uses');

  // Outcome guards.
  r = await send('POST', '/api/interviews/outcome', { appId: 900001, stage: 'Phone Screen', outcome: 'bogus' });
  check(r.status === 400 && /outcome must be one of/.test(r.body.error), 'an unknown outcome is a 400');
  r = await send('POST', '/api/interviews/outcome', { appId: 900001, stage: '2nd Interview', outcome: 'held', heldOn: daysBack(1), result: 'advanced' });
  check(r.status === 404, 'no pending round at that stage is a 404');

  // Held: writes held_on with owner_confirmation evidence, opens the debrief, and the round leaves the pending list.
  r = await send('POST', '/api/interviews/outcome', { appId: 900001, stage: 'Phone Screen', outcome: 'held', heldOn: daysBack(1), result: 'advanced' });
  check(r.status === 200 && r.body.debrief === true, 'held opens the debrief');
  let rec = recordOf(900001, 'Phone Screen');
  check(rec.held_on === daysBack(1) && rec.evidence[0].kind === 'owner_confirmation' && rec.scheduled_for === '2030-04-01', 'the recording is held with owner confirmation as evidence and keeps its scheduled day');
  r = await send('GET', '/api/interviews/pending-outcome');
  check(r.body.items.length === 3 && !r.body.items.some((it) => it.appId === 900001), 'the held round leaves the pending list');
  r = await send('POST', '/api/interviews/outcome', { appId: 900001, stage: 'Phone Screen', outcome: 'held', heldOn: daysBack(1), result: 'advanced' });
  check(r.status === 404, 'a round already held has nothing pending to answer again');

  // A future held date, or an unknown result, refuses and writes nothing.
  r = await send('POST', '/api/interviews/outcome', { appId: 900002, stage: 'Phone Screen', outcome: 'held', heldOn: '2099-01-01', result: 'advanced' });
  check(r.status === 400 && /future/.test(r.body.error), 'a held date in the future is refused');
  r = await send('POST', '/api/interviews/outcome', { appId: 900002, stage: 'Phone Screen', outcome: 'held', heldOn: daysBack(1), result: 'maybe' });
  check(r.status === 400 && /result must be one of/.test(r.body.error), 'an unknown result is refused');
  check(!recordOf(900002, 'Phone Screen').held_on, 'neither refusal wrote a held date');

  // Rescheduled: a new recording, the earlier one kept in history.
  r = await send('POST', '/api/interviews/outcome', { appId: 900002, stage: 'Phone Screen', outcome: 'rescheduled', newDate: '2030-04-10', newTime: '09:30' });
  check(r.status === 200, 'rescheduling is accepted');
  rec = recordOf(900002, 'Phone Screen');
  check(rec.scheduled_for === '2030-04-10' && !rec.held_on && rec.evidence.length === 0, 'the newest recording carries the new date and is unconfirmed again');
  const { openEventStore: reopen, readEvents } = await import('../lib/event-store.mjs');
  const st2 = reopen(path.join(sandbox, 'trajecktory.db'));
  const stillThere = readEvents(st2, { type: 'interview_recorded', applicationId: '900002' }).some((e) => e.payload.scheduled_for === '2030-04-01');
  st2.close();
  check(stillThere, 'the original scheduled recording is kept in history, not overwritten');
  r = await send('POST', '/api/interviews/outcome', { appId: 900002, stage: 'Phone Screen', outcome: 'rescheduled', newDate: 'nonsense' });
  check(r.status === 400 && /Invalid reschedule/.test(r.body.error), 'a bad reschedule date is refused');

  // Cancelled by employer, withdrew, no-show, dropped: the scheduled recording is voided and a note is kept.
  r = await send('POST', '/api/interviews/outcome', { appId: 900003, stage: 'Phone Screen', outcome: 'cancelled_by_employer' });
  check(r.status === 200 && r.body.voided, 'a cancellation voids the scheduled recording');
  check(!recordOf(900003, 'Phone Screen'), 'the voided recording is gone from the current record (D-10)');
  check(notesFor(900003).some((n) => /Interview outcome/.test(n.text) && /Cancelled by employer/.test(n.text)), 'and a plain note keeps why');
  r = await send('GET', '/api/interviews/pending-outcome');
  check(!r.body.items.some((it) => it.appId === 900003), 'a cancelled round leaves the pending list too');

  // The store off: both endpoints answer gracefully instead of erroring.
  fs.writeFileSync(path.join(sandbox, 'event-store.json'), '{"writes":"off"}\n');
  const { resetLogWritesCache } = await import('../lib/log-writes.mjs');
  resetLogWritesCache();
  r = await send('GET', '/api/interviews/pending-outcome');
  check(r.status === 200 && r.body.enabled === false && r.body.items.length === 0, 'with the store off, pending-outcome reports disabled rather than erroring');
  r = await send('POST', '/api/interviews/outcome', { appId: 900002, stage: 'Phone Screen', outcome: 'withdrew' });
  check(r.status === 409, 'with the store off, recording an outcome is refused');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\ninterview-outcome-route: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
