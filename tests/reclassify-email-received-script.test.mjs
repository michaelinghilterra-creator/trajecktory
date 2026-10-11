#!/usr/bin/env node
// Runs reclassify-email-received.mjs against invented data folders. The dry run must report, refuse bad inputs, print no
// message text and leave every file as it was. The real write must refuse without its guards, then void and replace the
// moved events, change nothing else, and find nothing to do the second time.
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
const scriptTmp = path.join(repoRoot, '.test-sandboxes', 'reclassify-email-received-script-tmp');
fs.mkdirSync(scriptTmp, { recursive: true });
const D = '-' + '-';
const names = ['trajecktory.db', 'trajecktory.db-wal', 'trajecktory.db-shm', 'event-store.json', 'app-notes.json', 'applications.md'];
const sha = (file) => (fs.existsSync(file) ? createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null);
const hashes = (sandbox) => Object.fromEntries(names.map((name) => [name, sha(path.join(sandbox, name))]));
const sameHashes = (left, right) => names.every((key) => left[key] === right[key]);
const runScript = (sandbox, args = []) => spawnSync(process.execPath, ['reclassify-email-received.mjs', ...args, `${D}data-dir`, sandbox], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: { ...process.env, TJK_DATA_DIR: '', TMP: scriptTmp, TEMP: scriptTmp, TMPDIR: scriptTmp },
});

