#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { makeRepoSandbox } from './helpers/sandbox.mjs';
import { TRACKER_SEPARATOR } from '../lib/tracker.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = makeRepoSandbox(repoRoot, 'reply-automated-choice');
process.env.TJK_DATA_DIR = sandbox;

const applicationsPath = path.join(sandbox, 'applications.md');
const targetTalentPath = path.join(sandbox, 'target-talent.md');
const correspondenceDir = path.join(sandbox, 'target-talent-correspondence');
const contact = { source: 'ta', id: 900001, company: 'Zorblax Widgetry', name: 'Example Personone' };

function row(id, company, role) {
  return `| ${id} | 2031-03-01 | ${company} | ${role} | 0.01/5 | Applied | | | | | https://jobs.example.test/${id} |\n`;
}

fs.writeFileSync(applicationsPath,
  '# Applications Tracker\n\n'
  + '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n'
  + `${TRACKER_SEPARATOR}\n`
  + row(900001, 'Zorblax Widgetry', 'Example Cog Lead')
  + row(900002, 'Quennox Ratchet Works', 'Example Ratchet Lead')
  + row(900003, 'Zorblax Gear Foundry', 'Example Gear Lead')
  + row(900004, 'Quennox Spring Works', 'Example Spring Lead')
  + row(900005, 'Zorblax Axle Studio', 'Example Axle Lead'),
  'utf8');
fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), JSON.stringify({
  900001: '2031-03-01',
  900002: '2031-03-01',
  900003: '2031-03-01',
  900004: '2031-03-01',
  900005: '2031-03-01',
}, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(sandbox, 'status-events.tsv'), 'app#\tdate\tstatus\tcompany\tlogged\n', 'utf8');
fs.writeFileSync(path.join(sandbox, 'app-notes.json'), '{}\n', 'utf8');
fs.writeFileSync(path.join(sandbox, 'google-sync.json'), JSON.stringify({
  seenMessageIds: [], handledReplies: {}, unmatchedReplies: {}, notRelatedSenders: {},
}, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(sandbox, 'event-store.json'), JSON.stringify({
  writes: 'on', flipped_at: '2031-03-01T00:00:00.000Z',
}) + '\n', 'utf8');
fs.writeFileSync(targetTalentPath,
  '| 900001 | Zorblax Widgetry | Personone | Example | | Talent Lead | | | | | example.personone@example.test | | Not Contacted | | | |\n',
  'utf8');

const { openEventStore, readEvents } = await import('../lib/event-store.mjs');
const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
const { renderLegacyFile } = await import('../lib/legacy-files.mjs');
{
  const outputDir = path.join(sandbox, 'fixture-output');
  fs.mkdirSync(outputDir);
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  importDataFolder(store, {
    dataDir: sandbox,
    outputDir,
    ownerName: 'Example Personone',
    definitionsVersion: 'v1',
    importedOn: '2031-03-01',
  });
  store.close();
}

const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => String(url).startsWith('http://127.0.0.1:')
  ? nativeFetch(url, options)
  : Promise.reject(new Error('no network in this test'));

const { router } = await import('../dashboard-web/server/routes/google.mjs');
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const post = (msgId, action, body) => fetch(`${base}/api/google/replies/${msgId}/${action}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(async response => ({ status: response.status, body: await response.json() }));

function allEvents() {
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  const events = readEvents(store);
  store.close();
  return events;
}

function rendered(file) {
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  const text = renderLegacyFile(store, file);
  store.close();
  return text || '';
}

function notesFor(appId) {
  const text = rendered('app-notes.json');
  return text ? JSON.parse(text)[String(appId)] || [] : [];
}

function contactState() {
  const correspondence = fs.existsSync(correspondenceDir)
    ? fs.readdirSync(correspondenceDir).sort().map(file => [file, fs.readFileSync(path.join(correspondenceDir, file), 'utf8')])
    : [];
  return JSON.stringify({ row: fs.readFileSync(targetTalentPath, 'utf8'), correspondence });
}

const request = (appId, company, role, extra = {}) => ({
  appId,
  company,
  pickConfirmed: true,
  from: 'Automatic Notice <notice@example.test>',
  subject: `${role} update`,
  bodyPreview: 'Invented application message.',
  date: '2031-03-09T15:00:00Z',
  ...extra,
});

console.log('reply-automated-choice.test.mjs');

try {
  const contactsBeforeAutomated = contactState();
  const rejected = await post('m-auto-rejected', 'rejected', request(
    900001, 'Zorblax Widgetry', 'Example Cog Lead', { automated: true },
  ));
  const rejectedEvents = allEvents();
  check(rejected.status === 200
    && rejected.body.automated === true
    && rejected.body.contactLogged === false
    && /\| 900001 \|[^\n]+\| Rejected \|/.test(rendered('applications.md'))
    && notesFor(900001).length === 1
    && notesFor(900001)[0]?.msgId === 'm-auto-rejected'
    && rejectedEvents.filter(event => event.type === 'email_received' && event.payload.msg_id === 'm-auto-rejected').length === 1
    && contactState() === contactsBeforeAutomated,
  'automated rejection writes application state and no contact state');

  const beforeMissing = rendered('applications.md') + rendered('app-notes.json') + JSON.stringify(allEvents());
  const missing = await post('m-auto-missing', 'rejected', request(
    900002, 'Quennox Ratchet Works', 'Example Ratchet Lead',
  ));
  const afterMissing = rendered('applications.md') + rendered('app-notes.json') + JSON.stringify(allEvents());
  check(missing.status === 409 && missing.body.needsContact === true
    && beforeMissing === afterMissing,
  'missing automated choice returns the contact guard and writes nothing');

  const beforeString = rendered('applications.md') + rendered('app-notes.json') + JSON.stringify(allEvents());
  const stringChoice = await post('m-auto-string', 'rejected', request(
    900002, 'Quennox Ratchet Works', 'Example Ratchet Lead', { automated: 'true' },
  ));
  const afterString = rendered('applications.md') + rendered('app-notes.json') + JSON.stringify(allEvents());
  check(stringChoice.status === 409 && stringChoice.body.needsContact === true
    && beforeString === afterString,
  'a string automated value does not bypass the contact guard');

  const validContact = await post('m-auto-contact', 'log', request(
    900005, 'Zorblax Axle Studio', 'Example Axle Lead', {
      automated: true,
      contact,
      from: 'Example Personone <example.personone@example.test>',
    },
  ));
  check(validContact.status === 200
    && validContact.body.contactLogged === true
    && !Object.hasOwn(validContact.body, 'automated')
    && contactState() !== contactsBeforeAutomated,
  'a valid contact is used and the automated response marker is absent');

  const logged = await post('m-auto-log', 'log', request(
    900003, 'Zorblax Gear Foundry', 'Example Gear Lead', { automated: true },
  ));
  const interviewed = await post('m-auto-interview', 'Phone Screen', request(
    900004, 'Quennox Spring Works', 'Example Spring Lead', { automated: true },
  ));
  check(logged.status === 200 && logged.body.automated === true
    && logged.body.statusFlip === null && notesFor(900003).length === 1
    && interviewed.status === 200 && interviewed.body.automated === true
    && interviewed.body.statusFlip === 'Phone Screen'
    && notesFor(900004).length === 1
    && /\| 900004 \|[^\n]+\| Phone Screen \|/.test(rendered('applications.md')),
  'automated log and interview actions write notes and preserve their status behavior');

  const duplicate = await post('m-auto-rejected', 'rejected', request(
    900002, 'Quennox Ratchet Works', 'Example Ratchet Lead', { automated: true },
  ));
  check(duplicate.status === 409 && duplicate.body.alreadyLogged === true
    && duplicate.body.appId === 900001 && notesFor(900001).length === 1,
  'a repeated message id keeps the existing dedupe response');
} finally {
  await new Promise(resolve => server.close(resolve));
  globalThis.fetch = nativeFetch;
}

console.log(`reply-automated-choice: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
