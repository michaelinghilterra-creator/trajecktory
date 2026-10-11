#!/usr/bin/env node
/**
 * reclassify-email-received.mjs: dry run. Reports which stored email_received events would move if their reply notes
 * were classified again with the current rules.
 *
 * Stored events keep the kind and sentiment they were classified under, so a classifier change leaves history on the
 * old rules (see INBOUND_CLASSIFIER_VERSION in lib/inbound-events.mjs). This reads every visible email_received event,
 * finds its reply note by key, classifies the note again and prints what would change. It writes nothing, anywhere.
 *
 *   node reclassify-email-received.mjs                 counts by transition, and the effect on the reply numbers
 *   node reclassify-email-received.mjs --list          also one line per event that would move
 *   node reclassify-email-received.mjs --data-dir <dir>   another data folder (default: ./data, or TJK_DATA_DIR)
 *
 * It works on a scratch copy of trajecktory.db (with its -wal and -shm files), event-store.json and app-notes.json, so
 * the real folder is only read. The output has counts, event ids, application ids and the old and new kind. It never
 * has a sender, a subject or a body. There is no write step: --apply is refused. Writing needs the owner's OK first.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const refuse = (message) => { console.error(`REFUSED: ${message}`); process.exit(2); };

if (flag('--apply')) refuse('this script only reports what would move. The write step is not built; it needs the owner\'s OK first.');
const known = new Set(['--list', '--data-dir']);
const dataDirIndex = args.indexOf('--data-dir');
const dataDirValueIndex = dataDirIndex >= 0 ? dataDirIndex + 1 : -1;
for (const [index, arg] of args.entries()) {
  if (arg.startsWith('--') && !known.has(arg)) refuse(`unknown option ${arg}`);
  if (!arg.startsWith('--') && index !== dataDirValueIndex) refuse(`unexpected argument ${arg}`);
}
if (dataDirIndex >= 0 && !option('--data-dir')) refuse('--data-dir needs a folder.');

const root = import.meta.dirname;
const realDir = resolve(option('--data-dir') || process.env.TJK_DATA_DIR || join(root, 'data'));

if (!existsSync(join(realDir, 'trajecktory.db'))) refuse(`no trajecktory.db in ${realDir}; the event store is not set up there, so there is nothing to reclassify.`);
let switchValue = {};
try { switchValue = JSON.parse(readFileSync(join(realDir, 'event-store.json'), 'utf8')); } catch { /* treated as off */ }
if (switchValue.writes !== 'on') refuse('the event store is not switched on here; replies are read from the notes and there are no stored events to reclassify.');

const scratch = mkdtempSync(join(tmpdir(), 'tjk-reclassify-email-received-'));
try {
  for (const name of ['trajecktory.db', 'trajecktory.db-wal', 'trajecktory.db-shm', 'event-store.json', 'app-notes.json']) {
    if (existsSync(join(realDir, name))) copyFileSync(join(realDir, name), join(scratch, name));
  }
  const { openEventStore, readEvents } = await import('./lib/event-store.mjs');
  const { visibleEvents } = await import('./lib/void-events.mjs');
  const { INBOUND_EVENT_TYPE } = await import('./lib/inbound-events.mjs');
  const { planInboundReclassification } = await import('./lib/inbound-reclassify.mjs');

  const store = openEventStore(join(scratch, 'trajecktory.db'));
  let events;
  try {
    events = visibleEvents([...readEvents(store, { type: INBOUND_EVENT_TYPE }), ...readEvents(store, { type: 'event_undone' })])
      .filter((event) => event.type === INBOUND_EVENT_TYPE);
  } finally {
    store.close();
  }
  let notes = {};
  try { notes = JSON.parse(readFileSync(join(scratch, 'app-notes.json'), 'utf8')) || {}; } catch { /* no notes */ }

  const plan = planInboundReclassification({ events, notes });
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
  console.log('DRY RUN OK. Nothing real was changed.');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
