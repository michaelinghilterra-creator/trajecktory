import { validateOverride, applyOverride, validateOverrides } from '../lib/override-evidence.mjs';

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('✅ ' + msg); }
  else { failed++; console.log('❌ ' + msg); }
}

const resolve = (kind, id) => {
  return (kind === 'message_id' && id === 'msg-900001') ||
         (kind === 'calendar_event_id' && id === 'cal-900002');
};

const event = { id: 900001, application_id: 900101, stage: '1st Interview', date: '2030-03-08' };
const initialState = { events: [event], overrides: [] };

// Test validateOverride
let validation;

validation = validateOverride({ event_id: 900001, stage: 'Phone Screen', evidence_ref: { kind: 'message_id', id: 'msg-999999' } }, resolve);
check(validation.ok === false && validation.reason === 'unresolved_evidence', 'override with dead reference rejected with unresolved_evidence');

validation = validateOverride({ event_id: 900001, stage: 'Phone Screen' }, resolve);
check(validation.ok === false && validation.reason === 'no_evidence', 'missing evidence_ref gives no_evidence');

validation = validateOverride({ event_id: 900001, stage: 'Phone Screen', evidence_ref: { kind: 'carrier_pigeon', id: 'x' } }, resolve);
check(validation.ok === false && validation.reason === 'bad_evidence_kind', 'kind carrier_pigeon gives bad_evidence_kind');

validation = validateOverride({ event_id: 900001, stage: 'Phone Screen', evidence_ref: { kind: 'message_id', id: '' } }, resolve);
check(validation.ok === false && validation.reason === 'empty_evidence_id', 'empty id gives empty_evidence_id');

validation = validateOverride({ event_id: 900001 }, resolve);
check(validation.ok === false && validation.reason === 'no_change', 'no stage and no date gives no_change');

validation = validateOverride({ event_id: 900001, date: '2030-02-30', evidence_ref: { kind: 'message_id', id: 'msg-900001' } }, resolve);
check(validation.ok === false && validation.reason === 'bad_date', 'date 2030-02-30 gives bad_date');

validation = validateOverride({ stage: 'Phone Screen', evidence_ref: { kind: 'message_id', id: 'msg-900001' } }, resolve);
check(validation.ok === false && validation.reason === 'no_event_id', 'missing event_id gives no_event_id');

validation = validateOverride({ event_id: 900001, stage: 'Phone Screen', evidence_ref: { kind: 'message_id', id: 'msg-900001' } }, resolve);
check(validation.ok === true, 'valid override passes validation');

const goodRef = { kind: 'message_id', id: 'msg-900001' };
for (const badDate of ['2030-13-01', '2030-03-32', '2030-03-08T00:00:00', 20300308]) {
  validation = validateOverride({ event_id: 900001, date: badDate, evidence_ref: goodRef }, resolve);
  check(validation.ok === false && validation.reason === 'bad_date', 'date ' + String(badDate) + ' gives bad_date');
}
for (const badRef of [null, 'msg-900001']) {
  validation = validateOverride({ event_id: 900001, stage: 'Phone Screen', evidence_ref: badRef }, resolve);
  check(validation.ok === false && validation.reason === 'no_evidence', 'evidence_ref ' + String(badRef) + ' gives no_evidence');
}

// Test applyOverride
let newState = applyOverride(initialState, { event_id: 900001, stage: 'Phone Screen', evidence_ref: { kind: 'message_id', id: 'msg-900001' } }, resolve);
check(newState.events.length === 1, 'new state events length is 1');
check(newState.events[0].stage === 'Phone Screen', 'event stage updated to Phone Screen');
check(newState.events[0].date === '2030-03-08', 'event date unchanged');
check(newState.overrides.length === 1, 'overrides length is 1');
check(initialState.events[0].stage === '1st Interview', 'original event stage unchanged');
check(initialState.overrides.length === 0, 'original overrides unchanged');

newState = applyOverride(initialState, { event_id: 900001, date: '2030-04-10', evidence_ref: { kind: 'message_id', id: 'msg-900001' } }, resolve);
check(newState.events[0].stage === '1st Interview', 'stage unchanged when only date changed');
check(newState.events[0].date === '2030-04-10', 'date updated');

try {
  applyOverride(initialState, { event_id: 900001, stage: 'Phone Screen', evidence_ref: { kind: 'message_id', id: 'msg-999999' } }, resolve);
  check(false, 'applyOverride with dead reference throws');
} catch (e) {
  check(e.message === 'override rejected: unresolved_evidence', 'applyOverride with dead reference throws correct error');
  check(initialState.events[0].stage === '1st Interview', 'input state unchanged after failed applyOverride');
}

try {
  applyOverride(initialState, { event_id: 999999, stage: 'Phone Screen', evidence_ref: { kind: 'message_id', id: 'msg-900001' } }, resolve);
  check(false, 'applyOverride with unknown event_id throws');
} catch (e) {
  check(e.message === 'override rejected: unknown_event', 'applyOverride with unknown event_id throws correct error');
}

// Test validateOverrides
const overrides = [
  { event_id: 900001, stage: 'Phone Screen', evidence_ref: { kind: 'message_id', id: 'msg-900001' } },
  { event_id: 900001, stage: 'Phone Screen', evidence_ref: { kind: 'message_id', id: 'msg-999999' } },
  { event_id: 900001, evidence_ref: { kind: 'message_id', id: 'msg-900001' } }
];

const result = validateOverrides(overrides, resolve);
check(result.accepted.length === 1 && result.accepted[0] === overrides[0], 'validateOverrides accepted holds only the first override');
check(result.rejected.length === 2, 'validateOverrides rejected length is 2');
check(result.rejected[0].index === 1 && result.rejected[0].reason === 'unresolved_evidence', 'rejected[0] has correct index and reason');
check(result.rejected[1].index === 2 && result.rejected[1].reason === 'no_change', 'rejected[1] has correct index and reason');

console.log(`override-evidence: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
