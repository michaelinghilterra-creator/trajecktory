#!/usr/bin/env node
/**
 * backfill-email-received.mjs: one-time record of every logged reply as an email_received event.
 *
 * Until now the reply metrics re-read the 'Reply logged' notes in app-notes.json and the 'Responded' rows in
 * status-events.tsv on every read. This writes one email_received event for each of them (kind, sentiment and the
 * date it was logged, no sender, subject or body), so the metrics read a stored fact. The reader falls back to the
 * notes for any reply that has no event yet, so the order of release and backfill does not matter for correctness,
 * but run it once after installing the release so the history is on the events.
 *
 *   node backfill-email-received.mjs                    dry run on a scratch copy; the real folder is not touched
 *   node backfill-email-received.mjs --apply --no-other-writers --backup <backup folder>
 *                                                       the real run (see the checks below)
 *
 * Options: --data-dir <dir> to point at another data folder (default: ./data, or TJK_DATA_DIR).
 *
 * The real run refuses unless: the dashboard and every other writer are stopped (--no-other-writers), the event store
 * is on, and --backup names a folder made by backup-data.mjs whose copy of trajecktory.db, its -wal file and
 * event-store.json is byte-identical to the live files right now.
 *
 * What it does:
 *   1. plans one event per reply note and per 'Responded' row that has no event yet (skips what is recorded);
 *   2. computes the core metrics BEFORE;
 *   3. appends the events in one transaction (a duplicate key rolls the whole batch back);
 *   4. computes the core metrics AFTER and requires the two to be identical;
 *   5. plans again and requires nothing is left to write.
 * A dry run does all of it on a scratch copy. It prints counts only, never a record. Idempotent.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

if (!existsSync(join(realDir, 'trajecktory.db'))) refuse(`no trajecktory.db in ${realDir}; the event store is not set up there, so nothing needs recording.`);
let switchValue = {};
try { switchValue = JSON.parse(readFileSync(join(realDir, 'event-store.json'), 'utf8')); } catch { /* treated as off */ }
if (switchValue.writes !== 'on') refuse('the event store is not switched on here; replies are read from the notes and there is nothing to do.');

let backupDir = null;
if (apply) {
  if (!flag('--no-other-writers')) refuse('stop the dashboard and every other writer, then pass --no-other-writers to confirm.');
  backupDir = option('--backup');
  if (!backupDir) refuse('--backup <folder> is required: take one with backup-data.mjs first.');
  const copy = join(resolve(backupDir), 'data');
  if (!existsSync(copy)) refuse(`${copy} does not exist; --backup must be a folder made by backup-data.mjs.`);
  for (const name of ['trajecktory.db', 'trajecktory.db-wal', 'event-store.json']) {
    if (sha(join(realDir, name)) !== sha(join(copy, name))) refuse(`the backup's ${name} is not identical to the live one. Make a fresh backup with nothing running.`);
  }
}

// A dry run works on a copy of the whole data folder, because the metrics read many of its files.
let target = realDir;
let scratch = null;
if (!apply) {
  scratch = mkdtempSync(join(tmpdir(), 'tjk-email-received-backfill-'));
  target = join(scratch, 'data');
  cpSync(realDir, target, { recursive: true });
  console.log('DRY RUN on a scratch copy; the real data folder is not touched.');
}
process.env.TJK_DATA_DIR = target;

const { openDataStore } = await import('./lib/log-writes.mjs');
const { readEvents, appendEvents } = await import('./lib/event-store.mjs');
const { visibleEvents } = await import('./lib/void-events.mjs');
const { INBOUND_EVENT_TYPE, inboundRepliesFromEvents, planInboundBackfill } = await import('./lib/inbound-events.mjs');
const { REPLY_EVENT_TYPE } = await import('./lib/event-undo.mjs');
const { parseStatusEvents } = await import('./dashboard-web/server/lib/sidecars.mjs');
const { collectCoreMetrics } = await import('./dashboard-web/server/lib/metrics-collect.mjs');
const { resetLogWritesCache } = await import('./lib/log-writes.mjs');

let problems = 0;
const fail = (message) => { problems += 1; console.log(`FAIL ${message}`); };

const store = openDataStore(target);

function plan() {
  const log = [...readEvents(store, { type: INBOUND_EVENT_TYPE }), ...readEvents(store, { type: REPLY_EVENT_TYPE }), ...readEvents(store, { type: 'event_undone' })];
  const visible = visibleEvents(log);
  const existing = inboundRepliesFromEvents(log);
  const replyAttachedByMsgId = new Map();
  for (const event of visible) {
    if (event.type === REPLY_EVENT_TYPE && event.payload && event.payload.msg_id) replyAttachedByMsgId.set(String(event.payload.msg_id), event.id);
  }
  let notes = {};
  try { notes = JSON.parse(readFileSync(join(target, 'app-notes.json'), 'utf8')) || {}; } catch { /* no notes */ }
  const respondedRows = (parseStatusEvents() || [])
    .filter((row) => String(row.status || '').trim().toLowerCase() === 'responded')
    .map((row) => ({ application_id: row.app, date: row.date }));
  return planInboundBackfill({ notes, respondedRows, existingKeys: existing.keys, replyAttachedByMsgId });
}

const toWrite = plan();
const c = toWrite.counts;
console.log(`notes ${c.notes}, reply notes ${c.replyNotes}, Responded rows ${c.responded}, already recorded ${c.alreadyRecorded}.`);
console.log(`to write: ${c.created} events (${Object.entries(c.byKind).map(([kind, n]) => `${n} ${kind}`).join(', ') || 'none'}); ${c.linkedToAttach} linked to an attach event so undoing that attach removes them.`);

const before = JSON.stringify(collectCoreMetrics());
let wrote = 0;
if (toWrite.events.length) {
  try {
    appendEvents(store, toWrite.events);
    wrote = toWrite.events.length;
  } catch (error) {
    fail(`the batch was rolled back: ${error.message}`);
  }
}
if (!problems) {
  const after = JSON.stringify(collectCoreMetrics());
  console.log(`core metrics before and after: ${before === after ? 'identical' : 'DIFFERENT'}`);
  if (before !== after) fail('the core metrics changed; the backfill must not move a number.');
  const again = plan();
  if (again.events.length) fail(`${again.events.length} replies still have no event after the write.`);
  const kinds = inboundRepliesFromEvents(readEvents(store, { type: INBOUND_EVENT_TYPE }));
  console.log(`events now record ${kinds.keys.size} replies (any kind).`);
}
resetLogWritesCache();

if (problems) {
  console.log(apply ? `PROBLEMS after the real write. Restore trajecktory.db (and -wal/-shm) from ${backupDir}.` : 'DRY RUN FAILED. Nothing real was changed.');
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  process.exit(1);
}

if (apply && wrote && backupDir) {
  writeFileSync(join(resolve(backupDir), 'WHAT-CHANGED.md'), [
    '# pre-email-received-backfill',
    '',
    `Backup of data/ taken before ${wrote} email_received events (one per logged reply note and per Responded row) were appended to the event store.`,
    '',
    'Changed: trajecktory.db only (new events, source import). No sender, subject or body was stored; notes and status files were not touched.',
    '',
    'To undo: with everything stopped, restore trajecktory.db (and its -wal/-shm sidecars) from this backup.',
    '',
  ].join('\n'));
  console.log(`WHAT-CHANGED.md written in ${backupDir}`);
}
console.log(apply ? (wrote ? 'DONE.' : 'Nothing to do.') : 'DRY RUN OK. Nothing real was changed.');
if (scratch) rmSync(scratch, { recursive: true, force: true });
