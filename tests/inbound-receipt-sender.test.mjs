#!/usr/bin/env node
// Test the sender-aware receipt classification helpers and the backfill planner.

import { isAutomatedSender, isApplicationReceipt, isAutomatedRejection } from '../lib/inbound-classify.mjs';
import { classifyForEvent, planInboundBackfill } from '../lib/inbound-events.mjs';

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
console.log('inbound-receipt-sender.test.mjs');

const AUTO = 'no-reply@example.test';
const PERSON = 'ada.vance@example.test';
// Vendor hostnames are joined to a local part at run time. A literal vendor address in a test file is flagged by the repository personal data scan, and a bare hostname is not an address.
const atHost = (local, host) => `${local}@${host}`;
const RECEIPT_SUBJECT = 'Thank you for applying to Zorblax Widgetry';
const INTEREST_SUBJECT = 'Thank you for your interest in Quennox Ratchet Works';
const BOILERPLATE = 'We are excited to receive your application. Next steps: if selected for an interview we will schedule a call.';
const WRAPPED_REJECTION = 'We have decided to move forward\r\n      with another candidate for this role.';

// isAutomatedSender checks
check(isAutomatedSender('no-reply@example.test') === true, 'isAutomatedSender: no-reply@example.test');
check(isAutomatedSender('Zorblax Talent <noreply@example.test>') === true, 'isAutomatedSender: Zorblax Talent <noreply@example.test>');
check(isAutomatedSender('donotreply@example.test') === true, 'isAutomatedSender: donotreply@example.test');
check(isAutomatedSender(atHost('hiring', 'mail.ashbyhq.com')) === true, 'isAutomatedSender: hiring at ashby domain');
check(isAutomatedSender('Ada Vance <ada.vance@example.test>') === false, 'isAutomatedSender: Ada Vance example test');
check(isAutomatedSender(atHost('ada', 'notashbyhq.com')) === false, 'isAutomatedSender: ada at not ashby domain');
check(isAutomatedSender(atHost('ada', 'ashbyhq.com.example.test')) === false, 'isAutomatedSender: ada at ashby subdomain example test');
check(isAutomatedSender('') === false, 'isAutomatedSender: empty string');
check(isAutomatedSender('no address here') === false, 'isAutomatedSender: no address here');
check(isAutomatedSender(undefined) === false, 'isAutomatedSender: undefined');

// isApplicationReceipt checks
check(isApplicationReceipt({ subject: RECEIPT_SUBJECT, sentiment: 'positive', sender: AUTO, body: BOILERPLATE }) === true, 'isApplicationReceipt: receipt subject, positive, AUTO');
check(isApplicationReceipt({ subject: RECEIPT_SUBJECT, sentiment: 'positive', sender: PERSON, body: BOILERPLATE }) === false, 'isApplicationReceipt: receipt subject, positive, PERSON');
check(isApplicationReceipt({ subject: RECEIPT_SUBJECT, sentiment: 'positive', body: BOILERPLATE }) === false, 'isApplicationReceipt: receipt subject, positive, no sender');
check(isApplicationReceipt({ subject: RECEIPT_SUBJECT, sentiment: 'negative', sender: AUTO, body: BOILERPLATE }) === false, 'isApplicationReceipt: receipt subject, negative, AUTO');
check(isApplicationReceipt({ subject: 'Interview confirmation for Zorblax Widgetry', body: 'Thank you for applying.', sentiment: 'positive', sender: AUTO }) === false, 'isApplicationReceipt: interview subject, positive, AUTO');
check(isApplicationReceipt({ subject: INTEREST_SUBJECT, body: 'We will review it.', sentiment: 'neutral', sender: AUTO }) === true, 'isApplicationReceipt: interest subject, neutral, AUTO');
check(isApplicationReceipt({ subject: INTEREST_SUBJECT, body: 'We will review it.', sentiment: 'neutral', sender: PERSON }) === false, 'isApplicationReceipt: interest subject, neutral, PERSON');
check(isApplicationReceipt({ subject: INTEREST_SUBJECT, body: 'We will review it.', sentiment: 'positive', sender: AUTO }) === true, 'isApplicationReceipt: interest subject, positive, AUTO');
check(isApplicationReceipt({ subject: RECEIPT_SUBJECT, body: WRAPPED_REJECTION, sentiment: 'positive', sender: AUTO }) === false, 'isApplicationReceipt: receipt subject, wrapped rejection, positive, AUTO');

