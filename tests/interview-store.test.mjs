// D-1 and D-3: the interview line as an event, and reading it back. Invented fixtures only.
import { join } from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';
import { openEventStore, appendEvents, readEvents, EVENT_TYPES } from '../lib/event-store.mjs';
import { buildVoidEvent } from '../lib/void-events.mjs';
import { buildInterviewRecordedEvent, interviewRecordsFromEvents, interviewState, interviewKey, INTERVIEW_EVENT_TYPE } from '../lib/interview-store.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
const throwsOn = (fn, field) => { try { fn(); return false; } catch (error) { return error instanceof TypeError && error.message === field; } };

const base = { application_id: 900001, stage: 'Phone Screen', recorded_on: '2030-03-09' };
const confirmation = { kind: 'owner_confirmation', confirmed_on: '2030-03-09', ref: 'confirmation-900001' };

// Building the event.
const held = buildInterviewRecordedEvent({ ...base, booked_on: '2030-03-01', scheduled_for: '2030-03-08', held_on: '2030-03-08', evidence: [confirmation] });
check(held.type === INTERVIEW_EVENT_TYPE && EVENT_TYPES.includes(held.type), 'the event type exists in the store');
check(held.occurred_on === '2030-03-08' && held.application_id === '900001' && held.definitions_version === 'v1.1' && held.source === 'dashboard', 'a held interview is dated by the day it was held and carries the definitions version');
check(held.payload.booked_on === '2030-03-01' && held.payload.scheduled_for === '2030-03-08' && held.payload.held_on === '2030-03-08' && held.payload.recorded_on === '2030-03-09', 'booked, scheduled, held and recorded stay separate fields');
check(held.evidence_ref === 'confirmation-900001', 'the first evidence reference is on the event');
check(held.payload.slot_end === '2030-03-08T23:59:59Z', 'a missing slot end is the end of the day');
const explicit = buildInterviewRecordedEvent({ ...base, held_on: '2030-03-08', slot_end: '2030-03-08T15:30:00Z', evidence: [] });
check(explicit.payload.slot_end === '2030-03-08T15:30:00Z' && explicit.evidence_ref === undefined, 'a given slot end is kept and no evidence means no reference');
const refs = buildInterviewRecordedEvent({ ...base, held_on: '2030-03-08', evidence: [{ kind: 'owner_confirmation', confirmed_on: '2030-03-09', ref: '' }, { kind: 'owner_confirmation', confirmed_on: '2030-03-09', ref: 7 }, { kind: 'owner_confirmation', confirmed_on: '2030-03-09', ref: 'confirmation-2' }] });
check(refs.evidence_ref === 'confirmation-2', 'the event reference is the first evidence reference that is real text');
const noRefs = buildInterviewRecordedEvent({ ...base, held_on: '2030-03-08', evidence: [{ kind: 'owner_confirmation', confirmed_on: '2030-03-09', ref: 7 }] });
check(noRefs.evidence_ref === undefined, 'an evidence reference that is not text is not used');
const scheduledOnly = buildInterviewRecordedEvent({ ...base, scheduled_for: '2030-03-20' });
check(scheduledOnly.occurred_on === '2030-03-20' && scheduledOnly.payload.held_on === undefined, 'a scheduled interview is dated by the planned day and has no held_on');
check(buildInterviewRecordedEvent({ ...base, held_on: '2030-03-08', note: '  first call  ' }).payload.note === 'first call', 'a note is trimmed and kept');
check(buildInterviewRecordedEvent({ ...base, held_on: '2030-03-08', note: '   ' }).payload.note === undefined, 'a blank note is dropped');
check(buildInterviewRecordedEvent({ ...base, held_on: '2030-03-08', source: 'import' }).source === 'import', 'the source can be import');

