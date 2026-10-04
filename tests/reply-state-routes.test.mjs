#!/usr/bin/env node
// Route coverage for reply-state decisions with the event store on. Invented data in a sandbox; no network.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('reply-state-routes');
process.env.TJK_DATA_DIR = sandbox;

const row = (id, company, role, status) => `| ${id} | 2030-03-01 | ${company} | ${role} | 0.01/5 | ${status} | | | | | https://jobs.zorblax.example/${id} |\n`;
fs.writeFileSync(path.join(sandbox, 'applications.md'),
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
  row(900001, 'Zorblax Widgetry', 'Example Cog Lead', 'Evaluated') +
  row(900003, 'Quennox Ratchet Works', 'Example Gear Manager', 'Applied'),
  'utf8');
fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), '{}\n');
fs.writeFileSync(path.join(sandbox, 'status-events.tsv'), 'app#\tdate\tstatus\tcompany\tlogged\n');
fs.writeFileSync(path.join(sandbox, 'app-notes.json'), '{}\n');
fs.writeFileSync(path.join(sandbox, 'google-sync.json'), JSON.stringify({
  seenMessageIds: ['seen-1'],
  lastCheckedAt: '2030-03-01T00:00:00.000Z',
  lastPreviewAt: '2030-03-02T00:00:00.000Z',
}, null, 2) + '\n');
fs.writeFileSync(path.join(sandbox, 'event-store.json'), JSON.stringify({ writes: 'on', flipped_at: '2030-03-01T00:00:00.000Z' }));

const { openEventStore, readEvents } = await import('../lib/event-store.mjs');
const { appendEventsWithEffects, renderLegacyFile } = await import('../lib/legacy-files.mjs');
const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
const { buildReplyDismissedEvent } = await import('../lib/reply-state.mjs');
{
  const out = path.join(sandbox, 'fixture-output');
  fs.mkdirSync(out);
  const st = openEventStore(path.join(sandbox, 'trajecktory.db'));
  importDataFolder(st, { dataDir: sandbox, outputDir: out, ownerName: 'Example Personone', definitionsVersion: 'v1', importedOn: '2030-04-01' });
  st.close();
}

const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => (String(url).startsWith('http://127.0.0.1:') ? nativeFetch(url, options) : Promise.reject(new Error('no network in this test')));

const express = (await import('express')).default;
const { router: appsRouter } = await import('../dashboard-web/server/routes/applications.mjs');
const { router: googleRouter } = await import('../dashboard-web/server/routes/google.mjs');
const { router: eventRouter } = await import('../dashboard-web/server/routes/event-actions.mjs');
const { readSync, writeSync } = await import('../dashboard-web/server/lib/google.mjs');
const app = express();
app.use(express.json());
app.use(appsRouter);
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
const send = (method, url, body) => {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (method !== 'GET' && method !== 'HEAD') options.body = JSON.stringify(body);
  return fetch(`${base}${url}`, options).then(async r => ({ status: r.status, body: await r.json() }));
};
const allEvents = () => { const st = openEventStore(path.join(sandbox, 'trajecktory.db')); const e = readEvents(st); st.close(); return e; };
const projectedReplyState = () => {
  const st = openEventStore(path.join(sandbox, 'trajecktory.db'));
  const text = renderLegacyFile(st, 'reply-state.json');
  st.close();
  return text ? JSON.parse(text) : {};
};
const recent = () => send('GET', '/api/events/recent').then(r => r.body);
const syncFile = () => JSON.parse(fs.readFileSync(path.join(sandbox, 'google-sync.json'), 'utf8'));
const noReplySetsOnDisk = () => {
  const disk = syncFile();
  return !Object.hasOwn(disk, 'handledReplies') && !Object.hasOwn(disk, 'notRelatedSenders') && !Object.hasOwn(disk, 'unmatchedReplies');
};

