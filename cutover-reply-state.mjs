#!/usr/bin/env node
/**
 * cutover-reply-state.mjs: one-time move of the reply decisions out of google-sync.json into the event store.
 *
 * With the event store on, the dashboard reads handledReplies, notRelatedSenders and unmatchedReplies from the
 * reply-state.json projection. Until this has run, that projection is empty and every reply you already handled
 * would show up in the sweep again. So run it BEFORE the release that contains the reader switch is installed.
 *
 *   node cutover-reply-state.mjs                       dry run on a scratch copy; the real folder is not touched
 *   node cutover-reply-state.mjs --apply --no-other-writers --backup <backup folder>
 *                                                      the real run (see the checks below)
 *
 * Options: --data-dir <dir> to point at another data folder (default: ./data, or TJK_DATA_DIR).
 *
 * The real run refuses unless: the dashboard and every other writer are stopped (--no-other-writers), the event store
 * is on, and --backup names a folder made by backup-data.mjs whose copy of trajecktory.db, its -wal file,
 * google-sync.json and event-store.json is byte-identical to the live files right now.
 *
 * What it does, in this order, so a crash at any point leaves a readable folder:
 *   1. appends one json_snapshot event for reply-state.json holding today's three sets (the event store);
 *   2. checks the projection equals the snapshot and the sets byte for byte;
 *   3. writes data/reply-state.json (atomic);
 *   4. rewrites data/google-sync.json without the three sets (atomic), keeping the scan bookmarks and any other key;
 *   5. reads everything back the way the dashboard does and compares it with what google-sync.json held.
 * It prints counts only, never a record. Idempotent: a second run reports 'already_cut_over' and changes nothing,
 * apart from stripping stale sets from google-sync.json if a crash left them behind.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const apply = flag('--apply');
const root = import.meta.dirname;
const realDir = resolve(option('--data-dir') || process.env.TJK_DATA_DIR || join(root, 'data'));

const sha = (file) => (existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null);
const refuse = (message) => { console.error(`REFUSED: ${message}`); process.exit(2); };

if (!existsSync(join(realDir, 'trajecktory.db'))) refuse(`no trajecktory.db in ${realDir}; the event store is not set up there, so nothing needs moving.`);
let switchValue = {};
try { switchValue = JSON.parse(readFileSync(join(realDir, 'event-store.json'), 'utf8')); } catch { /* treated as off */ }
if (switchValue.writes !== 'on') refuse('the event store is not switched on here; the reply sets stay in google-sync.json and there is nothing to do.');

let backupDir = null;
if (apply) {
  if (!flag('--no-other-writers')) refuse('stop the dashboard and every other writer, then pass --no-other-writers to confirm.');
  backupDir = option('--backup');
  if (!backupDir) refuse('--backup <folder> is required: take one with backup-data.mjs first.');
  const copy = join(resolve(backupDir), 'data');
  if (!existsSync(copy)) refuse(`${copy} does not exist; --backup must be a folder made by backup-data.mjs.`);
  for (const name of ['trajecktory.db', 'trajecktory.db-wal', 'google-sync.json', 'event-store.json']) {
    if (sha(join(realDir, name)) !== sha(join(copy, name))) refuse(`the backup's ${name} is not identical to the live one. Make a fresh backup with nothing running.`);
  }
}

// Work on the real folder only when applying. A dry run copies just what the cutover touches into a scratch folder.
let target = realDir;
let scratch = null;
if (!apply) {
  scratch = mkdtempSync(join(tmpdir(), 'tjk-reply-state-cutover-'));
  mkdirSync(join(scratch, 'data'));
  for (const name of ['trajecktory.db', 'trajecktory.db-wal', 'trajecktory.db-shm', 'event-store.json', 'google-sync.json', 'reply-state.json']) {
    if (existsSync(join(realDir, name))) cpSync(join(realDir, name), join(scratch, 'data', name));
  }
  target = join(scratch, 'data');
  console.log('DRY RUN on a scratch copy; the real data folder is not touched.');
}
process.env.TJK_DATA_DIR = target;

