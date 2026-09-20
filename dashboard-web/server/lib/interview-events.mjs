// D-1 and D-3 storage for the dashboard: interview lines live in the event store as
// `interview_recorded` events (lib/interview-store.mjs). With the event store switched off there is
// nowhere to keep them, so reads return nothing and the Work Search log keeps its old rules for
// every line; writes refuse instead of pretending.
import { DATA_DIR } from '../config.mjs';
import { appendEvents, readEvents } from '../../../lib/event-store.mjs';
import { logWritesEnabled, withLogRead, withLogWrite } from '../../../lib/log-writes.mjs';
import { INTERVIEW_EVENT_TYPE, buildInterviewRecordedEvent, interviewRecordsFromEvents } from '../../../lib/interview-store.mjs';

/** The current interview lines, a Map from interviewKey to record. Empty when the store is off. */
export function readInterviewRecords(dataDir = DATA_DIR) {
  if (!logWritesEnabled(dataDir)) return new Map();
  return withLogRead(dataDir, (store) => interviewRecordsFromEvents([
    ...readEvents(store, { type: INTERVIEW_EVENT_TYPE }),
    ...readEvents(store, { type: 'event_undone' }),
  ]));
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
