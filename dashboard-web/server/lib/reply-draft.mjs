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
== ${me.firstName.toUpperCase()}'S CV (source of truth — never invent metrics or experience) ==
${cvMd}

== VOICE RULES (from modes/_profile.md — must follow) ==
${profileMd}

== HOW TO REPLY ==
- Answer the SPECIFIC content of their email. If they asked a question, answer it. If they shared news (a role put on hold, a decline, an introduction, a scheduling request), address that news directly.
- If they declined or put a role on hold: be gracious, thank them, keep the door open for future roles. Do NOT push back, re-pitch hard, or sound disappointed.
- If they proposed next steps or asked for availability: confirm warmly and make scheduling effortless.
- Warm, direct, senior operator tone. No corporate filler, no "I hope this finds you well".
- Maximum 120 words. NO em dashes anywhere (use periods, commas, semicolons, colons, or parentheses). Never invent a metric or claim not on the CV.
- The UI prefills "Hi ${firstName}," so the body MUST begin with substantive content, not a greeting and not their name.

Output ONLY a JSON object — no markdown, no code fences, no explanation:
{"subject": "<usually \\"RE: ${inbound.subject}\\" unless a genuinely fresh subject is clearly better>", "body": "<plain-text reply, 2-3 short paragraphs separated by a LITERAL \\n\\n between paragraphs, NO greeting, NO sign-off, NO signature block, NO contact info>"}`;
}