const BOILERPLATE = 'Secret boilerplate. We are excited to receive your application. Next steps: if selected for an interview we will schedule a call.';
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
    '900002\t2030-03-01\tApplied\tQuennox Ratchet Works\t2030-03-01',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(sandbox, 'app-notes.json'), JSON.stringify({
    900001: [{ timestamp: '2030-03-04T15:00:00.000Z', msgId: 'm900101', text: note('2030-03-04', 'no-reply@example.test', 'Secret thank you for applying', 'positive', BOILERPLATE) }],
    900002: [{ timestamp: '2030-03-05T15:00:00.000Z', msgId: 'm900102', text: note('2030-03-05', 'secret.person@example.test', 'Secret Re: role', 'positive', 'Secret person body. Can we schedule a call?') }],
  }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(sandbox, 'google-sync.json'), '{}\n', 'utf8');
  fs.writeFileSync(path.join(sandbox, 'event-store.json'), JSON.stringify(eventStore) + '\n', 'utf8');
}
function makeBackup(sandbox) {
  const backupRoot = makeRepoSandbox(repoRoot, 'reclassify-email-received-backup');
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
async function makeDataDir(options = {}) {
  const sandbox = makeRepoSandbox(repoRoot, 'reclassify-email-received-script');
  writeFixture(sandbox, options);
  const { openEventStore, appendEvents } = await import('../lib/event-store.mjs');
  const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
  const { buildEmailReceivedEvent } = await import('../lib/inbound-events.mjs');
  const out = path.join(sandbox, 'fixture-output');
  fs.mkdirSync(out);
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  importDataFolder(store, { dataDir: sandbox, outputDir: out, ownerName: 'Example Personone', definitionsVersion: 'v1', importedOn: '2030-04-01' });
  // Stored as they were classified before the sender rule: the first note is a receipt tagged positive, the second a person.
  appendEvents(store, [
    buildEmailReceivedEvent({ application_id: 900001, msg_id: 'm900101', note_timestamp: '2030-03-04T15:00:00.000Z', sent_on: '2030-03-04', kind: 'human', sentiment: 'positive' }),
    buildEmailReceivedEvent({ application_id: 900002, msg_id: 'm900102', note_timestamp: '2030-03-05T15:00:00.000Z', sent_on: '2030-03-05', kind: 'human', sentiment: 'positive' }),
  ]);
  store.close();
  return sandbox;
}

console.log('reclassify-email-received-script.test.mjs');

const noDbSandbox = makeRepoSandbox(repoRoot, 'reclassify-email-received-no-db');
writeFixture(noDbSandbox);
let result = runScript(noDbSandbox);
check(result.status === 2 && result.stderr.includes('no trajecktory.db'), 'data dir with no trajecktory.db is refused');

const offSandbox = await makeDataDir({ eventStore: { writes: 'off' } });
result = runScript(offSandbox);
check(result.status === 2 && result.stderr.includes('not switched on'), 'event store off is refused');

let sandbox = await makeDataDir();
let before = hashes(sandbox);
result = runScript(sandbox, [`${D}apply`]);
check(result.status === 2 && result.stderr.includes('no-other-writers') && sameHashes(before, hashes(sandbox)), 'the write flag without no-other-writers is refused and changes nothing');

result = runScript(sandbox, [`${D}apply`, `${D}no-other-writers`]);
check(result.status === 2 && result.stderr.includes(`${D}backup`) && sameHashes(before, hashes(sandbox)), 'the write flag without a backup is refused and changes nothing');

let staleBackup = makeBackup(sandbox);
fs.appendFileSync(path.join(staleBackup, 'data', 'trajecktory.db'), 'stale');
result = runScript(sandbox, [`${D}apply`, `${D}no-other-writers`, `${D}backup`, staleBackup]);
check(result.status === 2 && result.stderr.includes('not identical') && sameHashes(before, hashes(sandbox)), 'a stale backup is refused and changes nothing');

result = runScript(sandbox, [`${D}bogus`]);
check(result.status === 2 && result.stderr.includes('unknown option'), 'an unknown option is refused');

result = runScript(sandbox, ['stray']);
check(result.status === 2 && result.stderr.includes('unexpected argument'), 'a stray argument is refused');

before = hashes(sandbox);
result = runScript(sandbox);
check(result.status === 0
  && result.stdout.includes('email_received events: 2 visible, 0 with no reply note')
  && result.stdout.includes('would change: 1; 1 stay as they are.')
  && result.stdout.includes('human/positive -> receipt: 1')
  && result.stdout.includes('human replies: 2 -> 1')
  && result.stdout.includes('applications with a human reply: 2 -> 1')
  && result.stdout.includes('applications with a positive human reply: 2 -> 1')
  && result.stdout.includes('DRY RUN OK. Nothing real was changed.')
  && !result.stdout.includes('  event '), 'the dry run reports the move, the reply numbers and no event lines without the list flag');
check(sameHashes(before, hashes(sandbox)), 'the dry run leaves every file in the data folder unchanged');

result = runScript(sandbox, [`${D}list`]);
const output = `${result.stdout}\n${result.stderr}`;
check(result.status === 0
  && /event \d+ app 900001: human\/positive -> receipt/.test(result.stdout)
  && !result.stdout.includes('app 900002:')
  && sameHashes(before, hashes(sandbox)), 'the list flag names the event that would move and not the one that would stay');
check(!output.includes('Secret') && !output.includes('no-reply@') && !output.includes('secret.person') && !output.includes('example.test'),
  'no sender, subject or body is printed');
check(fs.readdirSync(scriptTmp).every((name) => !name.startsWith('tjk-reclassify-email-received-')), 'the scratch copy is removed afterwards');

// The real write on a fresh folder.
const writeSandbox = await makeDataDir();
let backup = makeBackup(writeSandbox);
const keep = ['applications.md', 'app-notes.json', 'event-store.json'];
const beforeWrite = hashes(writeSandbox);
const eventsBefore = await readStoreEvents(writeSandbox);
result = runScript(writeSandbox, [`${D}apply`, `${D}no-other-writers`, `${D}backup`, backup]);
const writeOutput = `${result.stdout}
${result.stderr}`;
const eventsAfter = await readStoreEvents(writeSandbox);
const inbound = eventsAfter.filter((event) => event.type === 'email_received');
const voids = eventsAfter.filter((event) => event.type === 'event_undone');
check(result.status === 0
  && result.stdout.includes('rehearsal on a scratch copy')
  && result.stdout.includes('wrote 2 events (1 voided, 1 replaced)')
  && result.stdout.includes('DONE.')
  && eventsAfter.length === eventsBefore.length + 2
  && inbound.length === 3 && voids.length === 1
  && fs.existsSync(path.join(backup, 'WHAT-CHANGED.md')), 'the real write voids the moved event, adds its replacement and writes the note in the backup');
const replacement = inbound.find((event) => event.dedupe_key && event.dedupe_key.startsWith('reclassify:'));
const voidedId = voids[0] && voids[0].corrects_event_id;
check(replacement && replacement.payload.kind === 'receipt' && replacement.payload.sentiment === null
  && replacement.payload.key === 'msg:m900101' && replacement.payload.sent_on === '2030-03-04'
  && inbound.some((event) => event.id === voidedId && event.payload.kind === 'human'), 'the replacement has the new kind and the old key and date, and the voided event is the old human one');
check(keep.every((name) => beforeWrite[name] === hashes(writeSandbox)[name]), 'the notes, the tracker and the switch file are untouched');
check(!writeOutput.includes('Secret') && !writeOutput.includes('no-reply@'), 'the write prints no message text');

result = runScript(writeSandbox);
check(result.status === 0 && result.stdout.includes('would change: 0'), 'the dry run after the write finds nothing left to move');
backup = makeBackup(writeSandbox);
const beforeSecond = hashes(writeSandbox);
result = runScript(writeSandbox, [`${D}apply`, `${D}no-other-writers`, `${D}backup`, backup]);
check(result.status === 0 && result.stdout.includes('Nothing to do.') && sameHashes(beforeSecond, hashes(writeSandbox)), 'a second write has nothing to do and changes nothing');

console.log(`reclassify-email-received-script.test.mjs: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
