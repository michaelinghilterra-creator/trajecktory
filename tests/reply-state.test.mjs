#!/usr/bin/env node
import { join } from 'node:path';
import { EVENT_TYPES, openEventStore } from '../lib/event-store.mjs';
import { appendEventsWithEffects, renderLegacyFile } from '../lib/legacy-files.mjs';
import {
  REPLY_DISMISSED_EVENT_TYPE,
  REPLY_STATE_DEFINITIONS_VERSION,
  SENDER_NOT_RELATED_EVENT_TYPE,
  REPLY_UNMATCHED_EVENT_TYPE,
  buildReplyDismissedEvent,
  buildReplyUnmatchedEvent,
  buildSenderNotRelatedEvent,
  emptyReplyState,
  handledReplyDelete,
  handledReplySet,
  normalizeReplyState,
  notRelatedSenderSet,
  replyAttachedStateEffects,
  splitSync,
  unmatchedReplyDelete,
  unmatchedReplySet,
} from '../lib/reply-state.mjs';
import { buildVoidEvent } from '../lib/void-events.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

console.log('reply-state.test.mjs');
const root = makeSandbox('reply-state-test');
const store = openEventStore(join(root, 'store.db'));
const file = 'reply-state.json';

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function renderedDoc(targetStore = store) {
  return JSON.parse(renderLegacyFile(targetStore, file));
}

function hasEntry(doc, key, subkey) {
  if (!doc || typeof doc !== 'object') return false;
  return Object.hasOwn(doc[key] ?? {}, subkey);
}

function replyAttachedEvent({ msg_id, application_id, action, occurred_on }) {
  return {
    type: 'reply_attached',
    occurred_on,
    source: 'dashboard',
    application_id: String(application_id),
    definitions_version: REPLY_STATE_DEFINITIONS_VERSION,
    payload: {
      msg_id,
      application_id,
      action,
      legacy_effects: replyAttachedStateEffects({ msg_id, application_id, action, occurred_on }),
    },
  };
}

function voidEvent(target_event_id, occurred_on) {
  return buildVoidEvent({
    target_event_id,
    reason_code: 'erroneous_entry',
    actor: 'agent',
    evidence_ref: 'fixture:reply-state-test',
    occurred_on,
    definitions_version: REPLY_STATE_DEFINITIONS_VERSION,
  });
}

const emptyOne = emptyReplyState();
const emptyTwo = emptyReplyState();
check(same(emptyOne, { handledReplies: {}, notRelatedSenders: {}, unmatchedReplies: {} }), 'emptyReplyState has the three empty sets');
check(emptyOne !== emptyTwo
  && emptyOne.handledReplies !== emptyTwo.handledReplies
  && emptyOne.notRelatedSenders !== emptyTwo.notRelatedSenders
  && emptyOne.unmatchedReplies !== emptyTwo.unmatchedReplies, 'emptyReplyState returns distinct objects');

check(same(normalizeReplyState(null), emptyReplyState())
  && same(normalizeReplyState([]), emptyReplyState())
  && same(normalizeReplyState('text'), emptyReplyState()), 'normalizeReplyState returns empty state for non objects');
const validSets = {
  handledReplies: { 'msg-900001': { action: 'dismiss' } },
  notRelatedSenders: null,
  unmatchedReplies: [],
  extra: { keep: false },
};
check(same(normalizeReplyState(validSets), {
  handledReplies: { 'msg-900001': { action: 'dismiss' } },
  notRelatedSenders: {},
  unmatchedReplies: {},
}), 'normalizeReplyState keeps valid sets and drops unknown keys');

const syncDoc = {
  seenMessageIds: ['msg-900002'],
  lastCheckedAt: '2030-08-09T00:00:00.000Z',
  handledReplies: { 'msg-900003': { action: 'attach' } },
  notRelatedSenders: { 'sender@example.test': { date: '2030-08-09' } },
  unmatchedReplies: { 'msg-900004': { subject: 'Hello' } },
  futureBookmark: { cursor: 'abc' },
};
const beforeSplit = JSON.stringify(syncDoc);
const split = splitSync(syncDoc);
check(same(split.cursors, {
  seenMessageIds: ['msg-900002'],
  lastCheckedAt: '2030-08-09T00:00:00.000Z',
  futureBookmark: { cursor: 'abc' },
}) && same(split.state, {
  handledReplies: { 'msg-900003': { action: 'attach' } },
  notRelatedSenders: { 'sender@example.test': { date: '2030-08-09' } },
  unmatchedReplies: { 'msg-900004': { subject: 'Hello' } },
}) && JSON.stringify(syncDoc) === beforeSplit, 'splitSync separates cursors and reply state without modifying input');
check(same(splitSync(null), { cursors: {}, state: emptyReplyState() }), 'splitSync returns empty result for non objects');

