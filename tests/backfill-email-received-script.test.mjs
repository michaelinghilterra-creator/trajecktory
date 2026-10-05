#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox } from './helpers/sandbox.mjs';
import { TRACKER_SEPARATOR } from '../lib/tracker.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
function row(id, company, role, status) {
  return `| ${id} | 2030-03-01 | ${company} | ${role} | 4.1/5 | ${status} | | | | | https://jobs.example.test/${id} |\n`;
}
function note(sentOn, sender, subject, sentiment, body) {
  return `### Reply logged (${sentOn})\n${sender}: ${subject} [${sentiment}]\n\n${body}`;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptTmp = path.join(repoRoot, '.test-sandboxes', 'email-received-script-tmp');
fs.mkdirSync(scriptTmp, { recursive: true });
const D = '-' + '-';
const names = ['trajecktory.db', 'trajecktory.db-wal', 'event-store.json', 'app-notes.json', 'status-events.tsv'];
const sha = (file) => (fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null);
const hashes = (sandbox) => Object.fromEntries(names.map((name) => [name, sha(path.join(sandbox, name))]));
const sameHashes = (left, right, keys = names) => keys.every((key) => left[key] === right[key]);
const runScript = (sandbox, args = []) => spawnSync(process.execPath, ['backfill-email-received.mjs', ...args, `${D}data-dir`, sandbox], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: { ...process.env, TJK_DATA_DIR: '', TMP: scriptTmp, TEMP: scriptTmp, TMPDIR: scriptTmp },
});
function writeFixture(sandbox, { eventStore = { writes: 'on', flipped_at: '2030-03-01T00:00:00.000Z' } } = {}) {
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
    '900001\t2030-03-04\tResponded\tZorblax Widgetry\t2030-03-04',
    '900002\t2030-03-01\tApplied\tQuennox Ratchet Works\t2030-03-01',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(sandbox, 'app-notes.json'), JSON.stringify({
    900001: [{ timestamp: '2030-03-04T15:00:00.000Z', msgId: 'm900101', text: note('2030-03-04', 'secret.sender@example.test', 'Secret Zorblax subject', 'positive', 'Secret invented body text.') }],
    900002: [{ timestamp: '2030-03-05T15:00:00.000Z', msgId: 'm900102', text: note('2030-03-05', 'secret.person@example.test', 'Application received secret', 'neutral', 'Secret receipt body text.') }],
  }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(sandbox, 'google-sync.json'), '{}\n', 'utf8');
  fs.writeFileSync(path.join(sandbox, 'event-store.json'), JSON.stringify(eventStore) + '\n', 'utf8');
}
async function makeDataDir(options = {}) {
  const sandbox = makeRepoSandbox(repoRoot, 'backfill-email-received-script');
  writeFixture(sandbox, options);
  const { openEventStore } = await import('../lib/event-store.mjs');
  const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
  const out = path.join(sandbox, 'fixture-output');
  fs.mkdirSync(out);
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  importDataFolder(store, { dataDir: sandbox, outputDir: out, ownerName: 'Example Personone', definitionsVersion: 'v1', importedOn: '2030-04-01' });
  store.close();
  return sandbox;
}
function makeBackup(sandbox) {
  const backupRoot = makeRepoSandbox(repoRoot, 'email-received-backup');
  const data = path.join(backupRoot, 'data');
  fs.mkdirSync(data);
  for (const name of names) {
    const src = path.join(sandbox, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(data, name));
  }
  return backupRoot;
}
async function readStoreEvents(sandbox) {
  const { openEventStore, readEvents } = await import('../lib/event-store.mjs');
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  const events = readEvents(store);
  store.close();
  return events;
}

console.log('backfill-email-received-script.test.mjs');

const noDbSandbox = makeRepoSandbox(repoRoot, 'backfill-email-received-no-db');
writeFixture(noDbSandbox);
let result = runScript(noDbSandbox);
check(result.status === 2 && result.stderr.includes('no trajecktory.db'), 'data dir with no trajecktory.db is refused');

const offSandbox = await makeDataDir({ eventStore: { writes: 'off' } });
result = runScript(offSandbox);
check(result.status === 2 && result.stderr.includes('not switched on'), 'event store off is refused');

let sandbox = await makeDataDir();
let before = hashes(sandbox);
result = runScript(sandbox);
let after = hashes(sandbox);
check(result.status === 0
  && result.stdout.includes('DRY RUN OK')
  && result.stdout.includes('reply notes 2')
  && result.stdout.includes('Responded rows 1')
  && result.stdout.includes('to write: 3 events')
  && sameHashes(before, after), 'dry run prints the plan and leaves the real folder unchanged');

sandbox = await makeDataDir();
before = hashes(sandbox);
result = runScript(sandbox, [`${D}apply`]);
after = hashes(sandbox);
check(result.status === 2 && result.stderr.includes('no-other-writers') && sameHashes(before, after), 'apply without no-other-writers is refused and changes nothing');

sandbox = await makeDataDir();
before = hashes(sandbox);
result = runScript(sandbox, [`${D}apply`, `${D}no-other-writers`]);
after = hashes(sandbox);
check(result.status === 2 && result.stderr.includes(`${D}backup`) && sameHashes(before, after), 'apply without backup is refused and changes nothing');

sandbox = await makeDataDir();
let backup = makeBackup(sandbox);
fs.appendFileSync(path.join(backup, 'data', 'trajecktory.db'), 'stale');
before = hashes(sandbox);
result = runScript(sandbox, [`${D}apply`, `${D}no-other-writers`, `${D}backup`, backup]);
after = hashes(sandbox);
check(result.status === 2 && result.stderr.includes('not identical') && sameHashes(before, after), 'apply with stale backup is refused and changes nothing');

sandbox = await makeDataDir();
backup = makeBackup(sandbox);
result = runScript(sandbox, [`${D}apply`, `${D}no-other-writers`, `${D}backup`, backup]);
let events = await readStoreEvents(sandbox);
let inbound = events.filter(event => event.type === 'email_received');
const output = `${result.stdout}\n${result.stderr}`;
check(result.status === 0
  && result.stdout.includes('DONE.')
  && inbound.length === 3
  && inbound.every(event => event.source === 'import')
  && fs.existsSync(path.join(backup, 'WHAT-CHANGED.md'))
  && !output.includes('Secret Zorblax subject')
  && !output.includes('Secret invented body text')
  && !output.includes('secret.sender@example.test'), 'valid apply writes import events and does not print private message text');

before = hashes(sandbox);
backup = makeBackup(sandbox);
result = runScript(sandbox, [`${D}apply`, `${D}no-other-writers`, `${D}backup`, backup]);
after = hashes(sandbox);
events = await readStoreEvents(sandbox);
inbound = events.filter(event => event.type === 'email_received');
check(result.status === 0
  && result.stdout.includes('Nothing to do.')
  && inbound.length === 3
  && sameHashes(before, after), 'second apply writes nothing');

console.log(`backfill-email-received-script.test.mjs: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
