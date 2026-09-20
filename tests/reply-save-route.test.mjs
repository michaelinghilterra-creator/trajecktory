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

fs.writeFileSync(applicationsPath,
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
  '| 900001 | 2030-03-04 | Zorblax Widgetry | Example Cog Lead | 0.01/5 | Applied | | | | | https://jobs.zorblax.example/900001 |\n' +
  '| 900002 | 2030-03-05 | Zorblax Widgetry | Example Pulley Director | 0.01/5 | Applied | | | | | https://jobs.zorblax.example/900002 |\n',
  'utf8');
fs.writeFileSync(notesPath, '{}\n', 'utf8');

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

console.log('reply-save-route.test.mjs');

try {
  const first = await post('m900001', 'log', {
    appId: 900001,
    company: 'Zorblax Widgetry',
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

