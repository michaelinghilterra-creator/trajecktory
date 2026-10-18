// D-1 and D-3 storage for the dashboard: interview lines live in the event store as
// `interview_recorded` events (lib/interview-store.mjs). With the event store switched off there is
// nowhere to keep them, so reads return nothing and the Work Search log keeps its old rules for
// every line; writes refuse instead of pretending.
import { DATA_DIR } from '../config.mjs';
import { appendEvents, readEvents } from '../../../lib/event-store.mjs';
import { logWritesEnabled, withLogRead, withLogWrite } from '../../../lib/log-writes.mjs';
import { INTERVIEW_EVENT_TYPE, buildInterviewRecordedEvent, interviewRecordsFromEvents, interviewKey } from '../../../lib/interview-store.mjs';
import { isCalendarDate } from '../../../lib/interview-dates.mjs';
import { localToday } from '../../../lib/local-date.mjs';

/** The current interview lines, a Map from interviewKey to record. Empty when the store is off. */
export function readInterviewRecords(dataDir = DATA_DIR) {
  if (!logWritesEnabled(dataDir)) return new Map();
  return withLogRead(dataDir, (store) => interviewRecordsFromEvents([
    ...readEvents(store, { type: INTERVIEW_EVENT_TYPE }),
    ...readEvents(store, { type: 'event_undone' }),
  ]));
}

/**
 * Filing a debrief is the person saying the interview happened, so it also records the interview as held.
 * Without this the same fact had to be entered three times: in the chat, in Today's "Did it happen?" card and
 * again under the Activity Tracker's "It was held" button. The held date is the explicit `heldOn`, else the
 * booked slot's day when that has already passed, else today. An interview that is already held is left alone.
 * Returns { held: true, heldOn } when it recorded one, or { held: false, reason } when it did nothing. It never
 * throws: the debrief itself is already saved and must not fail because of this.
 */
export function markHeldFromDebrief({ appId, stage, heldOn } = {}, dataDir = DATA_DIR) {
  try {
    const id = Number(appId);
    if (!Number.isInteger(id) || typeof stage !== 'string' || !stage) return { held: false, reason: 'bad_input' };
    if (!logWritesEnabled(dataDir)) return { held: false, reason: 'store_off' };
    const today = localToday();
    const record = readInterviewRecords(dataDir).get(interviewKey(id, stage));
    if (record && record.held_on) return { held: false, reason: 'already_held' };
    let date = isCalendarDate(heldOn) ? heldOn : null;
    if (!date && record && isCalendarDate(record.scheduled_for) && record.scheduled_for <= today) date = record.scheduled_for;
    if (!date) date = today;
    if (date > today) date = today;
    recordInterview({
      application_id: id,
      stage,
      booked_on: record ? record.booked_on : undefined,
      recorded_on: today,
      scheduled_for: record ? record.scheduled_for : undefined,
      held_on: date,
      evidence: [{ kind: 'owner_confirmation', confirmed_on: today, ref: `owner-confirmation:${id}:${stage}:${date}` }],
      note: 'held_from_debrief',
      source: 'dashboard',
    }, dataDir);
    return { held: true, heldOn: date };
  } catch (error) {
    return { held: false, reason: error.message };
  }
}

/** Record an interview line. Returns the stored event ids. Throws when the event store is off. */
export function recordInterview(fields, dataDir = DATA_DIR) {
  if (!logWritesEnabled(dataDir)) {
    const error = new Error('The event store is off, so interview evidence cannot be kept yet.');
    error.code = 'STORE_OFF';
    throw error;
  }
  const event = buildInterviewRecordedEvent(fields);
  return withLogWrite(dataDir, (store) => appendEvents(store, [event]));
}
