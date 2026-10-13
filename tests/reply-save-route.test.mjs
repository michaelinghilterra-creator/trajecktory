#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('reply-save-route');
process.env.TJK_DATA_DIR = sandbox;

const applicationsPath = path.join(sandbox, 'applications.md');
const notesPath = path.join(sandbox, 'app-notes.json');
const eventsPath = path.join(sandbox, 'status-events.tsv');
const syncPath = path.join(sandbox, 'google-sync.json');
const correspondencePath = path.join(sandbox, 'target-talent-correspondence', '900001.md');
const contact = { source: 'ta', id: 900001, company: 'Zorblax Widgetry', name: 'Example Personone' };

fs.writeFileSync(applicationsPath,
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
  '| 900001 | 2030-03-04 | Zorblax Widgetry | Example Cog Lead | 0.01/5 | Applied | | | | | https://jobs.zorblax.example/900001 |\n' +
  '| 900002 | 2030-03-05 | Zorblax Widgetry | Example Pulley Director | 0.01/5 | Applied | | | | | https://jobs.zorblax.example/900002 |\n',
  'utf8');
fs.writeFileSync(notesPath, '{}\n', 'utf8');
fs.writeFileSync(path.join(sandbox, 'target-talent.md'), '| 900001 | Zorblax Widgetry | Personone | Example | | Talent Lead | | | | | example.personone@example.test | | Not Contacted | | | |\n', 'utf8');

const nativeFetch = globalThis.fetch;
let externalNetworkCalls = 0;
globalThis.fetch = (url, options) => {
  const target = String(url);
  if (!target.startsWith('http://127.0.0.1:')) externalNetworkCalls++;
  return nativeFetch(url, options);
};

const express = (await import('express')).default;
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
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
}

