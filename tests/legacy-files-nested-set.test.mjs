#!/usr/bin/env node
import { join } from 'node:path';
import { openEventStore, appendEvents } from '../lib/event-store.mjs';
import { appendEventsWithEffects, renderLegacyFile } from '../lib/legacy-files.mjs';
import { buildVoidEvent } from '../lib/void-events.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
function throws(fn) {
  try { fn(); return false; } catch { return true; }
}
let seq = 0;
function liveEvent(effects) {
  seq += 1;
  return {
    type: 'note_added',
    occurred_on: '2030-08-09',
    source: 'cli',
    definitions_version: 'fixture-v1',
    dedupe_key: `fixture-nested-set-${seq}`,
    payload: { legacy_effects: effects },
  };
}

console.log('legacy-files-nested-set.test.mjs');
const root = makeSandbox('legacy-files-nested-set-test');
const store = openEventStore(join(root, 'store.db'));
const file = 'google-sync.json';

function renderedDoc(targetStore = store) {
  return JSON.parse(renderLegacyFile(targetStore, file));
}

// 1. Set into a missing key.
const firstValue = { action: 'log', appId: 900001, from: 'someone@example.test' };
appendEventsWithEffects(store, [
  liveEvent([{ file, op: 'json_nested_set', key: 'handledReplies', subkey: 'msg-900001', value: firstValue }]),
]);
check(JSON.stringify(renderedDoc().handledReplies['msg-900001']) === JSON.stringify(firstValue), 'set into a missing key creates the nested entry');

// 2. A second set on a different subkey keeps both entries.
const secondValue = { action: 'dismiss', appId: null, from: 'sender@example.test' };
appendEventsWithEffects(store, [
  liveEvent([{ file, op: 'json_nested_set', key: 'handledReplies', subkey: 'msg-900002', value: secondValue }]),
]);
check(renderedDoc().handledReplies['msg-900001'].action === 'log'
  && renderedDoc().handledReplies['msg-900002'].action === 'dismiss', 'a second subkey keeps both nested entries');

// 3. A set on an existing subkey replaces the value.
const replacementValue = { action: 'unmatched', appId: null, from: 'someone@example.test' };
appendEventsWithEffects(store, [
  liveEvent([{ file, op: 'json_nested_set', key: 'handledReplies', subkey: 'msg-900001', value: replacementValue }]),
]);
check(renderedDoc().handledReplies['msg-900001'].action === 'unmatched'
  && renderedDoc().handledReplies['msg-900001'].appId === null, 'setting an existing subkey replaces its value');

// 4. Two different keys do not collide.
const senderValue = { date: '2030-08-09', reason: 'not related' };
appendEventsWithEffects(store, [
  liveEvent([{ file, op: 'json_nested_set', key: 'notRelatedSenders', subkey: 'someone@example.test', value: senderValue }]),
]);
check(renderedDoc().handledReplies['msg-900002'].action === 'dismiss'
  && renderedDoc().notRelatedSenders['someone@example.test'].reason === 'not related', 'handledReplies and notRelatedSenders do not collide');

// 5. Delete removes the entry and leaves the others.
appendEventsWithEffects(store, [
  liveEvent([{ file, op: 'json_nested_delete', key: 'handledReplies', subkey: 'msg-900002' }]),
]);
check(!Object.hasOwn(renderedDoc().handledReplies, 'msg-900002')
  && renderedDoc().handledReplies['msg-900001'].action === 'unmatched'
  && renderedDoc().notRelatedSenders['someone@example.test'].reason === 'not related', 'delete removes one nested entry and leaves others');

// 6. Deletes of absent paths are harmless and do not create keys.
appendEventsWithEffects(store, [
  liveEvent([
    { file, op: 'json_nested_delete', key: 'handledReplies', subkey: 'msg-900404' },
    { file, op: 'json_nested_delete', key: 'missingNestedKey', subkey: 'msg-900405' },
  ]),
]);
check(!Object.hasOwn(renderedDoc().handledReplies, 'msg-900404')
  && !Object.hasOwn(renderedDoc(), 'missingNestedKey'), 'absent nested deletes do not throw or create keys');

