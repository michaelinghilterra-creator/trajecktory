#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { makeRepoSandbox } from './helpers/sandbox.mjs';
import { TRACKER_SEPARATOR } from '../lib/tracker.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = makeRepoSandbox(repoRoot, 'email-received-route');
process.env.TJK_DATA_DIR = sandbox;

function row(id, company, role, status) {
  return `| ${id} | 2030-03-01 | ${company} | ${role} | 4.1/5 | ${status} | | | | | https://jobs.example.test/${id} |\n`;
}
fs.writeFileSync(path.join(sandbox, 'applications.md'),
  '# Applications Tracker\n\n'
  + '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n'
  + `${TRACKER_SEPARATOR}\n`
  + row(900001, 'Zorblax Widgetry', 'Widget Engineer', 'Applied')
  + row(900002, 'Quennox Ratchet Works', 'Ratchet Engineer', 'Applied'),
  'utf8');
fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), JSON.stringify({ 900001: '2030-03-01', 900002: '2030-03-01' }, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(sandbox, 'status-events.tsv'), [
  'app#\tdate\tstatus\tcompany\tlogged',
  '900001\t2030-03-01\tApplied\tZorblax Widgetry\t2030-03-01',
  '900002\t2030-03-01\tApplied\tQuennox Ratchet Works\t2030-03-01',
  '',
].join('\n'), 'utf8');
fs.writeFileSync(path.join(sandbox, 'app-notes.json'), '{}\n', 'utf8');
fs.writeFileSync(path.join(sandbox, 'google-sync.json'), JSON.stringify({ seenMessageIds: [], lastCheckedAt: null, handledReplies: {}, lastPreviewAt: null, notRelatedSenders: {} }, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(sandbox, 'event-store.json'), JSON.stringify({ writes: 'on', flipped_at: '2030-03-01T00:00:00.000Z' }) + '\n', 'utf8');

const { openEventStore, readEvents } = await import('../lib/event-store.mjs');
const { appendEventsWithEffects, renderLegacyFile } = await import('../lib/legacy-files.mjs');
const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
const { buildEmailReceivedEvent } = await import('../lib/inbound-events.mjs');
{
  const out = path.join(sandbox, 'fixture-output');
  fs.mkdirSync(out);
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  importDataFolder(store, { dataDir: sandbox, outputDir: out, ownerName: 'Example Personone', definitionsVersion: 'v1', importedOn: '2030-04-01' });
  store.close();
}

const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => (String(url).startsWith('http://127.0.0.1:') ? nativeFetch(url, options) : Promise.reject(new Error('no network in this test')));

const { router: googleRouter } = await import('../dashboard-web/server/routes/google.mjs');
const { router: eventRouter } = await import('../dashboard-web/server/routes/event-actions.mjs');
const { collectCoreMetrics } = await import('../dashboard-web/server/lib/metrics-collect.mjs');
const app = express();
app.use(express.json());
app.use(googleRouter);
app.use(eventRouter);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
const send = (method, url, body) => {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (method !== 'GET' && method !== 'HEAD') options.body = JSON.stringify(body);
  return fetch(`${base}${url}`, options).then(async response => ({ status: response.status, body: await response.json() }));
};
const allEvents = () => {
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  const events = readEvents(store);
  store.close();
  return events;
};
const projectedNotes = () => {
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  const text = renderLegacyFile(store, 'app-notes.json');
  store.close();
  return text ? JSON.parse(text) : {};
};
const responseCount = () => collectCoreMetrics({ today: '2030-03-10' }).results.response.all.k;

console.log('email-received-route.test.mjs');
try {
  let r = await send('POST', '/api/google/replies/m900001/log', {
    appId: 900001,
    company: 'Zorblax Widgetry',
    sentiment: 'positive',
    from: 'Example Person <person@example.test>',
    subject: 'Next steps',
    bodyPreview: 'Could we schedule a conversation?',
    date: '2030-03-04T10:00:00Z',
  });
  check(r.status === 200, 'plain logged attach succeeds');
  let events = allEvents();
  let attached = events.find(event => event.type === 'reply_attached' && event.payload.msg_id === 'm900001');
  let received = events.find(event => event.type === 'email_received' && event.payload.msg_id === 'm900001');
  const payloadKeys = Object.keys(received?.payload || {}).sort();
  check(attached && received && received.id === attached.id + 1
    && received.payload.kind === 'human'
    && received.payload.sentiment === 'positive'
    && received.payload.sentiment_source === 'owner'
    && received.payload.attach_event_id === null
    && same(payloadKeys, ['attach_event_id', 'classifier_version', 'key', 'kind', 'msg_id', 'note_timestamp', 'sent_on', 'sentiment', 'sentiment_source'].sort()),
  'attaching a reply appends a classified email event without sender subject or body');

  r = await send('GET', '/api/events/recent', {});
  check(r.status === 200 && r.body.actions.length === 1 && r.body.actions[0].member_ids.includes(received.id), 'recent changes groups the email event with the reply action');
  const firstAttachId = attached.id;
  r = await send('POST', `/api/events/${firstAttachId}/undo`, {});
  events = allEvents();
  check(r.status === 200
    && events.some(event => event.type === 'event_undone' && event.corrects_event_id === received.id)
    && responseCount() === 0
    && !projectedNotes()['900001'], 'undo voids the email event and removes the reply from metrics');

  r = await send('POST', '/api/google/replies/m900001/log', {
    appId: 900001,
    company: 'Zorblax Widgetry',
    sentiment: 'neutral',
    from: 'Example Person <person@example.test>',
    subject: 'Next steps again',
    bodyPreview: 'Thanks for following up.',
    date: '2030-03-05T10:00:00Z',
  });
  events = allEvents();
  const receivedAgain = events.filter(event => event.type === 'email_received' && event.payload.msg_id === 'm900001').at(-1);
  check(r.status === 200 && receivedAgain && receivedAgain.id !== received.id && responseCount() === 1, 'logging the same message again after undo writes a new email event');

  r = await send('POST', '/api/google/replies/m900010/log', {
    appId: 900002,
    company: 'Quennox Ratchet Works',
    sentiment: 'neutral',
    from: 'Example Person <person@example.test>',
    subject: 'Application update',
    bodyPreview: 'Thanks for your note.',
    date: '2030-03-06T10:00:00Z',
  });
  events = allEvents();
  const backfillLeader = events.find(event => event.type === 'reply_attached' && event.payload.msg_id === 'm900010');
  {
    const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
    appendEventsWithEffects(store, [buildEmailReceivedEvent({
      application_id: 900002,
      msg_id: 'm900010-backfill',
      sent_on: '2030-03-06',
      kind: 'human',
      sentiment: 'neutral',
      source: 'import',
      attach_event_id: backfillLeader.id,
      dedupe_key: 'backfill:msg:m900010-backfill',
    })]);
    store.close();
  }
  const importEvent = allEvents().find(event => event.dedupe_key === 'backfill:msg:m900010-backfill');
  r = await send('POST', `/api/events/${backfillLeader.id}/undo`, {});
  events = allEvents();
  check(r.status === 200 && events.some(event => event.type === 'event_undone' && event.corrects_event_id === importEvent.id), 'undoing an attach voids linked backfilled imports');

  r = await send('POST', '/api/google/replies/m900020/rejected', {
    appId: 900002,
    company: 'Quennox Ratchet Works',
    sentiment: 'negative',
    from: 'Example Person <person@example.test>',
    subject: 'Application update',
    bodyPreview: 'Unfortunately we are not moving forward.',
    date: '2030-03-07T10:00:00Z',
  });
  events = allEvents();
  check(r.status === 200 && events.some(event => event.type === 'email_received' && event.payload.msg_id === 'm900020' && event.payload.sentiment === 'negative'), 'a rejected attach with a status flip writes an email event');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`email-received-route: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