check(same(handledReplySet(900005, { action: 'dismiss' }), {
  file,
  op: 'json_nested_set',
  key: 'handledReplies',
  subkey: '900005',
  value: { action: 'dismiss' },
}), 'handledReplySet builds the exact nested set effect');
check(same(handledReplyDelete(900006), {
  file,
  op: 'json_nested_delete',
  key: 'handledReplies',
  subkey: '900006',
}), 'handledReplyDelete builds the exact nested delete effect');
check(same(notRelatedSenderSet(900007, { date: '2030-08-09' }), {
  file,
  op: 'json_nested_set',
  key: 'notRelatedSenders',
  subkey: '900007',
  value: { date: '2030-08-09' },
}), 'notRelatedSenderSet builds the exact nested set effect');
check(same(unmatchedReplySet(900008, { subject: 'Parked' }), {
  file,
  op: 'json_nested_set',
  key: 'unmatchedReplies',
  subkey: '900008',
  value: { subject: 'Parked' },
}), 'unmatchedReplySet builds the exact nested set effect');
check(same(unmatchedReplyDelete(900009), {
  file,
  op: 'json_nested_delete',
  key: 'unmatchedReplies',
  subkey: '900009',
}), 'unmatchedReplyDelete builds the exact nested delete effect');

const attachedEffects = replyAttachedStateEffects({
  msg_id: 'msg-900010',
  application_id: '900010',
  action: 'attach',
  occurred_on: '2030-08-09',
});
check(same(attachedEffects, [
  { file, op: 'json_nested_set', key: 'handledReplies', subkey: 'msg-900010', value: { action: 'attach', appId: 900010, date: '2030-08-09' } },
  { file, op: 'json_nested_delete', key: 'unmatchedReplies', subkey: 'msg-900010' },
]), 'replyAttachedStateEffects records handled state and deletes unmatched state');

const dismissedEvent = buildReplyDismissedEvent({ msg_id: 'msg-900011', occurred_on: '2030-08-10' });
check(dismissedEvent.type === REPLY_DISMISSED_EVENT_TYPE
  && dismissedEvent.source === 'dashboard'
  && dismissedEvent.occurred_on === '2030-08-10'
  && dismissedEvent.definitions_version === 'v1'
  && dismissedEvent.payload.msg_id === 'msg-900011'
  && same(dismissedEvent.payload.legacy_effects, [
    { file, op: 'json_nested_set', key: 'handledReplies', subkey: 'msg-900011', value: { action: 'dismiss', appId: null, date: '2030-08-10' } },
    { file, op: 'json_nested_delete', key: 'unmatchedReplies', subkey: 'msg-900011' },
  ]), 'buildReplyDismissedEvent has the expected metadata and effects');

const notRelatedNoAddress = buildSenderNotRelatedEvent({ msg_id: 'msg-900012', occurred_on: '2030-08-11' });
check(notRelatedNoAddress.type === SENDER_NOT_RELATED_EVENT_TYPE
  && notRelatedNoAddress.source === 'dashboard'
  && notRelatedNoAddress.occurred_on === '2030-08-11'
  && notRelatedNoAddress.definitions_version === 'v1'
  && notRelatedNoAddress.payload.msg_id === 'msg-900012'
  && same(notRelatedNoAddress.payload.legacy_effects, [
    { file, op: 'json_nested_set', key: 'handledReplies', subkey: 'msg-900012', value: { action: 'not-related', appId: null, date: '2030-08-11' } },
    { file, op: 'json_nested_delete', key: 'unmatchedReplies', subkey: 'msg-900012' },
  ]), 'buildSenderNotRelatedEvent without address has two effects');

const notRelatedWithAddress = buildSenderNotRelatedEvent({
  msg_id: 'msg-900013',
  address: 'sender@example.test',
  occurred_on: '2030-08-12',
});
check(notRelatedWithAddress.type === SENDER_NOT_RELATED_EVENT_TYPE
  && notRelatedWithAddress.source === 'dashboard'
  && notRelatedWithAddress.occurred_on === '2030-08-12'
  && notRelatedWithAddress.definitions_version === 'v1'
  && notRelatedWithAddress.payload.msg_id === 'msg-900013'
  && same(notRelatedWithAddress.payload.legacy_effects, [
    { file, op: 'json_nested_set', key: 'handledReplies', subkey: 'msg-900013', value: { action: 'not-related', appId: null, date: '2030-08-12' } },
    { file, op: 'json_nested_delete', key: 'unmatchedReplies', subkey: 'msg-900013' },
    { file, op: 'json_nested_set', key: 'notRelatedSenders', subkey: 'sender@example.test', value: { date: '2030-08-12' } },
  ]), 'buildSenderNotRelatedEvent with address has sender effect last');

