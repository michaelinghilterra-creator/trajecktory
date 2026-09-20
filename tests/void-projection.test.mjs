#!/usr/bin/env node
// D-10: a void takes an event out of the rendered files and leaves it in the log. Invented fixtures only.
import { join } from 'node:path';
import { openEventStore, readEvents, appendEvents } from '../lib/event-store.mjs';
import { importTracker } from '../lib/import/tracker-import.mjs';
import { importStatusHistory } from '../lib/import/status-import.mjs';
import { importCorrespondence } from '../lib/import/correspondence-import.mjs';
import { recordJsonSnapshots, appendEventsWithEffects, renderLegacyFile, renderDirty, listLegacyFiles } from '../lib/legacy-files.mjs';
import { buildVoidEvent } from '../lib/void-events.mjs';
import { TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const root = makeSandbox('void-projection');
const definitionsVersion = 'fixture-v1';
const importedOn = '2030-12-31';
const rowOne = '| 900001 | 2030-01-01 | Zorblax Widgetry | Example Cog Lead | 0.01/5 | Evaluated | - | - | - | Invented note |';
const rowTwo = '| 900002 | 2030-01-02 | Quennox Ratchet Works | Example Gear Manager | 0.01/5 | Evaluated | - | - | - | Invented note |';
const trackerText = `# Invented Applications\n\n${TRACKER_HEADER}\n${TRACKER_SEPARATOR}\n${rowOne}\n${rowTwo}\n`;
const statusText = 'app#\tdate\tstatus\tcompany\tlogged\n900001\t2030-01-03\tApplied\tZorblax Widgetry\t2030-01-03\n';
const correspondence = 'Invented preamble.\n## 2030-01-06 09:00 | Sent | Invented subject\n\nInvented body.\n\n';

let counter = 0;
const live = (effects) => ({
  type: 'note_added', occurred_on: '2030-08-09', source: 'cli', definitions_version: definitionsVersion,
  dedupe_key: `void-fixture-${++counter}`, payload: { legacy_effects: effects },
});
const voidOf = (id, reason = 'wrong_record') => buildVoidEvent({ target_event_id: id, reason_code: reason, evidence_ref: 'owner', actor: 'owner', occurred_on: '2030-09-01', definitions_version: definitionsVersion });
const lastId = (store) => Math.max(...readEvents(store).map(event => event.id));
function fresh(name) {
  const store = openEventStore(join(root, `${name}.db`));
  importTracker(store, trackerText, { definitionsVersion, importedOn });
  importStatusHistory(store, statusText, { definitionsVersion, importedOn });
  importCorrespondence(store, { targetTalentFiles: { '900001.md': correspondence }, referralFiles: {}, definitionsVersion, importedOn });
  recordJsonSnapshots(store, { texts: { 'twc-overrides.json': `${JSON.stringify({ add: {} }, null, 2)}\n` }, definitionsVersion, importedOn });
  return store;
}
const edit = (raw, at = 'applications.md#4') => ({ file: 'applications.md', op: 'row_upsert', row_id: at, raw });

console.log('void-projection.test.mjs');

// No void: the projection is what it always was.
{
  const store = fresh('none');
  const before = renderLegacyFile(store, 'applications.md');
  appendEventsWithEffects(store, [live([edit(rowOne.replace('Evaluated', 'Applied'))])]);
  const after = renderLegacyFile(store, 'applications.md');
  check(before.includes('Evaluated') && after.includes('| Applied |') && after.includes(rowTwo), 'with no void, an edit shows in the rendered file');
  store.close();
}

// Voiding an edit brings the earlier row back.
{
  const store = fresh('edit');
  const original = renderLegacyFile(store, 'applications.md');
  appendEventsWithEffects(store, [live([edit(rowOne.replace('Evaluated', 'Applied'))])]);
  const editId = lastId(store);
  check(renderLegacyFile(store, 'applications.md') !== original, 'the edit changes the file');
  appendEventsWithEffects(store, [voidOf(editId)]);
  check(renderLegacyFile(store, 'applications.md') === original, 'voiding the edit gives back the exact earlier file, byte for byte');
  check(readEvents(store).some(event => event.id === editId) && readEvents(store).some(event => event.type === 'event_undone' && event.corrects_event_id === editId), 'the edit and its void both stay in the log');
  // Undoing the void brings the edit back.
  const voidId = lastId(store);
  appendEventsWithEffects(store, [voidOf(voidId, 'undone_by_owner')]);
  check(renderLegacyFile(store, 'applications.md').includes('| Applied |'), 'voiding the void brings the edit back');
  store.close();
}

// Only the voided edit is skipped; later edits of the same row stay.
{
  const store = fresh('layers');
  appendEventsWithEffects(store, [live([edit(rowOne.replace('Evaluated', 'Applied'))])]);
  const first = lastId(store);
  appendEventsWithEffects(store, [live([edit(rowOne.replace('Evaluated', 'Phone Screen'))])]);
  appendEventsWithEffects(store, [voidOf(first)]);
  const rendered = renderLegacyFile(store, 'applications.md');
  check(rendered.includes('| Phone Screen |') && !rendered.includes('| Applied |'), 'voiding an older edit leaves the newer edit in place');
  store.close();
}

// Voiding an inserted row removes it, and a later edit of that row is dropped without breaking the render.
{
  const store = fresh('insert');
  appendEventsWithEffects(store, [live([{ file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#n-new', raw: '| 900003 | new row |', anchor: { at: 'table_end' } }])]);
  const insertId = lastId(store);
  appendEventsWithEffects(store, [live([{ file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#n-new', raw: '| 900003 | new row edited |' }])]);
  appendEventsWithEffects(store, [live([{ file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#n-after', raw: '| 900004 | after |', anchor: { at: 'after', row_id: 'applications.md#n-new' } }])]);
  check(renderLegacyFile(store, 'applications.md').includes('| 900004 | after |'), 'before the void the new rows are there');
  appendEventsWithEffects(store, [voidOf(insertId, 'duplicate')]);
  let rendered;
  const warn = console.warn;
  let warned = '';
  console.warn = (message) => { warned += message; };
  try { rendered = renderLegacyFile(store, 'applications.md'); } finally { console.warn = warn; }
  check(rendered !== null && !rendered.includes('new row') && !rendered.includes('| 900004 | after |') && rendered.includes(rowTwo), 'voiding an insert removes the row and what was built only on it, and the file still renders');
  check(/dropped 2 effect/.test(warned), 'the render says how many dependent effects were dropped');
  store.close();
}

// A void of a genuine mistake elsewhere still fails loudly: with no void, a bad effect is not tolerated.
{
  const store = fresh('strict');
  let threw = false;
  try { appendEventsWithEffects(store, [live([{ file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#n-orphan', raw: '| x |' }])]); } catch { threw = true; }
  check(threw, 'without a void, an edit of a row that does not exist is still an error');
  store.close();
}

// An orphan effect is an error when nothing was voided: the tolerant mode is only for voids.
{
  const store = fresh('orphan');
  appendEvents(store, [live([{ file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#n-orphan', raw: '| x |' }])]);
  let threw = false;
  const warn = console.warn;
  console.warn = () => {};
  try { renderLegacyFile(store, 'applications.md'); } catch { threw = true; } finally { console.warn = warn; }
  check(threw, 'with no void in the log, an effect that cannot apply still fails the render');
  store.close();
}

// Undoing a void marks the files of the original event dirty again.
{
  const store = fresh('chain');
  appendEventsWithEffects(store, [live([edit(rowOne.replace('Evaluated', 'Applied'))])]);
  const editId = lastId(store);
  appendEventsWithEffects(store, [voidOf(editId)]);
  const voidId = lastId(store);
  store.db.prepare("UPDATE legacy_render_state SET dirty = 0 WHERE file = 'applications.md'").run();
  appendEventsWithEffects(store, [voidOf(voidId, 'undone_by_owner')]);
  check(store.db.prepare("SELECT dirty FROM legacy_render_state WHERE file = 'applications.md'").get().dirty > 0, 'voiding a void marks the file of the original event dirty');
  store.close();
}

// JSON files.
{
  const store = fresh('json');
  appendEventsWithEffects(store, [live([{ file: 'twc-overrides.json', op: 'json_set', key: 'add', value: { 'example-900001': { company: 'Zorblax Widgetry' } } }])]);
  const setId = lastId(store);
  check(renderLegacyFile(store, 'twc-overrides.json').includes('example-900001'), 'the JSON edit shows before the void');
  appendEventsWithEffects(store, [voidOf(setId)]);
  check(!renderLegacyFile(store, 'twc-overrides.json').includes('example-900001'), 'voiding a JSON edit takes it out of the file');
  store.close();
}

// Correspondence.
{
  const store = fresh('mail');
  appendEventsWithEffects(store, [live([{ file: 'target-talent-correspondence/900001.md', op: 'file_replace', raw: 'Invented replacement.\n' }])]);
  const replaceId = lastId(store);
  check(renderLegacyFile(store, 'target-talent-correspondence/900001.md') === 'Invented replacement.\n', 'a file replacement shows before the void');
  appendEventsWithEffects(store, [voidOf(replaceId)]);
  check(renderLegacyFile(store, 'target-talent-correspondence/900001.md') === correspondence, 'voiding a file replacement gives back the imported file');
  store.close();
}

// A void marks the affected file for re-rendering.
{
  const store = fresh('dirty');
  appendEventsWithEffects(store, [live([edit(rowOne.replace('Evaluated', 'Applied'))])]);
  const editId = lastId(store);
  const dir = join(root, 'dirty-out');
  renderDirty(store, dir);
  const clean = store.db.prepare("SELECT dirty FROM legacy_render_state WHERE file = 'applications.md'").get().dirty;
  appendEventsWithEffects(store, [voidOf(editId)]);
  const dirty = store.db.prepare("SELECT dirty FROM legacy_render_state WHERE file = 'applications.md'").get().dirty;
  check(dirty > clean, 'a void marks the target file dirty so it is written again');
  const other = store.db.prepare("SELECT dirty FROM legacy_render_state WHERE file = 'referrals.md'").get();
  check(!other || other.dirty === 0, 'files the voided event never touched stay clean');
  check(listLegacyFiles(store).includes('applications.md'), 'the file is still listed');
  store.close();
}

// A void of an event that touched no file does nothing to the files.
{
  const store = fresh('quiet');
  const before = renderLegacyFile(store, 'applications.md');
  appendEventsWithEffects(store, [{ type: 'note_added', occurred_on: '2030-08-09', source: 'cli', definitions_version: definitionsVersion, payload: { text: 'Invented note.' } }]);
  appendEventsWithEffects(store, [voidOf(lastId(store), 'erroneous_entry')]);
  check(renderLegacyFile(store, 'applications.md') === before, 'voiding an event with no file effects changes no file');
  store.close();
}

console.log(`void-projection: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
