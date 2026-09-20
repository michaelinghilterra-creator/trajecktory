#!/usr/bin/env node
// E-1: moving into an interview stage asks for the schedule. Invented data in a sandbox.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('interview-schedule-route');
process.env.TJK_DATA_DIR = sandbox;

const centralToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const daysBack = (n) => {
  const [y, m, d] = centralToday().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};

const row = (id, company, role, status) => `| ${id} | ${daysBack(20)} | ${company} | ${role} | 0.01/5 | ${status} | | | | | https://jobs.zorblax.example/${id} |\n`;
fs.writeFileSync(path.join(sandbox, 'applications.md'),
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
  row(900001, 'Zorblax Widgetry', 'Example Cog Lead', 'Applied') +
  row(900002, 'Quennox Ratchet Works', 'Example Gear Manager', 'Applied') +
  row(900003, 'Vantrix Sprocketry', 'Example Sprocket Designer', 'Applied'),
  'utf8');
fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), JSON.stringify({ 900001: daysBack(20), 900002: daysBack(20), 900003: daysBack(20) }, null, 2) + '\n');
fs.writeFileSync(path.join(sandbox, 'status-events.tsv'), 'app#\tdate\tstatus\tcompany\tlogged\n');
fs.writeFileSync(path.join(sandbox, 'app-notes.json'), '{}\n');

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
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.json() }));
const applicationsPath = path.join(sandbox, 'applications.md');
const statusOf = (id) => (fs.readFileSync(applicationsPath, 'utf8').split('\n').find(l => l.startsWith(`| ${id} |`)) || '').split('|')[6].trim();
const schedule = { date: '2030-04-01', time: '14:00', organizerName: 'Example Personone', organizerType: 'recruiter_ta', channel: 'Phone' };

console.log('interview-schedule-route.test.mjs (store off)');
try {
  let r = await patch(900001, { status: 'Phone Screen', company: 'Zorblax Widgetry' });
  check(r.status === 200 && statusOf(900001) === 'Phone Screen', 'with the event store off, moving into an interview stage needs no schedule (phase in)');
} finally {
  await new Promise(resolve => server.close(resolve));
}

// Turn the store on. logWritesEnabled caches its answer per data dir for the life of the process, and the
// store-off block above already asked it once, so the cache has to be cleared or the store-on section would
// silently keep running against the cached "off".
fs.writeFileSync(path.join(sandbox, 'event-store.json'), JSON.stringify({ writes: 'on', flipped_at: '2030-03-01T00:00:00.000Z' }));
const { openEventStore } = await import('../lib/event-store.mjs');
const { resetLogWritesCache } = await import('../lib/log-writes.mjs');
resetLogWritesCache();
const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
{
  const out = path.join(sandbox, 'fixture-output');
  fs.mkdirSync(out);
  const st = openEventStore(path.join(sandbox, 'trajecktory.db'));
  importDataFolder(st, { dataDir: sandbox, outputDir: out, ownerName: 'Example Personone', definitionsVersion: 'v1', importedOn: '2030-04-01' });
  st.close();
}
const { readInterviewRecords } = await import('../dashboard-web/server/lib/interview-events.mjs');

const app2 = express();
app2.use(express.json());
app2.use(router);
const server2 = app2.listen(0);
await new Promise(resolve => server2.once('listening', resolve));
const base2 = `http://127.0.0.1:${server2.address().port}`;
const patch2 = (id, body) => fetch(`${base2}/api/applications/${id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.json() }));
let tick = Date.now();
const statusOf2 = (id) => { tick += 2000; fs.utimesSync(applicationsPath, tick / 1000, tick / 1000); return (fs.readFileSync(applicationsPath, 'utf8').split('\n').find(l => l.startsWith(`| ${id} |`)) || '').split('|')[6].trim(); };
const recordOf = (id, stage) => readInterviewRecords(sandbox).get(`${id}|${stage.toLowerCase()}`);

console.log('\ninterview-schedule-route.test.mjs (store on)');
try {
  let r = await patch2(900003, { status: 'Phone Screen', company: 'Vantrix Sprocketry' });
  check(r.status === 400 && /schedule is required/.test(r.body.error) && statusOf2(900003) === 'Applied', 'with the store on, no schedule is a 400 and writes nothing');

  r = await patch2(900003, { status: 'Phone Screen', company: 'Vantrix Sprocketry', schedule: { date: '2030-04-01', time: '14:00', organizerName: 'Example Personone', organizerType: 'recruiter_ta' } });
  check(r.status === 400 && /schedule\.channel/.test(r.body.error) && statusOf2(900003) === 'Applied', 'a missing channel is a 400 naming the field');

  r = await patch2(900003, { status: 'Phone Screen', company: 'Vantrix Sprocketry', schedule: { ...schedule, time: 'noon' } });
  check(r.status === 400 && /Invalid schedule\.time/.test(r.body.error), 'an unparseable time is a 400');

  r = await patch2(900003, { status: 'Phone Screen', company: 'Vantrix Sprocketry', schedule: { ...schedule, organizerType: 'ceo' } });
  check(r.status === 400 && /organizerType/.test(r.body.error), 'an unknown organizer type is a 400');

  r = await patch2(900003, { status: 'Phone Screen', company: 'Vantrix Sprocketry', schedule });
  check(r.status === 200 && statusOf2(900003) === 'Phone Screen', 'with a full schedule the status becomes the interview stage immediately');
  let rec = recordOf(900003, 'Phone Screen');
  check(rec && rec.scheduled_for === '2030-04-01' && rec.slot_end === '2030-04-01T15:00:00.000Z' && !rec.held_on && rec.evidence.length === 0, 'and a scheduled recording is written, unconfirmed until held');

  // Advancing to the NEXT round asks again.
  r = await patch2(900003, { status: '1st Interview', company: 'Vantrix Sprocketry' });
  check(r.status === 400 && statusOf2(900003) === 'Phone Screen', 'advancing to the next round without a schedule is also refused');
  r = await patch2(900003, { status: '1st Interview', company: 'Vantrix Sprocketry', schedule: { date: '2030-04-08', time: '10:00', organizerName: 'Example Personone', organizerType: 'hiring_manager_panel', channel: 'Video' } });
  check(r.status === 200 && statusOf2(900003) === '1st Interview' && recordOf(900003, '1st Interview').scheduled_for === '2030-04-08', 'a second round is scheduled the same way, and the first round record is untouched');
  check(recordOf(900003, 'Phone Screen').scheduled_for === '2030-04-01', 'the earlier round keeps its own record');

  // A non-interview status change needs nothing.
  r = await patch2(900002, { status: 'Rejected', guard: { phoneRejectionOn: daysBack(2) } });
  check(r.status === 200, 'a status change that is not an interview stage is never asked for a schedule');
} finally {
  await new Promise(resolve => server2.close(resolve));
}

console.log(`\ninterview-schedule-route: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
