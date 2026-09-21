// E-3: rules for attaching an employer message to an application. Pure functions; nothing here reads or writes a
// file. The reply route asks before it writes:
//   pick_required           more than one application at this employer fits, and the person did not pick one.
//   already_attached        the message is already logged on an application.
//   needs_acknowledgement   the message is older than the application, or automated (a receipt, a security code, a
//                           reminder, a survey, an out of office); logging it needs an explicit yes, or logging it
//                           as neutral / dismissing it instead.
import { classifyEmployerMessage } from './held-evidence.mjs';
import { localToday } from './local-date.mjs';

const RECEIPT = /\b(thank(s| you) for (applying|your (application|interest))|we(?:'ve| have)? received your application|application (was |has been )?(received|submitted)|(security|verification|one[- ]time) (code|passcode)|confirm your (email|account))\b/;

/** What kind of automated message this is, or 'human'. */
export function classifyReplyAutomation({ subject, body } = {}) {
  const subjectLower = String(subject || '').toLowerCase();
  if (RECEIPT.test(subjectLower)) return 'receipt';
  const kind = classifyEmployerMessage({ subject, body });
  return kind === 'human' ? 'human' : kind;
}

function dateOnly(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : localToday(parsed);
}

/**
 * Decide whether a message may be attached to an application. Returns
 *   { allowed, reason, warnings }
 * reason is null when allowed. Options: message { date, subject, body }, apply_date (YYYY-MM-DD or null),
 * candidate_count (applications at this employer that fit), pick_confirmed, acknowledged, already_attached_to.
 */
export function evaluateReplyAttachment({ message = {}, apply_date = null, candidate_count = 1, pick_confirmed = false, acknowledged = false, already_attached_to = null } = {}) {
  const warnings = [];
  const messageOn = dateOnly(message.date);
  if (already_attached_to != null) return { allowed: false, reason: 'already_attached', warnings, attached_to: already_attached_to };
  if (candidate_count > 1 && pick_confirmed !== true) return { allowed: false, reason: 'pick_required', warnings };
  if (messageOn && apply_date && messageOn < apply_date) warnings.push({ type: 'older_than_application', message_on: messageOn, apply_date });
  const automation = classifyReplyAutomation({ subject: message.subject, body: message.body });
  if (automation !== 'human') warnings.push({ type: 'automated', kind: automation });
  if (warnings.length && acknowledged !== true) return { allowed: false, reason: 'needs_acknowledgement', warnings };
  return { allowed: true, reason: null, warnings };
}
