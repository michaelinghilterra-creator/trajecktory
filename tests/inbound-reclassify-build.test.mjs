#!/usr/bin/env node
// Test the reclassification planner and event builder with a small fixture.

import { planInboundReclassification, buildReclassificationEvents } from '../lib/inbound-reclassify.mjs';
import { INBOUND_CLASSIFIER_VERSION } from '../lib/inbound-events.mjs';

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
function throws(fn) {
  try { fn(); return false; } catch { return true; }
}
console.log('inbound-reclassify-build.test.mjs');

const AUTO = 'no-reply@example.test';
const notes = {
  '900001': [
    { timestamp: '2030-03-04T15:00:00.000Z', msgId: 'm900001', text: note('2030-03-04', AUTO, 'Thank you for applying to Zorblax Widgetry', 'positive', 'We are excited. Next steps: interview.') },
    { timestamp: '2030-03-05T15:00:00.000Z', msgId: 'm900002', text: note('2030-03-05', AUTO, 'Update regarding your application to Quennox Ratchet Works', 'neutral', 'We have filled this role with another qualified applicant.') },
  ],
};
const events = [
  { id: 900101, type: 'email_received', application_id: '900001', payload: { key: 'msg:m900001', msg_id: 'm900001', note_timestamp: '2030-03-04T15:00:00.000Z', sent_on: '2030-03-04', kind: 'human', sentiment: 'positive', sentiment_source: 'owner', attach_event_id: 900050 } },
  { id: 900102, type: 'email_received', application_id: '900001', payload: { key: 'msg:m900002', msg_id: 'm900002', note_timestamp: '2030-03-05T15:00:00.000Z', sent_on: '2030-03-05', kind: 'human', sentiment: 'neutral', sentiment_source: 'owner', attach_event_id: null } },
];

const before = JSON.stringify({ events, notes });
const plan = planInboundReclassification({ events, notes });
const built = buildReclassificationEvents({ events, plan, occurredOn: '2030-04-01', runId: 'run900001' });

check(built.length === 4, 'built has four events');
check(same(built.map((event) => event.type), ['event_undone', 'email_received', 'event_undone', 'email_received']), 'built types are correct');

check(built[0].corrects_event_id === 900101, 'first void corrects 900101');
check(built[0].occurred_on === '2030-04-01', 'first void occurred_on is 2030-04-01');
check(built[0].source === 'cli', 'first void source is cli');
check(built[0].evidence_ref === 'reclassify:msg:m900001', 'first void evidence_ref is correct');
check(same(built[0].payload, { reason_code: 'superseded', actor: 'bulk_script', script: 'reclassify-email-received.mjs', run_id: 'run900001' }), 'first void payload is correct');

check(built[1].application_id === '900001', 'first replacement application_id is 900001');
check(built[1].source === 'import', 'first replacement source is import');
check(built[1].occurred_on === '2030-03-04', 'first replacement occurred_on is 2030-03-04');
check(built[1].dedupe_key === 'reclassify:' + INBOUND_CLASSIFIER_VERSION + ':msg:m900001', 'first replacement dedupe_key is correct');
check(same(built[1].payload, { key: 'msg:m900001', msg_id: 'm900001', note_timestamp: '2030-03-04T15:00:00.000Z', sent_on: '2030-03-04', kind: 'receipt', sentiment: null, sentiment_source: 'owner', classifier_version: INBOUND_CLASSIFIER_VERSION, attach_event_id: 900050 }), 'first replacement payload is correct');

check(built[2].corrects_event_id === 900102, 'second void corrects 900102');
check(built[2].evidence_ref === 'reclassify:msg:m900002', 'second void evidence_ref is correct');

check(same(built[3].payload, { key: 'msg:m900002', msg_id: 'm900002', note_timestamp: '2030-03-05T15:00:00.000Z', sent_on: '2030-03-05', kind: 'human', sentiment: 'negative', sentiment_source: 'rule', classifier_version: INBOUND_CLASSIFIER_VERSION, attach_event_id: null }), 'second replacement payload is correct');
check(built[3].dedupe_key === 'reclassify:' + INBOUND_CLASSIFIER_VERSION + ':msg:m900002', 'second replacement dedupe_key is correct');

check(same(plan.changes.map((c) => [c.to_kind, c.to_sentiment, c.sentiment_source]), [['receipt', null, null], ['human', 'negative', 'rule']]), 'plan changes carry correct fields');

check(JSON.stringify({ events, notes }) === before, 'inputs are not mutated');

check(same(buildReclassificationEvents({ events, plan: { changes: [] }, occurredOn: '2030-04-01', runId: 'run900001' }), []), 'empty plan builds nothing');
check(same(buildReclassificationEvents({ events, occurredOn: '2030-04-01', runId: 'run900001' }), []), 'missing plan builds nothing');

check(throws(() => buildReclassificationEvents({ events: [], plan, occurredOn: '2030-04-01', runId: 'run900001' })), 'event not in plan throws');
check(throws(() => buildReclassificationEvents({ events, plan, occurredOn: 'bad', runId: 'run900001' })), 'bad date throws');
check(throws(() => buildReclassificationEvents({ events, plan, occurredOn: '2030-04-01' })), 'missing run id throws');

console.log(`\ninbound-reclassify-build: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
