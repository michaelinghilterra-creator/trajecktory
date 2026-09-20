/**
 * E-5: rules for a status change that the person makes by hand. Pure functions; nothing here reads or
 * writes a file. Messages have the shape lib/employer-status.mjs uses:
 * { message_id, direction, subject, body, sent_on }.
 *
 *   Rejected      needs an employer message that rejects, or an explicit "said no by phone" with a date.
 *   Passed        is planned, not live; a withdrawal is offered as Discarded for now.
 *   No Response   is never automatic and only a prompt: it is offered when no employer message exists
 *                 since the application, and when one does the message is shown first.
 */

import { classifyStatusSignal } from './employer-status.mjs';

function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function sinceApplication(messages, appliedOn) {
  const list = Array.isArray(messages) ? messages : [];
  return isRealDate(appliedOn) ? list.filter((m) => m.sent_on >= appliedOn) : list;
}

function bySentOn(a, b) {
  if (a.sent_on !== b.sent_on) return a.sent_on < b.sent_on ? -1 : 1;
  return a.message_id < b.message_id ? -1 : 1;
}

function summarize(message) {
  return { message_id: message.message_id, sent_on: message.sent_on, subject: message.subject ?? '' };
}

/** Employer messages since the application that a person wrote (a rejection or another human reply). */
function employerMessagesSince(messages, appliedOn) {
  return sinceApplication(messages, appliedOn)
    .filter((m) => ['rejection', 'human_reply'].includes(classifyStatusSignal(m)))
    .sort(bySentOn);
}

/**
 * The No Response prompt. offer is true only when no human employer message exists since the application;
 * otherwise show_first lists those messages so the person reads them first.
 */
export function noResponsePrompt({ messages = [], applied_on = null } = {}) {
  const found = employerMessagesSince(messages, applied_on);
  return { offer: found.length === 0, show_first: found.map(summarize) };
}

/**
 * Decide whether a status change is allowed. Returns
 *   { allowed, reason, dated_on, evidence_ref, show_first, suggest }
 * reason is null when allowed. Options: messages, applied_on (YYYY-MM-DD), phone_rejection_on
 * (YYYY-MM-DD, the day the employer said no by phone), withdrawn (the person is the one leaving),
 * by_hand (the person chose the change; required for No Response), today (YYYY-MM-DD).
 */
export function evaluateStatusChange({ to, messages = [], applied_on = null, phone_rejection_on = null, withdrawn = false, by_hand = false, today = null } = {}) {
  const verdict = (allowed, reason, extra = {}) => ({
    allowed, reason, dated_on: null, evidence_ref: null, show_first: [], suggest: null, ...extra,
  });

  if (to === 'Passed') return verdict(false, 'passed_not_live', { suggest: 'Discarded' });

  if (to === 'Rejected') {
    if (withdrawn) return verdict(false, 'withdrawal_is_not_rejection', { suggest: 'Discarded' });
    const rejection = sinceApplication(messages, applied_on)
      .filter((m) => classifyStatusSignal(m) === 'rejection')
      .sort(bySentOn)[0];
    if (rejection) return verdict(true, null, { dated_on: rejection.sent_on, evidence_ref: rejection.message_id });
    if (phone_rejection_on !== null && phone_rejection_on !== undefined) {
      if (!isRealDate(phone_rejection_on)) return verdict(false, 'invalid_phone_date');
      if (isRealDate(today) && phone_rejection_on > today) return verdict(false, 'future_phone_date');
      return verdict(true, null, { dated_on: phone_rejection_on, evidence_ref: 'said_no_by_phone' });
    }
    return verdict(false, 'no_employer_evidence', { show_first: employerMessagesSince(messages, applied_on).map(summarize) });
  }

  if (to === 'No Response') {
    if (by_hand !== true) return verdict(false, 'must_be_set_by_hand');
    const prompt = noResponsePrompt({ messages, applied_on });
    if (!prompt.offer) return verdict(false, 'employer_message_exists', { show_first: prompt.show_first });
    return verdict(true, null);
  }

  return verdict(true, null);
}
