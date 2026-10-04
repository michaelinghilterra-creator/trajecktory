#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox } from './helpers/sandbox.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = makeRepoSandbox(repoRoot, 'reply-state-before-cutover');
const scriptTmp = path.join(repoRoot, '.test-sandboxes', 'reply-state-before-cutover-tmp');
fs.mkdirSync(scriptTmp, { recursive: true });
process.env.TJK_DATA_DIR = sandbox;

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

function row(id, company, role, status) {
  return `| ${id} | 2030-03-01 | ${company} | ${role} | 0.01/5 | ${status} | | | | | https://jobs.zorblax.example/${id} |\n`;
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(sandbox, name), JSON.stringify(value, null, 2) + '\n');
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(sandbox, name), 'utf8'));
}

function fixtureSync() {
  return {
    seenMessageIds: ['seen-1'],
    lastCheckedAt: '2030-03-01T00:00:00.000Z',
    lastPreviewAt: '2030-03-02T00:00:00.000Z',
    handledReplies: {
      m930001: { action: 'log', appId: 900003, date: '2030-03-01' },
    },
    notRelatedSenders: {
      'someone@example.test': { date: '2030-03-02' },
    },
    unmatchedReplies: {
      m930002: {
        from: 'Other Person <other@example.test>',
        subject: 'Example follow up',
        date: '2030-03-03',
        threadId: 'thread-930002',
        snippet: 'Invented snippet',
        company: 'Quennox Ratchet Works',
        parkedOn: '2030-03-03',
      },
    },
  };
}

function bookmarksOnlySync() {
  const { handledReplies, notRelatedSenders, unmatchedReplies, ...bookmarks } = fixtureSync();
  return bookmarks;
}

function syncFile() {
  return readJson('google-sync.json');
}

function noReplySetsOnDisk() {
  const disk = syncFile();
  return !Object.hasOwn(disk, 'handledReplies')
    && !Object.hasOwn(disk, 'notRelatedSenders')
    && !Object.hasOwn(disk, 'unmatchedReplies');
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function makeBackup() {
  const backupRoot = makeRepoSandbox(repoRoot, 'reply-state-before-cutover-backup');
  const data = path.join(backupRoot, 'data');
  fs.mkdirSync(data);
  for (const name of ['trajecktory.db', 'trajecktory.db-wal', 'google-sync.json', 'event-store.json']) {
    const src = path.join(sandbox, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(data, name));
  }
  return backupRoot;
}

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
writeJson('google-sync.json', bookmarksOnlySync());
writeJson('event-store.json', { writes: 'on', flipped_at: '2030-03-01T00:00:00.000Z' });

const { openEventStore, readEvents } = await import('../lib/event-store.mjs');
const { renderLegacyFile } = await import('../lib/legacy-files.mjs');
const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
const { resetLogWritesCache } = await import('../lib/log-writes.mjs');

{
  const out = path.join(sandbox, 'fixture-output');
  fs.mkdirSync(out);
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  importDataFolder(store, { dataDir: sandbox, outputDir: out, ownerName: 'Example Personone', definitionsVersion: 'v1', importedOn: '2030-04-01' });
  store.db.prepare('DELETE FROM event_files WHERE file = ?').run('reply-state.json');
  store.close();
}

const { readSync, writeSync, replyDecisionsViaEvents } = await import('../dashboard-web/server/lib/google.mjs');

const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => (String(url).startsWith('http://127.0.0.1:')
  ? nativeFetch(url, options)
  : Promise.reject(new Error('no network in this test')));

const express = (await import('express')).default;
const { router: appsRouter } = await import('../dashboard-web/server/routes/applications.mjs');
const { router: googleRouter } = await import('../dashboard-web/server/routes/google.mjs');
const { router: eventRouter } = await import('../dashboard-web/server/routes/event-actions.mjs');
const app = express();
app.use(express.json());
app.use(appsRouter);
app.use(googleRouter);
app.use(eventRouter);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const send = (method, url, body = {}) => {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (method !== 'GET' && method !== 'HEAD') options.body = JSON.stringify(body);
  return fetch(`${base}${url}`, options).then(async r => ({ status: r.status, body: await r.json() }));
};
const allEvents = () => {
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  const events = readEvents(store);
  store.close();
  return events;
};
const eventFileCount = () => {
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  const n = store.db.prepare("SELECT COUNT(*) AS n FROM event_files WHERE file = 'reply-state.json'").get().n;
  store.close();
  return n;
};
const projectedReplyState = () => {
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  const text = renderLegacyFile(store, 'reply-state.json');
  store.close();
  return text ? JSON.parse(text) : null;
};
const recent = () => send('GET', '/api/events/recent').then(r => r.body);
const runCutover = (args = []) => spawnSync(process.execPath, ['cutover-reply-state.mjs', ...args, '--data-dir', sandbox], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: { ...process.env, TMP: scriptTmp, TEMP: scriptTmp, TMPDIR: scriptTmp },
});

