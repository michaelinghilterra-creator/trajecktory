// reply-draft.mjs — shared "Reply" draft prompt for the TA and recruiter draft
// routes. Unlike the outreach draft (a candidate reaching out), this responds to
// the contact's most recent RECEIVED email, using the thread for context and the
// CV/profile for voice. Kept in one place so both channels reply identically.

// A reply subject with exactly one leading "RE: ". The model is told to reply
// with "RE: <their subject>", but the inbound subject often already carries a
// "RE:", which stacks into "RE: RE:". Collapse any run of leading Re:/Fw:/Fwd:
// prefixes to a single "RE: "; fall back to the inbound subject if the model
// returned none. A subject with no reply prefix at all is left as-is (the model
// may have chosen a genuinely fresh subject).
export function collapseRe(modelSubject, inboundSubject = '') {
  const s = String(modelSubject || `RE: ${inboundSubject}`);
  return s.replace(/^((?:re|fwd?)\s*:\s*){2,}/i, 'RE: ');
}

// The most recent inbound message in a correspondence log, or null. The log is
// oldest-first, so scan from the end.
export function lastReceived(prior = []) {
  for (let i = prior.length - 1; i >= 0; i--) {
    if (prior[i] && prior[i].direction === 'Received') return prior[i];
  }
  return null;
}

// The most recent message YOU sent in a correspondence log, or null. Mirror of
// lastReceived, used by the "follow up on my last sent email" draft mode. Only
// counts a real Sent message — an unsent 'Draft' is not something to follow up
// on, so it is skipped.
export function lastSent(prior = []) {
  for (let i = prior.length - 1; i >= 0; i--) {
    if (prior[i] && prior[i].direction === 'Sent') return prior[i];
  }
  return null;
}

// Build the "follow up on my last sent email" prompt. Unlike buildReplyPrompt
// (which answers something they wrote), this nudges a thread that went quiet:
// the contact received your last email and has NOT replied, and you want a short
// polite bump that adds a little new value without repeating the whole pitch.
// Assumes lastSent(prior) is non-null — callers check first and 400 when there
// is nothing sent to follow up on.
export function buildFollowupFromSentPrompt({ me, cvMd, profileMd, prior, contactLabel, contactBlock, firstName }) {
  const sent = lastSent(prior);
  // Days since that email went out, so the nudge uses honest timing language
  // instead of defaulting to "yesterday". Best-effort: skip if unparseable.
  let daysSince = null;
  const sentMs = Date.parse(sent.timestamp);
  if (!isNaN(sentMs)) daysSince = Math.max(0, Math.floor((Date.now() - sentMs) / 86400000));
  const timingLine = daysSince == null
    ? '(sent date unavailable — avoid specific timing claims)'
    : daysSince <= 1 ? `${daysSince} day ago (do NOT nudge same-day; if this says 0 days, soften to "the other day")`
    : daysSince <= 3 ? `${daysSince} days ago (use "a few days ago" or "earlier this week")`
    : daysSince <= 10 ? `${daysSince} days ago (use "last week" or "about a week ago")`
    : daysSince <= 21 ? `${daysSince} days ago (use "a couple of weeks ago")`
    : daysSince <= 45 ? `${daysSince} days ago (use "last month" or "a few weeks back")`
    : `${daysSince} days ago (reference the earlier note without over-specifying timing)`;

  const thread = prior.slice().reverse()
    .filter(m => m !== sent)
    .slice(0, 3)
    .map(m => `--- ${m.direction} on ${m.timestamp} | Subject: ${m.subject}\n${m.body}`)
    .join('\n\n');

  return `You are drafting ${me.fullName}'s brief FOLLOW-UP to ${contactLabel}. ${me.firstName} already sent the email below and has NOT heard back. Write a short, polite nudge that revives the thread — NOT a fresh pitch and NOT a reply (they did not write anything to reply to).

== WHO YOU ARE FOLLOWING UP WITH ==
${contactBlock}

== YOUR LAST EMAIL TO THEM (this is what went unanswered, build the nudge on THIS) ==
Subject: ${sent.subject}
Sent:    ${sent.timestamp}
TIMING LANGUAGE: ${timingLine}
${sent.body}
${thread ? `
== EARLIER IN THE THREAD (context only, most recent first) ==
${thread}
` : ''}
== ${me.firstName.toUpperCase()}'S CV (source of truth, never invent metrics or experience) ==
${cvMd}
${profileMd ? `
== VOICE RULES (from modes/_profile.md, must follow) ==
${profileMd}
` : ''}
== HOW TO FOLLOW UP ==
- Reference the earlier email lightly ("following up on my note from last week about…"), using the exact phrasing from the TIMING LANGUAGE line above. Do NOT invent a different gap.
- Keep it SHORT — this is a bump, not a re-send. Maximum 90 words.
- Add ONE small new reason to reply: a fresh proof point from the CV, a relevant update, or a lighter, easier ask. Do NOT just repeat the original email.
- Assume good faith (they are busy), never guilt-trip or sound impatient. No "I haven't heard back" as an accusation.
- Warm, direct, senior operator tone. No corporate filler, no "I hope this finds you well".
- NO em dashes anywhere (use periods, commas, semicolons, colons, or parentheses). Never invent a metric or claim not on the CV.
- The UI prefills "Hi ${firstName}," so the body MUST begin with substantive content, not a greeting and not their name.

== SUBJECT REQUIREMENTS ==
- Usually use "RE: ${sent.subject}" to keep the same thread, unless a fresh subject is clearly better.

== BODY REQUIREMENTS ==
- Use plain text.
- Write 1 to 2 short paragraphs separated by a literal \\n\\n.
- Omit the greeting, sign-off, signature block, and contact information.`;
}

