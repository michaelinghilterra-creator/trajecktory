import { isSendable } from '../../../lib/email-verify.mjs';
import { isLinkedInInvite } from './channels.mjs';
import { logConnect } from './connects.mjs';
import {
  advanceSequence,
  expectedNextChannel,
  getSequence,
  getTemplate,
  pauseSequence,
} from './sequences.mjs';
import { markInvitePending } from './tt-linkedin.mjs';

// Keep the state transitions caused by a persisted TA message in one place.
// Callers invoke this immediately after writing correspondence and updating the
// contact row so sequence and LinkedIn state cannot drift by entry point.
export function applyTargetTalentCorrespondenceSideEffects({
  contact,
  id = contact?.id,
  message,
  isHumanReply = false,
  today,
} = {}) {
  const { direction, channel, subject, timestamp } = message || {};

  if (isHumanReply) {
    try { pauseSequence('ta', id, today); } catch { /* no active sequence, safe to ignore */ }
  }

  if (direction === 'Sent') {
    const active = getSequence('ta', id);
    if (active && !active.paused && !active.completedAt) {
      const template = getTemplate(active.sequenceId);
      const expected = expectedNextChannel(active, template);
      const sentChannel = channel === 'LinkedIn' ? 'linkedin' : 'email';
      if (expected && (expected === 'either' || expected === sentChannel)) {
        const available = {
          email: isSendable(contact),
          linkedin: !!String(contact?.linkedin || '').trim(),
        };
        try {
          advanceSequence('ta', id, timestamp.slice(0, 10), sentChannel, { available });
        } catch { /* template or entry vanished mid-request, safe to ignore */ }
      }
    }
  }

  if (direction === 'Sent' && (channel === 'LinkedIn' || isLinkedInInvite(subject))) {
    const date = timestamp.slice(0, 10);
    logConnect({
      name: `${contact?.first || ''} ${contact?.last || ''}`.trim(),
      source: 'ta',
      id,
      date,
    });
    markInvitePending(id, date);
  }
}