console.log('reply-state-routes.test.mjs');
try {
  let r = await send('POST', '/api/google/replies/m910001/dismiss', {});
  let state = projectedReplyState();
  check(r.status === 200
    && state.handledReplies?.m910001?.action === 'dismiss'
    && state.handledReplies.m910001.appId === null
    && /^\d{4}-\d{2}-\d{2}$/.test(state.handledReplies.m910001.date)
    && allEvents().some(e => e.type === 'reply_dismissed')
    && noReplySetsOnDisk(), 'dismiss writes projected handled state and keeps google-sync to bookmarks');

  r = await send('POST', '/api/google/replies/m910002/not-related', { from: 'Someone <someone@example.test>' });
  state = projectedReplyState();
  check(r.status === 200
    && state.handledReplies?.m910002?.action === 'not-related'
    && state.notRelatedSenders?.['someone@example.test']
    && allEvents().some(e => e.type === 'sender_not_related'), 'not-related writes handled state, sender state and event');

  r = await send('POST', '/api/google/replies/m910003/unmatched', {
    from: 'Other <other@example.test>',
    subject: 'Example follow up',
    snippet: 'Invented snippet',
    company: 'Quennox Ratchet Works',
  });
  state = projectedReplyState();
  let unmatched = await send('GET', '/api/google/replies/unmatched', {});
  check(r.status === 200
    && state.unmatchedReplies?.m910003?.subject === 'Example follow up'
    && state.unmatchedReplies.m910003.parkedOn
    && state.handledReplies?.m910003?.action === 'unmatched'
    && unmatched.body.count === 1
    && unmatched.body.items[0]?.msgId === 'm910003'
    && allEvents().some(e => e.type === 'reply_unmatched'), 'unmatched parks the message and lists it');

  r = await send('POST', '/api/google/replies/m910003/log', {
    appId: 900003,
    company: 'Quennox Ratchet Works',
    from: 'Other <other@example.test>',
    subject: 'Example follow up',
    bodyPreview: 'Invented human reply.',
    date: '2030-03-12T10:00:00Z',
  });
  state = projectedReplyState();
  unmatched = await send('GET', '/api/google/replies/unmatched', {});
  check(r.status === 200
    && !state.unmatchedReplies?.m910003
    && state.handledReplies?.m910003?.action === 'log'
    && state.handledReplies.m910003.appId === 900003
    && unmatched.body.count === 0, 'attach removes parked state and records the application');

  let list = await recent();
  const attachId = list.actions.find(action => action.type === 'reply_attached' && action.payload?.msg_id === 'm910003')?.event_id;
  r = await send('POST', `/api/events/${attachId}/undo`, {});
  state = projectedReplyState();
  // The message was parked before the attach, so undoing the attach puts it back exactly there: parked and handled as
  // unmatched, with no release event (the void alone does it).
  check(r.status === 200
    && state.handledReplies?.m910003?.action === 'unmatched'
    && Boolean(state.unmatchedReplies?.m910003)
    && !allEvents().some(event => event.type === 'reply_released'), 'undoing a modern attach puts a parked message back on the parked list by void only');

  const before = readSync();
  writeSync({ ...before, lastPreviewAt: '2030-04-01T00:00:00.000Z' });
  const after = readSync();
  const disk = syncFile();
  check(before.seenMessageIds.includes('seen-1')
    && before.handledReplies?.m910001
    && disk.seenMessageIds.includes('seen-1')
    && disk.lastPreviewAt === '2030-04-01T00:00:00.000Z'
    && noReplySetsOnDisk()
    && after.handledReplies?.m910001, 'readSync merges projection and writeSync strips reply sets');

  const st = openEventStore(path.join(sandbox, 'trajecktory.db'));
  appendEventsWithEffects(st, [
    buildReplyDismissedEvent({ msg_id: 'm910004', occurred_on: '2030-05-01' }),
  ]);
  appendEventsWithEffects(st, [{
    type: 'reply_attached',
    source: 'dashboard',
    application_id: '900001',
    definitions_version: 'v1',
    occurred_on: '2030-05-01',
    payload: {
      msg_id: 'm910004',
      action: 'log',
      legacy_effects: [{
        file: 'app-notes.json',
        op: 'json_nested_append',
        key: '900001',
        item: { timestamp: '2030-05-01T00:00:00.000Z', text: 'Invented legacy note', msgId: 'm910004' },
      }],
    },
  }]);
  st.close();
  list = await recent();
  const legacyAttach = list.actions.find(action => action.type === 'reply_attached' && action.payload?.msg_id === 'm910004');
  r = await send('POST', `/api/events/${legacyAttach?.event_id}/undo`, {});
  state = projectedReplyState();
  check(legacyAttach?.undoable
    && r.status === 200
    && allEvents().some(event => event.type === 'reply_released' && event.payload?.msg_id === 'm910004')
    && !state.handledReplies?.m910004, 'undoing a legacy attach writes reply_released and clears handled state');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\nreply-state-routes: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