const post = (msgId, action, body) => fetch(`${base}/api/google/replies/${msgId}/${action}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(async response => ({ status: response.status, body: await response.json() }));
const stateFiles = ['applications.md', 'app-notes.json', 'status-events.tsv', 'google-sync.json'];
const writeState = () => Object.fromEntries(stateFiles.map(file => {
  const target = path.join(sandbox, file);
  return [file, fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null];
}));
const sameState = (left, right) => stateFiles.every(file => left[file] === right[file]);

console.log('reply-save-route.test.mjs');

try {
  const initialState = writeState();
  const missing = await post('m-missing', 'log', {
    appId: 900001,
    company: 'Zorblax Widgetry',
    pickConfirmed: true,
    from: 'Example Persontwo <example.persontwo@example.test>',
    subject: 'Example Cog Lead update',
    bodyPreview: 'Invented reply body.',
    date: '2030-03-09T15:00:00Z',
  });
  check(missing.status === 409
    && missing.body.needsContact === true
    && missing.body.reason === 'missing'
    && sameState(writeState(), initialState),
  'log without a contact returns the contact guard and writes no application state');

  const notFound = await post('m-not-found', 'log', {
    appId: 900001,
    company: 'Zorblax Widgetry',
    contact: { ...contact, id: 999999 },
    pickConfirmed: true,
    from: 'Example Persontwo <example.persontwo@example.test>',
    subject: 'Example Cog Lead update',
    bodyPreview: 'Invented reply body.',
    date: '2030-03-09T15:00:00Z',
  });
  check(notFound.status === 409
    && notFound.body.reason === 'not_found'
    && sameState(writeState(), initialState),
  'log with an unknown contact returns not found and writes nothing');

  const rejectedWithoutContact = await post('m-rejected-missing', 'rejected', {
    appId: 900001,
    company: 'Zorblax Widgetry',
    pickConfirmed: true,
    from: 'Example Persontwo <example.persontwo@example.test>',
    subject: 'Example Cog Lead decision',
    bodyPreview: 'Invented rejection body.',
    date: '2030-03-09T15:00:00Z',
  });
  check(rejectedWithoutContact.status === 409
    && /\| 900001 \|[^\n]+\| Applied \|/.test(fs.readFileSync(applicationsPath, 'utf8'))
    && sameState(writeState(), initialState),
  'rejected without a contact returns 409 and leaves status unchanged');

  const interviewWithoutContact = await post('m-interview-missing', 'Phone Screen', {
    appId: 900001,
    company: 'Zorblax Widgetry',
    pickConfirmed: true,
    from: 'Example Persontwo <example.persontwo@example.test>',
    subject: 'Example Cog Lead interview',
    bodyPreview: 'Invented interview body.',
    date: '2030-03-09T15:00:00Z',
  });
  check(interviewWithoutContact.status === 409 && interviewWithoutContact.body.needsContact === true,
    'an interview stage without a contact returns 409');

  const dismissed = await post('m-dismiss', 'dismiss', {});
  const notRelated = await post('m-not-related', 'not-related', { from: 'example.persontwo@example.test' });
  const unmatched = await post('m-unmatched', 'unmatched', {
    from: 'example.persontwo@example.test',
    subject: 'Invented unmatched reply',
    snippet: 'Invented unmatched body.',
    company: 'Quennox Ratchet Works',
  });
  check(dismissed.status === 200 && notRelated.status === 200 && unmatched.status === 200,
    'dismiss, not related and unmatched still succeed without a contact');

  const fallbackSuggestion = await post('m-fallback-name', 'log', {
    appId: 900001,
    company: 'Zorblax Widgetry',
    pickConfirmed: true,
    from: 'example.persontwo@example.test',
    fromName: '  Example   Persontwo  ',
    subject: 'Invented reply',
    bodyPreview: 'Invented reply body.',
    date: '2030-03-09T15:00:00Z',
  });
  const relaySuggestion = await post('m-relay-name', 'log', {
    appId: 900001,
    company: 'Quennox Ratchet Works',
    pickConfirmed: true,
    from: 'notification@jobvite.example.test',
    fromName: 'Example Personone',
    subject: 'Invented relay reply',
    bodyPreview: 'Invented relay body.',
    date: '2030-03-09T15:00:00Z',
  });
  check(fallbackSuggestion.status === 409
    && fallbackSuggestion.body.suggestedName === 'Example Persontwo'
    && fallbackSuggestion.body.suggestedEmail === 'example.persontwo@example.test'
    && fallbackSuggestion.body.company === 'Zorblax Widgetry'
    && relaySuggestion.status === 409
    && relaySuggestion.body.suggestedName === 'Example Personone'
    && relaySuggestion.body.suggestedEmail === '',
  'the contact guard suggests fallback identity and suppresses ATS relay addresses');

  const first = await post('m900001', 'log', {
    appId: 900001,
    company: 'Zorblax Widgetry',
    contact,
    pickConfirmed: true,
    from: 'Example Personone <example.personone@zorblax.example>',
    subject: 'Example Cog Lead update',
    bodyPreview: 'Invented reply body.',
    date: '2030-03-10T15:00:00Z',
    threadId: 't900001',
  });
  const firstNotes = JSON.parse(fs.readFileSync(notesPath, 'utf8'));
  check(first.status === 200
    && first.body.alreadyLogged === false
    && firstNotes['900001']?.length === 1
    && firstNotes['900001'][0]?.msgId === 'm900001',
  'first log returns 200 and stores one note with the Gmail message id');
  check(fs.readFileSync(correspondencePath, 'utf8').includes('Invented reply body.'),
    'a valid contact receives the reply in correspondence');

  const trackerBeforeDuplicate = fs.readFileSync(applicationsPath, 'utf8');
  const eventsBeforeDuplicate = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, 'utf8') : null;
  const handledBeforeDuplicate = JSON.parse(fs.readFileSync(syncPath, 'utf8')).handledReplies?.m900001;
  const duplicate = await post('m900001', 'rejected', {
    appId: 900002,
    company: 'Zorblax Widgetry',
    pickConfirmed: true,
    from: 'Example Personone <example.personone@zorblax.example>',
    subject: 'Example Pulley Director update',
    bodyPreview: 'Invented duplicate reply body.',
    date: '2030-03-10T15:00:00Z',
    threadId: 't900001',
  });
  const notesAfterDuplicate = JSON.parse(fs.readFileSync(notesPath, 'utf8'));
  const handledAfterDuplicate = JSON.parse(fs.readFileSync(syncPath, 'utf8')).handledReplies?.m900001;
  const eventsAfterDuplicate = fs.existsSync(eventsPath) ? fs.readFileSync(eventsPath, 'utf8') : null;
  check(duplicate.status === 409
    && duplicate.body.alreadyLogged === true
    && duplicate.body.needsContact !== true
    && duplicate.body.appId === 900001
    && duplicate.body.error === 'This email is already logged on application #900001.'
    && fs.readFileSync(applicationsPath, 'utf8') === trackerBeforeDuplicate
    && eventsAfterDuplicate === eventsBeforeDuplicate
    && JSON.stringify(handledAfterDuplicate) === JSON.stringify(handledBeforeDuplicate)
    && Object.values(notesAfterDuplicate).flat().length === 1,
  'cross-application repeat save returns 409 with no tracker, event, handled, or note side effects');

  const rejected = await post('m900002', 'rejected', {
    appId: 900002,
    company: 'Zorblax Widgetry',
    contact,
    pickConfirmed: true,
    from: 'Example Personone <example.personone@zorblax.example>',
    subject: 'Example Pulley Director decision',
    bodyPreview: 'Invented rejection body.',
    date: '2030-03-11T15:00:00Z',
    threadId: 't900002',
  });
  const trackerAfterRejected = fs.readFileSync(applicationsPath, 'utf8');
  check(rejected.status === 200
    && rejected.body.statusFlip === 'Rejected'
    && /\| 900002 \|[^\n]+\| Rejected \|/.test(trackerAfterRejected),
  'a new Gmail message can mark the selected application Rejected');
  check(externalNetworkCalls === 0, 'missing Google tokens prevent any external network call');
} finally {
  await new Promise(resolve => server.close(resolve));
  globalThis.fetch = nativeFetch;
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

