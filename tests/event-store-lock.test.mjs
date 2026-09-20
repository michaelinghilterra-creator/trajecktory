#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { verifyImport } from '../lib/import/verify-import.mjs';
import { runEventStore } from '../scripts/event-store.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  PASS ${msg}`); passed++; }
  else { console.log(`  FAIL ${msg}`); failed++; }
}

const LOCK = '.event-store-operation.lock';
const STARTED = '2030-03-04T05:00:00.000Z';
const root = makeSandbox('event-store-lock');
console.log('event-store-lock.test.mjs');

function fixture(name) {
  const base = join(root, name);
  const dataDir = join(base, 'input');
  const outputDir = join(base, 'generated');
  const backupsDir = join(base, 'saved-copies');
  for (const dir of [dataDir, outputDir, backupsDir]) mkdirSync(dir, { recursive: true });
  const row = '| 900001 | 2030-03-01 | Zorblax Widgetry | Example Cog Lead | 0.11/5 | Evaluated | no | example.docx | [900001](https://example.test/r/900001) | Invented fixture | https://example.test/jobs/900001 |';
  writeFileSync(join(dataDir, 'applications.md'), ['# Invented Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, row, ''].join('\n'), 'utf8');
  writeFileSync(join(dataDir, 'apply-dates.json'), '{\n  "900001": "2030-03-02"\n}\n', 'utf8');
  mkdirSync(join(dataDir, 'target-talent-correspondence'));
  writeFileSync(join(dataDir, 'target-talent-correspondence', '900001.md'), '# Example Personone\n\nInvented message for Zorblax Widgetry.\n', 'utf8');
  return { dataDir, outputDir, backupsDir, lockPath: join(dataDir, LOCK) };
}

function run(item, args, extra = {}) {
  const stdout = [];
  const stderr = [];
  const previous = process.env.TJK_DATA_DIR;
  process.env.TJK_DATA_DIR = item.dataDir;
  let code;
  try {
    const argv = args[0] === 'flip' ? [...args, '--data-dir', item.dataDir, '--output-dir', item.outputDir] : args;
    code = runEventStore(argv, {
      backupsDir: item.backupsDir,
      getOwnerName: () => 'Example Personone',
      now: () => new Date(STARTED),
      findOtherWriters: () => [],
      io: { log: value => stdout.push(String(value)), error: value => stderr.push(String(value)) },
      ...extra,
    });
  } finally {
    if (previous === undefined) delete process.env.TJK_DATA_DIR;
    else process.env.TJK_DATA_DIR = previous;
  }
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

const flipArgs = ['flip', '--apply', '--no-other-writers'];
const staleFiles = item => readdirSync(item.dataDir).filter(name => name.startsWith(`${LOCK}.stale-`));
const writeLock = (path, lock) => writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
const readLock = path => JSON.parse(readFileSync(path, 'utf8'));

// A normal flip leaves nothing behind, and the lock carries a token while it runs.
{
  const item = fixture('normal');
  let seen = null;
  const result = run(item, flipArgs, {
    verifyImportFn: (...args) => {
      seen = existsSync(item.lockPath) ? readLock(item.lockPath) : null;
      return verifyImport(...args);
    },
  });
  check(result.code === 0, 'a normal flip returns 0');
  check(!existsSync(item.lockPath) && staleFiles(item).length === 0, 'a normal flip leaves no lock file and no stale file behind');
  check(seen !== null && seen.pid === process.pid && typeof seen.token === 'string' && seen.token.length === 36, 'while the flip runs the lock names this process and carries a 36 character token');
}

// A stale lock (dead process) is replaced.
{
  const item = fixture('stale');
  writeLock(item.lockPath, { pid: 999999, started_at: STARTED, token: 'old-token' });
  const result = run(item, flipArgs, { isProcessAlive: () => false });
  check(result.code === 0 && /Removing stale event store operation lock for dead pid 999999/.test(result.stdout), 'a lock naming a dead process is replaced and the flip succeeds');
  check(!existsSync(item.lockPath) && staleFiles(item).length === 0, 'the stale claim file does not survive');
}

// A live lock refuses and is left untouched.
{
  const item = fixture('live');
  writeLock(item.lockPath, { pid: 424242, started_at: STARTED, token: 'live-token' });
  const result = run(item, flipArgs, { isProcessAlive: () => true });
  check(result.code === 1 && result.stderr.includes('424242'), 'a lock naming a live process refuses and names the pid');
  check(readLock(item.lockPath).token === 'live-token' && staleFiles(item).length === 0, 'a live lock is left exactly as it was');
  check(!existsSync(join(item.dataDir, 'trajecktory.db')) && readdirSync(item.backupsDir).length === 0, 'a refused flip makes no database and no backup');
}

// Release is token checked: a lock that was replaced during the run is not deleted.
{
  const item = fixture('foreign-release');
  const result = run(item, flipArgs, {
    verifyImportFn: (...args) => {
      writeLock(item.lockPath, { pid: 1, started_at: STARTED, token: 'foreign-token' });
      return verifyImport(...args);
    },
  });
  check(existsSync(item.lockPath) && readLock(item.lockPath).token === 'foreign-token', 'a lock replaced during the run stays in place');
  check(result.stderr.includes('no longer ours'), 'the release says the lock is no longer ours');
}

// The ABA case: the stale lock is replaced by a live one between the check and the removal.
{
  const item = fixture('aba');
  writeLock(item.lockPath, { pid: 999999, started_at: STARTED, token: 'old-token' });
  const result = run(item, flipArgs, {
    isProcessAlive: pid => pid !== 999999,
    hooks: {
      beforeStaleRemoval: lockPath => writeLock(lockPath, { pid: 999998, started_at: STARTED, token: 'new-token' }),
    },
  });
  check(result.code === 1 && result.stderr.includes('lock changed while'), 'a lock replaced during stale cleanup refuses the flip');
  check(existsSync(item.lockPath) && readLock(item.lockPath).token === 'new-token', 'the new live lock is still at the lock path with its own token');
  check(staleFiles(item).length === 0, 'no stale copy is left beside it');
  check(!existsSync(join(item.dataDir, 'trajecktory.db')), 'no database was created');
}

// A replacement with the same pid but a different start time is still a different lock.
{
  const item = fixture('aba-same-pid');
  writeLock(item.lockPath, { pid: 999999, started_at: STARTED, token: 'old-token' });
  const result = run(item, flipArgs, {
    isProcessAlive: pid => pid !== 999999,
    hooks: {
      beforeStaleRemoval: lockPath => writeLock(lockPath, { pid: 999999, started_at: '2030-03-04T06:00:00.000Z', token: 'new-token' }),
    },
  });
  check(result.code === 1 && result.stderr.includes('lock changed while'), 'a lock with the same pid and a different start time counts as replaced');
  check(existsSync(item.lockPath) && readLock(item.lockPath).token === 'new-token', 'and the replacement stays in place');
}

// A lock that is already gone at release time is not reported as foreign.
{
  const item = fixture('release-missing');
  const result = run(item, flipArgs, {
    verifyImportFn: (...args) => {
      rmSync(item.lockPath, { force: true });
      return verifyImport(...args);
    },
  });
  check(result.code === 0 && !result.stderr.includes('no longer ours'), 'a lock removed during the run is not reported as taken by someone else');
}

// The lock that disappears while it is being claimed is simply retried.
{
  const item = fixture('vanish');
  writeLock(item.lockPath, { pid: 999999, started_at: STARTED, token: 'old-token' });
  const result = run(item, flipArgs, {
    isProcessAlive: () => false,
    hooks: { beforeStaleRemoval: lockPath => rmSync(lockPath, { force: true }) },
  });
  check(result.code === 0 && !existsSync(item.lockPath) && staleFiles(item).length === 0, 'a stale lock that vanishes while it is being claimed is retried and the flip succeeds');
}

// Rollback goes through the same lock code.
{
  const item = fixture('rollback');
  writeLock(item.lockPath, { pid: 424242, started_at: STARTED, token: 'live-token' });
  const result = run(item, ['rollback', '--apply', '--no-other-writers'], { isProcessAlive: () => true });
  check(result.code === 1 && result.stderr.includes('424242'), 'rollback refuses while another operation holds the lock');
  check(readLock(item.lockPath).token === 'live-token', 'and leaves that lock alone');
}

// The backup does not copy a stale claim file.
{
  const item = fixture('backup-skips');
  writeFileSync(join(item.dataDir, `${LOCK}.stale-1-abc`), 'x', 'utf8');
  const result = run(item, flipArgs);
  const backups = readdirSync(item.backupsDir);
  check(result.code === 0 && backups.length === 1 && readdirSync(join(item.backupsDir, backups[0])).every(name => !name.startsWith(LOCK)), 'a stale claim file is not copied into the backup');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
