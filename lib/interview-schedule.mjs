// E-1 and E-2: scheduling an interview round and recording what happened to it. Pure functions; nothing here
// reads or writes a file. E-1 (Data Architecture Plan, Phase E): moving into an interview stage asks for the
// date and time (required), who runs it, and the channel; the record is dated to the scheduled day and marked
// scheduled, and nothing counts until it is held (D-1). E-2: at slot end plus 30 minutes, and again whenever the
// app is next opened, ask what happened: Held, Rescheduled, Cancelled by employer, Withdrew, No-show, or Call
// dropped. Held asks for the outcome and opens the debrief.
import { isCalendarDate } from './interview-dates.mjs';

export const CHANNELS = Object.freeze(['Phone', 'Video', 'Onsite']);
export const ORGANIZER_TYPES = Object.freeze(['recruiter_ta', 'hiring_manager_panel']);
export const OUTCOME_TYPES = Object.freeze(['held', 'rescheduled', 'cancelled_by_employer', 'withdrew', 'no_show', 'dropped']);
export const RESULT_TYPES = Object.freeze(['advanced', 'not_advancing', 'pending']);

export const OUTCOME_LABELS = Object.freeze({
  held: 'Held',
  rescheduled: 'Rescheduled',
  cancelled_by_employer: 'Cancelled by employer',
  withdrew: 'Withdrew',
  no_show: 'No-show',
  dropped: 'Call dropped',
});

// A conversation is asked about once its slot has been over for this long (D-2: evidence must be AFTER the
// slot, so asking any earlier could only get "not yet").
export const OUTCOME_DUE_AFTER_MS = 30 * 60 * 1000;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The scheduled_for and slot_end fields for an interview_recorded event, from a date, a required time, and an
 * optional duration (minutes, default 60). Same UTC-suffixed convention the rest of D-1 uses for a timestamp
 * built from a date. Throws a TypeError naming the field.
 */
export function buildScheduleFields({ date, time, durationMinutes = 60 } = {}) {
  if (!isCalendarDate(date)) throw new TypeError('date');
  if (typeof time !== 'string' || !TIME_RE.test(time)) throw new TypeError('time');
  const minutes = durationMinutes === undefined || durationMinutes === null ? 60 : Number(durationMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) throw new TypeError('durationMinutes');
  const start = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(start.getTime())) throw new TypeError('time');
  const end = new Date(start.getTime() + minutes * 60000);
  return { scheduled_for: date, slot_end: end.toISOString() };
}

/** True once a slot has been over long enough that "did it happen?" can be asked (D-2). */
export function isOutcomeDue({ slot_end, now = Date.now() } = {}) {
  const slotMs = new Date(slot_end).getTime();
  if (Number.isNaN(slotMs)) return false;
  const nowMs = now instanceof Date ? now.getTime() : now;
  return nowMs - slotMs >= OUTCOME_DUE_AFTER_MS;
}

/** The free-text note an E-1 scheduling event carries: who runs it and how. */
export function scheduleNote({ organizerName, organizerType, channel }) {
  const label = organizerType === 'hiring_manager_panel' ? 'hiring manager/panel' : 'recruiter/TA';
  return `organizer:${String(organizerName ?? '').trim()} (${label}); channel:${channel}`;
}
