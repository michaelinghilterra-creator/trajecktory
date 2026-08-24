/**
 * Classify an inbound correspondence entry by the kind of response it records.
 *
 * This deliberately defaults to `human` whenever the evidence is uncertain.
 * Misclassifying a real reply suppresses a live conversation, while treating an
 * unusual automatic response as human only preserves the behavior that existed
 * before this classifier. The patterns therefore require distinctive structure.
 */

const textOf = (value) => String(value || '').trim();

export function isDepartureNotice(message) {
  const body = textOf(message?.body);
  return /\b(?:no longer with|is no longer employed|has left the company|no longer at|is no longer working)\b/i.test(body);
}

export function isAutoReply(message) {
  const subject = textOf(message?.subject);
  const body = textOf(message?.body);
  const automaticSubject = /^(?:automatic reply|auto-reply|autoreply|auto response|autoresponse|out of office)\b/i.test(subject)
    || /\booo\b/i.test(subject);
  const absenceOpening = /^(?:(?:i am|i'm)(?: currently)? out of the office|(?:i am|i'm) on (?:vacation|leave)|(?:i am|i'm) away from the office|thank you for your email[.!]?\s+i am currently\s+(?:out of the office|on (?:vacation|leave)|away from the office))\b/i.test(body);
  return automaticSubject || absenceOpening;
}

export function isAcceptanceNotice(m) {
  return /^accepted linkedin connection request/i.test(String(m?.subject || '').trim())
      || /^accepted linkedin connection request/i.test(String(m?.body || '').trim());
}

export function classifyInbound(message) {
  // Departure notices are commonly automatic replies too, but the departure is
  // the more actionable fact. Acceptance is checked only after both email cases.
  if (isDepartureNotice(message)) return 'departure';
  if (isAutoReply(message)) return 'auto-reply';
  if (isAcceptanceNotice(message)) return 'acceptance';
  return 'human';
}