const unmatchedEntry = { subject: 'Reply', from: 'someone@example.test' };
const unmatchedEvent = buildReplyUnmatchedEvent({ msg_id: 'msg-900014', entry: unmatchedEntry, occurred_on: '2030-08-13' });
check(unmatchedEvent.type === REPLY_UNMATCHED_EVENT_TYPE
  && unmatchedEvent.source === 'dashboard'
  && unmatchedEvent.occurred_on === '2030-08-13'
  && unmatchedEvent.definitions_version === 'v1'
  && unmatchedEvent.payload.msg_id === 'msg-900014'
  && same(unmatchedEvent.payload.legacy_effects, [
    { file, op: 'json_nested_set', key: 'unmatchedReplies', subkey: 'msg-900014', value: unmatchedEntry },
    { file, op: 'json_nested_set', key: 'handledReplies', subkey: 'msg-900014', value: { action: 'unmatched', appId: null, date: '2030-08-13' } },
  ]), 'buildReplyUnmatchedEvent has the expected metadata and effects');

appendEventsWithEffects(store, [
  buildReplyDismissedEvent({ msg_id: 'msg-900015', occurred_on: '2030-08-14' }),
]);
check(same(renderedDoc().handledReplies['msg-900015'], { action: 'dismiss', appId: null, date: '2030-08-14' })
  && !hasEntry(renderedDoc(), 'unmatchedReplies', 'msg-900015'), 'dismiss render sets handled record and removes unmatched record');

appendEventsWithEffects(store, [
  buildReplyUnmatchedEvent({
    msg_id: 'msg-900016',
    entry: { subject: 'Unmatched', from: 'someone@example.test' },
    occurred_on: '2030-08-15',
  }),
  replyAttachedEvent({
    msg_id: 'msg-900016',
    application_id: '900016',
    action: 'attach',
    occurred_on: '2030-08-16',
  }),
]);
check(!hasEntry(renderedDoc(), 'unmatchedReplies', 'msg-900016')
  && renderedDoc().handledReplies['msg-900016'].action === 'attach', 'attach moves a message out of unmatched replies');

appendEventsWithEffects(store, [
  buildSenderNotRelatedEvent({
    msg_id: 'msg-900017',
    address: 'notrelated@example.test',
    occurred_on: '2030-08-17',
  }),
]);
check(same(renderedDoc().handledReplies['msg-900017'], { action: 'not-related', appId: null, date: '2030-08-17' })
  && same(renderedDoc().notRelatedSenders['notrelated@example.test'], { date: '2030-08-17' }), 'not related render writes handled reply and sender state');

const voidStore = openEventStore(join(root, 'void-store.db'));
const [unmatchedBeforeNotRelatedId] = appendEventsWithEffects(voidStore, [
  buildReplyUnmatchedEvent({
    msg_id: 'msg-900018',
    entry: { subject: 'Before not related', from: 'void@example.test' },
    occurred_on: '2030-08-18',
  }),
]);
const [notRelatedEventId] = appendEventsWithEffects(voidStore, [
  buildSenderNotRelatedEvent({
    msg_id: 'msg-900018',
    address: 'void@example.test',
    occurred_on: '2030-08-19',
  }),
]);
check(!hasEntry(JSON.parse(renderLegacyFile(voidStore, file)), 'unmatchedReplies', 'msg-900018')
  && same(JSON.parse(renderLegacyFile(voidStore, file)).handledReplies['msg-900018'], { action: 'not-related', appId: null, date: '2030-08-19' })
  && same(JSON.parse(renderLegacyFile(voidStore, file)).notRelatedSenders['void@example.test'], { date: '2030-08-19' }), 'not related event applies all three effects before voiding');
appendEventsWithEffects(voidStore, [
  voidEvent(notRelatedEventId, '2030-08-20'),
]);
const afterNotRelatedVoid = JSON.parse(renderLegacyFile(voidStore, file));
check(same(afterNotRelatedVoid.unmatchedReplies['msg-900018'], { subject: 'Before not related', from: 'void@example.test' })
  && same(afterNotRelatedVoid.handledReplies['msg-900018'], { action: 'unmatched', appId: null, date: '2030-08-18' })
  && !hasEntry(afterNotRelatedVoid, 'notRelatedSenders', 'void@example.test'), 'voiding not related restores prior unmatched state and removes sender state');
appendEventsWithEffects(voidStore, [
  voidEvent(unmatchedBeforeNotRelatedId, '2030-08-21'),
]);
const afterUnmatchedVoid = JSON.parse(renderLegacyFile(voidStore, file));
check(!hasEntry(afterUnmatchedVoid, 'unmatchedReplies', 'msg-900018')
  && !hasEntry(afterUnmatchedVoid, 'handledReplies', 'msg-900018'), 'voiding unmatched removes parked entry and handled record');

check(EVENT_TYPES.includes(REPLY_DISMISSED_EVENT_TYPE)
  && EVENT_TYPES.includes(SENDER_NOT_RELATED_EVENT_TYPE)
  && EVENT_TYPES.includes(REPLY_UNMATCHED_EVENT_TYPE), 'reply event types are registered in EVENT_TYPES');

console.log(`reply-state.test.mjs: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