// Refusals name the field.
check(throwsOn(() => buildInterviewRecordedEvent({ ...base, application_id: '  ', held_on: '2030-03-08' }), 'application_id'), 'a blank application id is refused');
check(throwsOn(() => buildInterviewRecordedEvent({ ...base, application_id: undefined, held_on: '2030-03-08' }), 'application_id'), 'a missing application id is refused');
check(throwsOn(() => buildInterviewRecordedEvent({ ...base, stage: '', held_on: '2030-03-08' }), 'stage'), 'a blank stage is refused');
check(throwsOn(() => buildInterviewRecordedEvent({ ...base, stage: 7, held_on: '2030-03-08' }), 'stage'), 'a stage that is not text is refused');
check(throwsOn(() => buildInterviewRecordedEvent({ ...base, recorded_on: '2030-02-30', held_on: '2030-03-08' }), 'recorded_on'), 'an impossible recorded date is refused');
check(throwsOn(() => buildInterviewRecordedEvent({ ...base, held_on: '2030-13-01' }), 'held_on'), 'an impossible held date is refused');
check(throwsOn(() => buildInterviewRecordedEvent({ ...base, booked_on: 'soon', held_on: '2030-03-08' }), 'booked_on'), 'a bad booked date is refused');
check(throwsOn(() => buildInterviewRecordedEvent(base), 'scheduled_for'), 'a record with neither a scheduled nor a held date is refused');
check(throwsOn(() => buildInterviewRecordedEvent({ ...base, held_on: '2030-03-08', slot_end: 'noon' }), 'slot_end'), 'a slot end that is not a time is refused');
check(throwsOn(() => buildInterviewRecordedEvent({ ...base, held_on: '2030-03-08', slot_end: 12 }), 'slot_end'), 'a slot end that is not text is refused');
check(throwsOn(() => buildInterviewRecordedEvent({ ...base, held_on: '2030-03-08', evidence: 'yes' }), 'evidence'), 'evidence that is not a list is refused');
check(throwsOn(() => buildInterviewRecordedEvent({ ...base, held_on: '2030-03-08', evidence: [{ kind: 'gut_feeling' }] }), 'evidence'), 'an unknown evidence kind is refused');
check(throwsOn(() => buildInterviewRecordedEvent({ ...base, held_on: '2030-03-08', evidence: [null] }), 'evidence'), 'a null evidence item is refused');
check(throwsOn(() => buildInterviewRecordedEvent({ ...base, held_on: '2030-03-08', source: 'guess' }), 'source'), 'an unknown source is refused');

// Keys.
check(interviewKey(900001, ' Phone   Screen ') === interviewKey('900001', 'phone screen'), 'the key ignores case, spacing and number versus text');
check(interviewKey(900001, 'Phone Screen') !== interviewKey(900002, 'Phone Screen') && interviewKey(900001, 'Phone Screen') !== interviewKey(900001, '1st Interview'), 'the key tells applications and stages apart');

// Reading back through a real store.
const dataDir = makeSandbox('interview-store');
const store = openEventStore(join(dataDir, 'test.db'));
appendEvents(store, [
  scheduledOnly,
  held,
  buildInterviewRecordedEvent({ application_id: 900002, stage: '1st Interview', recorded_on: '2030-04-03', held_on: '2030-04-02', evidence: [] }),
  buildInterviewRecordedEvent({ application_id: 900003, stage: 'Phone Screen', recorded_on: '2030-04-03', scheduled_for: '2030-05-01' }),
]);
let stored = readEvents(store);
check(stored.length === 4 && stored.every(event => event.type === INTERVIEW_EVENT_TYPE && event.payload.stage), 'the store accepts the events and gives the payload back');
let records = interviewRecordsFromEvents(stored);
check(records.size === 3, 'three interview lines are current');
const first = records.get(interviewKey(900001, 'Phone Screen'));
check(first.held_on === '2030-03-08' && first.scheduled_for === '2030-03-08' && first.evidence.length === 1 && first.id === 900001 && first.application_id === '900001', 'the newest recording of a line wins (the held one replaced the scheduled one)');
check(interviewState(first, '2030-06-01').state === 'counted' && interviewState(first, '2030-06-01').held_on === '2030-03-08', 'a held line with an owner confirmation is counted, dated by held_on');
const noEvidence = records.get(interviewKey(900002, '1st Interview'));
check(interviewState(noEvidence, '2030-06-01').state === 'unconfirmed' && interviewState(noEvidence, '2030-06-01').reasons.includes('no_evidence'), 'a held line with no evidence is unconfirmed');
const upcoming = records.get(interviewKey(900003, 'Phone Screen'));
check(interviewState(upcoming, '2030-04-01').state === 'scheduled' && interviewState(upcoming, '2030-06-01').state === 'unconfirmed', 'a scheduled line is scheduled until its day passes, then unconfirmed');

