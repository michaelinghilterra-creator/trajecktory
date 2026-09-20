// E-6: undo for changes made through the dashboard. Pure functions over event lists; nothing here reads or writes a
// file. A change the person makes is one "action": a leading event and the events written with it (a status change
// that also sets the apply date or, moving into an interview stage (E-1), also schedules it; a reply that also
// flips the status). An action can be undone only while it is the newest change on its application, so the files
// go back to exactly what they were; the undo itself is a void event (D-10), so the original stays in history.
import { voidedIds } from './void-events.mjs';
import { INTERVIEW_EVENT_TYPE } from './interview-store.mjs';

export const REPLY_EVENT_TYPE = 'reply_attached';
export const LEADER_TYPES = Object.freeze(['status_changed', 'interview_recorded', REPLY_EVENT_TYPE]);

/** One event describing a reply that was attached to an application. Payload only; the note itself lives in app-notes.json. */
export function buildReplyAttachedEvent({ application_id, msg_id, note_timestamp, action, sentiment, status_flip, occurred_on, definitions_version = 'v1' } = {}) {
  return {
    type: REPLY_EVENT_TYPE,
    occurred_on,
    source: 'dashboard',
    application_id: String(application_id),
    definitions_version,
    payload: { msg_id, note_timestamp, action, sentiment: sentiment || null, status_flip: status_flip || null },
  };
}

function isMember(leader, e) {
  if (String(e.application_id) !== String(leader.application_id) || e.source !== 'dashboard') return false;
  // E-1: moving into an interview stage writes the status change and, in the same request, a scheduling
  // record. That record never has application_submitted alongside it (only an Applied status change does), so
  // the two conditions never both match the same follower event.
  if (leader.type === 'status_changed') {
    return (e.type === 'application_submitted' || e.type === INTERVIEW_EVENT_TYPE) && e.id === leader.id + 1;
  }
  if (leader.type === REPLY_EVENT_TYPE) {
    const flip = leader.payload && leader.payload.status_flip;
    return Boolean(flip) && e.type === 'status_changed' && e.payload && e.payload.to === flip && e.id > leader.id && e.id <= leader.id + 3;
  }
  return false;
}

/**
 * The actions the person made through the dashboard, newest first, each with the events it wrote and whether it can
 * be undone now. events: every event (voids included), any order.
 */
export function undoableActions(events, { limit = 20 } = {}) {
  const sorted = events.slice().sort((a, b) => a.id - b.id);
  const voided = voidedIds(sorted);
  const visible = sorted.filter((e) => e.type !== 'event_undone' && !voided.has(e.id) && e.source === 'dashboard');
  const claimed = new Set();
  const actions = [];
  for (const e of visible) {
    if (!LEADER_TYPES.includes(e.type) || claimed.has(e.id)) continue;
    const members = visible.filter((m) => m.id !== e.id && isMember(e, m));
    members.forEach((m) => claimed.add(m.id));
    actions.push({ leader: e, members });
  }
  const result = actions
    .filter((a) => !claimed.has(a.leader.id))
    .map((a) => {
      const owned = new Set([a.leader.id, ...a.members.map((m) => m.id)]);
      const newer = visible.find((e) => e.id > a.leader.id && !owned.has(e.id) && String(e.application_id) === String(a.leader.application_id) && !claimed.has(e.id));
      return {
        event_id: a.leader.id,
        type: a.leader.type,
        application_id: a.leader.application_id,
        occurred_on: a.leader.occurred_on,
        payload: a.leader.payload,
        member_ids: a.members.map((m) => m.id),
        undoable: !newer,
        blocked_reason: newer ? 'newer_change' : null,
      };
    })
    .sort((x, y) => y.event_id - x.event_id);
  return result.slice(0, limit);
}
