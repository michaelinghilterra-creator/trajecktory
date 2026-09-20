/**
 * D-1 and D-3: how an interview line is stored in the event log, and how it is read back.
 *
 * An interview line is one `interview_recorded` event per recording. The facts live in the payload
 * (no schema change): stage, booked_on, scheduled_for, held_on, recorded_on, slot_end and evidence[]
 * (Definitions v1.1). The newest recording for an application and stage wins, so a rescheduled or
 * later confirmed interview is a new event and the older ones stay in the history. A voided event
 * (D-10) is skipped. Pure functions; nothing here reads or writes a file or a database.
 */

import { interviewDateFields, isCalendarDate } from './interview-dates.mjs';
import { EVIDENCE_KINDS } from './held-evidence.mjs';
import { visibleEvents } from './void-events.mjs';
import { assessInterviewRecord } from './interview-records.mjs';

export const INTERVIEW_EVENT_TYPE = 'interview_recorded';
export const INTERVIEW_DEFINITIONS_VERSION = 'v1.1';
const SOURCES = ['dashboard', 'cli', 'import'];

/** The key an application and stage share, whatever the capitalization or spacing of the stage. */
export function interviewKey(applicationId, stage) {
  return `${applicationId}|${String(stage ?? '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

function validateEvidence(evidence) {
  if (!Array.isArray(evidence)) throw new TypeError('evidence');
  for (const item of evidence) {
    if (item === null || typeof item !== 'object' || !EVIDENCE_KINDS.includes(item.kind)) throw new TypeError('evidence');
  }
}

/**
 * Build the event that records an interview line. At least one of scheduled_for and held_on is
 * required. Throws a TypeError naming the field when something is wrong.
 */
export function buildInterviewRecordedEvent({ application_id, stage, booked_on, scheduled_for, held_on, recorded_on, slot_end, evidence = [], note, source = 'dashboard' }) {
  const id = String(application_id ?? '').trim();
  if (id === '') throw new TypeError('application_id');
  if (typeof stage !== 'string' || stage.trim() === '') throw new TypeError('stage');
  if (!isCalendarDate(recorded_on)) throw new TypeError('recorded_on');
  if (!SOURCES.includes(source)) throw new TypeError('source');
  const dates = interviewDateFields({ booked_on, scheduled_for, held_on, recorded_on });
  if (dates.scheduled_for === undefined && dates.held_on === undefined) throw new TypeError('scheduled_for');
  if (slot_end !== undefined && slot_end !== null && (typeof slot_end !== 'string' || Number.isNaN(new Date(slot_end).getTime()))) throw new TypeError('slot_end');
  validateEvidence(evidence);

  const payload = { stage: stage.trim(), ...dates, evidence };
  // No slot end given: the day is treated as ending at 23:59:59 UTC, so only later evidence counts.
  payload.slot_end = slot_end || `${dates.held_on ?? dates.scheduled_for}T23:59:59Z`;
  if (typeof note === 'string' && note.trim() !== '') payload.note = note.trim();
  const first = evidence.find((item) => typeof item.ref === 'string' && item.ref !== '');
  return {
    type: INTERVIEW_EVENT_TYPE,
    occurred_on: dates.held_on ?? dates.scheduled_for,
    application_id: id,
    source,
    ...(first ? { evidence_ref: first.ref } : {}),
    payload,
    definitions_version: INTERVIEW_DEFINITIONS_VERSION,
  };
}

/**
 * The current record of each interview line: a Map from interviewKey to
 * { id, application_id, stage, event_id, booked_on, scheduled_for, held_on, slot_end, evidence }.
 * `events` are stored events (with ids), in any order.
 */
export function interviewRecordsFromEvents(events) {
  const records = new Map();
  const sorted = visibleEvents(events).filter((event) => event.type === INTERVIEW_EVENT_TYPE).sort((a, b) => a.id - b.id);
  for (const event of sorted) {
    const p = event.payload ?? {};
    if (typeof p.stage !== 'string' || event.application_id === undefined || event.application_id === null) continue;
    const numeric = Number(event.application_id);
    records.set(interviewKey(event.application_id, p.stage), {
      id: Number.isInteger(numeric) ? numeric : event.application_id,
      application_id: String(event.application_id),
      stage: p.stage,
      event_id: event.id,
      booked_on: p.booked_on,
      scheduled_for: p.scheduled_for,
      held_on: p.held_on,
      slot_end: p.slot_end,
      evidence: Array.isArray(p.evidence) ? p.evidence : [],
    });
  }
  return records;
}

/** counted, unconfirmed or scheduled, with reasons (see lib/interview-records.mjs). */
export function interviewState(record, today) {
  return assessInterviewRecord(record, { today });
}
