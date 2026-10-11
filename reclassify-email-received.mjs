#!/usr/bin/env node
/**
 * reclassify-email-received.mjs: re-classify stored email_received events with the current rules.
 *
 * Stored events keep the kind and sentiment they were classified under, so a classifier change leaves history on the
 * old rules (see INBOUND_CLASSIFIER_VERSION in lib/inbound-events.mjs). This reads every visible email_received event,
 * finds its reply note by key, classifies the note again and reports what would change.
 *
 *   node reclassify-email-received.mjs                 dry run: counts by transition and the effect on the reply numbers
 *   node reclassify-email-received.mjs --list          also one line per event that would move
 *   node reclassify-email-received.mjs --data-dir <dir>   another data folder (default: ./data, or TJK_DATA_DIR)
 *   node reclassify-email-received.mjs --apply --no-other-writers --backup <backup folder>
 *                                                      the real write (see the checks below)
 *
 * The dry run works on a scratch copy of trajecktory.db (with its -wal and -shm files), event-store.json and
 * app-notes.json, so the real folder is only read. The output has counts, event ids, application ids and the old and
 * new kind. It never has a sender, a subject or a body.
 *
 * The real write refuses unless: the dashboard and every other writer are stopped (--no-other-writers), the event
 * store is on, and --backup names a folder made by backup-data.mjs whose copy of trajecktory.db, its -wal file and
 * event-store.json is byte-identical to the live files right now. It then:
 *   1. rehearses the whole write on a scratch copy and requires that planning again finds nothing left to move;
 *   2. appends, in one transaction, a void of each moved event and a replacement with the same key, message id and
 *      attach link (history is not edited; the old event stays, voided);
 *   3. plans again on the real store and requires nothing is left to move and the reply numbers match the plan.
 * Idempotent: a second run finds nothing to do.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const refuse = (message) => { console.error(`REFUSED: ${message}`); process.exit(2); };

const apply = flag('--apply');
const known = new Set(['--list', '--data-dir', '--apply', '--no-other-writers', '--backup']);
const valueIndexes = new Set(['--data-dir', '--backup'].map((name) => args.indexOf(name)).filter((i) => i >= 0).map((i) => i + 1));
for (const [index, arg] of args.entries()) {
  if (arg.startsWith('--') && !known.has(arg)) refuse(`unknown option ${arg}`);
  if (!arg.startsWith('--') && !valueIndexes.has(index)) refuse(`unexpected argument ${arg}`);
}
if (args.includes('--data-dir') && !option('--data-dir')) refuse('--data-dir needs a folder.');

const root = import.meta.dirname;
const realDir = resolve(option('--data-dir') || process.env.TJK_DATA_DIR || join(root, 'data'));
const sha = (file) => (existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null);

if (!existsSync(join(realDir, 'trajecktory.db'))) refuse(`no trajecktory.db in ${realDir}; the event store is not set up there, so there is nothing to reclassify.`);
let switchValue = {};
try { switchValue = JSON.parse(readFileSync(join(realDir, 'event-store.json'), 'utf8')); } catch { /* treated as off */ }
if (switchValue.writes !== 'on') refuse('the event store is not switched on here; replies are read from the notes and there are no stored events to reclassify.');

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

const { openEventStore, readEvents, appendEvents } = await import('./lib/event-store.mjs');
const { visibleEvents } = await import('./lib/void-events.mjs');
const { INBOUND_EVENT_TYPE } = await import('./lib/inbound-events.mjs');
const { buildReclassificationEvents, planInboundReclassification } = await import('./lib/inbound-reclassify.mjs');
const { localToday } = await import('./lib/local-date.mjs');

const COPIED = ['trajecktory.db', 'trajecktory.db-wal', 'trajecktory.db-shm', 'event-store.json', 'app-notes.json'];
function scratchCopy(from) {
  const dir = mkdtempSync(join(tmpdir(), 'tjk-reclassify-email-received-'));
  for (const name of COPIED) if (existsSync(join(from, name))) copyFileSync(join(from, name), join(dir, name));
  return dir;
}
function readVisibleInbound(store) {
  return visibleEvents([...readEvents(store, { type: INBOUND_EVENT_TYPE }), ...readEvents(store, { type: 'event_undone' })])
    .filter((event) => event.type === INBOUND_EVENT_TYPE);
}
function readNotes(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'app-notes.json'), 'utf8')) || {}; } catch { return {}; }
}
function planFrom(store, dir) {
  const events = readVisibleInbound(store);
  return { events, plan: planInboundReclassification({ events, notes: readNotes(dir) }) };
}