// 7. Voiding a set removes it on replay; voiding a delete restores it.
const [setEventId] = appendEventsWithEffects(store, [
  liveEvent([{ file, op: 'json_nested_set', key: 'handledReplies', subkey: 'msg-900003', value: { action: 'log', appId: 900003 } }]),
]);
appendEventsWithEffects(store, [
  buildVoidEvent({
    target_event_id: setEventId,
    reason_code: 'erroneous_entry',
    actor: 'agent',
    evidence_ref: 'fixture:legacy-files-nested-set-test',
    occurred_on: '2030-08-10',
    definitions_version: 'fixture-v1',
  }),
]);
check(!Object.hasOwn(renderedDoc().handledReplies, 'msg-900003'), 'voiding a nested set removes that entry on replay');

const [deleteEventId] = appendEventsWithEffects(store, [
  liveEvent([{ file, op: 'json_nested_delete', key: 'handledReplies', subkey: 'msg-900001' }]),
]);
check(!Object.hasOwn(renderedDoc().handledReplies, 'msg-900001'), 'the delete event removes the target before it is voided');
appendEventsWithEffects(store, [
  buildVoidEvent({
    target_event_id: deleteEventId,
    reason_code: 'erroneous_entry',
    actor: 'agent',
    evidence_ref: 'fixture:legacy-files-nested-set-test',
    occurred_on: '2030-08-11',
    definitions_version: 'fixture-v1',
  }),
]);
check(renderedDoc().handledReplies['msg-900001'].action === 'unmatched', 'voiding a nested delete restores the deleted entry');

// 8. Validation rejects malformed nested set and delete effects.
check(throws(() => appendEventsWithEffects(store, [
  liveEvent([{ file, op: 'json_nested_set', subkey: 'msg-900010', value: {} }]),
])), 'json_nested_set with no key throws');
check(throws(() => appendEventsWithEffects(store, [
  liveEvent([{ file, op: 'json_nested_set', key: 'handledReplies', value: {} }]),
])), 'json_nested_set with no subkey throws');
check(throws(() => appendEventsWithEffects(store, [
  liveEvent([{ file, op: 'json_nested_set', key: 'handledReplies', subkey: '', value: {} }]),
])), 'json_nested_set with an empty subkey throws');
check(throws(() => appendEventsWithEffects(store, [
  liveEvent([{ file, op: 'json_nested_set', key: 'handledReplies', subkey: 'msg-900011' }]),
])), 'json_nested_set with no value throws');
check(throws(() => appendEventsWithEffects(store, [
  liveEvent([{ file, op: 'json_nested_set', key: '__proto__', subkey: 'msg-900012', value: {} }]),
])), 'json_nested_set with an unsafe key throws');
check(throws(() => appendEventsWithEffects(store, [
  liveEvent([{ file, op: 'json_nested_set', key: 'handledReplies', subkey: 'constructor', value: {} }]),
])), 'json_nested_set with an unsafe subkey throws');
check(throws(() => appendEventsWithEffects(store, [
  liveEvent([{ file, op: 'json_nested_set', key: 'handledReplies', subkey: 'msg-900013', value: {}, extra: true }]),
])), 'json_nested_set with an extra field throws');
check(throws(() => appendEventsWithEffects(store, [
  liveEvent([{ file, op: 'json_nested_delete', key: 'handledReplies', subkey: 'msg-900014', extra: true }]),
])), 'json_nested_delete with an extra field throws');
check(throws(() => appendEventsWithEffects(store, [
  liveEvent([{ file: 'applications.md', op: 'json_nested_set', key: 'handledReplies', subkey: 'msg-900015', value: {} }]),
])), 'json_nested_set on a non-JSON legacy file throws');

// 9. A historical nested set against an array at document[key] fails during replay.
const replayStore = openEventStore(join(root, 'replay-store.db'));
appendEventsWithEffects(replayStore, [
  liveEvent([{ file, op: 'json_replace', value: { handledReplies: [] } }]),
]);
appendEvents(replayStore, [
  liveEvent([{ file, op: 'json_nested_set', key: 'handledReplies', subkey: 'msg-900016', value: { action: 'log' } }]),
]);
check(throws(() => renderedDoc(replayStore)), 'json_nested_set throws on replay when document[key] is an array');

console.log(`legacy-files-nested-set.test.mjs: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