// Build the reply prompt. `contactLabel` is a short human phrase ("an executive
// recruiter at Acme"); `contactBlock` is the labeled who-you-are-replying-to
// block, which differs per channel (company vs firm). Assumes lastReceived(prior)
// is non-null — callers check first and 400 when there is nothing to reply to.
export function buildReplyPrompt({ me, cvMd, profileMd, prior, contactLabel, contactBlock, firstName }) {
  const inbound = lastReceived(prior);
  const thread = prior.slice().reverse()
    .filter(m => m !== inbound)
    .slice(0, 4)
    .map(m => `--- ${m.direction} on ${m.timestamp} | Subject: ${m.subject}\n${m.body}`)
    .join('\n\n');

  return `You are drafting ${me.fullName}'s REPLY to the most recent email from ${contactLabel}. This is a real reply in an ongoing thread, NOT a generic follow-up: respond directly and specifically to what they wrote.

== WHO YOU ARE REPLYING TO ==
${contactBlock}

== THEIR MOST RECENT EMAIL (reply to THIS) ==
Subject:  ${inbound.subject}
Received: ${inbound.timestamp}
${inbound.body}
${thread ? `
== EARLIER IN THE THREAD (context only, most recent first) ==
${thread}
` : ''}
== ${me.firstName.toUpperCase()}'S CV (source of truth, never invent metrics or experience) ==
${cvMd}
${profileMd ? `
== VOICE RULES (from modes/_profile.md, must follow) ==
${profileMd}
` : ''}
== HOW TO REPLY ==
- Answer the SPECIFIC content of their email. If they asked a question, answer it. If they shared news (a role put on hold, a decline, an introduction, a scheduling request), address that news directly.
- If they declined or put a role on hold: be gracious, thank them, keep the door open for future roles. Do NOT push back, re-pitch hard, or sound disappointed.
- If they proposed next steps or asked for availability: confirm warmly and make scheduling effortless.
- Warm, direct, senior operator tone. No corporate filler, no "I hope this finds you well".
- Maximum 120 words. NO em dashes anywhere (use periods, commas, semicolons, colons, or parentheses). Never invent a metric or claim not on the CV.
- The UI prefills "Hi ${firstName}," so the body MUST begin with substantive content, not a greeting and not their name.

== SUBJECT REQUIREMENTS ==
- Usually use "RE: ${inbound.subject}", unless a genuinely fresh subject is clearly better.

== BODY REQUIREMENTS ==
- Use plain text.
- Write 2 to 3 short paragraphs separated by a literal \\n\\n between paragraphs.
- Omit the greeting, sign-off, signature block, and contact information.`;
}
