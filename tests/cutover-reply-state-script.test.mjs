#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function row(id, company, role, status) {
  return `| ${id} | 2030-03-01 | ${company} | ${role} | 0.01/5 | ${status} | | | | | https://jobs.zorblax.example/${id} |\n`;
}
function fixtureSync() {
  return {
    seenMessageIds: ['seen-1'],
    lastCheckedAt: '2030-03-01T00:00:00.000Z',
    lastPreviewAt: '2030-03-02T00:00:00.000Z',
    futureBookmark: { cursor: 'abc' },
    handledReplies: {
      m920001: { action: 'log', appId: 900001, date: '2030-03-01' },
      m920002: { action: 'dismiss', appId: null, date: '2030-03-02' },
      m920003: { action: 'unmatched', appId: null, date: '2030-03-03' },
    },
    notRelatedSenders: {
      'someone@example.test': { date: '2030-03-04' },
    },
    unmatchedReplies: {
      m920003: {
        from: 'Other Person <other@example.test>',
        subject: 'Example follow up',
        date: '2030-03-03',
        threadId: 'thread-920003',
        snippet: 'Invented snippet',
        company: 'Quennox Ratchet Works',
        parkedOn: '2030-03-03',
      },
    },
  };
}
function writeFixture(sandbox, { eventStore = { writes: 'on', flipped_at: '2030-03-01T00:00:00.000Z' } } = {}) {
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
  fs.writeFileSync(path.join(sandbox, 'google-sync.json'), JSON.stringify(fixtureSync(), null, 2) + '\n');
  fs.writeFileSync(path.join(sandbox, 'event-store.json'), JSON.stringify(eventStore));
}
function bookmarksOnlySync() {
  return Object.fromEntries(Object.entries(fixtureSync()).filter(([key]) => !['handledReplies', 'notRelatedSenders', 'unmatchedReplies'].includes(key)));
}
// The folder was imported before reply decisions were added to its sync file, as a real one was.
async function makeDataDir(options = {}) {
  const sandbox = makeRepoSandbox(repoRoot, 'cutover-reply-state-script');
  writeFixture(sandbox, options);
  fs.writeFileSync(path.join(sandbox, 'google-sync.json'), JSON.stringify(bookmarksOnlySync(), null, 2) + '\n');
  const { openEventStore } = await import('../lib/event-store.mjs');
  const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
  const out = path.join(sandbox, 'fixture-output');
  fs.mkdirSync(out);
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  importDataFolder(store, { dataDir: sandbox, outputDir: out, ownerName: 'Example Personone', definitionsVersion: 'v1', importedOn: '2030-04-01' });
  store.close();
  fs.writeFileSync(path.join(sandbox, 'google-sync.json'), JSON.stringify(fixtureSync(), null, 2) + '\n');
  return sandbox;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptTmp = path.join(repoRoot, '.test-sandboxes', 'script-tmp');
fs.mkdirSync(scriptTmp, { recursive: true });
const names = ['trajecktory.db', 'trajecktory.db-wal', 'google-sync.json', 'event-store.json'];
const sha = (file) => (fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null);
const hashes = (sandbox) => Object.fromEntries([...names, 'reply-state.json'].map((name) => [name, sha(path.join(sandbox, name))]));
const sameHashes = (left, right, keys = names) => keys.every((key) => left[key] === right[key]);
const runScript = (sandbox, args = []) => spawnSync(process.execPath, ['cutover-reply-state.mjs', ...args, '--data-dir', sandbox], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: { ...process.env, TJK_DATA_DIR: '', TMP: scriptTmp, TEMP: scriptTmp, TMPDIR: scriptTmp },
});
function makeBackup(sandbox) {
  const backupRoot = makeRepoSandbox(repoRoot, 'cutover-backup');
  const data = path.join(backupRoot, 'data');
  fs.mkdirSync(data);
  for (const name of names) {
    const src = path.join(sandbox, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(data, name));
  }
  return backupRoot;
}
function readStoreEvents(sandbox) {
  return import('../lib/event-store.mjs').then(({ openEventStore, readEvents }) => {
    const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
    const events = readEvents(store);
    store.close();
    return events;
  });
}
function parseJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function parseJsonIfExists(file) {
  return fs.existsSync(file) ? parseJson(file) : null;
}

console.log('cutover-reply-state-script.test.mjs');

let sandbox = await makeDataDir();
let before = hashes(sandbox);
let result = runScript(sandbox);
let after = hashes(sandbox);
check(result.status === 0
  && result.stdout.includes('DRY RUN OK')
  && result.stdout.includes('3 handled, 1 not-related senders, 1 parked')
  && sameHashes(before, after)
  && after['reply-state.json'] === null, 'dry run exits 0 with counts and changes no live files');

sandbox = await makeDataDir();
before = hashes(sandbox);
result = runScript(sandbox, ['--apply']);
after = hashes(sandbox);
check(result.status === 2
  && result.stderr.includes('REFUSED')
  && sameHashes(before, after), 'apply without no-other-writers is refused and changes nothing');

