#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openEventStore } from '../lib/event-store.mjs';
import { verifyImport } from '../lib/import/verify-import.mjs';
import { TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { removeDatabase, runEventStore } from '../scripts/event-store.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

function fixture(root, name) {
  const base = join(root, name);
  const dataDir = join(base, 'input');
  const outputDir = join(base, 'generated');
  const backupsDir = join(base, 'saved-copies');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  const tracker = [
    '# Invented Applications Tracker',
    '',
    TRACKER_HEADER,
    TRACKER_SEPARATOR,
    '| 900001 | 2030-03-01 | Zorblax Widgetry | Example Cog Lead | 0.11/5 | Evaluated | no | example.docx | [900001](https://example.test/report/900001) | Invented fixture | https://example.test/jobs/900001 |',
    '',
  ].join('\n');
  writeFileSync(join(dataDir, 'applications.md'), tracker, 'utf8');
  writeFileSync(join(dataDir, 'apply-dates.json'), '{\n  "900001": "2030-03-02"\n}\n', 'utf8');
  mkdirSync(join(dataDir, 'target-talent-correspondence'));
  writeFileSync(
    join(dataDir, 'target-talent-correspondence', '900001.md'),
    '# Example Personone\n\nInvented message for Zorblax Widgetry.\n',
    'utf8',
  );
  return { base, dataDir, outputDir, backupsDir };
}

function snapshot(directory) {
  const values = {};
  function visit(current, prefix = '') {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path, key);
      else values[key] = readFileSync(path).toString('base64');
    }
  }
  visit(directory);
  return values;
}

function dataFileSnapshot(directory) {
  const values = snapshot(directory);
  delete values['trajecktory.db'];
  delete values['trajecktory.db-shm'];
  delete values['trajecktory.db-wal'];
  delete values['event-store.json'];
  return values;
}

function addTrackerRow(dataDir, id, company = 'Quasar Works') {
  const path = join(dataDir, 'applications.md');
  const row = `| ${id} | 2030-03-03 | ${company} | Example Signal Lead | 4.21/5 | Evaluated | no | example-${id}.docx | [${id}](https://example.test/report/${id}) | Added while off | https://example.test/jobs/${id} |`;
  writeFileSync(path, `${readFileSync(path, 'utf8').trimEnd()}\n${row}\n`, 'utf8');
}

function hasApplicationEvent(dataDir, id) {
  const store = openEventStore(join(dataDir, 'trajecktory.db'));
  try {
    return store.db.prepare("SELECT payload FROM events WHERE type = 'posting_evaluated'")
      .all()
      .some(event => JSON.parse(event.payload).num === Number(id));
  } finally {
    store.close();
  }
}

function capture() {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    io: { log: value => stdout.push(String(value)), error: value => stderr.push(String(value)) },
  };
}

function dependencies(item, extra = {}) {
  return {
    backupsDir: item.backupsDir,
    getOwnerName: () => 'Example Personone',
    now: () => new Date('2030-03-04T05:06:07.000Z'),
    ...extra,
  };
}

function withDataDir(dataDir, fn) {
  const previous = process.env.TJK_DATA_DIR;
  process.env.TJK_DATA_DIR = dataDir;
  try { return fn(); }
  finally {
    if (previous === undefined) delete process.env.TJK_DATA_DIR;
    else process.env.TJK_DATA_DIR = previous;
  }
}

function command(item, args, extra = {}) {
  const output = capture();
  const code = withDataDir(item.dataDir, () => runEventStore(args, {
    ...dependencies(item, extra),
    io: output.io,
  }));
  return { code, ...output };
}

const root = makeSandbox('event-store-flip');
console.log('event-store-flip.test.mjs');

