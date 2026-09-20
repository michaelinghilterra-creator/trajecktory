#!/usr/bin/env node
// E-7: the read only weekly review route. Invented data; nothing is written.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('weekly-review-route');
process.env.TJK_DATA_DIR = sandbox;

const centralToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const daysBack = (n) => {
  const [y, m, d] = centralToday().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};

// The last day of the current Sunday to Saturday week; a scheduled line can only be shown when it is still ahead.
const weekEnd = daysBack(-(6 - new Date(`${centralToday()}T00:00:00Z`).getUTCDay()));
const canSchedule = weekEnd > centralToday();

const row = (id, company, role, status) => `| ${id} | ${daysBack(30)} | ${company} | ${role} | 0.01/5 | ${status} | | | | | https://jobs.zorblax.example/${id} |\n`;
fs.writeFileSync(path.join(sandbox, 'applications.md'),
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
  row(900001, 'Zorblax Widgetry', 'Example Flange Engineer', 'No Response') +
  row(900002, 'Quennox Ratchet Works', 'Example Gear Manager', 'Phone Screen') +
  row(900003, 'Vantrix Sprocketry', 'Example Sprocket Designer', 'Rejected'),
  'utf8');
fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), JSON.stringify({ 900001: daysBack(30), 900002: daysBack(30), 900003: daysBack(30) }, null, 2) + '\n');
fs.writeFileSync(path.join(sandbox, 'status-events.tsv'),
  `app#\tdate\tstatus\tcompany\tlogged\n900001\t${daysBack(20)}\tNo Response\tZorblax Widgetry\t${daysBack(20)}\n` +
  `900003\t${daysBack(9)}\tApplied\tVantrix Sprocketry\t${daysBack(9)}\n900003\t${daysBack(4)}\tRejected\tVantrix Sprocketry\t${daysBack(4)}\n`, 'utf8');
fs.writeFileSync(path.join(sandbox, 'app-notes.json'), JSON.stringify({
  900001: [{ timestamp: `${daysBack(1)}T15:00:00.123Z`, text: `### Reply logged (${daysBack(1)})\nexample.personone@zorblax.example: We will not be moving forward with your application [negative]\n\nInvented rejection body.` }],
  900003: [{ timestamp: `${daysBack(6)}T15:00:00.123Z`, text: `### Reply logged (${daysBack(6)})\nexample.personone@vantrix.example: We will not be moving forward with your application [negative]\n\nInvented rejection body.` }],
}, null, 2) + '\n');
fs.writeFileSync(path.join(sandbox, 'twc-overrides.json'), JSON.stringify({
  interviews: [
    { appId: 900002, stage: 'Phone Screen', date: daysBack(2) },
    { appId: 900002, stage: '1st Interview', date: daysBack(3), evidence_ref: { kind: 'message_id', id: 'm900001' } },
    ...(canSchedule ? [{ appId: 900002, stage: '2nd Interview', date: weekEnd }] : []),
  ],
}, null, 2) + '\n');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/weekly-review.mjs');
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const get = (url) => fetch(`${base}${url}`).then(async response => ({ status: response.status, body: await response.json() }));

console.log('weekly-review-route.test.mjs');
try {
  const before = ['applications.md', 'app-notes.json', 'twc-overrides.json', 'status-events.tsv']
    .map(name => fs.readFileSync(path.join(sandbox, name), 'utf8')).join('\n');

  const r = await get('/api/setup/weekly-review?weeks=2');
  const weeks = r.body.weeks || [];
  const all = key => weeks.flatMap(w => w[key]);
  check(r.status === 200 && weeks.length === 2, 'the route answers with two weeks');
  check(weeks[1].to >= centralToday() && weeks[1].from <= centralToday(), 'the last week holds today');
  check(all('unconfirmed_interviews').some(i => i.stage === 'Phone Screen' && i.company === 'Quennox Ratchet Works'), 'an interview line with no evidence is listed');
  check(!all('unconfirmed_interviews').some(i => i.stage === '1st Interview'), 'an interview line that cites evidence is not listed');
  if (canSchedule) check(all('scheduled').some(i => i.stage === '2nd Interview' && i.company === 'Quennox Ratchet Works'), 'a future interview line is listed as scheduled, with the company');
  else console.log('  SKIP scheduled check: today is the last day of the week');
  check(all('newer_messages').some(i => i.application_id === 900001 && i.kind === 'rejection' && i.company === 'Zorblax Widgetry'), 'a rejection newer than the last status change is listed');
  check(!all('newer_messages').some(i => i.application_id === 900003), 'a rejection older than the newest status change is not listed');
  check(typeof r.body.needs_review === 'number' && r.body.needs_review === weeks.reduce((sum, w) => sum + w.needs_review, 0), 'the total adds up');

  const wide = await get('/api/setup/weekly-review');
  check(wide.status === 200 && wide.body.weeks.length === 4, 'four weeks are shown by default');
  check((await get('/api/setup/weekly-review?weeks=0')).status === 400, 'zero weeks is a 400');
  check((await get('/api/setup/weekly-review?weeks=13')).status === 400, 'thirteen weeks is a 400');
  check((await get('/api/setup/weekly-review?weeks=abc')).status === 400, 'a word for weeks is a 400');

  // A recorded interview event decides its line: confirmed and held, it is no longer listed (D-1).
  fs.writeFileSync(path.join(sandbox, 'event-store.json'), JSON.stringify({ writes: 'on', flipped_at: '2030-03-01T00:00:00.000Z' }));
  const { openEventStore } = await import('../lib/event-store.mjs');
  const { resetLogWritesCache } = await import('../lib/log-writes.mjs');
  const { recordInterview } = await import('../dashboard-web/server/lib/interview-events.mjs');
  openEventStore(path.join(sandbox, 'trajecktory.db')).db.close();
  resetLogWritesCache();
  const listedBefore = (await get('/api/setup/weekly-review?weeks=2')).body.weeks.flatMap(w => w.unconfirmed_interviews).some(i => i.stage === 'Phone Screen');
  recordInterview({ application_id: 900002, stage: 'Phone Screen', recorded_on: centralToday(), held_on: daysBack(2), evidence: [{ kind: 'owner_confirmation', confirmed_on: centralToday(), ref: 'confirmation-900002' }] }, sandbox);
  const listedAfter = (await get('/api/setup/weekly-review?weeks=2')).body.weeks.flatMap(w => w.unconfirmed_interviews).some(i => i.stage === 'Phone Screen');
  check(listedBefore && !listedAfter, 'a line that is recorded as held with evidence is no longer listed as unconfirmed');
  const noEvidence = recordInterview({ application_id: 900002, stage: 'Phone Screen', recorded_on: centralToday(), held_on: daysBack(2), evidence: [] }, sandbox);
  check(noEvidence.length === 1 && (await get('/api/setup/weekly-review?weeks=2')).body.weeks.flatMap(w => w.unconfirmed_interviews).some(i => i.stage === 'Phone Screen'), 'a newer recording with no evidence puts the line back on the list');

  const after = ['applications.md', 'app-notes.json', 'twc-overrides.json', 'status-events.tsv']
    .map(name => fs.readFileSync(path.join(sandbox, name), 'utf8')).join('\n');
  check(before === after, 'the review changed no file');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\nweekly-review-route: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
