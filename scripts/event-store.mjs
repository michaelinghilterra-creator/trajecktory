#!/usr/bin/env node

import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIdentity } from '../dashboard-web/server/lib/profile.mjs';
import { openEventStore } from '../lib/event-store.mjs';
import {
  DATABASE_FILE,
  SWITCH_FILE,
  readEventStoreSwitch,
} from '../lib/event-store-switch.mjs';
import { importDataFolder } from '../lib/import/import-data-folder.mjs';
import { printImportVerification, verifyImport } from '../lib/import/verify-import.mjs';
import { fileMatchesLastRender, listLegacyFiles } from '../lib/legacy-files.mjs';
import { writeFileAtomic } from '../lib/atomic-write.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function timestampForPath(date) {
  const part = value => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${part(date.getUTCMonth() + 1)}-${part(date.getUTCDate())}-${part(date.getUTCHours())}${part(date.getUTCMinutes())}${part(date.getUTCSeconds())}`;
}

function localDate(date) {
  const part = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
}

function removeDatabase(path) {
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${path}${suffix}`, { force: true });
}

function recordVerifiedBaselines(store, dataDir) {
  const latest = store.db.prepare('SELECT MAX(id) AS id FROM events').get().id;
  const statement = store.db.prepare(`
    INSERT INTO legacy_render_state (file, dirty, last_event_id, sha256, rendered_at)
    VALUES (?, 0, ?, ?, ?)
    ON CONFLICT(file) DO UPDATE SET
      dirty = 0,
      last_event_id = excluded.last_event_id,
      sha256 = excluded.sha256,
      rendered_at = excluded.rendered_at
  `);
  const renderedAt = new Date().toISOString();
  for (const file of listLegacyFiles(store)) {
    const path = join(dataDir, file);
    if (!existsSync(path)) continue;
    const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    statement.run(file, latest, sha256, renderedAt);
  }
}

function parseOptions(argv, allowed) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!allowed.has(key) || Object.hasOwn(options, key)) return null;
    if (key === '--apply' || key === '--reimport') {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) return null;
    options[key] = value;
    index++;
  }
  return options;
}

function defaultIo() {
  return {
    log: value => console.log(value),
    error: value => console.error(value),
  };
}

function status(dataDir, io) {
  const state = readEventStoreSwitch(dataDir);
  const switchLabel = state.state === 'ok' ? state.writes : state.state;
  io.log(`Switch: ${switchLabel}`);
  if (state.flipped_at) io.log(`Flipped at: ${state.flipped_at}`);

  const dbPath = join(dataDir, DATABASE_FILE);
  if (!existsSync(dbPath)) {
    io.log(`Database: missing (${dbPath})`);
    io.log('Render matches: unavailable until the database exists');
    io.log(state.state === 'invalid'
      ? 'Verdict: not ready, the switch file is invalid'
      : 'Verdict: ready to flip');
    return 0;
  }

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const summary = db.prepare('SELECT COUNT(*) AS count, MAX(id) AS latest FROM events').get();
    io.log(`Database: present (${dbPath})`);
    io.log(`Events: ${summary.count}; latest event id: ${summary.latest ?? 'none'}`);
    const store = { db };
    for (const file of listLegacyFiles(store)) {
      const match = fileMatchesLastRender(store, dataDir, file);
      io.log(`Render ${file}: ${match === null ? 'no marker yet' : match}`);
    }
    if (state.writes === 'on') {
      io.log('Verdict: already on');
    } else {
      io.log('Database state: stale because writes made while the switch is off do not reach it.');
      io.log('Verdict: flip forward by re-importing from the current files with flip --apply --reimport.');
    }
  } catch (error) {
    io.log(`Database: present but unreadable (${error.message})`);
    io.log(state.writes === 'on'
      ? 'Verdict: not ready, the live database must be dealt with deliberately'
      : 'Verdict: the database is stale; flip forward by re-importing from the current files with flip --apply --reimport.');
  } finally {
    db?.close();
  }
  return 0;
}

