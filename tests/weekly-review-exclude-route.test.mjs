#!/usr/bin/env node
// E-7: an interview scheduled purely through the event store (never in the legacy overrides file) shows up on
// the weekly review, and an item can be excluded with a reason. Invented data in a sandbox.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('weekly-review-exclude-route');
process.env.TJK_DATA_DIR = sandbox;

const centralToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const daysBack = (n) => {
  const [y, m, d] = centralToday().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
};

const row = (id, company, role, status) => `| ${id} | ${daysBack(30)} | ${company} | ${role} | 0.01/5 | ${status} | | | | | https://jobs.zorblax.example/${id} |\n`;
fs.writeFileSync(path.join(sandbox, 'applications.md'),
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
  row(900001, 'Zorblax Widgetry', 'Example Cog Lead', 'Phone Screen') +
  row(900002, 'Quennox Ratchet Works', 'Example Gear Manager', 'Phone Screen'),
  'utf8');
fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), JSON.stringify({ 900001: daysBack(30), 900002: daysBack(30) }, null, 2) + '\n');
fs.writeFileSync(path.join(sandbox, 'status-events.tsv'), 'app#\tdate\tstatus\tcompany\tlogged\n');
fs.writeFileSync(path.join(sandbox, 'app-notes.json'), '{}\n');
// No twc-overrides.json at all: these two lines exist ONLY as interview_recorded events.
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
const { recordInterview } = await import('../dashboard-web/server/lib/interview-events.mjs');
// 900001: unconfirmed (held, no evidence). 900002: scheduled (future).
recordInterview({ application_id: 900001, stage: 'Phone Screen', booked_on: daysBack(10), recorded_on: centralToday(), held_on: daysBack(2), evidence: [], source: 'dashboard' }, sandbox);
const future = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
recordInterview({ application_id: 900002, stage: 'Phone Screen', booked_on: daysBack(1), recorded_on: centralToday(), scheduled_for: future, evidence: [], source: 'dashboard' }, sandbox);

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
const get = (url) => fetch(`${base}${url}`).then(async r => ({ status: r.status, body: await r.json() }));
const post = (url, body) => fetch(`${base}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, body: await r.json() }));

console.log('weekly-review-exclude-route.test.mjs');
try {
  let r = await get('/api/setup/weekly-review?weeks=2');
  const all = key => r.body.weeks.flatMap(w => w[key]);
  check(all('unconfirmed_interviews').some(i => i.application_id === '900001' && i.company === 'Zorblax Widgetry'), 'a line that exists ONLY as an event-store record shows up as unconfirmed, with no overrides entry needed');
  check(all('scheduled').some(i => i.application_id === '900002' && i.company === 'Quennox Ratchet Works'), 'a line scheduled purely through the event store shows up as scheduled');
  check(r.body.excluded === 0 && r.body.open === r.body.needs_review, 'nothing is excluded yet, so open equals the raw total');

  const item = all('unconfirmed_interviews').find(i => i.application_id === '900001');
  check(item.excluded === null && typeof item.item_key === 'string', 'an unexcluded item carries no exclusion and a stable key');

  // Guards.
  r = await post('/api/setup/weekly-review/exclude', { itemKind: 'bogus', applicationId: 900001, stage: 'Phone Screen', reason: 'x' });
  check(r.status === 400 && /itemKind/.test(r.body.error), 'an unknown itemKind is a 400');
  r = await post('/api/setup/weekly-review/exclude', { itemKind: 'unconfirmed_interview', applicationId: 900001, stage: 'Phone Screen', reason: '' });
  check(r.status === 400 && /reason/.test(r.body.error), 'an empty reason is a 400');
  r = await post('/api/setup/weekly-review/exclude', { itemKind: 'unconfirmed_interview', applicationId: 'abc', stage: 'Phone Screen', reason: 'x' });
  check(r.status === 400 && /applicationId/.test(r.body.error), 'a bad applicationId is a 400');
  r = await post('/api/setup/weekly-review/exclude', { itemKind: 'unconfirmed_interview', applicationId: 900001, reason: 'x' });
  check(r.status === 400 && /stage or messageId/.test(r.body.error), 'a missing stage for an interview item is a 400');

  // Exclude the unconfirmed interview.
  r = await post('/api/setup/weekly-review/exclude', { itemKind: 'unconfirmed_interview', applicationId: 900001, stage: 'Phone Screen', reason: 'Waiting on the recruiter to confirm it happened.' });
  check(r.status === 200 && r.body.item_key === item.item_key, 'excluding it returns the same key the review listed');
  r = await get('/api/setup/weekly-review?weeks=2');
  const excludedItem = r.body.weeks.flatMap(w => w.unconfirmed_interviews).find(i => i.application_id === '900001');
  check(excludedItem && excludedItem.excluded && excludedItem.excluded.reason === 'Waiting on the recruiter to confirm it happened.', 'the item stays listed and now carries the reason');
  check(r.body.excluded === 1 && r.body.open === r.body.needs_review - 1, 'the totals count it as excluded, not open');
  check(!all('scheduled').some(i => i.application_id === '900002' && i.excluded), 'the other item is untouched');

  // Replacing the exclusion with a new reason does not double it.
  r = await post('/api/setup/weekly-review/exclude', { itemKind: 'unconfirmed_interview', applicationId: 900001, stage: 'Phone Screen', reason: 'Confirmed by email, updating the status next.' });
  check(r.status === 200, 'a second exclusion on the same item is accepted');
  r = await get('/api/setup/weekly-review?weeks=2');
  const second = r.body.weeks.flatMap(w => w.unconfirmed_interviews).find(i => i.application_id === '900001');
  check(second.excluded.reason === 'Confirmed by email, updating the status next.' && r.body.excluded === 1, 'the newer reason replaces the older one, still counted once');

  // With the store off, exclusion is refused; the review still reads (falling back to whatever the legacy path shows).
  fs.writeFileSync(path.join(sandbox, 'event-store.json'), '{"writes":"off"}\n');
  const { resetLogWritesCache } = await import('../lib/log-writes.mjs');
  resetLogWritesCache();
  r = await post('/api/setup/weekly-review/exclude', { itemKind: 'unconfirmed_interview', applicationId: 900001, stage: 'Phone Screen', reason: 'x' });
  check(r.status === 409, 'excluding with the store off is refused');
  r = await get('/api/setup/weekly-review?weeks=2');
  check(r.status === 200, 'the review itself still answers with the store off');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\nweekly-review-exclude-route: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