{
  const item = fixture(root, 'acknowledgement-required');
  const before = snapshot(item.dataDir);
  const flipResult = command(item, ['flip', '--apply', '--data-dir', item.dataDir, '--output-dir', item.outputDir]);
  const flipAfter = snapshot(item.dataDir);
  writeFileSync(join(item.dataDir, 'event-store.json'), '{"writes":"on"}\n', 'utf8');
  const rollbackBefore = snapshot(item.dataDir);
  const rollbackResult = command(item, ['rollback', '--apply']);
  check(flipResult.code === 1 && /Stop the dashboard and every script/.test(flipResult.stderr.join('\n'))
    && JSON.stringify(before) === JSON.stringify(flipAfter),
  'flip apply requires explicit acknowledgement that no other writers are running');
  check(rollbackResult.code === 1 && /cache the switch/.test(rollbackResult.stderr.join('\n'))
    && JSON.stringify(snapshot(item.dataDir)) === JSON.stringify(rollbackBefore),
  'rollback apply requires the same acknowledgement and changes nothing');
}

{
  const item = fixture(root, 'dry');
  const before = snapshot(item.dataDir);
  const result = command(item, ['flip', '--data-dir', item.dataDir, '--output-dir', item.outputDir]);
  check(result.code === 0, 'flip dry run exits zero after successful verification');
  check(!existsSync(join(item.dataDir, 'trajecktory.db'))
    && !existsSync(join(item.dataDir, 'event-store.json'))
    && JSON.stringify(snapshot(item.dataDir)) === JSON.stringify(before),
  'flip dry run creates no database or switch and leaves every input byte unchanged');
}

let applied;
let appliedOriginal;
{
  applied = fixture(root, 'apply');
  appliedOriginal = snapshot(applied.dataDir);
  const result = command(applied, ['flip', '--apply', '--no-other-writers', '--data-dir', applied.dataDir, '--output-dir', applied.outputDir]);
  const switchValue = JSON.parse(readFileSync(join(applied.dataDir, 'event-store.json'), 'utf8'));
  check(result.code === 0
    && existsSync(join(applied.dataDir, 'trajecktory.db'))
    && switchValue.writes === 'on'
    && switchValue.flipped_at === '2030-03-04T05:06:07.000Z'
    && /RESTART REQUIRED/.test(result.stdout.join('\n')),
  'flip apply creates the database and an on switch with a timestamp');
  const after = snapshot(applied.dataDir);
  check(Object.entries(appliedOriginal).every(([file, bytes]) => after[file] === bytes),
    'flip apply leaves every pre-existing input file byte identical');
  const backup = join(applied.backupsDir, 'event-store-flip-2030-03-04-050607');
  check(existsSync(backup) && JSON.stringify(snapshot(backup)) === JSON.stringify(appliedOriginal),
    'backup is a faithful copy of every pre-flip file');
  const baselineStore = openEventStore(join(applied.dataDir, 'trajecktory.db'));
  const absentBaseline = baselineStore.db.prepare(
    'SELECT sha256 FROM legacy_render_state WHERE file = ?',
  ).get('contact-links.json');
  baselineStore.close();
  check(absentBaseline?.sha256 === 'known-absent',
    'flip records an explicit baseline for an absent projected file');
}

{
  const item = fixture(root, 'failed-verification');
  const before = snapshot(item.dataDir);
  const result = command(item, ['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir], {
    verifyImportFn(store, imported, dataDir, outputDir) {
      const result = verifyImport(store, imported, dataDir, outputDir);
      return {
        ...result,
        comparisons: {
          ...result.comparisons,
          tracker: { ...result.comparisons.tracker, match: false },
        },
        ok: false,
      };
    },
  });
  check(result.code === 1
    && !existsSync(join(item.dataDir, 'trajecktory.db'))
    && !existsSync(join(item.dataDir, 'event-store.json')),
  'failed verification exits one and leaves no database or switch');
  check(JSON.stringify(snapshot(item.dataDir)) === JSON.stringify(before),
    'failed verification leaves every input file byte identical');
}

{
  const item = fixture(root, 'write-during-flip');
  const changedPath = join(item.dataDir, 'apply-dates.json');
  const result = command(item, ['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir], {
    verifyImportFn(store, imported, dataDir, outputDir) {
      const verification = verifyImport(store, imported, dataDir, outputDir);
      writeFileSync(changedPath, '{"900001":"2030-03-09"}\n', 'utf8');
      return verification;
    },
  });
  check(result.code === 1
    && /something wrote during the flip/.test(result.stderr.join('\n'))
    && /apply-dates\.json/.test(result.stderr.join('\n'))
    && !existsSync(join(item.dataDir, 'trajecktory.db'))
    && !existsSync(join(item.dataDir, 'event-store.json')),
  'a projected file changed after import aborts the flip and reports the writer race');
}