function flip(options, context) {
  const { io, now, backupsDir, verifyImportFn, getOwnerName } = context;
  const dataDir = resolve(options['--data-dir'] ?? process.env.TJK_DATA_DIR ?? join(root, 'data'));
  const outputDir = resolve(options['--output-dir'] ?? join(root, 'output'));
  const dbPath = join(dataDir, DATABASE_FILE);
  const switchState = readEventStoreSwitch(dataDir);
  const reimport = options['--reimport'] === true;
  if (switchState.writes === 'on') {
    io.error('Refusing to flip: the event store is already on. Run rollback first.');
    return 1;
  }
  const databaseExists = existsSync(dbPath);
  if (databaseExists && !reimport) {
    io.error(`Refusing to flip: ${dbPath} is from an earlier flip and is stale because writes made while the switch was off never reached it. Flipping forward re-imports from the current files; pass --reimport to do that.`);
    return 1;
  }

  const apply = options['--apply'] === true;
  const startedAt = now();
  let backupPath = null;
  if (apply) {
    backupPath = join(backupsDir, `event-store-flip-${timestampForPath(startedAt)}`);
    try {
      mkdirSync(backupsDir, { recursive: true });
      cpSync(dataDir, backupPath, { recursive: true, errorOnExist: true, force: false });
    } catch (error) {
      rmSync(backupPath, { recursive: true, force: true });
      io.error(`Backup failed. Nothing was changed. ${error.message}`);
      return 1;
    }
    io.log(`Backup: ${backupPath}`);
    if (databaseExists) removeDatabase(dbPath);
  }

  const temporaryDir = apply ? null : mkdtempSync(join(tmpdir(), 'tjk-event-store-flip-'));
  const importDbPath = apply ? dbPath : join(temporaryDir, DATABASE_FILE);
  let store;
  let imported;
  let verification;
  let count;
  try {
    store = openEventStore(importDbPath);
    imported = importDataFolder(store, {
      dataDir,
      outputDir,
      ownerName: getOwnerName(),
      definitionsVersion: 'v1',
      importedOn: localDate(startedAt),
    });
    verification = verifyImportFn(store, imported, dataDir, outputDir);
    printImportVerification(verification, io.log);
    count = store.db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
    if (apply && verification.ok) recordVerifiedBaselines(store, dataDir);
  } catch (error) {
    io.error(`Import failed: ${error.message}`);
    return 1;
  } finally {
    store?.close();
    if (temporaryDir) rmSync(temporaryDir, { recursive: true, force: true });
    if (apply && (!verification || !verification.ok)) removeDatabase(dbPath);
  }

  if (!verification.ok) {
    io.error('Verification failed. The new database was removed and the switch remains off.');
    if (backupPath) io.error(`Backup retained at ${backupPath}`);
    return 1;
  }

  if (!apply) {
    io.log(`Dry run passed with ${count} events. No backup, database or switch file was created.`);
    io.log(databaseExists
      ? 'Plan: run flip --apply --reimport to back up the data folder, discard the stale database, import from the current files, verify and enable event-store writes.'
      : 'Plan: run flip --apply to back up the data folder, import, verify and enable event-store writes.');
    return 0;
  }

  const switchPath = join(dataDir, SWITCH_FILE);
  try {
    writeFileAtomic(switchPath, `${JSON.stringify({
      writes: 'on',
      flipped_at: startedAt.toISOString(),
    }, null, 2)}\n`, 'utf8');
  } catch (error) {
    removeDatabase(dbPath);
    io.error(`Writing the switch failed. The new database was removed. ${error.message}`);
    io.error(`Backup retained at ${backupPath}`);
    return 1;
  }
  io.log(`Flip complete: ${count} events imported.`);
  io.log(`Backup: ${backupPath}`);
  io.log('To roll back, run: node scripts/event-store.mjs rollback --apply');
  return 0;
}

function rollback(options, context) {
  const { io } = context;
  const dataDir = resolve(process.env.TJK_DATA_DIR ?? join(root, 'data'));
  const state = readEventStoreSwitch(dataDir);
  if (state.writes === 'off') {
    io.log('The event store is already off. Nothing was changed.');
    return 0;
  }
  if (!options['--apply']) {
    io.log('Dry run: rollback will only set writes to off. The database and every data file will stay in place.');
    io.log('Run rollback --apply to continue.');
    return 0;
  }
  writeFileAtomic(join(dataDir, SWITCH_FILE), `${JSON.stringify({
    writes: 'off',
    flipped_at: state.flipped_at,
  }, null, 2)}\n`, 'utf8');
  io.log('Rollback complete. Writes are off. The database and every data file stayed in place.');
  io.log('To flip forward again, run: node scripts/event-store.mjs flip --apply --reimport');
  return 0;
}

export function runEventStore(argv, dependencies = {}) {
  const io = dependencies.io ?? defaultIo();
  const context = {
    io,
    now: dependencies.now ?? (() => new Date()),
    backupsDir: dependencies.backupsDir ?? join(root, 'backups'),
    verifyImportFn: dependencies.verifyImportFn ?? verifyImport,
    getOwnerName: dependencies.getOwnerName ?? (() => getIdentity().fullName),
  };
  const [command, ...rest] = argv;
  if (command === 'status') {
    if (rest.length) {
      io.error('usage: event-store.mjs status');
      return 2;
    }
    return status(resolve(process.env.TJK_DATA_DIR ?? join(root, 'data')), io);
  }
  if (command === 'flip') {
    const options = parseOptions(rest, new Set(['--apply', '--reimport', '--data-dir', '--output-dir']));
    if (!options) {
      io.error('usage: event-store.mjs flip [--apply] [--reimport] [--data-dir <dir>] [--output-dir <dir>]');
      return 2;
    }
    return flip(options, context);
  }
  if (command === 'rollback') {
    const options = parseOptions(rest, new Set(['--apply']));
    if (!options) {
      io.error('usage: event-store.mjs rollback [--apply]');
      return 2;
    }
    return rollback(options, context);
  }
  io.error('usage: event-store.mjs status | flip [--apply] [--reimport] | rollback [--apply]');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runEventStore(process.argv.slice(2));
}