const scratches = [];
const fail = (message) => {
  console.log(`FAIL ${message}`);
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
  process.exit(1);
};

const today = localToday();
const runId = `reclassify-${today}-${Date.now()}`;
const dry = scratchCopy(realDir);
scratches.push(dry);
const dryStore = openEventStore(join(dry, 'trajecktory.db'));
let events;
let plan;
try { ({ events, plan } = planFrom(dryStore, dry)); } finally { dryStore.close(); }

const c = plan.counts;
console.log(`email_received events: ${c.events} visible, ${c.noNote} with no reply note (left as they are).`);
console.log(`would change: ${c.changed}; ${c.unchanged} stay as they are.`);
const transitions = Object.entries(c.byTransition).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
if (transitions.length) for (const [transition, n] of transitions) console.log(`  ${transition}: ${n}`);
else console.log('  (none)');
console.log(`human replies: ${plan.humanReplies.before} -> ${plan.humanReplies.after}`);
console.log(`applications with a human reply: ${plan.apps.reply.before} -> ${plan.apps.reply.after}`);
console.log(`applications with a positive human reply: ${plan.apps.positive.before} -> ${plan.apps.positive.after}`);
if (flag('--list')) {
  for (const change of plan.changes) {
    console.log(`  event ${change.event_id} app ${change.application_id}: ${change.from} -> ${change.to}${change.sentiment_source ? ` (${change.sentiment_source})` : ''}`);
  }
}

if (!apply) {
  console.log('DRY RUN OK. Nothing real was changed.');
  rmSync(dry, { recursive: true, force: true });
  process.exit(0);
}

if (!plan.changes.length) {
  console.log('Nothing to do.');
  rmSync(dry, { recursive: true, force: true });
  process.exit(0);
}

// The same checks run after a write: nothing is left to move, and the reply numbers are the planned ones.
// Returns a description of the problem, or null when the write is as planned.
function problemAfter(store, dir) {
  const after = planFrom(store, dir);
  if (after.plan.changes.length) return `${after.plan.changes.length} events would still move after the write.`;
  const planned = JSON.stringify([plan.humanReplies.after, plan.apps.reply.after, plan.apps.positive.after]);
  const found = JSON.stringify([after.plan.humanReplies.before, after.plan.apps.reply.before, after.plan.apps.positive.before]);
  return planned === found ? null : `the reply numbers after the write (${found}) are not the planned ones (${planned}).`;
}

const built = buildReclassificationEvents({ events, plan, occurredOn: today, runId });

// 1. Rehearsal on a second scratch copy.
const rehearsal = scratchCopy(realDir);
scratches.push(rehearsal);
const rehearsalStore = openEventStore(join(rehearsal, 'trajecktory.db'));
try {
  appendEvents(rehearsalStore, built);
  const problem = problemAfter(rehearsalStore, rehearsal);
  if (problem) { rehearsalStore.close(); fail(`rehearsal failed, nothing real was changed: ${problem}`); }
} finally {
  try { rehearsalStore.close(); } catch { /* already closed */ }
}
console.log(`rehearsal on a scratch copy: ${built.length} events appended, nothing left to move, reply numbers as planned.`);

// 2 and 3. The real write, then the same verification on the real store.
const { openDataStore, resetLogWritesCache } = await import('./lib/log-writes.mjs');
const store = openDataStore(realDir);
let wrote = 0;
try {
  appendEvents(store, built);
  wrote = built.length;
} catch (error) {
  resetLogWritesCache();
  fail(`the batch was rolled back, nothing real was written: ${error.message}`);
}
const realProblem = problemAfter(store, realDir);
resetLogWritesCache();
if (realProblem) {
  console.log(`PROBLEMS after the real write: ${realProblem}`);
  fail(`restore trajecktory.db (and -wal/-shm) from ${backupDir}.`);
}
console.log(`wrote ${wrote} events (${plan.changes.length} voided, ${plan.changes.length} replaced), run ${runId}.`);

writeFileSync(join(resolve(backupDir), 'WHAT-CHANGED.md'), [
  '# pre-reclassify-email-received',
  '',
  `Backup of data/ taken before ${wrote} events were appended to the event store: a void of each of ${plan.changes.length} email_received events and a replacement with the kind and sentiment the current rules give (run ${runId}).`,
  '',
  'Changed: trajecktory.db only. No sender, subject or body was stored; notes and status files were not touched.',
  '',
  'To undo: with everything stopped, restore trajecktory.db (and its -wal/-shm sidecars) from this backup.',
  '',
].join('\n'));
console.log(`WHAT-CHANGED.md written in ${backupDir}`);
console.log('DONE.');
for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