// The order of the events does not matter; the id decides.
check(interviewRecordsFromEvents([...stored].reverse()).get(interviewKey(900001, 'Phone Screen')).held_on === '2030-03-08', 'the newest event id wins whatever the order of the list');

// A later recording replaces an earlier one, and a void takes a recording out (D-10).
appendEvents(store, [buildInterviewRecordedEvent({ ...base, scheduled_for: '2030-03-08', held_on: '2030-03-09', evidence: [{ kind: 'owner_confirmation', confirmed_on: '2030-03-10' }] })]);
stored = readEvents(store);
records = interviewRecordsFromEvents(stored);
check(records.get(interviewKey(900001, 'Phone Screen')).held_on === '2030-03-09' && records.size === 3, 'a re-recording replaces the line and keeps the older event in the log');
const newestId = Math.max(...stored.filter(event => event.application_id === '900001').map(event => event.id));
appendEvents(store, [buildVoidEvent({ target_event_id: newestId, reason_code: 'wrong_record', evidence_ref: 'owner', actor: 'owner', occurred_on: '2030-03-11', definitions_version: 'v1.1' })]);
records = interviewRecordsFromEvents(readEvents(store));
check(records.get(interviewKey(900001, 'Phone Screen')).held_on === '2030-03-08', 'voiding the newest recording brings back the one before it');
const firstIds = readEvents(store).filter(event => event.type === INTERVIEW_EVENT_TYPE && event.application_id === '900001').map(event => event.id);
appendEvents(store, firstIds.map(id => buildVoidEvent({ target_event_id: id, reason_code: 'not_held', evidence_ref: 'owner', actor: 'owner', occurred_on: '2030-03-12', definitions_version: 'v1.1' })));
records = interviewRecordsFromEvents(readEvents(store));
check(!records.has(interviewKey(900001, 'Phone Screen')) && records.size === 2, 'voiding every recording removes the line from the projection');
check(readEvents(store).filter(event => event.type === INTERVIEW_EVENT_TYPE).length === 5, 'the voided events stay in the log');

// Rubbish in, nothing out.
check(interviewRecordsFromEvents([{ id: 1, type: INTERVIEW_EVENT_TYPE, application_id: '900009', payload: {} }, { id: 2, type: 'status_changed', application_id: '900009', payload: { stage: 'Phone Screen' } }, { id: 3, type: INTERVIEW_EVENT_TYPE, payload: { stage: 'Phone Screen' } }]).size === 0, 'events without a stage or an application, and other types, are ignored');
check(interviewRecordsFromEvents([]).size === 0, 'no events, no lines');
const textId = interviewRecordsFromEvents([{ id: 1, type: INTERVIEW_EVENT_TYPE, application_id: 'x-77', payload: { stage: 'Offer', held_on: '2030-03-08', evidence: 'oops' } }]).get(interviewKey('x-77', 'Offer'));
check(textId.id === 'x-77' && Array.isArray(textId.evidence) && textId.evidence.length === 0, 'a non numeric id is kept as text and bad evidence becomes an empty list');

store.db.close();
console.log(`interview-store: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