console.log('reply-state-before-cutover.test.mjs');
try {
  check(replyDecisionsViaEvents() === true, 'bookmarks only uses events');

  writeJson('google-sync.json', fixtureSync());
  let sync = readSync();
  check(replyDecisionsViaEvents() === false
    && sync.handledReplies?.m930001?.action === 'log'
    && sync.notRelatedSenders?.['someone@example.test']
    && sync.unmatchedReplies?.m930002
    && sync.seenMessageIds.includes('seen-1'), 'reply decisions in google-sync stay in the file before cutover');

  writeSync({ ...readSync(), lastPreviewAt: '2030-04-01T00:00:00.000Z' });
  sync = readSync();
  let disk = syncFile();
  check(disk.handledReplies?.m930001?.action === 'log'
    && disk.notRelatedSenders?.['someone@example.test']
    && disk.unmatchedReplies?.m930002
    && disk.lastPreviewAt === '2030-04-01T00:00:00.000Z'
    && sync.unmatchedReplies?.m930002, 'writeSync preserves file decisions before cutover');

  let r = await send('POST', '/api/google/replies/m930003/dismiss');
  disk = syncFile();
  check(r.status === 200
    && disk.handledReplies?.m930003?.action === 'dismiss'
    && disk.handledReplies?.m930001?.action === 'log'
    && disk.notRelatedSenders?.['someone@example.test']
    && !allEvents().some(event => event.type === 'reply_dismissed')
    && projectedReplyState() === null, 'dismiss route writes file and leaves projection absent');

  r = await send('POST', '/api/google/replies/m930004/not-related', { from: 'Other <other@example.test>' });
  disk = syncFile();
  check(r.status === 200
    && disk.notRelatedSenders?.['other@example.test']
    && !allEvents().some(event => event.type === 'sender_not_related'), 'not-related route writes file before cutover');

  r = await send('POST', '/api/google/replies/m930005/unmatched', {
    from: 'Third <third@example.test>',
    subject: 'Example parked reply',
    snippet: 'Invented parking snippet',
    company: 'Quennox Ratchet Works',
  });
  disk = syncFile();
  check(r.status === 200
    && disk.unmatchedReplies?.m930005
    && disk.handledReplies?.m930005?.action === 'unmatched'
    && !allEvents().some(event => event.type === 'reply_unmatched'), 'unmatched route writes file before cutover');

  r = await send('POST', '/api/google/replies/m930002/log', {
    appId: 900003,
    company: 'Quennox Ratchet Works',
    from: 'Other Person <other@example.test>',
    subject: 'Example follow up',
    bodyPreview: 'Invented human reply.',
    date: '2030-03-12T10:00:00Z',
  });
  disk = syncFile();
  const attachEvent = allEvents().find(event => event.type === 'reply_attached' && event.payload?.msg_id === 'm930002');
  check(r.status === 200
    && !disk.unmatchedReplies?.m930002
    && disk.handledReplies?.m930002?.action === 'log'
    && attachEvent?.payload?.legacy_effects?.some(effect => effect.file === 'app-notes.json')
    && !attachEvent.payload.legacy_effects.some(effect => effect.file === 'reply-state.json')
    && eventFileCount() === 0, 'attach logs note event and keeps reply-state out of events before cutover');

  const list = await recent();
  const attachId = list.actions.find(action => action.type === 'reply_attached' && action.payload?.msg_id === 'm930002')?.event_id;
  r = await send('POST', `/api/events/${attachId}/undo`);
  disk = syncFile();
  check(r.status === 200
    && !disk.handledReplies?.m930002
    && !allEvents().some(event => event.type === 'reply_released')
    && eventFileCount() === 0, 'undo of pre-cutover attach edits file without release event');

  await new Promise(resolve => server.close(resolve));
  resetLogWritesCache();
  let result = runCutover();
  check(result.status === 0
    && result.stdout.includes('status: ready')
    && result.stdout.includes('DRY RUN OK'), 'cutover dry run reports ready');

  const backup = makeBackup();
  result = runCutover(['--apply', '--no-other-writers', '--backup', backup]);
  check(result.status === 0
    && result.stdout.includes('DONE.'), 'cutover apply finishes');

  resetLogWritesCache();
  check(replyDecisionsViaEvents() === true, 'after cutover reply decisions use events');

  sync = readSync();
  disk = syncFile();
  check(sync.handledReplies?.m930001?.action === 'log'
    && sync.notRelatedSenders?.['someone@example.test']
    && sync.handledReplies?.m930003?.action === 'dismiss'
    && sync.handledReplies?.m930005?.action === 'unmatched'
    && noReplySetsOnDisk()
    && disk.seenMessageIds.includes('seen-1'), 'cutover moves earlier decisions to projection and strips sync file');

  const server2 = app.listen(0);
  await new Promise(resolve => server2.once('listening', resolve));
  const base2 = `http://127.0.0.1:${server2.address().port}`;
  globalThis.fetch = (url, options) => (String(url).startsWith('http://127.0.0.1:')
    ? nativeFetch(url, options)
    : Promise.reject(new Error('no network in this test')));
  const send2 = (method, url, body = {}) => {
    const options = { method, headers: { 'Content-Type': 'application/json' } };
    if (method !== 'GET' && method !== 'HEAD') options.body = JSON.stringify(body);
    return fetch(`${base2}${url}`, options).then(async response => ({ status: response.status, body: await response.json() }));
  };
  r = await send2('POST', '/api/google/replies/m930006/dismiss');
  const projected = projectedReplyState();
  check(r.status === 200
    && allEvents().some(event => event.type === 'reply_dismissed' && event.payload?.msg_id === 'm930006')
    && projected?.handledReplies?.m930006?.action === 'dismiss'
    && noReplySetsOnDisk(), 'after cutover dismiss writes event and leaves sync file stripped');
  await new Promise(resolve => server2.close(resolve));
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
}

console.log(`\nreply-state-before-cutover: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
