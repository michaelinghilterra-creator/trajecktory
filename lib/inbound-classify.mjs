/**
 * Classify an inbound correspondence entry by the kind of response it records.
 *
 * This deliberately defaults to `human` whenever the evidence is uncertain.
 * Misclassifying a real reply suppresses a live conversation, while treating an
 * unusual automatic response as human only preserves the behavior that existed
 * before this classifier. The patterns therefore require distinctive structure.
 */

const textOf = (value) => String(value || '').trim();

export const RECEIPT_SUBJECT = /\b(thank(s| you) for (applying|your application|submitting)|we( ve|'ve| have)? received your application|application (received|confirmation|submitted)|(security|verification) code)\b/;

export const REJECTION_PATTERN = /\b(not moving forward|not be moving forward|will not be (moving|proceeding)|position (has been |was )?(filled|closed)|role (has been |was )?(filled|closed)|decided to (move|proceed) forward with (other|another)|regret to inform you|unfortunately,? we (have|will|are))\b/;

// Lowercase with every run of whitespace folded to one space. Email bodies are hard wrapped, so a phrase such as
// "decided to move forward with another" can be split by a line break and indentation.
const flatLower = (value) => textOf(value).toLowerCase().replace(/\s+/g, ' ');

// Sender local parts that only ever send automatic mail.
const AUTOMATED_LOCAL_PART = /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|mailer-daemon)$/i;
// Applicant tracking system mail domains. Matches the domain itself and any subdomain of it.
const ATS_DOMAIN = /(?:^|\.)(?:ashbyhq\.com|greenhouse\.io|greenhouse-mail\.io|lever\.co|myworkday\.com|icims\.com|jobvite\.com|smartrecruiters\.com|workable\.com|recruitee\.com|breezy\.hr|jazzhr\.com|taleo\.net)$/i;
// Bounded quantifiers on purpose: the sender is attacker influenced text.
const SENDER_ADDRESS = /([^\s<>"',;]{1,64})@([^\s<>"',;]{1,255})/;

// A receipt subject that only counts when an automated sender sent it. A person writing "thanks for your interest" is a reply.
export const INTEREST_SUBJECT = /\bthank(?:s| you)(?: again)? for your interest\b/;
// A scheduling or progress word in the subject means the message is about the hiring process, not an application receipt.
export const PROCESS_SUBJECT = /\b(?:interview|schedul(?:e|ing)|availability|invitation|invite|next steps?|phone screen|screening call|offer)\b/;

/** True when the sender address is a no-reply style mailbox or sits on a known applicant tracking system domain. */
export function isAutomatedSender(sender) {
  const found = SENDER_ADDRESS.exec(textOf(sender));
  if (!found) return false;
  return AUTOMATED_LOCAL_PART.test(found[1]) || ATS_DOMAIN.test(found[2]);
}

// More ways an automated message says no. Kept apart from REJECTION_PATTERN, which other code imports.
const REJECTION_EXTRA = /\b(?:decided to close (?:this|the) (?:position|role)|filled (?:this|the) (?:role|position)|do(?:es)? not feel (?:like )?(?:this|the) (?:position|role) (?:best )?matche?s?|decided to (?:move|proceed) forward with candidates|decided not to (?:move|proceed)|decision (?:was )?(?:made )?to not (?:move|proceed) forward|decision to (?:move|proceed) forward with (?:other|another)|(?:will be|are|is) moving forward with (?:other|another)|won(?:'|’)?t be (?:moving|proceeding)|unable to (?:move|proceed) forward|(?:role|position) is (?:now )?(?:closed|filled|no longer available)|(?:role|position|it) (?:is being|has been) (?:canceled|cancelled)|no longer (?:reviewing|considering) (?:resumes|applications|candidates)|not (?:been )?(?:selected|chosen) (?:to|for))\b/;

// A sentence that starts with "if" is a condition ("If you have not heard back, we regret to inform you ..."), not a decision.
const withoutConditions = (flat) => flat.split(/(?<=[.!?])\s+/).filter((sentence) => !/^(?:and |but |so )?if\b/.test(sentence)).join(' ');

/** True when the text states a rejection. Whitespace is folded first and conditional sentences are ignored. */
export function isRejectionText(value) {
  const text = withoutConditions(flatLower(value));
  return REJECTION_PATTERN.test(text) || REJECTION_EXTRA.test(text);
}

// A reply or forward prefix. A person's message with this prefix is a reply to something that was sent, never a receipt.
const REPLY_PREFIX = /^\s*(?:re|fwd?)\s*:/;
// Subjects of automated acknowledgements that RECEIPT_SUBJECT does not cover. Only trusted from an automated sender.
const ACK_SUBJECT = /\b(?:(?:has|have) received your (?:application|resume)|received your (?:[a-z0-9&,'’-]+ ){0,8}application|has been received|application received|we(?:'|’)?ve got your (?:application|resume)|you(?:'|’)?ve applied|excited you applied|you applied to|thanks? for completing your application)\b/;
// "Your application for X" is a receipt only when the subject carries no status wording and the body reads like one.
const GENERIC_APPLICATION_SUBJECT = /\byour application (?:for|to|at|with)\b/;
const STATUS_WORDS = /\b(?:update|information|regarding|status|decision|news|outcome|candidacy|next steps?)\b/;
const BODY_RECEIPT = /\b(?:we(?:'|’)?ve received|we have received|has received your|received your (?:application|submission|resume)|application has been received|(?:is|are|will be)(?: (?:currently|carefully))* reviewing|looking forward to reviewing|will (?:carefully )?review)\b/;
// Candidate experience surveys sent by an applicant tracking system.
const SURVEY_SUBJECT = /\b(?:tell us about your (?:application )?experience|we value your feedback|your feedback|provide feedback|candidate experience|share your experience)\b/;

/** True when an automated sender wrote a rejection. Used to correct a sentiment tag the text contradicts. */
export function isAutomatedRejection({ subject, body, sender } = {}) {
  return isAutomatedSender(sender) && isRejectionText(`${textOf(subject)} ${textOf(body)}`);
}

export function isApplicationReceipt({ subject, body, sentiment, sender } = {}) {
  const subjectText = textOf(subject).toLowerCase();
  if (isRejectionText(`${subjectText} ${textOf(body)}`)) return false;
  const automated = isAutomatedSender(sender);
  if (!automated && REPLY_PREFIX.test(subjectText)) return false;
  const survey = automated && SURVEY_SUBJECT.test(subjectText);
  const acknowledged = automated && (ACK_SUBJECT.test(subjectText)
    || (GENERIC_APPLICATION_SUBJECT.test(subjectText) && !STATUS_WORDS.test(subjectText) && BODY_RECEIPT.test(flatLower(body))));
  if (!(RECEIPT_SUBJECT.test(subjectText) || (automated && INTEREST_SUBJECT.test(subjectText)) || acknowledged || survey)) return false;
  const tag = textOf(sentiment).toLowerCase();
  if (!tag || tag === 'neutral') return true;
  // A positive tag on an automated receipt is the sync keyword guess on boilerplate ("next steps", "interview").
  return tag === 'positive' && automated && (survey || !PROCESS_SUBJECT.test(subjectText));
}

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
  // Auto-replies that put the absence first and the original subject after it ("Currently on Vacation Re: ...").
  const absenceBeforeSubject = /\b(?:out of (?:the )?office|away from (?:my|the) desk|(?:currently )?on (?:vacation|leave|pto))\b[^:]{0,80}\bre:\s/i.test(subject);
  const greetedAbsence = /^(?:hi|hello)(?: there)?[,.!]?\s+(?:i am|i'm)(?: currently)? (?:ooo|out of (?:the )?office|on (?:vacation|leave|pto)|away)\b/i.test(body);
  return automaticSubject || absenceOpening || absenceBeforeSubject || greetedAbsence;
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