const { openEventStore } = await import('./lib/event-store.mjs');
const { writeFileAtomic } = await import('./lib/atomic-write.mjs');
const { localToday } = await import('./lib/local-date.mjs');
const { splitSync } = await import('./lib/reply-state.mjs');
const { planReplyStateCutover, applyReplyStateCutover, verifyReplyStateCutover } = await import('./lib/reply-state-cutover.mjs');

const syncPath = join(target, 'google-sync.json');
const syncText = existsSync(syncPath) ? readFileSync(syncPath, 'utf8') : null;
const before = splitSync(syncText ? (() => { try { return JSON.parse(syncText); } catch { return {}; } })() : {});

let problems = 0;
const fail = (message) => { problems += 1; console.log(`FAIL ${message}`); };
const summary = (counts) => `${counts.handled} handled, ${counts.notRelated} not-related senders, ${counts.unmatched} parked`;

const store = openEventStore(join(target, 'trajecktory.db'));
const plan = planReplyStateCutover({ syncText, store });
console.log(`google-sync.json holds: ${summary(plan.counts)}.`);
console.log(`status: ${plan.status}`);
if (plan.syncInvalid) fail('google-sync.json is not valid JSON; nothing was changed.');

let wroteAnything = false;
if (plan.status === 'ready') {
  applyReplyStateCutover(store, plan, { importedOn: localToday() });
  wroteAnything = true;
  for (const problem of verifyReplyStateCutover(store, plan)) fail(problem);
}
store.close();

if (!problems && (plan.status === 'ready' || plan.status === 'already_cut_over')) {
  if (plan.status === 'ready') writeFileAtomic(join(target, 'reply-state.json'), plan.snapshotText);
  if (plan.setsPresentInSync) {
    // For 'already_cut_over' the sets in the file are stale (a crash left them); the projection is the truth.
    writeFileAtomic(syncPath, plan.cursorsText);
    wroteAnything = true;
  }
}

// Read it back the way the dashboard does and compare with what google-sync.json held before.
if (!problems && plan.status === 'ready') {
  const { readSync } = await import('./dashboard-web/server/lib/google.mjs');
  const { resetLogWritesCache } = await import('./lib/log-writes.mjs');
  const after = readSync();
  resetLogWritesCache(); // closes the connection readSync opened, so the scratch folder can be deleted
  for (const key of Object.keys(before.state)) {
    if (JSON.stringify(after[key]) !== JSON.stringify(before.state[key])) fail(`readSync ${key} differs from what google-sync.json held`);
  }
  for (const key of Object.keys(before.cursors)) {
    if (JSON.stringify(after[key]) !== JSON.stringify(before.cursors[key])) fail(`readSync ${key} differs from what google-sync.json held`);
  }
  const onDisk = JSON.parse(readFileSync(syncPath, 'utf8'));
  for (const key of Object.keys(before.state)) {
    if (Object.hasOwn(onDisk, key)) fail(`google-sync.json still holds ${key}`);
  }
  console.log(`read back: ${problems ? 'DIFFERENCES FOUND' : 'identical to what google-sync.json held'}`);
}

if (problems) {
  console.log(apply ? `PROBLEMS after the real write. Restore trajecktory.db (and -wal/-shm) and google-sync.json from ${backupDir}.` : 'DRY RUN FAILED. Nothing real was changed.');
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  process.exit(1);
}

if (apply && wroteAnything && backupDir) {
  writeFileSync(join(resolve(backupDir), 'WHAT-CHANGED.md'), [
    '# pre-reply-state-cutover',
    '',
    `Backup of data/ taken before the reply decisions (${summary(plan.counts)}) were moved from google-sync.json into the event store as one json_snapshot of reply-state.json.`,
    '',
    'Changed: trajecktory.db (one new event), data/reply-state.json (new), data/google-sync.json (the three reply sets removed; scan bookmarks kept).',
    '',
    'To undo: with everything stopped, restore trajecktory.db (and its -wal/-shm sidecars) and google-sync.json from this backup, and delete data/reply-state.json.',
    '',
  ].join('\n'));
  console.log(`WHAT-CHANGED.md written in ${backupDir}`);
}
console.log(apply ? (wroteAnything ? 'DONE.' : 'Nothing to do.') : 'DRY RUN OK. Nothing real was changed.');
if (scratch) rmSync(scratch, { recursive: true, force: true });