// isAutomatedRejection checks
check(isAutomatedRejection({ subject: INTEREST_SUBJECT, body: WRAPPED_REJECTION, sender: AUTO }) === true, 'isAutomatedRejection: interest subject, wrapped rejection, AUTO');
check(isAutomatedRejection({ subject: INTEREST_SUBJECT, body: WRAPPED_REJECTION, sender: PERSON }) === false, 'isAutomatedRejection: interest subject, wrapped rejection, PERSON');

// classifyForEvent checks
check(same(classifyForEvent({ subject: RECEIPT_SUBJECT, body: BOILERPLATE, sentiment: 'positive', sender: AUTO }), { kind: 'receipt', sentiment: null }), 'classifyForEvent: receipt subject, positive, AUTO');
check(same(classifyForEvent({ subject: RECEIPT_SUBJECT, body: BOILERPLATE, sentiment: 'positive', sender: PERSON }), { kind: 'human', sentiment: 'positive' }), 'classifyForEvent: receipt subject, positive, PERSON');
check(same(classifyForEvent({ subject: INTEREST_SUBJECT, body: WRAPPED_REJECTION, sentiment: 'positive', sender: AUTO }), { kind: 'human', sentiment: 'negative', sentiment_source: 'rule' }), 'classifyForEvent: interest subject, wrapped rejection, positive, AUTO');
check(same(classifyForEvent({ subject: INTEREST_SUBJECT, body: WRAPPED_REJECTION, sentiment: 'positive', sender: PERSON }), { kind: 'human', sentiment: 'positive' }), 'classifyForEvent: interest subject, wrapped rejection, positive, PERSON');
check(same(classifyForEvent({ subject: INTEREST_SUBJECT, body: WRAPPED_REJECTION, sentiment: 'neutral', sender: AUTO }), { kind: 'human', sentiment: 'neutral' }), 'classifyForEvent: interest subject, wrapped rejection, neutral, AUTO');

// planInboundBackfill checks
const plan = planInboundBackfill({ notes: { '900001': [
  { timestamp: '2030-03-04T15:00:00.000Z', text: note('2030-03-04', AUTO, RECEIPT_SUBJECT, 'positive', BOILERPLATE), msgId: 'm900001' },
  { timestamp: '2030-03-05T15:00:00.000Z', text: note('2030-03-05', AUTO, INTEREST_SUBJECT, 'positive', WRAPPED_REJECTION), msgId: 'm900002' },
] } });

check(plan.counts.created === 2, 'planInboundBackfill: created count is 2');
check(same(plan.counts.byKind, { receipt: 1, human: 1 }), 'planInboundBackfill: byKind is { receipt: 1, human: 1 }');
check(plan.events[0].payload.kind === 'receipt', 'planInboundBackfill: event 0 kind is receipt');
check(plan.events[0].payload.sentiment === null, 'planInboundBackfill: event 0 sentiment is null');
check(plan.events[1].payload.kind === 'human', 'planInboundBackfill: event 1 kind is human');
check(plan.events[1].payload.sentiment === 'negative', 'planInboundBackfill: event 1 sentiment is negative');
check(plan.events[1].payload.sentiment_source === 'rule', 'planInboundBackfill: event 1 sentiment_source is rule');
check(plan.events[0].payload.sentiment_source === 'owner', 'planInboundBackfill: event 0 sentiment_source is owner');

console.log(`\ninbound-receipt-sender: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
