#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('cadence-start');
process.env.TJK_DATA_DIR = sandbox;

const { planCadenceStarts } = await import('../dashboard-web/server/lib/cadence-start.mjs');

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};
const reachable = (id, company = 'Acme') => ({
  id, company, status: 'Not Contacted', lastTouch: '', linkedin: `https://linkedin.example/${id}`,
  email: '', verified: { state: 'none' },
});
const app = (id, company = 'Acme', status = 'Applied', date = '2030-01-02') => ({ id, company, status, date });
const plan = ({ contacts = [reachable(1)], apps = [app(10)], applyDates = {}, existingKeys = new Set(),
  sentIds = new Set(), today = '2030-01-09', scope = { contactIds: [1] } } = {}) => planCadenceStarts({
  contacts, apps, applyDates, existingKeys, sentIds, today, scope,
});

console.log('cadence-start.test.mjs');

let result = plan({ applyDates: { 10: '2030-01-05' } });
check(result.length === 1 && result[0].id === 1 && result[0].appId === 10
  && result[0].startDate === '2030-01-05', 'an eligible contact starts on the recorded apply date');

for (const [label, changes] of [
  ['Archived', { status: 'Archived' }],
  ['contacted status', { status: 'Sent' }],
  ['replied status', { status: 'Replied' }],
  ['non-empty lastTouch', { lastTouch: '2030-01-03' }],
]) {
  check(plan({ contacts: [{ ...reachable(1), ...changes }] }).length === 0, `${label} is ineligible`);
}
check(plan({ sentIds: new Set([1]) }).length === 0, 'a contact with Sent correspondence is ineligible');
check(plan({ contacts: [{ ...reachable(1), linkedin: '' }] }).length === 0, 'a contact with no channel is ineligible');
for (const state of ['active', 'paused', 'completed']) {
  check(plan({ existingKeys: new Set(['ta:1']) }).length === 0, `an existing ${state} sequence key cannot restart`);
}
check(plan({ apps: [app(10, 'Acme', 'Evaluated')] }).length === 0,
  'an Evaluated-only company has no submitted anchor');
check(plan({ apps: [app(10, 'Acme', 'Rejected')] }).length === 0,
  'a Rejected-only company has no submitted anchor');
check(plan({ contacts: [reachable(1, 'Acme')], apps: [app(10, 'Acme Inc.')] }).length === 1,
  'company suffix matching links a contact to its application');
result = plan({
  contacts: [reachable(1, 'Acme'), reachable(2, 'Acme Inc.')],
  apps: [app(10, 'Acme Inc.')],
  scope: { company: 'Acme Inc.' },
});
check(result.map(item => item.id).join(',') === '1,2',
  'an Applied Acme Inc. application starts both Acme and Acme Inc. contacts');
result = plan({
  contacts: [reachable(1, 'Acme')],
  apps: [app(10, 'Acme', 'Rejected', '2030-01-08'), app(11, 'Acme Inc.', 'Applied', '2030-01-07')],
});
check(result.length === 1 && result[0].appId === 11,
  'an exact closed historical application does not hide a live company alias');

result = plan({
  apps: [app(10, 'Acme', 'Applied', '2030-01-02'), app(11, 'Acme', 'Applied', '2030-01-03')],
  applyDates: { 10: '2030-01-08', 11: '2030-01-06' },
});
check(result[0]?.appId === 10 && result[0]?.startDate === '2030-01-08',
  'several submitted apps choose the latest effective apply date');
check(plan({ applyDates: { 10: '2030-02-01' } })[0]?.startDate === '2030-02-01',
  'applyDates is the first date fallback');
check(plan({ apps: [app(10, 'Acme', 'Applied', '2030-02-02')], applyDates: { 10: 'not-a-date' } })[0]?.startDate === '2030-02-02',
  'app.date is the second date fallback');
check(plan({ apps: [app(10, 'Acme', 'Applied', 'invalid')], applyDates: { 10: 'also-invalid' }, today: '2030-02-03' })[0]?.startDate === '2030-02-03',
  'today is the final date fallback');

const scopedContacts = [reachable(3, 'Beta'), reachable(1, 'Acme'), reachable(2, 'Acme')];
const scopedApps = [app(20, 'Beta'), app(10, 'Acme')];
check(plan({ contacts: scopedContacts, apps: scopedApps, scope: { contactIds: [3] } })[0]?.id === 3,
  'contactIds scope selects only listed contacts');
result = plan({ contacts: scopedContacts, apps: scopedApps, scope: { company: 'Acme Inc.' } });
check(result.map(item => item.id).join(',') === '1,2', 'company scope uses company matching and sorts ids');
check(plan({ scope: {} }).length === 0, 'no scope plans nothing');
check(plan({ contacts: scopedContacts, apps: scopedApps, scope: { contactIds: [99] } }).length === 0,
  'a scope with no contact match plans nothing');
