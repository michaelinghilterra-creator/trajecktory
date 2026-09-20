// E-6: the undo rules on invented event lists. No files, no store.
import { undoableActions, buildReplyAttachedEvent, REPLY_EVENT_TYPE } from '../lib/event-undo.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

let nextId = 1;
const ev = (over) => ({ id: nextId++, type: 'status_changed', source: 'dashboard', application_id: '900001', occurred_on: '2030-03-10', payload: {}, ...over });
const undone = (target) => ev({ type: 'event_undone', corrects_event_id: target, payload: { reason_code: 'undone_by_owner', actor: 'owner' } });

// One status change to Applied writes the status event and the apply date event together.
const applied = ev({ payload: { to: 'Applied' } });
const applyDate = ev({ type: 'application_submitted' });
let list = undoableActions([applied, applyDate]);
check(list.length === 1 && list[0].event_id === applied.id && list[0].member_ids.join() === String(applyDate.id) && list[0].undoable, 'a status change and its apply date are one action, undoable');

// A newer change on the same application blocks the older one.
const rejected = ev({ payload: { to: 'Rejected' } });
list = undoableActions([applied, applyDate, rejected]);
check(list.length === 2 && list[0].event_id === rejected.id && list[0].undoable && list[1].event_id === applied.id && !list[1].undoable && list[1].blocked_reason === 'newer_change', 'an older change is blocked while a newer one exists');

// Another application does not block.
const other = ev({ application_id: '900002', payload: { to: 'Applied' } });
list = undoableActions([applied, applyDate, other]);
check(list.find((a) => a.event_id === applied.id).undoable && list.find((a) => a.event_id === other.id).undoable, 'a change on another application does not block');

// Voided events disappear, and the older one becomes undoable again.
const voidRej = undone(rejected.id);
list = undoableActions([applied, applyDate, rejected, voidRej]);
check(list.length === 1 && list[0].event_id === applied.id && list[0].undoable, 'an undone change leaves the list and unblocks the older one');

// A reply that also flipped the status is one action with its status event.
const reply = { id: nextId++, ...buildReplyAttachedEvent({ application_id: 900003, msg_id: 'm900001', note_timestamp: '2030-03-10T10:00:00.000Z', action: 'rejected', status_flip: 'Rejected', occurred_on: '2030-03-10' }) };
const flip = ev({ application_id: '900003', payload: { to: 'Rejected' } });
list = undoableActions([reply, flip]);
check(reply.type === REPLY_EVENT_TYPE && list.length === 1 && list[0].event_id === reply.id && list[0].member_ids.join() === String(flip.id) && list[0].undoable, 'a reply and the status it flipped are one action');

// A reply that only logs has no members.
const logOnly = { id: nextId++, ...buildReplyAttachedEvent({ application_id: 900004, msg_id: 'm900002', note_timestamp: 't', action: 'log', occurred_on: '2030-03-10' }) };
list = undoableActions([logOnly]);
check(list.length === 1 && list[0].member_ids.length === 0, 'a log only reply is a single event');

// E-1: a status change into an interview stage that also schedules it is one action with the schedule event.
const scheduled = ev({ application_id: '900007', payload: { from: 'Applied', to: 'Phone Screen' } });
const recorded = ev({ application_id: '900007', type: 'interview_recorded', payload: { stage: 'Phone Screen', scheduled_for: '2030-04-01' } });
list = undoableActions([scheduled, recorded]);
check(list.length === 1 && list[0].event_id === scheduled.id && list[0].member_ids.join() === String(recorded.id) && list[0].undoable, 'a status change into an interview stage and its schedule are one action');

// Not made through the dashboard: never listed.
const imported = ev({ source: 'import', application_id: '900005' });
const script = ev({ source: 'cli', application_id: '900005' });
check(undoableActions([imported, script]).length === 0, 'imported and script events are not listed');

// Interview recordings are actions too.
const rec = ev({ type: 'interview_recorded', application_id: '900006' });
check(undoableActions([rec]).length === 1, 'an interview recording is listed');

// Limit, newest first.
const many = Array.from({ length: 30 }, (_, i) => ev({ application_id: String(910000 + i), payload: { to: 'Applied' } }));
list = undoableActions(many, { limit: 5 });
check(list.length === 5 && list[0].event_id > list[4].event_id, 'the list is newest first and limited');

let threw = false;
try { buildReplyAttachedEvent({}); } catch { threw = true; }
check(!threw, 'building a reply event never throws');

console.log(`event-undo: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
