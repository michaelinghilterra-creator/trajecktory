// LinkedIn SSI draft generation (Claude-backed): split from linkedin-ssi.mjs to
// keep each module focused and under the size budget.
import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { generateText, readProjectFile, draftModel } from '../lib/anthropic.mjs';
import { cleanProse } from '../lib/text-hygiene.mjs';
import { reviseForCadence } from '../lib/cadence-revise.mjs';
import { loadInfluencer, toneInstruction, flattenConnectNote, fitConnectNote, buildConnectPrompt } from '../lib/linkedin-ssi.mjs';
import { computeConnectQueue, computeBothQueue } from '../lib/followups.mjs';
import { parseTargetTalentMd, updateTTLine, readTTCorrespondence } from '../lib/target-talent.mjs';
import { parseReferralsMd } from '../lib/referrals.mjs';
import { getLinkedInStatus } from '../lib/tt-linkedin.mjs';
import { summarizeThread } from '../lib/correspondence-context.mjs';
import { getIdentity, getOutreachPolicy } from '../lib/profile.mjs';
import { getPersonContext } from '../lib/person-context.mjs';
import { canContact, logOutreachOverride } from '../lib/outreach-policy.mjs';
import { readEngagementLog } from '../lib/engagement-log.mjs';
import { getInmailBudget, decrementInmail, setInmailRemaining } from '../lib/inmail-budget.mjs';

export const router = express.Router();

// Resolve {source, id} to a recipient FROM THE BOOK THAT SOURCE NAMES.
//
// The three books number their rows independently, so an id on its own is
// ambiguous: referral 88 and target-talent 88 are two different people. Three
// handlers here used to look a contact up by id alone, against target talent,
// whatever source was requested. That was harmless while target talent was the
// only book that reached the follow-up queue, and it stopped being harmless the
// moment referrals and influencers joined it: asking for referral 88 drafted a
// note to target-talent 88 instead, addressed to the wrong person at the wrong
// company, and the UI showed it under the row you had clicked. Live example on
// real data: referral 88 is one person at one employer, target-talent 88 is
// somebody else entirely at another.
//
// Returns null when the source is unknown or the row is missing. It never falls
// back to another book, because guessing is what caused this.
function resolveRecipient(source, id) {
  if (id == null || !source) return null;
  const key = String(source);
  if (key === 'ta') {
    const row = parseTargetTalentMd().find(r => String(r.id) === String(id));
    return row && {
      source: 'ta', id: row.id,
      name: `${row.first || ''} ${row.last || ''}`.trim(),
      firstName: row.first || '',
      role: row.title || '', company: row.company || '', reason: '',
    };
  }
  if (key === 'referral') {
    const row = parseReferralsMd().find(r => String(r.id) === String(id));
    if (!row) return null;
    const parts = String(row.name || '').trim().split(/\s+/).filter(Boolean);
    return {
      source: 'referral', id: row.id,
      name: String(row.name || '').trim(),
      firstName: parts[0] || '',
      // A referral has no title column; "how you know them" is the closest thing
      // to context, and `where` is where they actually work now.
      role: row.how || '', company: row.where || '', reason: row.target || '',
    };
  }
  if (key === 'influencer') {
    const row = loadInfluencer({ influencerId: id });
    if (!row) return null;
    const parts = String(row.name || '').trim().split(/\s+/).filter(Boolean);
    return {
      source: 'influencer', id: row.id,
      name: String(row.name || '').trim(),
      firstName: parts[0] || '',
      role: row.role || '', company: '', reason: row.whyFollow || '',
    };
  }
  return null;
}