{
  const item = fixture(root, 'correspondence-created-during-flip');
  const createdFile = join(item.dataDir, 'referral-correspondence', '900099.md');
  const result = command(item, ['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir], {
    verifyImportFn(store, imported, dataDir, outputDir) {
      const verification = verifyImport(store, imported, dataDir, outputDir);
      mkdirSync(join(item.dataDir, 'referral-correspondence'), { recursive: true });
      writeFileSync(createdFile, '# Invented late correspondence\n', 'utf8');
      return verification;
    },
  });
  check(result.code === 1
    && /something wrote during the flip/.test(result.stderr.join('\n'))
    && /referral-correspondence\/900099\.md/.test(result.stderr.join('\n'))
    && existsSync(createdFile)
    && !existsSync(join(item.dataDir, 'trajecktory.db'))
    && !existsSync(join(item.dataDir, 'event-store.json')),
  'a correspondence file created after import aborts the flip and names the file');
}

{
  const before = snapshot(applied.dataDir);
  const result = command(applied, ['flip', '--apply', '--no-other-writers', '--data-dir', applied.dataDir, '--output-dir', applied.outputDir]);
  check(result.code === 1 && /already on/.test(result.stderr.join('\n'))
    && JSON.stringify(snapshot(applied.dataDir)) === JSON.stringify(before),
  'flip apply refuses an on switch and changes nothing');
  const reimport = command(applied, ['flip', '--apply', '--reimport', '--no-other-writers', '--data-dir', applied.dataDir, '--output-dir', applied.outputDir]);
  check(reimport.code === 1 && /already on/.test(reimport.stderr.join('\n'))
    && JSON.stringify(snapshot(applied.dataDir)) === JSON.stringify(before),
  'flip apply reimport refuses an on switch and changes nothing');

  const item = fixture(root, 'existing-db');
  writeFileSync(join(item.dataDir, 'trajecktory.db'), 'invented existing database', 'utf8');
  const existingBefore = snapshot(item.dataDir);
  const existing = command(item, ['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir]);
  check(existing.code === 1
    && /earlier flip/.test(existing.stderr.join('\n'))
    && /stale because writes made while the switch was off never reached it/.test(existing.stderr.join('\n'))
    && /pass --reimport/.test(existing.stderr.join('\n'))
    && JSON.stringify(snapshot(item.dataDir)) === JSON.stringify(existingBefore),
  'flip apply refuses an existing database with the stale database remedy and changes nothing');
}

let flippedAt;
{
  flippedAt = JSON.parse(readFileSync(join(applied.dataDir, 'event-store.json'), 'utf8')).flipped_at;
  const dryBefore = snapshot(applied.dataDir);
  const dry = command(applied, ['rollback']);
  check(dry.code === 0 && JSON.stringify(snapshot(applied.dataDir)) === JSON.stringify(dryBefore),
    'rollback dry run changes nothing');
  const filesBefore = snapshot(applied.dataDir);
  const databaseBefore = filesBefore['trajecktory.db'];
  const result = command(applied, ['rollback', '--apply', '--no-other-writers']);
  const switchValue = JSON.parse(readFileSync(join(applied.dataDir, 'event-store.json'), 'utf8'));
  const after = snapshot(applied.dataDir);
  check(result.code === 0 && switchValue.writes === 'off' && switchValue.flipped_at === flippedAt
    && after['trajecktory.db'] === databaseBefore
    && /flip --apply --reimport/.test(result.stdout.join('\n'))
    && /RESTART REQUIRED/.test(result.stdout.join('\n')),
  'rollback apply sets writes off, preserves flipped_at and leaves the database in place');
  check(Object.entries(filesBefore).every(([file, bytes]) => file === 'event-store.json' || after[file] === bytes),
    'rollback apply leaves every non-switch file byte identical');
  const switchBefore = readFileSync(join(applied.dataDir, 'event-store.json'));
  const again = command(applied, ['rollback', '--apply', '--no-other-writers']);
  check(again.code === 0
    && Buffer.compare(readFileSync(join(applied.dataDir, 'event-store.json')), switchBefore) === 0,
  'rollback when already off exits zero and writes nothing');

  const refusedBefore = snapshot(applied.dataDir);
  const refused = command(applied, ['flip', '--apply', '--no-other-writers', '--data-dir', applied.dataDir, '--output-dir', applied.outputDir]);
  check(refused.code === 1
    && /earlier flip/.test(refused.stderr.join('\n'))
    && /stale because writes made while the switch was off never reached it/.test(refused.stderr.join('\n'))
    && /pass --reimport/.test(refused.stderr.join('\n'))
    && JSON.stringify(snapshot(applied.dataDir)) === JSON.stringify(refusedBefore),
  'plain flip apply after rollback explains the stale database remedy and changes nothing');
}

{
  const item = fixture(root, 'reimport-success');
  const first = command(item, ['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir], {
    now: () => new Date('2030-03-04T05:06:20.000Z'),
  });
  const rolled = command(item, ['rollback', '--apply', '--no-other-writers']);
  addTrackerRow(item.dataDir, 900002);
  const filesBefore = dataFileSnapshot(item.dataDir);
  const folderBefore = snapshot(item.dataDir);
  const result = command(item, ['flip', '--apply', '--reimport', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir], {
    now: () => new Date('2030-03-04T05:06:21.000Z'),
  });
  const switchValue = JSON.parse(readFileSync(join(item.dataDir, 'event-store.json'), 'utf8'));
  check(first.code === 0 && rolled.code === 0 && result.code === 0
    && switchValue.writes === 'on',
  'flip apply reimport after rollback succeeds and turns the switch on');
  check(JSON.stringify(dataFileSnapshot(item.dataDir)) === JSON.stringify(filesBefore),
    'successful reimport leaves every data file byte identical');
  const backup = join(item.backupsDir, 'event-store-flip-2030-03-04-050621');
  check(existsSync(join(backup, 'trajecktory.db'))
    && JSON.stringify(snapshot(backup)) === JSON.stringify(folderBefore),
  'reimport backup is taken before the stale database is deleted');
  check(hasApplicationEvent(item.dataDir, 900002),
    'reimport includes a tracker change made while the switch was off in the event log');
}

{
  const item = fixture(root, 'reimport-failed-verification');
  command(item, ['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir], {
    now: () => new Date('2030-03-04T05:06:22.000Z'),
  });
  command(item, ['rollback', '--apply', '--no-other-writers']);
  addTrackerRow(item.dataDir, 900003);
  const folderBefore = snapshot(item.dataDir);
  const result = command(item, ['flip', '--apply', '--reimport', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir], {
    now: () => new Date('2030-03-04T05:06:23.000Z'),
    verifyImportFn(store, imported, dataDir, outputDir) {
      const verification = verifyImport(store, imported, dataDir, outputDir);
      return { ...verification, ok: false };
    },
  });
  const switchValue = JSON.parse(readFileSync(join(item.dataDir, 'event-store.json'), 'utf8'));
  check(result.code === 1
    && existsSync(join(item.dataDir, 'trajecktory.db'))
    && switchValue.writes === 'off',
  'failed reimport verification restores the stale database and leaves the switch off');
  check(JSON.stringify(snapshot(item.dataDir)) === JSON.stringify(folderBefore),
    'failed reimport verification leaves the data folder exactly as it was');
}

for (const [name, failure] of [
  ['counting', { countEvents: () => { throw new Error('invented count failure'); } }],
  ['baselines', { recordVerifiedBaselinesFn: () => { throw new Error('invented baseline failure'); } }],
]) {
  const item = fixture(root, `reimport-failed-${name}`);
  command(item, ['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir], {
    now: () => new Date(`2030-03-04T05:07:0${name === 'counting' ? '1' : '2'}.000Z`),
  });
  command(item, ['rollback', '--apply', '--no-other-writers']);
  const before = snapshot(item.dataDir);
  const result = command(item, ['flip', '--apply', '--reimport', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir], {
    now: () => new Date(`2030-03-04T05:07:1${name === 'counting' ? '1' : '2'}.000Z`),
    ...failure,
  });
  check(result.code === 1 && JSON.stringify(snapshot(item.dataDir)) === JSON.stringify(before),
    `a ${name} failure restores the stale database and every prior folder byte`);
}

{
  const item = fixture(root, 'reimport-dry');
  command(item, ['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir], {
    now: () => new Date('2030-03-04T05:06:24.000Z'),
  });
  command(item, ['rollback', '--apply', '--no-other-writers']);
  addTrackerRow(item.dataDir, 900004);
  const before = snapshot(item.dataDir);
  const backupPath = join(item.backupsDir, 'event-store-flip-2030-03-04-050625');
  const result = command(item, ['flip', '--reimport', '--data-dir', item.dataDir, '--output-dir', item.outputDir], {
    now: () => new Date('2030-03-04T05:06:25.000Z'),
  });
  check(result.code === 0
    && /flip --apply --reimport/.test(result.stdout.join('\n'))
    && JSON.stringify(snapshot(item.dataDir)) === JSON.stringify(before)
    && existsSync(join(item.dataDir, 'trajecktory.db'))
    && !existsSync(backupPath),
  'dry reimport verifies in temporary storage and changes nothing');
}

{
  const item = fixture(root, 'reimport-first-flip');
  const filesBefore = dataFileSnapshot(item.dataDir);
  const result = command(item, ['flip', '--apply', '--reimport', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir], {
    now: () => new Date('2030-03-04T05:06:26.000Z'),
  });
  check(result.code === 0
    && existsSync(join(item.dataDir, 'trajecktory.db'))
    && JSON.parse(readFileSync(join(item.dataDir, 'event-store.json'), 'utf8')).writes === 'on'
    && JSON.stringify(dataFileSnapshot(item.dataDir)) === JSON.stringify(filesBefore),
  'reimport without an existing database follows the normal first flip path');
}

{
  const item = fixture(root, 'live-lock');
  writeFileSync(join(item.dataDir, '.event-store-operation.lock'), JSON.stringify({
    pid: process.pid,
    started_at: '2030-03-04T05:06:27.000Z',
  }), 'utf8');
  const before = snapshot(item.dataDir);
  const result = command(item, ['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir]);
  check(result.code === 1 && /operation is running/.test(result.stderr.join('\n'))
    && JSON.stringify(snapshot(item.dataDir)) === JSON.stringify(before),
  'a concurrent operation lock refuses a second flip and changes nothing');
}

{
  const item = fixture(root, 'stale-lock');
  writeFileSync(join(item.dataDir, '.event-store-operation.lock'), JSON.stringify({
    pid: 99999999,
    started_at: '2020-03-04T05:06:28.000Z',
  }), 'utf8');
  const result = command(item, ['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir], {
    isProcessAlive: () => false,
    now: () => new Date('2030-03-04T05:06:28.000Z'),
  });
  check(result.code === 0 && /Removing stale/.test(result.stdout.join('\n'))
    && !existsSync(join(item.dataDir, '.event-store-operation.lock')),
  'a lock owned by a clearly dead process is broken and removed after the flip');
}

{
  const item = fixture(root, 'backup-collision');
  const backup = join(item.backupsDir, 'event-store-flip-2030-03-04-050607');
  mkdirSync(backup, { recursive: true });
  writeFileSync(join(backup, 'older-backup.txt'), 'preserve me\n', 'utf8');
  const before = snapshot(item.dataDir);
  const result = command(item, ['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir]);
  check(result.code === 1
    && readFileSync(join(backup, 'older-backup.txt'), 'utf8') === 'preserve me\n'
    && JSON.stringify(snapshot(item.dataDir)) === JSON.stringify(before),
  'a backup name collision preserves the older backup and changes no data file');
}

{
  const attempts = [];
  const failures = removeDatabase('invented.db', file => {
    attempts.push(file);
    if (!file.endsWith('-shm')) throw new Error(`cannot remove ${file}`);
  });
  check(attempts.join(',') === 'invented.db,invented.db-shm,invented.db-wal'
    && failures.length === 2,
  'database cleanup attempts the main file and both sidecars while collecting every failure');
}

{
  const before = fixture(root, 'status-before');
  const initial = command(before, ['status']);
  check(initial.code === 0 && /Switch: missing/.test(initial.stdout.join('\n'))
    && /Database: missing/.test(initial.stdout.join('\n'))
    && /Verdict: ready to flip/.test(initial.stdout.join('\n')),
  'status reports the pre-flip switch, database and readiness');

  const dangerous = fixture(root, 'status-dangerous');
  writeFileSync(join(dangerous.dataDir, 'event-store.json'), '{"writes":"on"}\n', 'utf8');
  const dangerStatus = command(dangerous, ['status']);
  check(/DANGEROUS/.test(dangerStatus.stdout.join('\n'))
    && /rollback --apply --no-other-writers/.test(dangerStatus.stdout.join('\n')),
  'status reports an on switch with no database as dangerous and names the rollback remedy');

  const item = fixture(root, 'status-after');
  command(item, ['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir]);
  const after = command(item, ['status']);
  check(after.code === 0 && /Switch: on/.test(after.stdout.join('\n'))
    && /Database: present/.test(after.stdout.join('\n'))
    && /Render applications\.md: true/.test(after.stdout.join('\n'))
    && /Verdict: already on/.test(after.stdout.join('\n')),
  'status reports the on switch, database and matching render baseline');
  writeFileSync(join(item.dataDir, 'applications.md'), `${readFileSync(join(item.dataDir, 'applications.md'), 'utf8')}Invented outside edit\n`, 'utf8');
  const edited = command(item, ['status']);
  check(/Render applications\.md: false/.test(edited.stdout.join('\n'))
    && /Verdict: DANGEROUS/.test(edited.stdout.join('\n'))
    && /applications\.md \(mismatch\)/.test(edited.stdout.join('\n'))
    && /rollback --apply --no-other-writers/.test(edited.stdout.join('\n'))
    && !/Verdict: already on/.test(edited.stdout.join('\n')),
  'status gives a dangerous verdict and a remedy for an on switch with a mismatched file');

  command(item, ['rollback', '--apply', '--no-other-writers']);
  const stale = command(item, ['status']);
  check(stale.code === 0
    && /Database state: stale because writes made while the switch is off do not reach it/.test(stale.stdout.join('\n'))
    && /flip --apply --reimport/.test(stale.stdout.join('\n'))
    && !/Verdict: DANGEROUS/.test(stale.stdout.join('\n')),
  'status identifies an off-switch database as stale and names the reimport command');
}

{
  const item = fixture(root, 'status-missing-marker');
  command(item, ['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir]);
  const store = openEventStore(join(item.dataDir, 'trajecktory.db'));
  store.db.prepare('DELETE FROM legacy_render_state WHERE file = ?').run('applications.md');
  store.close();
  const result = command(item, ['status']);
  check(/Render applications\.md: no marker yet/.test(result.stdout.join('\n'))
    && /Verdict: DANGEROUS/.test(result.stdout.join('\n'))
    && /applications\.md \(no marker\)/.test(result.stdout.join('\n'))
    && /flip --apply --reimport --no-other-writers/.test(result.stdout.join('\n'))
    && !/Verdict: already on/.test(result.stdout.join('\n')),
  'status gives a dangerous verdict and a remedy for an on switch with no render marker');
}

{
  const item = fixture(root, 'round-trip');
  const originals = dataFileSnapshot(item.dataDir);
  let tick = 0;
  const timed = {
    now: () => new Date(`2030-03-04T05:06:${String(10 + tick++).padStart(2, '0')}.000Z`),
  };
  const first = command(item, ['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir], timed);
  const rolled = command(item, ['rollback', '--apply', '--no-other-writers'], timed);
  addTrackerRow(item.dataDir, 900005, 'Nebula Fabrication');
  const edited = dataFileSnapshot(item.dataDir);
  const second = command(item, ['flip', '--apply', '--reimport', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir], timed);
  const final = dataFileSnapshot(item.dataDir);
  check(first.code === 0 && rolled.code === 0 && second.code === 0
    && JSON.stringify(final) === JSON.stringify(edited)
    && originals['applications.md'] !== final['applications.md']
    && hasApplicationEvent(item.dataDir, 900005),
  'flip, rollback, file edit and reimport preserve current file bytes and make the log current');
}

{
  const item = fixture(root, 'dry-run-compatibility');
  const script = resolve(fileURLToPath(new URL('../scripts/import-dry-run.mjs', import.meta.url)));
  const result = spawnSync(process.execPath, [
    script,
    '--data-dir', item.dataDir,
    '--output-dir', item.outputDir,
    '--db', join(item.base, 'dry-run.db'),
    '--report', join(item.base, 'dry-run-report.json'),
    '--owner-name', 'Example Personone',
    '--definitions-version', 'v1',
  ], { encoding: 'utf8' });
  const expected = [
    'TRACKER MATCH',
    'APPLY DATES MATCH',
    'STATUS HISTORY MATCH',
    'PEOPLE MATCH',
    'FOLLOWUPS MATCH',
    'CORRESPONDENCE MATCH',
    'LINKEDIN MATCH',
    'TWC MATCH',
    'BYTES MATCH applications.md',
    'BYTES MATCH status-events.tsv',
    'BYTES MATCH target-talent.md',
    'BYTES MATCH referrals.md',
    'BYTES MATCH follow-ups.md',
    'BYTES MATCH target-talent-correspondence (1 files)',
    'BYTES MATCH referral-correspondence (0 files)',
    'BYTES MATCH apply-dates.json',
    'BYTES MATCH linkedin-connects.json (absent)',
    'BYTES MATCH tt-linkedin.json (absent)',
    'BYTES MATCH linkedin-connections.json (absent)',
    'BYTES MATCH twc-events.json (absent)',
    'BYTES MATCH twc-overrides.json (absent)',
    'BYTES MATCH contact-links.json (absent)',
  ];
  const lines = result.stdout.trimEnd().split(/\r?\n/);
  const firstExpected = lines.indexOf('TRACKER MATCH');
  check(result.status === 0 && firstExpected >= 0
    && JSON.stringify(lines.slice(firstExpected)) === JSON.stringify(expected),
  'import dry run keeps the exact comparison lines and zero exit code');

  const bad = spawnSync(process.execPath, [script, '--unknown', 'fixture'], { encoding: 'utf8' });
  check(bad.status === 2
    && bad.stdout === ''
    && bad.stderr.replace(/\r\n/g, '\n') === 'usage: --data-dir, --output-dir, --db and --report are required\n',
    'import dry run keeps its malformed-argument output and exit code');

  const invalid = fixture(root, 'dry-run-invalid-json');
  writeFileSync(join(invalid.dataDir, 'apply-dates.json'), '{not json', 'utf8');
  const invalidResult = spawnSync(process.execPath, [
    script,
    '--data-dir', invalid.dataDir,
    '--output-dir', invalid.outputDir,
    '--db', join(invalid.base, 'dry-run.db'),
    '--report', join(invalid.base, 'dry-run-report.json'),
    '--owner-name', 'Example Personone',
  ], { encoding: 'utf8' });
  check(invalidResult.status === 1 && invalidResult.stdout === '' && /SyntaxError/.test(invalidResult.stderr),
    'import dry run keeps its import-error output shape and exit code one');
}

{
  const item = fixture(root, 'bad-arguments');
  const badFlip = command(item, ['flip', '--unknown']);
  const badStatus = command(item, ['status', '--apply']);
  const badRollback = command(item, ['rollback', '--data-dir', item.dataDir]);
  check([badFlip, badStatus, badRollback].every(result => result.code === 2),
    'unknown and malformed command arguments exit two');
}

{
  const store = openEventStore(join(root, 'sanity.db'));
  check(store.db.prepare('SELECT COUNT(*) AS count FROM events').get().count === 0,
    'test sandbox event store sanity check succeeds');
  store.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
