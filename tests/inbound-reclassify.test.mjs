#!/usr/bin/env node
// Tests for the inbound reclassification planner.

import { planInboundReclassification } from '../lib/inbound-reclassify.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function note(sentOn, sender, subject, sentiment, body) {
  return `### Reply logged (${sentOn})\n${sender}: ${subject} [${sentiment}]\n\n${body}`;
}
function event(id, appId, key, kind, sentiment, type = 'email_received') {
  return { id, type, application_id: appId, payload: { key, kind, sentiment } };
}
console.log('inbound-reclassify.test.mjs');

const AUTO = 'no-reply@example.test';
const PERSON = 'ada.vance@example.test';
const BOILERPLATE = 'We are excited to receive your application. Next steps: if selected for an interview we will schedule a call.';
const REJECTION = 'We have decided to move forward\r\n      with another candidate for this role.';
const notes = {
  '900001': [
    { timestamp: '2030-03-04T15:00:00.000Z', msgId: 'm900001', text: note('2030-03-04', AUTO, 'Thank you for applying to Zorblax Widgetry', 'positive', BOILERPLATE) },
    { timestamp: '2030-03-05T15:00:00.000Z', msgId: 'm900002', text: note('2030-03-05', PERSON, 'Re: Zorblax Widgetry role', 'positive', 'Can we schedule a call to talk next steps?') },
  ],
  '900002': [
    { timestamp: '2030-03-06T15:00:00.000Z', msgId: 'm900003', text: note('2030-03-06', AUTO, 'Thank you for your interest in Quennox Ratchet Works', 'positive', REJECTION) },
    { timestamp: '2030-03-07T15:00:00.000Z', msgId: 'm900004', text: note('2030-03-07', AUTO, 'Thank you for your interest in Quennox Ratchet Works', 'neutral', 'We will review it.') },
  ],
  '900003': [
    { timestamp: '2030-03-09T15:00:00.000Z', msgId: 'm900006', text: note('2030-03-09', AUTO, 'Thank you for applying to Zorblax Widgetry', 'positive', BOILERPLATE) },
  ],
};
const events = [
  event(900104, '900002', 'msg:m900004', 'human', 'neutral'),
  event(900101, '900001', 'msg:m900001', 'human', 'positive'),
  event(900102, '900001', 'msg:m900002', 'human', 'positive'),
  event(900103, '900002', 'msg:m900003', 'human', 'positive'),
  event(900106, '900003', 'msg:m900006', 'human', 'positive'),
  event(900107, '900004', 'msg:m900099', 'human', 'negative'),
  event(900108, '900005', 'msg:m900001', 'human', 'positive', 'reply_attached'),
  event(900109, '900006', 'msg:m900006', 'receipt', null),
];

const before = JSON.stringify({ events, notes });
const plan = planInboundReclassification({ events, notes });

check(same(plan.counts, { events: 7, noNote: 1, unchanged: 3, changed: 4, byTransition: { 'human/neutral -> receipt': 1, 'human/positive -> receipt': 2, 'human/positive -> human/negative': 1 } }), 'counts match expected values');
check(same(plan.changes.map((c) => [c.event_id, c.application_id, c.from, c.to, c.sentiment_source]), [[900101, '900001', 'human/positive', 'receipt', null], [900103, '900002', 'human/positive', 'human/negative', 'rule'], [900104, '900002', 'human/neutral', 'receipt', null], [900106, '900003', 'human/positive', 'receipt', null]]), 'changes list matches expected sorted output');
check(same(plan.humanReplies, { before: 6, after: 3 }), 'humanReplies before and after counts are correct');
check(same(plan.apps, { reply: { before: 4, after: 3 }, positive: { before: 3, after: 1 } }), 'apps reply and positive counts are correct');
check(plan.counts.events === 7, 'total events count is 7');
check(!plan.changes.some(c => c.event_id === 900108), 'reply_attached event 900108 is ignored');
check(plan.counts.noNote === 1, 'noNote count is 1');
check(!plan.changes.some(c => c.event_id === 900107), 'event 900107 with no note is not in changes');
check(!plan.changes.some(c => c.event_id === 900102), 'event 900102 is unchanged');
check(!plan.changes.some(c => c.event_id === 900109), 'event 900109 is unchanged');
const text = JSON.stringify(plan);
check(!text.includes(AUTO), 'result does not contain AUTO email');
check(!text.includes(PERSON), 'result does not contain PERSON email');
check(!text.includes('Thank you for'), 'result does not contain subject text');
check(!text.includes('We are excited'), 'result does not contain body text');
check(JSON.stringify({ events, notes }) === before, 'inputs are not mutated');
check(same(planInboundReclassification(), { counts: { events: 0, noNote: 0, unchanged: 0, changed: 0, byTransition: {} }, changes: [], humanReplies: { before: 0, after: 0 }, apps: { reply: { before: 0, after: 0 }, positive: { before: 0, after: 0 } } }), 'empty call returns zero counts');
check(same(planInboundReclassification({ events: [event(900101, '900001', 'msg:m900001', 'human', 'positive')], notes: { '900001': 'nope' } }).counts, { events: 1, noNote: 1, unchanged: 1, changed: 0, byTransition: {} }), 'invalid notes entry is skipped');

console.log(`\ninbound-reclassify: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
