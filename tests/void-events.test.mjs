import { buildVoidEvent, voidedIds, visibleEvents, historyEvents, countByType } from '../lib/void-events.mjs';

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('✅ ' + msg); }
  else { failed++; console.log('❌ ' + msg); }
}

// Fixtures
const definitionsVersion = '1.0.0';
const occurredOn = '2030-01-15';
const evidenceRef = 'evidence-ref-900001';

// Test buildVoidEvent with owner actor
try {
  const event = buildVoidEvent({
    target_event_id: 900001,
    reason_code: 'not_held',
    evidence_ref: evidenceRef,
    actor: 'owner',
    occurred_on: occurredOn,
    definitions_version: definitionsVersion
  });

  const allowedKeys = new Set(['type', 'occurred_on', 'source', 'evidence_ref', 'corrects_event_id', 'payload', 'definitions_version']);
  const eventKeys = new Set(Object.keys(event));
  check(event.type === 'event_undone', 'type is event_undone');
  check(event.source === 'dashboard', 'source is dashboard for owner');
  check(event.corrects_event_id === 900001, 'corrects_event_id equals target_event_id');
  check(event.payload.reason_code === 'not_held', 'payload.reason_code is correct');
  check(event.payload.actor === 'owner', 'payload.actor is owner');
  check(!('script' in event.payload), 'payload does not contain script for owner');
  check(!('run_id' in event.payload), 'payload does not contain run_id for owner');
  check(eventKeys.size === allowedKeys.size && [...eventKeys].every(k => allowedKeys.has(k)), 'top-level keys are exactly allowed keys');
} catch (e) {
  check(false, 'buildVoidEvent with owner actor throws');
}

// Test buildVoidEvent with bulk_script actor
try {
  const event = buildVoidEvent({
    target_event_id: 900002,
    reason_code: 'duplicate',
    evidence_ref: evidenceRef,
    actor: 'bulk_script',
    script: 'example-repair',
    run_id: 'run-900001',
    occurred_on: occurredOn,
    definitions_version: definitionsVersion
  });

  check(event.source === 'cli', 'source is cli for bulk_script');
  check(event.payload.script === 'example-repair', 'payload.script is present');
  check(event.payload.run_id === 'run-900001', 'payload.run_id is present');
} catch (e) {
  check(false, 'buildVoidEvent with bulk_script actor throws');
}

// Test missing run_id throws
try {
  buildVoidEvent({
    target_event_id: 900003,
    reason_code: 'erroneous_entry',
    evidence_ref: evidenceRef,
    actor: 'bulk_script',
    script: 'example-repair',
    occurred_on: occurredOn,
    definitions_version: definitionsVersion
  });
  check(false, 'buildVoidEvent without run_id throws');
} catch (e) {
  check(e.message === 'run_id', 'buildVoidEvent without run_id throws TypeError for run_id');
}

// Test invalid target_event_id
try {
  buildVoidEvent({
    target_event_id: 0,
    reason_code: 'not_held',
    evidence_ref: evidenceRef,
    actor: 'owner',
    occurred_on: occurredOn,
    definitions_version: definitionsVersion
  });
  check(false, 'target_event_id 0 throws');
} catch (e) {
  check(e.message === 'target_event_id', 'target_event_id 0 throws TypeError');
}

// Test invalid reason_code
try {
  buildVoidEvent({
    target_event_id: 900004,
    reason_code: 'because',
    evidence_ref: evidenceRef,
    actor: 'owner',
    occurred_on: occurredOn,
    definitions_version: definitionsVersion
  });
  check(false, 'reason_code invalid throws');
} catch (e) {
  check(e.message === 'reason_code', 'reason_code invalid throws TypeError');
}

// Test invalid actor
try {
  buildVoidEvent({
    target_event_id: 900005,
    reason_code: 'not_held',
    evidence_ref: evidenceRef,
    actor: 'nobody',
    occurred_on: occurredOn,
    definitions_version: definitionsVersion
  });
  check(false, 'actor invalid throws');
} catch (e) {
  check(e.message === 'actor', 'actor invalid throws TypeError');
}

// Test invalid occurred_on
try {
  buildVoidEvent({
    target_event_id: 900006,
    reason_code: 'not_held',
    evidence_ref: evidenceRef,
    actor: 'owner',
    occurred_on: '2030-02-30',
    definitions_version: definitionsVersion
  });
  check(false, 'occurred_on invalid throws');
} catch (e) {
  check(e.message === 'occurred_on', 'occurred_on invalid throws TypeError');
}

// Test empty definitions_version
try {
  buildVoidEvent({
    target_event_id: 900007,
    reason_code: 'not_held',
    evidence_ref: evidenceRef,
    actor: 'owner',
    occurred_on: occurredOn,
    definitions_version: ''
  });
  check(false, 'empty definitions_version throws');
} catch (e) {
  check(e.message === 'definitions_version', 'empty definitions_version throws TypeError');
}

// Test empty evidence_ref
try {
  buildVoidEvent({
    target_event_id: 900008,
    reason_code: 'not_held',
    evidence_ref: '',
    actor: 'owner',
    occurred_on: occurredOn,
    definitions_version: definitionsVersion
  });
  check(false, 'empty evidence_ref throws');
} catch (e) {
  check(e.message === 'evidence_ref', 'empty evidence_ref throws TypeError');
}

// Test voidedIds
const events1 = [
  { id: 900001, type: 'status_changed', corrects_event_id: null },
  { id: 900002, type: 'status_changed', corrects_event_id: null },
  { id: 900003, type: 'event_undone', corrects_event_id: 900001 }
];
const voided1 = voidedIds(events1);
check(voided1.has(900001) && voided1.size === 1, 'voidedIds with one void returns target id');

