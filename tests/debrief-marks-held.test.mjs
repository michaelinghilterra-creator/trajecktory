#!/usr/bin/env node
// Filing a debrief also records the interview as held, so Today and the Activity Tracker stop asking. Invented data in a sandbox.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';
import { localToday } from '../lib/local-date.mjs';

const sandbox = makeSandbox('debrief-marks-held');
process.env.TJK_DATA_DIR = sandbox;

// The server dates a held round with the machine's local day, so compare against the same clock
// (CI runs in UTC, where the Central date lags behind every evening).
const appToday = () => localToday();
const daysBack = (n) => {
  const [y, m, d] = appToday().split('-').map(Number);
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
const { renderLegacyFile } = await import('../lib/legacy-files.mjs');
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
const { router: interviewRouter } = await import('../dashboard-web/server/routes/interview.mjs');
const { readInterviewRecords } = await import('../dashboard-web/server/lib/interview-events.mjs');
const app = express();
app.use(express.json());
app.use(appsRouter);
app.use(eventRouter);
app.use(interviewRouter);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const send = (method, url, body) => fetch(`${base}${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  .then(async r => ({ status: r.status, body: await r.json() }));
const recordOf = (id, stage) => readInterviewRecords(sandbox).get(`${id}|${stage.toLowerCase()}`);

console.log('debrief-marks-held.test.mjs');
try {
  const past = (n) => ({ date: daysBack(n), time: '09:00', organizerName: 'Example Personone', organizerType: 'recruiter_ta', channel: 'Phone' });
  await send('PATCH', '/api/applications/900001', { status: 'Phone Screen', company: 'Zorblax Widgetry', schedule: past(2) });
  await send('PATCH', '/api/applications/900002', { status: 'Phone Screen', company: 'Quennox Ratchet Works', schedule: { ...past(1), date: '2030-04-01' } });

  let r = await send('GET', '/api/interviews/pending-outcome');
  check(r.body.items.some(it => it.appId === 900001 && it.due === true), 'before the debrief, the past round is listed as due');

  // The debrief itself.
  r = await send('POST', '/api/interview/debriefs/900001', { stage: 'Phone Screen', fields: { outcome: 'Went well' } });
  check(r.status === 200 && r.body.ok === true && r.body.held && r.body.held.held === true, 'saving a debrief reports the interview as held');
  check(r.body.held.heldOn === daysBack(2), 'the held date is the booked day, not the day the debrief was typed');
  const rec = recordOf(900001, 'Phone Screen');
  check(rec && rec.held_on === daysBack(2) && rec.scheduled_for === daysBack(2), 'the interview record keeps its booked date and gains the held date');
  check(rec && rec.evidence.some(e => e.kind === 'owner_confirmation'), 'the held record carries owner confirmation evidence');

  r = await send('GET', '/api/interviews/pending-outcome');
  check(!r.body.items.some(it => it.appId === 900001), 'after the debrief, Today no longer asks "Did it happen?"');

  // A second debrief for the same round does nothing extra.
  r = await send('POST', '/api/interview/debriefs/900001', { stage: 'Phone Screen', text: 'More thoughts' });
  check(r.status === 200 && r.body.held && r.body.held.held === false && r.body.held.reason === 'already_held', 'a second debrief does not record a second held event');

  // A round booked for the future cannot be recorded as held in the future.
  r = await send('POST', '/api/interview/debriefs/900002', { stage: 'Phone Screen', fields: { outcome: 'Early notes' } });
  check(r.status === 200 && r.body.held.held === true && r.body.held.heldOn <= appToday(), 'a debrief on a round booked in the future is held no later than today');

  // An explicit date wins, and a round that was never scheduled in the app still becomes held.
  await send('PATCH', '/api/applications/900003', { status: 'Phone Screen', company: 'Vantrix Sprocketry', schedule: past(5) });
  r = await send('POST', '/api/interview/debriefs/900004', { stage: '1st Interview', fields: { outcome: 'Fine' }, heldOn: daysBack(3) });
  check(r.status === 200 && r.body.held.held === true && r.body.held.heldOn === daysBack(3), 'an explicit heldOn is used for a round that was never scheduled');
  const rec4 = recordOf(900004, '1st Interview');
  check(rec4 && rec4.held_on === daysBack(3), 'the unscheduled round now exists as a held interview');

  // Bad stage still refused, and nothing is recorded.
  r = await send('POST', '/api/interview/debriefs/900003', { stage: 'Lunch' });
  check(r.status === 400, 'a stage that is not an interview stage is still refused');

  // Store off: the debrief still saves.
  fs.writeFileSync(path.join(sandbox, 'event-store.json'), '{"writes":"off"}\n');
  const { resetLogWritesCache } = await import('../lib/log-writes.mjs');
  resetLogWritesCache();
  r = await send('POST', '/api/interview/debriefs/900003', { stage: 'Phone Screen', fields: { outcome: 'ok' } });
  check(r.status === 200 && r.body.ok === true && r.body.held.held === false, 'with the store off the debrief still saves and held is reported as not recorded');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\ndebrief-marks-held: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