const plannedKeys = new Set(result.map(item => `ta:${item.id}`));
check(plan({ contacts: scopedContacts, apps: scopedApps, scope: { company: 'Acme' }, existingKeys: plannedKeys }).length === 0,
  'adding planned keys makes a second plan idempotent');

const trackerHeader = '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n';
const trackerRow = (id, company, status) => `| ${id} | 2030-03-01 | ${company} | Invented Role | 4.50/5 | ${status} | | | | | https://jobs.example.test/${id} |\n`;
fs.writeFileSync(path.join(sandbox, 'applications.md'), trackerHeader
  + trackerRow(920001, 'Route Works', 'Evaluated')
  + trackerRow(920002, 'Quiet Works', 'Evaluated')
  + trackerRow(920003, 'Import Works', 'Applied')
  + trackerRow(920004, 'Error Works', 'Evaluated')
  + trackerRow(920005, 'Alias Works Inc.', 'Evaluated'), 'utf8');
const talentHeader = '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
const talentRow = (id, company) => `| ${id} | ${company} | Example | Rowan | Mx. | Recruiter | Austin | TX | 78701 | | | https://linkedin.example/${id} | Not Contacted | | | |\n`;
fs.writeFileSync(path.join(sandbox, 'target-talent.md'), talentHeader
  + talentRow(930001, 'Route Works') + talentRow(930002, 'Quiet Works') + talentRow(930004, 'Error Works')
  + talentRow(930005, 'Alias Works') + talentRow(930006, 'Alias Works Inc.'), 'utf8');

const express = (await import('express')).default;
const { router: applicationsRouter } = await import('../dashboard-web/server/routes/applications.mjs');
const { router: reconcileRouter } = await import('../dashboard-web/server/routes/tt-reconcile.mjs');
const web = express();
web.use(express.json());
web.use(applicationsRouter);
web.use(reconcileRouter);
const server = web.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = (url, method, body) => fetch(`${base}${url}`, {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(async response => ({ status: response.status, body: await response.json() }));

try {
  let response = await post('/api/applications/920001', 'PATCH', { status: 'Applied', company: 'Route Works' });
  check(response.status === 200 && response.body.cadenceStarted === 1,
    'PATCH becoming Applied starts an in-scope cadence and reports the count');
  const sequencePath = path.join(sandbox, 'contact-sequences.json');
  let sequences = JSON.parse(fs.readFileSync(sequencePath, 'utf8'));
  check(sequences['ta:930001']?.sequenceId === 'application-day-0-1-5-12',
    'the application route persists the planned cadence');

  response = await post('/api/applications/920002', 'PATCH', { notes: 'Invented note', company: 'Quiet Works' });
  sequences = JSON.parse(fs.readFileSync(sequencePath, 'utf8'));
  check(response.status === 200 && response.body.cadenceStarted === undefined && !sequences['ta:930002'],
    'a PATCH that is not becoming Applied starts nothing');

  response = await post('/api/applications/920005', 'PATCH', { status: 'Applied', company: 'Alias Works Inc.' });
  sequences = JSON.parse(fs.readFileSync(sequencePath, 'utf8'));
  check(response.status === 200 && response.body.cadenceStarted === 2
    && sequences['ta:930005'] && sequences['ta:930006'],
  'an application flip starts both exact and suffix-variant company contacts');

  response = await post('/api/tt-reconcile/bulk-add', 'POST', { contacts: [{
    company: 'Import Works', first: 'Avery', last: 'Example', title: 'Recruiter',
    linkedin: 'https://linkedin.example/imported',
  }] });
  sequences = JSON.parse(fs.readFileSync(sequencePath, 'utf8'));
  const importedId = Number(Object.keys(sequences)
    .find(key => !['ta:930001', 'ta:930005', 'ta:930006'].includes(key))?.split(':')[1]);
  check(response.status === 200 && response.body.written === 1 && sequences[`ta:${importedId}`],
    'reconcile add starts a cadence for a new reachable contact');

  fs.rmSync(sequencePath, { force: true });
  fs.mkdirSync(sequencePath);
  response = await post('/api/applications/920004', 'PATCH', { status: 'Applied', company: 'Error Works' });
  check(response.status === 200 && response.body.status === 'Applied',
    'a cadence storage failure does not fail an application PATCH');
  response = await post('/api/tt-reconcile/bulk-add', 'POST', { contacts: [{
    company: 'Import Works', first: 'Persontwo', last: 'Example', title: 'Recruiter',
    linkedin: 'https://linkedin.example/imported-error',
  }] });
  check(response.status === 200 && response.body.written === 1,
    'a cadence storage failure does not fail a reconcile add');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\ncadence-start: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
