#!/usr/bin/env node
import {
  INBOUND_CLASSIFIER_VERSION,
  classifyForEvent,
  replyKey,
  respondedKey,
  buildEmailReceivedEvent,
  inboundRepliesFromEvents,
  linkedInboundEventIds,
  planInboundBackfill,
} from '../lib/inbound-events.mjs';
import { buildVoidEvent } from '../lib/void-events.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function throws(fn) {
  try { fn(); return false; } catch { return true; }
}
function note(sentOn, sender, subject, sentiment, body) {
  return `### Reply logged (${sentOn})\n${sender}: ${subject} [${sentiment}]\n\n${body}`;
}

console.log('inbound-events.test.mjs');

const fixtures = [
  [{ subject: 'Re: Zorblax Widgetry role', body: 'Thanks, can we schedule a conversation next week?', sentiment: 'positive' }, { kind: 'human', sentiment: 'positive' }],
  [{ subject: 'Quennox Ratchet Works update', body: 'Unfortunately we will not be moving forward.', sentiment: 'negative' }, { kind: 'human', sentiment: 'negative' }],
  [{ subject: 'Re: question', body: 'Thanks for your note. I will review and come back soon.', sentiment: 'neutral' }, { kind: 'human', sentiment: 'neutral' }],
  [{ subject: 'Application confirmation', body: 'Thank you for applying to Zorblax Widgetry. We received your application.', sentiment: 'neutral' }, { kind: 'receipt', sentiment: null }],
  [{ subject: 'Out of office', body: 'I am out of the office and will return next week.', sentiment: 'neutral' }, { kind: 'auto_reply', sentiment: null }],
  [{ subject: 'Departure notice', body: 'I am no longer with Quennox Ratchet Works. Please contact recruiting.', sentiment: 'neutral' }, { kind: 'departure', sentiment: null }],
  [{ subject: 'Accepted LinkedIn connection request', body: 'Example Person accepted LinkedIn connection request.', sentiment: 'positive' }, { kind: 'acceptance', sentiment: null }],
  [{ subject: 'Re: next steps', body: 'Let us find time to talk about the role.', sentiment: 'mystery' }, { kind: 'human', sentiment: 'neutral' }],
  [{ subject: 'Thank you for your application', body: 'This confirms that your application was submitted.', sentiment: 'neutral' }, { kind: 'receipt', sentiment: null }],
];
for (const [input, expected] of fixtures) {
  check(same(classifyForEvent(input), expected), `classifies ${input.subject}`);
}
check(INBOUND_CLASSIFIER_VERSION === '2026-10-05', 'classifier change must bump the version together with these fixtures');

check(replyKey({ msg_id: 'm900001', application_id: 900001, note_timestamp: 'later' }) === 'msg:m900001', 'replyKey uses the message id when present');
check(replyKey({ application_id: 900001, note_timestamp: '2030-03-04T15:00:00.000Z' }) === 'note:900001:2030-03-04T15:00:00.000Z', 'replyKey falls back to the note identity');
check(respondedKey({ application_id: 900002, date: '2030-03-05' }) === 'responded:900002:2030-03-05', 'respondedKey is stable');

const built = buildEmailReceivedEvent({
  application_id: 900001,
  msg_id: 'm900001',
  note_timestamp: '2030-03-04T15:00:00.000Z',
  sent_on: '2030-03-04',
  kind: 'human',
  sentiment: 'positive',
});
check(built.type === 'email_received'
  && built.occurred_on === '2030-03-04'
  && built.source === 'dashboard'
  && built.application_id === '900001'
  && built.definitions_version === 'v1'
  && !Object.hasOwn(built, 'dedupe_key')
  && same(built.payload, {
    key: 'msg:m900001',
    msg_id: 'm900001',
    note_timestamp: '2030-03-04T15:00:00.000Z',
    sent_on: '2030-03-04',
    kind: 'human',
    sentiment: 'positive',
    sentiment_source: 'owner',
    classifier_version: '2026-10-05',
    attach_event_id: null,
  }), 'buildEmailReceivedEvent writes the dashboard shape');
check(buildEmailReceivedEvent({ application_id: 900001, sent_on: '2030-03-04', kind: 'receipt', dedupe_key: 'backfill:one' }).dedupe_key === 'backfill:one', 'dedupe_key is optional and preserved');
check(throws(() => buildEmailReceivedEvent({ sent_on: '2030-03-04', kind: 'human', sentiment: 'neutral' })), 'missing application_id throws');
check(throws(() => buildEmailReceivedEvent({ application_id: 900001, sent_on: 'bad', kind: 'human', sentiment: 'neutral' })), 'bad sent_on throws');
check(throws(() => buildEmailReceivedEvent({ application_id: 900001, sent_on: '2030-03-04', kind: 'nonsense', sentiment: 'neutral' })), 'bad kind throws');
check(throws(() => buildEmailReceivedEvent({ application_id: 900001, sent_on: '2030-03-04', kind: 'human' })), 'human without sentiment throws');
check(throws(() => buildEmailReceivedEvent({ application_id: 900001, sent_on: '2030-03-04', kind: 'receipt', sentiment: 'neutral' })), 'non human with sentiment throws');
check(throws(() => buildEmailReceivedEvent({ application_id: 900001, sent_on: '2030-03-04', kind: 'human', sentiment: 'neutral', sentiment_source: 'guess' })), 'bad sentiment_source throws');
check(throws(() => buildEmailReceivedEvent({ application_id: 900001, sent_on: '2030-03-04', kind: 'human', sentiment: 'neutral', source: 'mailbox' })), 'bad source throws');

