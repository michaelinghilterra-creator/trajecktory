/**
 * Pure functions to determine whether a conversation was held based on evidence.
 */

import { isAutoReply } from './inbound-classify.mjs';

export const EVIDENCE_KINDS = Object.freeze(['owner_message', 'employer_message', 'owner_confirmation', 'calendar_event', 'invitation', 'reminder', 'scheduling_confirmation', 'feedback_survey', 'out_of_office', 'debrief']);

export function classifyEmployerMessage({ subject, body }) {
  const subjectLower = String(subject || '').toLowerCase();
  const bodyLower = String(body || '').toLowerCase();

  if (isAutoReply({ subject, body })) {
    return 'out_of_office';
  }

  const feedbackSurveyPattern = /\b(feedback survey|how was your (interview|experience)|rate your (interview|experience)|candidate experience survey)\b/;
  if (feedbackSurveyPattern.test(subjectLower) || feedbackSurveyPattern.test(bodyLower)) {
    return 'feedback_survey';
  }

  const reminderPattern = /\b(reminder|upcoming interview|starts in \d+ (minutes|hours))\b/;
  if (reminderPattern.test(subjectLower)) {
    return 'reminder';
  }

  const schedulingPattern = /\b(confirmed|confirmation|has been scheduled|scheduled for|see you on)\b/;
  if (schedulingPattern.test(subjectLower) && !bodyLower.includes('unfortunately')) {
    return 'scheduling_confirmation';
  }

  const invitationPattern = /\b(invitation|invite|calendar invite|please select a time|schedule (a|your) (call|interview|time))\b/;
  if (invitationPattern.test(subjectLower)) {
    return 'invitation';
  }

  return 'human';
}

export function evaluateHeldEvidence({ slot_end, items }) {
  const slotDate = new Date(slot_end);
  if (isNaN(slotDate.getTime())) {
    throw new TypeError('Invalid slot_end date');
  }

  const qualifying = [];
  const rejected = [];

  for (const item of items) {
    const { kind, at, refers_to_conversation, confirmed_on } = item;

    if (!EVIDENCE_KINDS.includes(kind)) {
      rejected.push({ item, reason: 'unknown_kind' });
      continue;
    }

    if (!['owner_message', 'employer_message', 'owner_confirmation'].includes(kind)) {
      rejected.push({ item, reason: 'not_evidence_kind' });
      continue;
    }

    if (kind === 'owner_message' || kind === 'employer_message') {
      const itemDate = new Date(at);
      if (isNaN(itemDate.getTime())) {
        rejected.push({ item, reason: 'bad_timestamp' });
        continue;
      }

      if (itemDate <= slotDate) {
        rejected.push({ item, reason: 'before_or_at_slot_end' });
        continue;
      }

      if (!refers_to_conversation) {
        rejected.push({ item, reason: 'does_not_refer' });
        continue;
      }

      qualifying.push(item);
      continue;
    }

    if (kind === 'owner_confirmation') {
      if (typeof confirmed_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(confirmed_on)) {
        rejected.push({ item, reason: 'bad_confirmation' });
        continue;
      }

      const [year, month, day] = confirmed_on.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
      ) {
        rejected.push({ item, reason: 'bad_confirmation' });
        continue;
      }

      qualifying.push(item);
      continue;
    }
  }

  const held = qualifying.length > 0;

  return { held, qualifying, rejected };
}
