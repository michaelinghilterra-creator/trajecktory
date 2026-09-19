/**
 */

import { classifyEmployerMessage } from './held-evidence.mjs';

function isRealDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function classifyStatusSignal({ direction, subject, body }) {
  if (direction !== 'from_employer' && direction !== 'from_owner') {
    return 'none';
  }

  const subjectStr = String(subject || '');
  const bodyStr = String(body || '');
  const combined = (subjectStr + ' ' + bodyStr).toLowerCase();

  if (direction === 'from_employer') {
    const classification = classifyEmployerMessage({ subject, body });
    if (classification !== 'human') {
      return 'none';
    }

    const rejectionPattern = /\b(not moving forward|not be moving forward|will not be (moving|proceeding)|position (has been |was )?(filled|closed)|role (has been |was )?(filled|closed)|decided to (move|proceed) forward with (other|another)|regret to inform you|unfortunately,? we (have|will|are))\b/;
    if (rejectionPattern.test(combined)) {
      return 'rejection';
    }

    return 'human_reply';
  }

  if (direction === 'from_owner') {
    const withdrawalPattern = /\b(withdraw(ing)? (my )?(application|candidacy)|please withdraw|no longer (interested|wish to (proceed|continue|pursue)))\b/;
    if (withdrawalPattern.test(combined)) {
      return 'withdrawal';
    }
    return 'none';
  }

  return 'none';
}

export function proposeStatusFromMessage(message) {
  const { message_id, direction, subject, body, sent_on } = message;

  const signal = classifyStatusSignal({ direction, subject, body });

  if (signal !== 'rejection' && signal !== 'withdrawal') {
    return null;
  }

  if (typeof message_id !== 'string' || message_id.trim() === '') {
    throw new TypeError('message_id must be a non-empty string');
  }

  if (!isRealDate(sent_on)) {
    throw new TypeError('sent_on must be a valid YYYY-MM-DD calendar date');
  }

  if (signal === 'rejection') {
    return {
      status: 'Rejected',
      dated_on: sent_on,
      evidence_ref: message_id
    };
  }

  return {
    status: 'Passed',
    dated_on: sent_on,
    evidence_ref: message_id
  };
}

export function findStatusMismatches(applications) {
  const mismatches = [];

  for (const app of applications) {
    if (app.status !== 'No Response') {
      continue;
    }

    const { messages } = app;
    if (!Array.isArray(messages) || messages.length === 0) {
      continue;
    }

    const sortedMessages = [...messages].sort((a, b) => {
      if (a.sent_on !== b.sent_on) {
        return a.sent_on < b.sent_on ? -1 : 1;
      }
      return a.message_id < b.message_id ? -1 : 1;
    });

    let rejectionMessage = null;
    let humanReplyMessage = null;

    for (const msg of sortedMessages) {
      const signal = classifyStatusSignal({ direction: msg.direction, subject: msg.subject, body: msg.body });

      if (signal === 'rejection') {
        rejectionMessage = msg;
        break;
      }

      if (signal === 'human_reply') {
        humanReplyMessage = msg;
      }
    }

    if (rejectionMessage) {
      mismatches.push({
        application_id: app.id,
        type: 'rejection_after_no_response',
        message_id: rejectionMessage.message_id,
        dated_on: rejectionMessage.sent_on,
        proposed: {
          status: 'Rejected',
          dated_on: rejectionMessage.sent_on,
          evidence_ref: rejectionMessage.message_id
        }
      });
    } else if (humanReplyMessage) {
      mismatches.push({
        application_id: app.id,
        type: 'reply_after_no_response',
        message_id: humanReplyMessage.message_id,
        dated_on: humanReplyMessage.sent_on,
        proposed: null
      });
    }
  }

  return mismatches;
}

export function confirmMismatch(mismatch, { confirmed }) {
  if (confirmed !== true) {
    return null;
  }

  if (mismatch.proposed === null) {
    throw new Error('no proposal to confirm');
  }

  return {
    application_id: mismatch.application_id,
    status: 'Rejected',
    occurred_on: mismatch.proposed.dated_on,
    evidence_ref: mismatch.proposed.evidence_ref,
    reason: 'employer_rejection_after_no_response'
  };
}