const humanEvent = { id: 1, ...buildEmailReceivedEvent({ application_id: 900001, msg_id: 'm900010', sent_on: '2030-03-04', kind: 'human', sentiment: 'positive' }) };
const receiptEvent = { id: 2, ...buildEmailReceivedEvent({ application_id: 900001, msg_id: 'm900011', sent_on: '2030-03-04', kind: 'receipt' }) };
const undoneHuman = { id: 3, ...buildEmailReceivedEvent({ application_id: 900002, msg_id: 'm900012', sent_on: '2030-03-05', kind: 'human', sentiment: 'negative' }) };
const voidEvent = {
  id: 4,
  ...buildVoidEvent({
    target_event_id: undoneHuman.id,
    reason_code: 'undone_by_owner',
    evidence_ref: 'owner',
    actor: 'owner',
    occurred_on: '2030-03-06',
    definitions_version: 'v1',
  }),
};
const inbound = inboundRepliesFromEvents([humanEvent, receiptEvent, undoneHuman, voidEvent, { id: 5, type: 'status_changed' }]);
check(same(inbound.replies, { 900001: [{ sent_on: '2030-03-04', sentiment: 'positive' }] }), 'inboundRepliesFromEvents groups visible human replies');
check(inbound.keys.has('msg:m900010') && inbound.keys.has('msg:m900011') && !inbound.keys.has('msg:m900012'), 'inboundRepliesFromEvents records visible keys and drops undone keys');

const linked = linkedInboundEventIds([
  { id: 11, ...buildEmailReceivedEvent({ application_id: 900001, sent_on: '2030-03-04', kind: 'human', sentiment: 'neutral', attach_event_id: 7 }) },
  { id: 12, ...buildEmailReceivedEvent({ application_id: 900001, sent_on: '2030-03-04', kind: 'human', sentiment: 'neutral', attach_event_id: 8 }) },
  { id: 13, ...buildEmailReceivedEvent({ application_id: 900001, sent_on: '2030-03-04', kind: 'receipt', attach_event_id: 7 }) },
  { id: 14, ...buildVoidEvent({ target_event_id: 13, reason_code: 'undone_by_owner', evidence_ref: 'owner', actor: 'owner', occurred_on: '2030-03-05', definitions_version: 'v1' }) },
], 7);
check(same(linked, [11]), 'linkedInboundEventIds returns visible events for one leader');

const notes = {
  900001: [
    { timestamp: '2030-03-04T15:00:00.000Z', msgId: 'm900021', text: note('2030-03-04', 'person@example.test', 'Next steps', 'positive', 'Could we schedule a call?') },
    { timestamp: '2030-03-05T15:00:00.000Z', text: note('2030-03-05', 'person@example.test', 'Update', 'negative', 'Unfortunately we are moving forward with another candidate.') },
    { timestamp: '2030-03-06T15:00:00.000Z', msgId: 'm900022', text: note('2030-03-06', 'person@example.test', 'Application received', 'neutral', 'We received your application.') },
    { timestamp: '2030-03-07T15:00:00.000Z', text: '### Debrief: Phone Screen\nInvented note.' },
  ],
};
const plan = planInboundBackfill({
  notes,
  respondedRows: [{ application_id: 900002, date: '2030-03-08' }],
  replyAttachedByMsgId: new Map([['m900021', 44]]),
});
check(plan.counts.notes === 4 && plan.counts.replyNotes === 3 && plan.counts.responded === 1 && plan.counts.created === 4, 'planInboundBackfill counts notes and created events');
check(plan.counts.linkedToAttach === 1 && same(plan.counts.byKind, { human: 3, receipt: 1 }), 'planInboundBackfill counts kinds and attach links');
check(plan.events.every(event => event.source === 'import' && event.dedupe_key.startsWith('backfill:')), 'planInboundBackfill writes import dedupe keys');
check(plan.events.find(event => event.payload.msg_id === 'm900021')?.payload.attach_event_id === 44, 'planInboundBackfill links notes by message id');
check(plan.events.filter(event => event.payload.sentiment_source === 'owner').length === 3
  && plan.events.find(event => event.payload.key === 'responded:900002:2030-03-08')?.payload.sentiment_source === 'rule', 'planInboundBackfill records sentiment sources');
const skip = planInboundBackfill({ notes, respondedRows: [{ application_id: 900002, date: '2030-03-08' }], existingKeys: new Set(plan.events.map(event => event.payload.key)) });
check(skip.events.length === 0 && skip.counts.alreadyRecorded === 4, 'planInboundBackfill skips keys already recorded');

console.log(`inbound-events: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
