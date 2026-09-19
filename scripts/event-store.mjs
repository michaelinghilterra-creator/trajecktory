#!/usr/bin/env node

import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
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
import { findOtherWriters } from '../lib/event-store-writers.mjs';
import { importDataFolder } from '../lib/import/import-data-folder.mjs';
import { findNonUtf8Files } from '../lib/import/utf8-guard.mjs';
import {
  changedImportedFiles,
  printImportVerification,
  verifyImport,
} from '../lib/import/verify-import.mjs';
import {
  ABSENT_FILE_SHA256,
  fileMatchesLastRender,
  listLegacyFiles,
} from '../lib/legacy-files.mjs';
import { writeFileAtomic } from '../lib/atomic-write.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_FILE = '.event-store-operation.lock';

function timestampForPath(date) {
  const part = value => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${part(date.getUTCMonth() + 1)}-${part(date.getUTCDate())}-${part(date.getUTCHours())}${part(date.getUTCMinutes())}${part(date.getUTCSeconds())}`;
}

function localDate(date) {
  const part = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
}

export function removeDatabase(path, removeFile = rmSync) {
  const failures = [];
  for (const suffix of ['', '-shm', '-wal']) {
    const file = `${path}${suffix}`;
    try {
      removeFile(file, { force: true });
    } catch (error) {
      failures.push({ file, error });
    }
  }
  return failures;
}

function recordVerifiedBaselines(store, _dataDir, imported) {
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
    const text = imported.texts[file] ?? null;
    const sha256 = text !== null
      ? createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
      : ABSENT_FILE_SHA256;
    statement.run(file, latest, sha256, renderedAt);
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readLockFile(lockPath) {
  try {
    return JSON.parse(readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

// Removes the lock only when it is still the one this process created. A lock that was replaced by
// another process is left alone and reported.
function releaseOperationLock(lockPath, token, io) {
  if (!existsSync(lockPath)) return;
  const lock = readLockFile(lockPath);
  if (lock?.token !== token) {
    io.error(`Operation lock ${lockPath} is no longer ours and was left in place.`);
    return;
  }
  try {
    rmSync(lockPath, { force: true });
  } catch (error) {
    io.error(`Could not remove operation lock ${lockPath}: ${error.message}`);
  }
}

function acquireOperationLock(dataDir, io, now, isProcessAlive, hooks = {}) {
  const lockPath = join(dataDir, LOCK_FILE);
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    let descriptor;
    try {
      descriptor = openSync(lockPath, 'wx');
      writeFileSync(descriptor, `${JSON.stringify({
        pid: process.pid,
        started_at: now().toISOString(),
        token,
      }, null, 2)}\n`, 'utf8');
      closeSync(descriptor);
      return () => releaseOperationLock(lockPath, token, io);
    } catch (error) {
      if (descriptor !== undefined) {
        try { closeSync(descriptor); } catch { /* already closed */ }
      }
      if (error.code !== 'EEXIST') {
        try { rmSync(lockPath, { force: true }); } catch { /* reported below */ }
        throw error;
      }
      let lock;
      try {
        lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      } catch (parseError) {
        throw new Error(`Another event store operation may be running. Lock file: ${lockPath}`, {
          cause: parseError,
        });
      }
      if (isProcessAlive(lock.pid)) {
        throw new Error(`Another event store operation is running with pid ${lock.pid}. Lock file: ${lockPath}`, {
          cause: error,
        });
      }
      io.log(`Removing stale event store operation lock for dead pid ${lock.pid}.`);
      hooks.beforeStaleRemoval?.(lockPath);
      // Claim the stale file by renaming it, then check that what was claimed is what was judged
      // stale. Deleting by path would remove a live lock that another process wrote in between.
      const claimed = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
      try {
        renameSync(lockPath, claimed);
      } catch (renameError) {
        if (renameError.code === 'ENOENT') continue;
        throw renameError;
      }
      const claimedLock = readLockFile(claimed);
      if (claimedLock && claimedLock.pid === lock.pid && claimedLock.started_at === lock.started_at) {
        rmSync(claimed, { force: true });
        continue;
      }
      if (!existsSync(lockPath)) {
        try { renameSync(claimed, lockPath); } catch { /* the copy stays beside the lock path */ }
      }
      throw new Error(`Another event store operation is running. The lock changed while it was being cleaned up: ${lockPath}`, { cause: error });
    }
  }
  throw new Error(`Could not acquire event store operation lock: ${lockPath}`);
}

function createBackup(dataDir, backupsDir, backupPath) {
  mkdirSync(backupsDir, { recursive: true });
  mkdirSync(backupPath);
  try {
    for (const entry of readdirSync(dataDir)) {
      if (entry === LOCK_FILE || entry.startsWith(`${LOCK_FILE}.stale-`)) continue;
      cpSync(join(dataDir, entry), join(backupPath, entry), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
  } catch (error) {
    try { rmSync(backupPath, { recursive: true, force: true }); } catch { /* caller reports copy failure */ }
    throw error;
  }
}

function describeRemovalFailures(io, heading, failures) {
  if (!failures.length) return;
  io.error(`${heading}: ${failures.map(item => `${item.file}: ${item.error.message}`).join('; ')}`);
}

function restoreDatabase(dbPath, backupPath, io) {
  const failures = removeDatabase(dbPath);
  for (const suffix of ['', '-shm', '-wal']) {
    const source = join(backupPath, `${DATABASE_FILE}${suffix}`);
    if (!existsSync(source)) continue;
    try {
      cpSync(source, `${dbPath}${suffix}`, { force: true });
    } catch (error) {
      failures.push({ file: `${dbPath}${suffix}`, error });
    }
  }
  if (!failures.length) return true;
  io.error(`DATABASE RESTORE FAILED. Restore manually from backup: ${backupPath}`);
  describeRemovalFailures(io, 'Restore errors', failures);
  return false;
}

function parseOptions(argv, allowed) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!allowed.has(key) || Object.hasOwn(options, key)) return null;
    if (key === '--apply' || key === '--reimport' || key === '--no-other-writers' || key === '--json') {
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
    if (state.writes === 'on') {
      io.log('Verdict: DANGEROUS, writes are on but the database is missing. Stop the dashboard and every script, then run rollback --apply --no-other-writers before repairing or flipping again.');
    } else {
      io.log(state.state === 'invalid'
        ? 'Verdict: not ready, the switch file is invalid'
        : 'Verdict: ready to flip');
    }
    return 0;
  }

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const summary = db.prepare('SELECT COUNT(*) AS count, MAX(id) AS latest FROM events').get();
    io.log(`Database: present (${dbPath})`);
    io.log(`Events: ${summary.count}; latest event id: ${summary.latest ?? 'none'}`);
    const store = { db };
    const renderIssues = [];
    for (const file of listLegacyFiles(store)) {
      const match = fileMatchesLastRender(store, dataDir, file);
      io.log(`Render ${file}: ${match === null ? 'no marker yet' : match}`);
      if (match !== true) renderIssues.push(`${file} (${match === null ? 'no marker' : 'mismatch'})`);
    }
    if (state.writes === 'on') {
      io.log(renderIssues.length
        ? `Verdict: DANGEROUS, writes are on but projected files are not healthy: ${renderIssues.join(', ')}. Stop the dashboard and every script. Resolve the reported files, or run rollback --apply --no-other-writers and then flip --apply --reimport --no-other-writers if the current files are authoritative.`
        : 'Verdict: already on');
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

function flipUnlocked(options, context) {
  const {
    io,
    now,
    backupsDir,
    verifyImportFn,
    getOwnerName,
    countEvents,
    recordVerifiedBaselinesFn,
    writeSwitch,
  } = context;
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

  const badFiles = findNonUtf8Files(dataDir);
  if (badFiles.length > 0) {
    io.error(`Refusing to flip: these files are not valid UTF-8 and would not survive the round trip: ${badFiles.join(', ')}. Nothing was changed.`);
    return 1;
  }

  const apply = options['--apply'] === true;
  const startedAt = now();
  let backupPath = null;
  let backupCreated = false;
  let staleDatabaseRemoved = false;
  let operationSucceeded = false;
  let temporaryDir;
  let store;
  if (apply) {
    backupPath = join(backupsDir, `event-store-flip-${timestampForPath(startedAt)}`);
    try {
      createBackup(dataDir, backupsDir, backupPath);
      backupCreated = true;
    } catch (error) {
      io.error(`Backup failed. Nothing was changed. ${error.message}`);
      return 1;
    }
    io.log(`Backup: ${backupPath}`);
    if (databaseExists) {
      staleDatabaseRemoved = true;
      const failures = removeDatabase(dbPath);
      if (failures.length) {
        describeRemovalFailures(io, 'Could not remove the stale database', failures);
        restoreDatabase(dbPath, backupPath, io);
        return 1;
      }
    }
  }

  temporaryDir = apply ? null : mkdtempSync(join(tmpdir(), 'tjk-event-store-flip-'));
  const importDbPath = apply ? dbPath : join(temporaryDir, DATABASE_FILE);
  try {
    store = openEventStore(importDbPath);
    const imported = importDataFolder(store, {
      dataDir,
      outputDir,
      ownerName: getOwnerName(),
      definitionsVersion: 'v1',
      importedOn: localDate(startedAt),
    });
    const verification = verifyImportFn(store, imported, dataDir, outputDir);
    printImportVerification(verification, io.log);
    const count = countEvents(store);
    if (!verification.ok) {
      io.error('Verification failed. The new database was removed and the switch remains off.');
      if (backupPath) io.error(`Backup retained at ${backupPath}`);
      return 1;
    }
    if (!apply) {
      operationSucceeded = true;
      io.log(`Dry run passed with ${count} events. No backup, database or switch file was created.`);
      io.log(databaseExists
        ? 'Plan: run flip --apply --reimport --no-other-writers to back up the data folder, discard the stale database, import from the current files, verify and enable event-store writes.'
        : 'Plan: run flip --apply --no-other-writers to back up the data folder, import, verify and enable event-store writes.');
      return 0;
    }

    const changed = changedImportedFiles(store, imported, dataDir);
    if (changed.length) {
      io.error(`Verification failed because something wrote during the flip. Changed files: ${changed.join(', ')}`);
      io.error('The new database was removed and the switch remains off.');
      io.error(`Backup retained at ${backupPath}`);
      return 1;
    }
    recordVerifiedBaselinesFn(store, dataDir, imported);
    writeSwitch(join(dataDir, SWITCH_FILE), `${JSON.stringify({
      writes: 'on',
      flipped_at: startedAt.toISOString(),
    }, null, 2)}\n`, 'utf8');
    // A file written between the last check and the switch write would otherwise go unnoticed and the
    // log would vouch for stale content. Check once more now that the switch is on.
    const late = changedImportedFiles(store, imported, dataDir);
    if (late.length) {
      let offFailure = '';
      try {
        writeSwitch(join(dataDir, SWITCH_FILE), `${JSON.stringify({ writes: 'off', flipped_at: null }, null, 2)}\n`, 'utf8');
      } catch (error) {
        offFailure = ` The switch could NOT be turned back off: ${error.message}. Run rollback --apply --no-other-writers.`;
      }
      io.error(`Verification failed because something wrote during the flip, after the switch was turned on, so the switch was turned back off. Changed files: ${late.join(', ')}.${offFailure}`);
      io.error(`Backup retained at ${backupPath}`);
      return 1;
    }
    operationSucceeded = true;
    io.log(`Flip complete: ${count} events imported.`);
    io.log(`Backup: ${backupPath}`);
    io.log('To roll back, run: node scripts/event-store.mjs rollback --apply --no-other-writers');
    io.log('RESTART REQUIRED: restart the dashboard and every script because running processes cache the switch.');
    return 0;
  } catch (error) {
    io.error(`Flip failed: ${error.message}`);
    if (backupPath) io.error(`Backup retained at ${backupPath}`);
    return 1;
  } finally {
    try { store?.close(); } catch (error) { io.error(`Closing the imported database failed: ${error.message}`); }
    if (temporaryDir) rmSync(temporaryDir, { recursive: true, force: true });
    if (apply && !operationSucceeded) {
      const failures = removeDatabase(dbPath);
      describeRemovalFailures(io, 'New database cleanup errors', failures);
      if (staleDatabaseRemoved && backupCreated) restoreDatabase(dbPath, backupPath, io);
    }
  }
}

// The dry run as one JSON document, for the Data storage screen. It runs the same dry run and reads the
// check lines it prints, so the two can never disagree. Nothing is written to the data folder.
function previewFlip(options, context) {
  const stdout = [];
  const stderr = [];
  const captured = {
    ...context,
    io: { log: value => stdout.push(String(value)), error: value => stderr.push(String(value)) },
  };
  const code = flipUnlocked(options, captured);
  const names = { LINKEDIN: 'LinkedIn', TWC: 'TWC' };
  const sentence = label => names[label] ?? `${label.charAt(0)}${label.slice(1).toLowerCase()}`;
  const events = stdout.map(line => /Dry run passed with (\d+) events/.exec(line)).find(Boolean);
  const document = {
    command: 'flip',
    dry_run: true,
    ok: code === 0,
    exit_code: code,
    events: events ? Number(events[1]) : null,
    checks: stdout.flatMap(line => {
      const match = /^([A-Z ]+) (MATCH|MISMATCH)$/.exec(line);
      return match ? [{ name: sentence(match[1]), match: match[2] === 'MATCH' }] : [];
    }),
    byte_checks: stdout.flatMap(line => {
      const match = /^BYTES (MATCH|DIFFER) (\S+)/.exec(line);
      return match ? [{ file: match[2], match: match[1] === 'MATCH' }] : [];
    }),
    messages: stdout,
    errors: stderr,
    will_add: ['trajecktory.db', 'event-store.json', 'a backup copy of the data folder'],
    will_not_change: ['Your data files are not rewritten by the flip. They are read, checked, and left exactly as they are.'],
  };
  context.io.log(JSON.stringify(document, null, 2));
  return code;
}

function flip(options, context) {
  const { io, now, isProcessAlive, hooks } = context;
  const apply = options['--apply'] === true;
  if (options['--json'] === true) {
    if (apply) {
      io.error('--json works with the dry run only. Run flip --json without --apply.');
      return 2;
    }
    return previewFlip(options, context);
  }
  if (apply && options['--no-other-writers'] !== true) {
    io.error('IMPORTANT: Refusing to flip without --no-other-writers. Stop the dashboard and every script first. Restart all of them afterwards because running processes cache the switch.');
    return 1;
  }
  if (!apply) return flipUnlocked(options, context);
  const writers = context.findOtherWriters();
  if (writers.length) {
    io.error(`Refusing to flip: --no-other-writers was given but ${writers.join('; ')}. Stop the dashboard and try again. This check sees dashboard ports only; scripts started from a terminal are not detected, so confirm none are running.`);
    return 1;
  }
  const dataDir = resolve(options['--data-dir'] ?? process.env.TJK_DATA_DIR ?? join(root, 'data'));
  let release;
  try {
    release = acquireOperationLock(dataDir, io, now, isProcessAlive, hooks);
    return flipUnlocked(options, context);
  } catch (error) {
    io.error(`Refusing event store operation: ${error.message}`);
    return 1;
  } finally {
    release?.();
  }
}

function rollbackUnlocked(options, context) {
  const { io, writeSwitch } = context;
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
  writeSwitch(join(dataDir, SWITCH_FILE), `${JSON.stringify({
    writes: 'off',
    flipped_at: state.flipped_at,
  }, null, 2)}\n`, 'utf8');
  io.log('Rollback complete. Writes are off. The database and every data file stayed in place.');
  io.log('To flip forward again, run: node scripts/event-store.mjs flip --apply --reimport --no-other-writers');
  io.log('RESTART REQUIRED: restart the dashboard and every script because running processes cache the switch.');
  return 0;
}

function rollback(options, context) {
  const { io, now, isProcessAlive, hooks } = context;
  if (options['--apply'] && options['--no-other-writers'] !== true) {
    io.error('IMPORTANT: Refusing to roll back without --no-other-writers. Stop the dashboard and every script first. Restart all of them afterwards because running processes cache the switch.');
    return 1;
  }
  if (!options['--apply']) return rollbackUnlocked(options, context);
  const writers = context.findOtherWriters();
  if (writers.length) {
    io.error(`Refusing to roll back: --no-other-writers was given but ${writers.join('; ')}. Stop the dashboard and try again. This check sees dashboard ports only; scripts started from a terminal are not detected, so confirm none are running.`);
    return 1;
  }
  const dataDir = resolve(process.env.TJK_DATA_DIR ?? join(root, 'data'));
  let release;
  try {
    release = acquireOperationLock(dataDir, io, now, isProcessAlive, hooks);
    return rollbackUnlocked(options, context);
  } catch (error) {
    io.error(`Refusing event store operation: ${error.message}`);
    return 1;
  } finally {
    release?.();
  }
}

export function runEventStore(argv, dependencies = {}) {
  const io = dependencies.io ?? defaultIo();
  const context = {
    io,
    now: dependencies.now ?? (() => new Date()),
    backupsDir: dependencies.backupsDir ?? join(root, 'backups'),
    verifyImportFn: dependencies.verifyImportFn ?? verifyImport,
    getOwnerName: dependencies.getOwnerName ?? (() => getIdentity().fullName),
    countEvents: dependencies.countEvents ?? (store => store.db.prepare('SELECT COUNT(*) AS count FROM events').get().count),
    recordVerifiedBaselinesFn: dependencies.recordVerifiedBaselinesFn ?? recordVerifiedBaselines,
    writeSwitch: dependencies.writeSwitch ?? writeFileAtomic,
    isProcessAlive: dependencies.isProcessAlive ?? processIsAlive,
    hooks: dependencies.hooks ?? {},
    findOtherWriters: dependencies.findOtherWriters ?? (() => findOtherWriters()),
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
    const options = parseOptions(rest, new Set(['--apply', '--reimport', '--no-other-writers', '--json', '--data-dir', '--output-dir']));
    if (!options) {
      io.error('usage: event-store.mjs flip [--apply] [--reimport] [--no-other-writers] [--json] [--data-dir <dir>] [--output-dir <dir>]');
      return 2;
    }
    return flip(options, context);
  }
  if (command === 'rollback') {
    const options = parseOptions(rest, new Set(['--apply', '--no-other-writers']));
    if (!options) {
      io.error('usage: event-store.mjs rollback [--apply] [--no-other-writers]');
      return 2;
    }
    return rollback(options, context);
  }
  io.error('usage: event-store.mjs status | flip [--apply] [--reimport] [--no-other-writers] [--json] | rollback [--apply] [--no-other-writers]');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runEventStore(process.argv.slice(2));
}