const events2 = [
  { id: 900001, type: 'status_changed', corrects_event_id: null },
  { id: 900002, type: 'status_changed', corrects_event_id: null },
  { id: 900003, type: 'event_undone', corrects_event_id: 900001 },
  { id: 900004, type: 'event_undone', corrects_event_id: 900003 }
];
const voided2 = voidedIds(events2);
check(voided2.size === 0, 'voidedIds with double void restores original');

const events3 = [
  { id: 900001, type: 'status_changed', corrects_event_id: null },
  { id: 900003, type: 'event_undone', corrects_event_id: 999999 }
];
const voided3 = voidedIds(events3);
check(voided3.size === 0, 'void pointing at missing id is ignored');

// Test visibleEvents and countByType
const events4 = [
  { id: 900001, type: 'status_changed', corrects_event_id: null },
  { id: 900002, type: 'event_undone', corrects_event_id: 900001 }
];
const visible4 = visibleEvents(events4);
const counts4 = countByType(events4);
const history4 = historyEvents(events4);

check(visible4.length === 0, 'visibleEvents excludes voided event');
check((counts4.status_changed ?? 0) === 0, 'countByType excludes voided event');
check(history4.length === 2, 'historyEvents includes all events');
check(history4[0].id === 900001, 'historyEvents includes voided event');

try {
  buildVoidEvent({
    target_event_id: 900010,
    reason_code: 'not_held',
    evidence_ref: evidenceRef,
    actor: 'owner',
    occurred_on: 12345,
    definitions_version: definitionsVersion
  });
  check(false, 'buildVoidEvent with non-string occurred_on throws');
} catch (e) {
  check(e.message === 'occurred_on', 'buildVoidEvent with non-string occurred_on throws TypeError');
}

try {
  buildVoidEvent({
    target_event_id: 900011,
    reason_code: 'not_held',
    evidence_ref: evidenceRef,
    actor: 'owner',
    occurred_on: 'not-a-date',
    definitions_version: definitionsVersion
  });
  check(false, 'buildVoidEvent with invalid format occurred_on throws');
} catch (e) {
  check(e.message === 'occurred_on', 'buildVoidEvent with invalid format occurred_on throws TypeError');
}

try {
  buildVoidEvent({
    target_event_id: 900018,
    reason_code: 'not_held',
    evidence_ref: evidenceRef,
    actor: 'owner',
    occurred_on: '0000-01-15',
    definitions_version: definitionsVersion
  });
  check(false, 'buildVoidEvent with year 0 throws');
} catch (e) {
  check(e.message === 'occurred_on', 'buildVoidEvent with year 0 throws TypeError');
}

try {
  buildVoidEvent({
    target_event_id: 900019,
    reason_code: 'not_held',
    evidence_ref: evidenceRef,
    actor: 'owner',
    occurred_on: '2030-00-15',
    definitions_version: definitionsVersion
  });
  check(false, 'buildVoidEvent with month 0 throws');
} catch (e) {
  check(e.message === 'occurred_on', 'buildVoidEvent with month 0 throws TypeError');
}

try {
  buildVoidEvent({
    target_event_id: 900020,
    reason_code: 'not_held',
    evidence_ref: evidenceRef,
    actor: 'owner',
    occurred_on: '2030-13-15',
    definitions_version: definitionsVersion
  });
  check(false, 'buildVoidEvent with month 13 throws');
} catch (e) {
  check(e.message === 'occurred_on', 'buildVoidEvent with month 13 throws TypeError');
}

try {
  buildVoidEvent({
    target_event_id: 900021,
    reason_code: 'not_held',
    evidence_ref: evidenceRef,
    actor: 'owner',
    occurred_on: '2030-01-00',
    definitions_version: definitionsVersion
  });
  check(false, 'buildVoidEvent with day 0 throws');
} catch (e) {
  check(e.message === 'occurred_on', 'buildVoidEvent with day 0 throws TypeError');
}

try {
  buildVoidEvent({
    target_event_id: 900022,
    reason_code: 'not_held',
    evidence_ref: evidenceRef,
    actor: 'owner',
    occurred_on: '2030-01-32',
    definitions_version: definitionsVersion
  });
  check(false, 'buildVoidEvent with day 32 throws');
} catch (e) {
  check(e.message === 'occurred_on', 'buildVoidEvent with day 32 throws TypeError');
}

const events5 = [
  { id: 900014, type: 'status_changed', corrects_event_id: null },
  { id: 900015, type: 'status_changed', corrects_event_id: null }
];
const _visible5 = visibleEvents(events5);
const counts5 = countByType(events5);
check((counts5.status_changed ?? 0) === 2, 'countByType correctly counts same-type events');

try {
  buildVoidEvent({
    target_event_id: 900016,
    reason_code: 'duplicate',
    evidence_ref: evidenceRef,
    actor: 'bulk_script',
    script: '',
    run_id: 'run-900002',
    occurred_on: occurredOn,
    definitions_version: definitionsVersion
  });
  check(false, 'buildVoidEvent with empty script throws');
} catch (e) {
  check(e.message === 'script', 'buildVoidEvent with empty script throws TypeError');
}

try {
  buildVoidEvent({
    target_event_id: 900017,
    reason_code: 'duplicate',
    evidence_ref: evidenceRef,
    actor: 'bulk_script',
    script: 12345,
    run_id: 'run-900002',
    occurred_on: occurredOn,
    definitions_version: definitionsVersion
  });
  check(false, 'buildVoidEvent with non-string script throws');
} catch (e) {
  check(e.message === 'script', 'buildVoidEvent with non-string script throws TypeError');
}

// Summary
console.log(`void-events: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