// GET /api/linkedin-drafts/inmail-budget — remaining monthly InMail credits.
// POST with { decrement: true } to spend one (an InMail follow-up was sent), or
// { set: N } to reconcile the count to LinkedIn's real balance.
router.get('/api/linkedin-drafts/inmail-budget', (req, res) => {
  try { res.json(getInmailBudget()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/api/linkedin-drafts/inmail-budget', (req, res) => {
  try {
    const { decrement, set } = req.body || {};
    if (decrement) return res.json(decrementInmail());
    if (set != null && `${set}`.trim() !== '') return res.json(setInmailRemaining(set));
    res.status(400).json({ error: 'Pass { decrement: true } or { set: <number> }.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/linkedin-ssi/generate-response', async (req, res) => {
  try {
    const { postText, influencerId, influencerName, tone = 'Insightful' } = req.body;
    if (!postText || !postText.trim()) {
      return res.status(400).json({ error: 'Paste the LinkedIn post you want to respond to.' });
    }
    const influencer = loadInfluencer({ influencerId, influencerName });
    if (!influencer) {
      return res.status(400).json({ error: 'Pick an influencer from the dropdown.' });
    }

    // Read the user's real CV for grounding
    const projectRoot = ROOT_DIR;
    let cvMd = '';
    try { cvMd = readProjectFile(projectRoot, 'cv.md'); } catch {}
    const cvExcerpt = cvMd ? cvMd.slice(0, 4000) : '(CV not available)';
    const id = getIdentity();

    const prompt = `You are helping ${id.fullName} (${id.headline}, based in ${id.location}) draft an authentic LinkedIn comment in reply to a post.

THE POST he is responding to (do not summarize or quote, REPLY to it):
"""
${postText.trim()}
"""

THE PERSON who wrote the post:
- Name: ${influencer.name}
- Role: ${influencer.role || '(unknown)'}
- Why he follows them: ${influencer.engagementTip || influencer.track || '(not specified)'}

ABOUT ${id.firstName.toUpperCase()} (use this to ground the reply, do not copy verbatim):
${cvExcerpt}

TONE DIRECTIVE (${tone}): ${toneInstruction(tone)}

HARD RULES:
- Reply must engage with the SPECIFIC content of the post above. If the post talks about MEDDPICC, talk about MEDDPICC. If it talks about category creation, talk about that. Never produce a generic comment.
- Maximum 2 short sentences or one short paragraph. LinkedIn comment length, not a blog post.
- NO em dashes (—). Use periods, commas, semicolons, colons, or parentheses.
- No "I hope this finds you well" or other corporate filler.
- No emojis unless the original post is highly informal.
- No self-promotion. No mention of looking for a job.
- Do NOT start with "Great post" or "Love this" or any generic opener.
- Do NOT include a signature, name, or sign-off. UI handles that.

Return ONLY the comment text, ready to paste. No quotes, no preface, no explanation.`;

    const response = await generateText(prompt, { model: draftModel(), maxTokens: 300 });
    res.json({ response: (await reviseForCadence(cleanProse(response.trim()), { surface: 'prose' })).text });
  } catch (err) {
    console.error('Error generating response:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/linkedin-ssi/generate-reply — draft the NEXT message in an ongoing 1:1
// LinkedIn conversation with a connected influencer. Unlike generate-response (a
// public comment on a post), this is a private reply, and it reads the contact's
// prior engagement history so the draft builds on the thread instead of resetting
// it. Relationship-building only: the prompt forbids any pitch or job-search ask.
router.post('/api/linkedin-ssi/generate-reply', async (req, res) => {
  try {
    const { theirMessage, influencerId, influencerName, tone = 'Curious' } = req.body;
    if (!theirMessage || !theirMessage.trim()) {
      return res.status(400).json({ error: 'Paste the message you want to reply to.' });
    }
    const influencer = loadInfluencer({ influencerId, influencerName });
    if (!influencer) return res.status(400).json({ error: 'Open this from an influencer.' });

    const id = getIdentity();
    let cvMd = '';
    try { cvMd = readProjectFile(ROOT_DIR, 'cv.md'); } catch {}
    const cvExcerpt = cvMd ? cvMd.slice(0, 3000) : '(CV not available)';

    // The prior thread with THIS contact, oldest→newest, compact. Matched on name
    // (the engagement log keys by influencer name). Cap the tail so the prompt stays
    // bounded on a long relationship.
    const wanted = (influencer.name || '').trim().toLowerCase();
    const history = readEngagementLog()
      .filter(e => (e.influencer || '').trim().toLowerCase() === wanted)
      .slice(-8)
      .map(e => `- ${e.date} [${e.actionType}] ${e.topic ? e.topic + ' — ' : ''}${(e.message || '').slice(0, 200)}`)
      .join('\n');

    const prompt = `You are helping ${id.fullName} (${id.headline}, based in ${id.location}) write the NEXT message in an ONGOING 1:1 LinkedIn conversation. This is a private direct reply to a message they received, NOT a public comment on a post.

WHO ${id.firstName} IS TALKING TO:
- Name: ${influencer.name}
- Role: ${influencer.role || '(unknown)'}
- Why ${id.firstName} follows them: ${influencer.engagementTip || influencer.track || '(not specified)'}

CONVERSATION HISTORY SO FAR (oldest first; use for continuity, do NOT repeat points already made):
${history || '(no prior logged exchanges)'}

THE MESSAGE ${id.firstName} IS REPLYING TO RIGHT NOW (reply to THIS, directly and specifically):
"""
${theirMessage.trim()}
"""

ABOUT ${id.firstName.toUpperCase()} (ground the reply in this, never copy verbatim):
${cvExcerpt}

TONE DIRECTIVE (${tone}): ${toneInstruction(tone)}

HARD RULES:
- This is a warm 1:1 reply. Engage specifically with what they just said, and build on the prior thread when it is relevant.
- 2 to 4 short sentences. A real direct message, not an essay.
- Advance the RELATIONSHIP, never an agenda. NO pitch, NO mention of looking for a job, NO referral or intro ask. This is rapport only.
- Keep the conversation open with a genuine question or a specific thread to pull, but only when it feels natural. Do not force it.
- NO em dashes. Use periods, commas, semicolons, colons, or parentheses.
- No corporate filler ("hope this finds you well"), no "Great point", no generic openers.
- No signature or sign-off. The UI handles that.

Return ONLY the reply text, ready to paste. No quotes, no preface, no explanation.`;

    const response = await generateText(prompt, { model: draftModel(), maxTokens: 400 });
    res.json({ response: (await reviseForCadence(cleanProse(response.trim()), { surface: 'prose' })).text });
  } catch (err) {
    console.error('Error generating reply:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/linkedin-ssi/generate-connect-request — Claude-generated LinkedIn connection note (max 300 chars)
router.post('/api/linkedin-ssi/generate-connect-request', async (req, res) => {
  try {
    const { influencerId, influencerName, theirRole = '', priorEngagement = '', angle = 'Reference Post', tone = 'Warm' } = req.body;
    const influencer = loadInfluencer({ influencerId, influencerName });
    if (!influencer) {
      return res.status(400).json({ error: 'Pick an influencer from the dropdown.' });
    }

    const projectRoot = ROOT_DIR;
    let cvMd = '';
    try { cvMd = readProjectFile(projectRoot, 'cv.md'); } catch {}
    const cvExcerpt = cvMd ? cvMd.slice(0, 3500) : '(CV not available)';
    const id = getIdentity();

    const angleGuidance = {
      'Reference Post': priorEngagement
        ? `Reference the specific post topic ${id.firstName} already commented on: "${priorEngagement}". Make it clear this is a follow-up to that engagement.`
        : 'Reference a generic recent post from them (since the specific topic is not provided, allude to a recent post without naming details).',
      'Mutual Interest': `Anchor on shared focus area: ${theirRole || influencer.role || 'GTM / RevOps / Analytics'}. Signal ${id.firstName} is a fellow operator in this space, not a job seeker.`,
      'Shared Network': 'Reference that they have mutual connections in the GTM / RevOps community. Do not name specific people.',
      'Career Stage': 'Briefly anchor on ${id.firstName} being a Director-level BI / RevOps leader exploring the next chapter. Keep it dignified, not desperate.',
    };

    const buildPrompt = (targetMax) => `You are drafting a LinkedIn CONNECTION REQUEST note from ${id.fullName} to a contact.

THE RECIPIENT:
- Name: ${influencer.name}
- Role: ${influencer.role || theirRole || '(unknown)'}
- Why ${id.firstName} wants to connect: ${influencer.engagementTip || influencer.track || '(general professional interest)'}

ABOUT ${id.firstName.toUpperCase()} (for grounding, do not copy):
${cvExcerpt}

ANGLE (${angle}): ${angleGuidance[angle] || angleGuidance['Reference Post']}

TONE DIRECTIVE (${tone}): ${toneInstruction(tone)}

HARD RULES:
- ABSOLUTE MAXIMUM ${targetMax} characters TOTAL (including the "Thanks, ${id.firstName}" sign-off). LinkedIn caps connection notes at 300 characters and will reject anything longer. Count characters before responding. Aim for ${targetMax - 20} to leave safety margin.
- Open with their first name + comma. Example: "Hi Sangram,"
- NO em dashes (—). Use periods, commas, semicolons, colons, or parentheses.
- One reason to connect that is grounded in the angle above. Be specific, not generic.
- End with a sign-off: "Thanks, ${id.firstName}" (with the comma).
- No "I'd love to pick your brain". No "I hope this finds you well". No "Quick question for you".
- Do NOT mention looking for a job, being in market, or open to opportunities (unless the angle is explicitly "Career Stage").
- Do NOT include emojis.

Return ONLY the body of the connection note, ready to paste into LinkedIn. No quotes, no preface, no character count, no explanation.`;

    const callClaude = async (targetMax) => {
      const text = await generateText(buildPrompt(targetMax), { model: draftModel(), maxTokens: 220 });
      // Clean before the 300-char cap check so the length test sees final text.
      return flattenConnectNote(cleanProse(text.trim()));
    };

    // First pass: aim for 280 to leave margin
    let response = await callClaude(280);
    // Retry once with stricter target if over
    if (response.length > 300) {
      response = await callClaude(250);
    }
    // Fit after flattening so the cap sees the exact one-line note returned.
    response = fitConnectNote(response, id.firstName).text;
    res.json({ response, length: response.length });
  } catch (err) {
    console.error('Error generating connect request:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/linkedin-drafts/connect-queue — contacts reachable only via LinkedIn
// (a real handle, no sendable email): the fallback outreach lane for people whose
// address bounced, is org-blocked, or was never verifiable. TA contacts.
router.get('/api/linkedin-drafts/connect-queue', (req, res) => {
  try {
    res.json({ queue: computeConnectQueue() });
  } catch (err) {
    console.error('connect-queue error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/linkedin-drafts/connect-note — draft a <=300-char LinkedIn connection
// note for a GENERIC recipient. Pass { source, id } to draft for a queue member
// (a TA contact), or raw { name, role, company, reason, firstName } for an
// ad-hoc contact. Raw fields override the resolved row. The note is always the
// user's to review and send; nothing is sent from here.
router.post('/api/linkedin-drafts/connect-note', async (req, res) => {
  try {
    const body = req.body || {};
    const { source, id, tone = 'Warm', angle = '' } = body;

    // Resolve from the queue when given a source+id, so we reuse the same
    // normalization and never draft for someone who has a live email channel.
    let resolved = null;
    if (source && id != null) {
      // Search the LinkedIn-only queue AND the high-value (both-channel) queue: a
      // both-channel contact is worked on LinkedIn from the Both tab, so it must
      // resolve here too, not only from the connect queue.
      const queue = [...computeConnectQueue(), ...computeBothQueue()];
      resolved = queue.find(r => r.source === source && String(r.id) === String(id)) || null;
      // Defensive fallback: a valid source+id that isn't in either queue (e.g. a
      // contact whose company isn't a live application, so it's filtered out) would
      // otherwise 400 below with an empty name. Read the contact row directly so we
      // can always resolve a recipient. The frontend already routes already-invited
      // contacts to /followup-message, so anything reaching here is a genuine
      // first-touch connect note; this only prevents a hard 400 on an edge case.
      if (!resolved) resolved = resolveRecipient(source, id);
    }
    const name            = (body.name    || resolved?.name    || '').trim();
    const recipientRole   = (body.role    || resolved?.role    || '').trim();
    const recipientCompany= (body.company || resolved?.company || '').trim();
    const reason          = (body.reason  || resolved?.reason  || '').trim();
    const recipientFirst  = (body.firstName || resolved?.firstName || name.split(/\s+/)[0] || '').trim();
    const src             = source || resolved?.source || 'ta';
    if (!name) {
      return res.status(400).json({ error: 'Provide a recipient: source+id from the connect queue, or a name.' });
    }
    if (resolved?.id != null) {
      const context = getPersonContext(src, resolved.id);
      const decision = canContact({ timeline: context?.timeline || [], channel: 'linkedin', company: recipientCompany, policy: getOutreachPolicy() });
      if (!decision.allowed && !body.override) return res.json({ blocked: true, blocks: decision.blocks, nextEligible: decision.nextEligible });
      if (!decision.allowed) logOutreachOverride({ contactRef: `${src}:${resolved.id}`, channel: 'linkedin', blocks: decision.blocks });
    }

    let cvMd = '';
    try { cvMd = readProjectFile(ROOT_DIR, 'cv.md'); } catch {}
    let articleDigestMd = '';
    try { articleDigestMd = readProjectFile(ROOT_DIR, 'article-digest.md'); } catch {}
    // Prepend portfolio artifacts (capped at 1000 chars) so the model can lead with
    // a named project/outcome rather than a generic role claim, even in 300 chars.
    const portfolioSnippet = articleDigestMd ? `PORTFOLIO / PROOF POINTS:\n${articleDigestMd.slice(0, 1000)}\n\nCV:\n` : '';
    const cvExcerpt = portfolioSnippet + (cvMd ? cvMd.slice(0, 3500) : '(CV not available)');
    const idn = getIdentity();

    // "Why connect" anchor for a TA / gatekeeper contact: a fellow-operator framing.
    const angleHint = angle ? ` (${angle})` : '';
    const guidance = reason
      ? `Anchor on this specific context${angleHint}: ${reason}`
      : `Anchor on ${name}'s work${recipientRole ? ` as ${recipientRole}` : ''}${recipientCompany ? ` at ${recipientCompany}` : ''} and on ${idn.firstName} being a fellow operator in the GTM / RevOps / analytics space, not a job seeker${angleHint}.`;

    const buildPrompt = (targetMax) => buildConnectPrompt({
      senderName: idn.fullName, senderFirst: idn.firstName, senderHeadline: idn.headline,
      recipientName: name, recipientFirst, recipientRole, recipientCompany,
      guidance, cvExcerpt, tone, toneText: toneInstruction(tone), targetMax,
    });

    let response = flattenConnectNote(cleanProse((await generateText(buildPrompt(280), { model: draftModel(), maxTokens: 220 })).trim()));
    if (response.length > 300) {
      response = flattenConnectNote(cleanProse((await generateText(buildPrompt(250), { model: draftModel(), maxTokens: 220 })).trim()));
    }
    response = fitConnectNote(response, idn.firstName).text;
    res.json({ response, length: response.length, recipient: { source: src, id: id ?? resolved?.id ?? null, name } });
  } catch (err) {
    console.error('Error generating connect note:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/linkedin-drafts/followup-message — draft a follow-up MESSAGE to a
// contact you ALREADY sent a connection request to. This is NOT another connect
// note: the invite is already out, so a follow-up is a real message (an InMail
// while you are not connected, a free DM once they accept). It reads the prior
// correspondence so it acknowledges the earlier touch instead of repeating it,
// and for a TA contact it leads with candidacy (interest in their
// company) plus one clear ask. Longer than the 300-char connect cap. The message
// is always the user's to review and send; nothing is sent from here.
router.post('/api/linkedin-drafts/followup-message', async (req, res) => {
  try {
    const body = req.body || {};
    const { id } = body;
    if (id == null) return res.status(400).json({ error: 'A contact id is required.' });
    // Source-aware: an id alone is ambiguous across the three books. Defaulting to
    // target talent here drafted to whoever happened to hold that id in THAT book.
    const source = body.source || 'ta';
    const recipient = resolveRecipient(source, id);
    if (!recipient) return res.status(404).json({ error: 'Contact not found.' });
    const row = source === 'ta'
      ? parseTargetTalentMd().find(r => String(r.id) === String(id))
      : null;

    const name = recipient.name || (body.name || '').trim();
    const recipientFirst = recipient.firstName || name.split(/\s+/)[0] || 'there';
    const recipientRole = recipient.role || '';
    const company = recipient.company || '';
    // Prior 1:1 history with THIS PERSON, merged across whichever books they are
    // filed in, rather than one book's correspondence file. A referral has no entry
    // in the target-talent log at all, so reading that directly returned either
    // nothing or, worse, the thread belonging to whoever shares their id.
    const context = getPersonContext(source, id);
    const corr = context?.timeline || [];

    // Has this person accepted the invite? That changes the message (a free DM to a
    // new first-degree connection, which must not ask whether the invite arrived)
    // and it lifts the InMail block, because a DM to a connection costs no credit.
    //
    // Read it from the PERSON, not the book. The LinkedIn connection axis is a
    // target-talent sidecar keyed by TA id, so it cannot be looked up with a
    // referral id. The previous guard was right about that and drew the wrong
    // conclusion from it: `source === 'ta' && ...` made a referral permanently
    // not-connected, so an accepted referral with no credits left was told "no
    // InMail credits remain" on a card that said, two lines above, that the message
    // was a free DM. The acceptance is already in the merged timeline as an
    // invite-accepted event, resolved per person, so a referral with a target-talent
    // twin is correctly connected and one without a twin correctly is not.
    const connected = corr.some(e => e.kind === 'invite-accepted')
      || (source === 'ta' && getLinkedInStatus(Number(id)) === 'Connected');
    const decision = canContact({
      timeline: corr,
      channel: 'linkedin',
      source,
      company,
      inmail: { exhausted: getInmailBudget().remaining === 0, alreadyInvited: true, freeDm: connected },
      policy: getOutreachPolicy(),
    });
    if (!decision.allowed && !body.override) return res.json({ blocked: true, blocks: decision.blocks, nextEligible: decision.nextEligible });
    if (!decision.allowed) logOutreachOverride({ contactRef: `${source}:${id}`, channel: 'linkedin', blocks: decision.blocks });
    const sent = corr.filter(m => m.direction === 'Sent');
    const firstTouchDate = (sent[0]?.timestamp || sent[0]?.at || row?.lastTouch || '').slice(0, 10);
    // Full-thread state: whether a substantive message already went out recently
    // and is unanswered, so the prompt writes a nudge instead of re-pitching.
    const thread = summarizeThread(corr);
    const history = thread.threadBlock || (connected
      ? '- A LinkedIn connection request that they ACCEPTED, so you are now connected.'
      : '- A LinkedIn connection request that has not been accepted or answered.');

    let cvMd = ''; try { cvMd = readProjectFile(ROOT_DIR, 'cv.md'); } catch {}
    let articleDigestMd = ''; try { articleDigestMd = readProjectFile(ROOT_DIR, 'article-digest.md'); } catch {}
    const cvExcerpt = (articleDigestMd ? `PORTFOLIO / PROOF POINTS:\n${articleDigestMd.slice(0, 900)}\n\nCV:\n` : '') + (cvMd ? cvMd.slice(0, 3200) : '(CV not available)');
    const idn = getIdentity();

    const purpose = `${name} works in Talent Acquisition or recruiting${company ? ` at ${company}` : ''}. ${idn.firstName} is genuinely interested in ${company || 'their company'} and has applied there (or is about to). The goal is candidacy: get on ${recipientFirst}'s radar as a strong fit and a name worth a reply.`;

    const prompt = `You are drafting a brief LinkedIn ${connected ? 'DIRECT MESSAGE (a free DM)' : 'FOLLOW-UP MESSAGE (an InMail)'} from ${idn.fullName} to ${connected
      ? `a contact he is now CONNECTED with on LinkedIn: they ACCEPTED his connection request${firstTouchDate ? ` (invite sent ${firstTouchDate})` : ''}, so this is the first real message in a brand-new 1st-degree connection.`
      : `a contact he ALREADY sent a connection request to${firstTouchDate ? ` on ${firstTouchDate}` : ''}. That request has not been accepted or answered.`}

${connected
  ? 'YOU ARE ALREADY CONNECTED. The invite was accepted, so do NOT say you sent a request, do NOT ask whether it arrived, and do NOT imply the connection is still pending. A short, warm nod to having just connected is fine; then go to the real reason for writing.'
  : 'THIS IS NOT A NEW CONNECTION REQUEST. The invite is already out, so do not write "I would like to connect" or restate it. Write the NEXT message: a real, purposeful note that moves things forward.'}

THE RECIPIENT:
- Name: ${name}
- Their role: ${recipientRole || '(unknown)'}
- Company: ${company || '(unknown)'}

THE THREAD SO FAR (most recent last). Read it: never repeat a point, proof, or ask already made here, and do NOT open by narrating it or dwelling on the lack of a reply:
${history}

THREAD STATE: ${thread.stateLine}
${thread.recentPitch ? `
NUDGE MODE (a substantive message already went out recently and is unanswered):
- Write a SHORT nudge, not a new pitch. Do NOT reintroduce ${idn.firstName}, do NOT restate proof points already in the thread, and do NOT repeat the earlier ask word for word.
- Reference the earlier note lightly and specifically, naming what it was about using the role/company from the thread above (e.g. "following up on my note from ${thread.lastSub ? String(thread.lastSub.timestamp).slice(0, 10) : 'the other day'} about the role at ${company || 'their company'}"). Do NOT use the bare, needy "just following up"; the reference must name the prior topic. Then add exactly ONE new, specific thing: a fresh detail, a relevant update, or a lighter, human touch. If there is genuinely nothing new to add, keep it to a one or two sentence friendly bump.
` : ''}
THE PURPOSE:
${purpose}

ABOUT ${idn.firstName.toUpperCase()} (ground the message in this, never copy verbatim):
${cvExcerpt}

HARD RULES:
- Open with "Hi ${recipientFirst}," then ${connected ? 'optionally one short warm clause about having just connected, then ' : ''}go to the real reason for writing: specific interest in ${company || 'their company'} and that ${idn.firstName} applied there. Lead with intent and value, in a confident tone.
- ${connected
    ? 'You are ALREADY connected, so NEVER say you "sent a connection request", "wanted to make sure this reached you", "reach you directly", or reference a pending or unanswered invite in any way. Treat the connection as established.'
    : 'Do NOT open by mentioning the earlier message, and NEVER say you "have not heard back" or that the silence is "fine". Being ignored is not the story; the candidacy is. If you reference the prior connection request at all, make it a brief, confident half-clause in the MIDDLE (for example, "I also sent a connection request recently, but wanted to reach you directly"), never an apology and never an opener.'}
- ${thread.recentPitch ? 'Do NOT dump a full proof point the thread already covered; at most add ONE new specific detail not previously mentioned.' : `Then give one concrete proof point about ${idn.firstName} from the CV or portfolio that makes him worth a reply.`}
- Close with ONE clear, low-friction ask: a quick reply, or being pointed to the right person for the relevant role. Do NOT ask for a call, a chat, a quick call, time on their calendar, or "15/20/30 minutes" — everyone is busy and a meeting ask reads as tone-deaf. Not a hard pitch.
- Length: ${thread.recentPitch ? '40 to 70 words. A nudge is short by design.' : '90 to 150 words. Longer than a connection note but still tight.'} Never a wall of text.
- STRUCTURE: write the body as ${thread.recentPitch ? '1 to 2 very short paragraphs' : '2 or 3 short paragraphs'} separated by a BLANK LINE (a literal double newline, \\n\\n, between paragraphs). It must be easy to scan on a phone. Do NOT return one dense block of text.
- NO em dashes. Use periods, commas, semicolons, colons, or parentheses.
- BANNED phrasings, they read as needy and get the message deleted: "haven't heard back", "never heard back", "which is fine", "I know you are busy", "just following up", "circling back", "wanted to reconnect", "sorry to bother", "I hope this finds you well", "quick question", "pick your brain", and any apology for writing.
- End with a sign-off line: "Thanks, ${idn.firstName}".
- No emojis. No mention of being desperate or unemployed.

Return ONLY the message text, ready to paste, including the "Hi ${recipientFirst}," opener and the "Thanks, ${idn.firstName}" sign-off. No preface, no quotes, no explanation.`;

    let response = cleanProse((await generateText(prompt, { model: draftModel(), maxTokens: 500 })).trim());
    response = (await reviseForCadence(response, { surface: 'prose' })).text;
    res.json({ response, length: response.length, recipient: { source: 'ta', id, name }, inmail: !connected });
  } catch (err) {
    console.error('Error generating follow-up message:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/linkedin-drafts/archive-contact — dispo a stale connect-queue contact
// (left the company, or changed to an unrelated role). Sets status Archived and
// appends a dated reason to notes, preserving the rest, so the contact drops off
// the queue and never gets outreach. It is NOT deleted: the record stays on the
// Network tab, auditable, and can be re-added fresh if they land at a target co.
const ARCHIVE_REASONS = { 'left-company': 'Left the company', 'changed-role': 'Changed role' };
router.post('/api/linkedin-drafts/archive-contact', (req, res) => {
  try {
    const { source, id, reason } = req.body || {};
    const reasonText = ARCHIVE_REASONS[reason];
    if (!source || id == null) return res.status(400).json({ error: 'source and id are required.' });
    if (!reasonText) return res.status(400).json({ error: `reason must be one of: ${Object.keys(ARCHIVE_REASONS).join(', ')}` });
    // This WRITES, and it writes to the target-talent book by id. It accepted a
    // source and then ignored it, so archiving a referral would have set some
    // unrelated target-talent contact to Archived. Refuse rather than write to the
    // wrong person: archiving the other books needs their own writers, and a
    // clear error is far better than a silent mis-write to real data.
    if (String(source) !== 'ta') {
      return res.status(400).json({ error: 'Archiving is only supported for TA Outreach contacts right now. Change the status on the contact itself.' });
    }
    const rows = parseTargetTalentMd();
    const row = rows.find(r => String(r.id) === String(id));
    if (!row) return res.status(404).json({ error: 'Contact not found.' });
    const date = new Date().toISOString().slice(0, 10);
    const existing = (row.notes || '').trim();
    const notes = `${existing ? existing + ' · ' : ''}Archived ${date}: ${reasonText}`;
    const ok = updateTTLine(Number(id), { status: 'Archived', notes });
    if (!ok) return res.status(404).json({ error: 'Contact not found.' });
    res.json({ ok: true, status: 'Archived', reason: reasonText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/linkedin-ssi/tracker — record weekly SSI update