sandbox = await makeDataDir();
before = hashes(sandbox);
result = runScript(sandbox, ['--apply', '--no-other-writers']);
after = hashes(sandbox);
check(result.status === 2 && sameHashes(before, after), 'apply without backup is refused and changes nothing');

sandbox = await makeDataDir();
let backup = makeBackup(sandbox);
fs.writeFileSync(path.join(backup, 'data', 'google-sync.json'), '{}\n');
before = hashes(sandbox);
result = runScript(sandbox, ['--apply', '--no-other-writers', '--backup', backup]);
after = hashes(sandbox);
check(result.status === 2 && sameHashes(before, after), 'apply with stale backup is refused and changes nothing');

const offSandbox = await makeDataDir({ eventStore: { writes: 'off' } });
let offDry = runScript(offSandbox);
backup = makeBackup(offSandbox);
let offApply = runScript(offSandbox, ['--apply', '--no-other-writers', '--backup', backup]);
check(offDry.status === 2 && offApply.status === 2, 'event store off is refused for dry run and apply');

const noDbSandbox = makeRepoSandbox(repoRoot, 'cutover-reply-state-script-no-db');
writeFixture(noDbSandbox);
result = runScript(noDbSandbox);
check(result.status === 2, 'data dir with no trajecktory.db is refused');

sandbox = await makeDataDir();
backup = makeBackup(sandbox);
result = runScript(sandbox, ['--apply', '--no-other-writers', '--backup', backup]);
const snapshot = parseJsonIfExists(path.join(sandbox, 'reply-state.json'));
const syncAfterApply = parseJson(path.join(sandbox, 'google-sync.json'));
const eventsAfterApply = await readStoreEvents(sandbox);
// The import recorded reply-state.json as absent (no decisions yet); only a snapshot that holds data is the cutover's.
const isDataSnapshot = (event) => event.evidence_ref === 'reply-state.json#snapshot' && event.payload?.exists !== false;
const snapshotEvents = eventsAfterApply.filter(isDataSnapshot);
check(result.status === 0
  && result.stdout.includes('DONE.')
  && result.stdout.includes('read back: identical')
  && snapshot !== null
  && same(snapshot, {
    handledReplies: fixtureSync().handledReplies,
    notRelatedSenders: fixtureSync().notRelatedSenders,
    unmatchedReplies: fixtureSync().unmatchedReplies,
  })
  && !Object.hasOwn(syncAfterApply, 'handledReplies')
  && !Object.hasOwn(syncAfterApply, 'notRelatedSenders')
  && !Object.hasOwn(syncAfterApply, 'unmatchedReplies')
  && same(syncAfterApply, {
    seenMessageIds: ['seen-1'],
    lastCheckedAt: '2030-03-01T00:00:00.000Z',
    lastPreviewAt: '2030-03-02T00:00:00.000Z',
    futureBookmark: { cursor: 'abc' },
  })
  && snapshotEvents.length === 1
  && fs.existsSync(path.join(backup, 'WHAT-CHANGED.md'))
  && !result.stdout.includes('Example follow up')
  && !result.stdout.includes('someone@example.test')
  && !result.stdout.includes('m920001'), 'valid apply writes snapshot, strips sets, records one event and prints counts only');

before = hashes(sandbox);
backup = makeBackup(sandbox);
result = runScript(sandbox, ['--apply', '--no-other-writers', '--backup', backup]);
after = hashes(sandbox);
const eventsAfterSecondApply = await readStoreEvents(sandbox);
check(result.status === 0
  && result.stdout.includes('already_cut_over')
  && result.stdout.includes('Nothing to do.')
  && before['reply-state.json'] === after['reply-state.json']
  && before['trajecktory.db'] === after['trajecktory.db']
  && eventsAfterSecondApply.filter(isDataSnapshot).length === 1, 'second apply is a no-op with one snapshot event');

const syncWithStale = parseJson(path.join(sandbox, 'google-sync.json'));
syncWithStale.handledReplies = { stale: { action: 'log', appId: 1, date: '2030-01-01' } };
fs.writeFileSync(path.join(sandbox, 'google-sync.json'), JSON.stringify(syncWithStale, null, 2) + '\n');
before = hashes(sandbox);
backup = makeBackup(sandbox);
result = runScript(sandbox, ['--apply', '--no-other-writers', '--backup', backup]);
after = hashes(sandbox);
const staleProjection = parseJsonIfExists(path.join(sandbox, 'reply-state.json'));
const staleSync = parseJson(path.join(sandbox, 'google-sync.json'));
check(result.status === 0
  && !Object.hasOwn(staleSync, 'handledReplies')
  && before['reply-state.json'] === after['reply-state.json']
  && staleProjection !== null
  && same(staleProjection, snapshot)
  && !Object.hasOwn(staleProjection.handledReplies, 'stale')
  && same(staleSync, {
    seenMessageIds: ['seen-1'],
    lastCheckedAt: '2030-03-01T00:00:00.000Z',
    lastPreviewAt: '2030-03-02T00:00:00.000Z',
    futureBookmark: { cursor: 'abc' },
  }), 'stale sets after crash are stripped without changing projection');

console.log(`cutover-reply-state-script.test.mjs: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
