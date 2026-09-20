#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('notes-event-store');
process.env.TJK_DATA_DIR = sandbox;
fs.writeFileSync(path.join(sandbox, 'event-store.json'), JSON.stringify({ writes: 'on' }));

const { openEventStore, readEvents } = await import('../lib/event-store.mjs');
const { appendEventsWithEffects } = await import('../lib/legacy-files.mjs');
const { openDataStore, resetLogWritesCache, withLogWrite } = await import('../lib/log-writes.mjs');
const { buildVoidEvent } = await import('../lib/void-events.mjs');
const { addNote, deleteNote, findNoteByMsgId, getNotes } = await import('../dashboard-web/server/lib/notes.mjs');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

console.log('notes-event-store.test.mjs');
try {
  openEventStore(path.join(sandbox, 'trajecktory.db')).close();
  const first = addNote(900001, '  Invented first note.  ', { msgId: 'm900001', threadId: 't900001', sender: 'person@example.test' });
  check(first.added === true && first.length === 1 && first[0].text === 'Invented first note.', 'addNote writes a projected note and preserves its return shape');

  addNote(900002, 'Invented second note.', { msgId: 'm900002' });
  check(getNotes(900001).length === 1 && getNotes(900002).length === 1, 'notes under different application ids do not collide');
  check(findNoteByMsgId('m900002') === '900002', 'findNoteByMsgId finds the application through the projection');

  const duplicate = addNote(900003, 'Invented duplicate.', { msgId: 'm900002' });
  check(duplicate.added === false && getNotes(900003).length === 0, 'a duplicate Gmail message id is a no-op');

  const timestamp = getNotes(900001)[0].timestamp;
  const beforeDelete = readEvents(openDataStore(sandbox));
  const noteEvent = beforeDelete.find((event) => event.type === 'note_added' && event.application_id === '900001');
  const deleted = deleteNote(900001, timestamp);
  const afterDelete = readEvents(openDataStore(sandbox));
  const deleteVoid = afterDelete.find((event) => event.type === 'event_undone' && event.corrects_event_id === noteEvent?.id);
  check(deleted.length === 0, 'deleteNote suppresses the matching projected note');
  check(Boolean(noteEvent && deleteVoid && afterDelete.some((event) => event.id === noteEvent.id)), 'deleteNote keeps the original event and records a void event');

  withLogWrite(sandbox, (store) => appendEventsWithEffects(store, [buildVoidEvent({
    target_event_id: deleteVoid.id,
    reason_code: 'erroneous_entry',
    evidence_ref: 'owner',
    actor: 'owner',
    occurred_on: new Date().toISOString().slice(0, 10),
    definitions_version: 'v1',
  })]));
  check(getNotes(900001).length === 1 && getNotes(900001)[0].timestamp === timestamp, 'voiding the delete void restores the note');

  const voidOwnedTimestamp = '2030-04-05T12:00:00.000Z';
  let voidOwnedEventId;
  withLogWrite(sandbox, (store) => {
    const [targetId] = appendEventsWithEffects(store, [{
      type: 'note_added',
      occurred_on: '2030-04-05',
      source: 'dashboard',
      application_id: '900004',
      definitions_version: 'v1',
      payload: {},
    }]);
    const voidEvent = buildVoidEvent({
      target_event_id: targetId,
      reason_code: 'not_held',
      evidence_ref: 'owner',
      actor: 'owner',
      occurred_on: '2030-04-05',
      definitions_version: 'v1',
    });
    voidEvent.payload.legacy_effects = [{
      file: 'app-notes.json',
      op: 'json_nested_append',
      key: '900004',
      item: { timestamp: voidOwnedTimestamp, text: 'Interview cancelled by employer.' },
    }];
    [voidOwnedEventId] = appendEventsWithEffects(store, [voidEvent]);
  });
  const beforeVoidOwnedDelete = readEvents(openDataStore(sandbox));
  const voidOwnedHistory = getNotes(900004);
  const afterVoidOwnedDeleteHistory = deleteNote(900004, voidOwnedTimestamp);
  const afterVoidOwnedDelete = readEvents(openDataStore(sandbox));
  const untouchedVoid = afterVoidOwnedDelete.find((event) => event.id === voidOwnedEventId);
  check(JSON.stringify(afterVoidOwnedDeleteHistory) === JSON.stringify(voidOwnedHistory)
    && JSON.stringify(afterVoidOwnedDelete) === JSON.stringify(beforeVoidOwnedDelete)
    && untouchedVoid?.type === 'event_undone'
    && untouchedVoid.payload?.legacy_effects?.[0]?.item?.timestamp === voidOwnedTimestamp,
  'deleting a note owned by a void event is a no-op and leaves the void effect untouched');

  let threw = false;
  try { deleteNote(900001, '1999-01-01T00:00:00.000Z'); } catch { threw = true; }
  check(!threw && getNotes(900001).length === 1, 'deleting a nonexistent timestamp is a no-op');
} finally {
  resetLogWritesCache();
}

console.log(`notes-event-store: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
