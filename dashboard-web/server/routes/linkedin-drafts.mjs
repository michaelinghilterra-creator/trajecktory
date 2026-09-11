// LinkedIn SSI draft generation (Claude-backed): split from linkedin-ssi.mjs to
// keep each module focused and under the size budget.
import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { generateText, readOptionalProjectFile, draftModel } from '../lib/anthropic.mjs';
import { cleanProse, stripDraftMeta } from '../lib/text-hygiene.mjs';
import { reviseForCadence } from '../lib/cadence-revise.mjs';
import { finishDraft } from '../lib/finish-draft.mjs';
import { loadCompanyResearch } from '../lib/report-research.mjs';
import { loadInfluencer, toneInstruction, fitConnectNote } from '../lib/linkedin-ssi.mjs';
import { computeConnectQueue, computeBothQueue } from '../lib/followups.mjs';
import { parseTargetTalentMd, updateTTLine, readTTCorrespondence, findRelatedApps } from '../lib/target-talent.mjs';
import { parseReferralsMd, referralTitle } from '../lib/referrals.mjs';
import { getLinkedInStatus } from '../lib/tt-linkedin.mjs';
import { getIdentity, getOutreachPolicy } from '../lib/profile.mjs';
import { getPersonContext } from '../lib/person-context.mjs';
import { canContact, logOutreachOverride } from '../lib/outreach-policy.mjs';
import { readEngagementLog } from '../lib/engagement-log.mjs';
import { getInmailBudget, decrementInmail, setInmailRemaining } from '../lib/inmail-budget.mjs';
import { ACTIVE_STATUSES, findSubmittedApplication } from '../lib/statuses.mjs';
import { getProfile } from '../../../lib/outreach-rubric.mjs';
import { resolveInfluenceTier } from '../../../lib/influence-tier.mjs';
import { buildPacket, buildPacketFromFields } from '../../../lib/outreach-packet.mjs';
import { buildAugustPrompt, parseDraftText, finishOptionsFor } from '../../../lib/outreach-voice.mjs';

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
      role: row.title || '', company: row.company || '', reason: '', notes: row.notes || '',
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
      // Referral titles are stored as the first segment of Notes; `where` is
      // where the person actually works now.
      role: referralTitle(row.notes), company: row.where || '', reason: row.target || '', notes: row.notes || '',
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
      role: row.role || '', company: '', reason: row.whyFollow || '', notes: row.notes || '',
    };
  }
  return null;
}

export function mergeConnectPacketContext(packet, { tone = '', reason = '', angleGuidance = '', referralTarget = '' } = {}) {
  const additions = [
    reason ? `Reason: ${reason}` : '',
    angleGuidance ? `Angle guidance: ${angleGuidance}` : '',
    referralTarget ? `Referral target: ${referralTarget}` : '',
    tone ? `Tone guidance: ${toneInstruction(tone)}` : '',
  ].filter(Boolean);
  if (!additions.length) return packet;
  return {
    ...packet,
    recipient: {
      ...packet.recipient,
      notesExcerpt: [packet.recipient?.notesExcerpt, ...additions].filter(Boolean).join(' · '),
    },
  };
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
    const cvMd = readOptionalProjectFile(projectRoot, 'cv.md');
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

Respond with the comment text ready to paste, without quotes, a preface, or an explanation.`;

    const response = await generateText(prompt, { model: draftModel(), maxTokens: 300 });
    res.json({ response: (await reviseForCadence(stripDraftMeta(cleanProse(response.trim())), { surface: 'prose' })).text });
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
    const cvMd = readOptionalProjectFile(ROOT_DIR, 'cv.md');
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

Respond with the reply text ready to paste, without quotes, a preface, or an explanation.`;

    const response = await generateText(prompt, { model: draftModel(), maxTokens: 400 });
    res.json({ response: (await reviseForCadence(stripDraftMeta(cleanProse(response.trim())), { surface: 'prose' })).text });
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

    const id = getIdentity();
    const recipientRole = influencer.role || theirRole || '';
    const recipientTier = resolveInfluenceTier({ notes: influencer.notes, title: recipientRole }).tier;

    const angleGuidance = {
      'Reference Post': priorEngagement
        ? `Reference the specific post topic ${id.firstName} already commented on: "${priorEngagement}". Make it clear this is a follow-up to that engagement.`
        : 'Reference a generic recent post from them (since the specific topic is not provided, allude to a recent post without naming details).',
      'Mutual Interest': `Anchor on shared focus area: ${theirRole || influencer.role || 'GTM / RevOps / Analytics'}. Signal ${id.firstName} is a fellow operator in this space, not a job seeker.`,
      'Shared Network': 'Reference that they have mutual connections in the GTM / RevOps community. Do not name specific people.',
      'Career Stage': 'Briefly anchor on ${id.firstName} being a Director-level BI / RevOps leader exploring the next chapter. Keep it dignified, not desperate.',
    };

    const surfaceId = 'connect_note_influencer';
    const profile = getProfile(surfaceId);
    const packet = buildPacketFromFields({
      kind: 'connect_note',
      name: influencer.name,
      role: recipientRole,
      company: influencer.company || '',
      notes: [influencer.engagementTip || influencer.track || '', angleGuidance[angle] || angleGuidance['Reference Post'], toneInstruction(tone)].filter(Boolean).join(' · '),
      tier: recipientTier,
    });
    const prompt = buildAugustPrompt(packet);
    const result = parseDraftText(await generateText(prompt, {
      model: draftModel(), maxTokens: 900, label: `draft:${packet.surfaceId}`,
    }));
    if (!result?.body) return res.status(500).json({ error: 'Could not parse connection note from model output' });
    const draft = await finishDraft({
      body: result.body,
      surface: surfaceId,
      cadence: false,
      ...finishOptionsFor(packet),
    });
    const fitted = fitConnectNote(draft.body, id.firstName, profile.hardCap);
    res.json({
      response: fitted.text,
      length: fitted.length,
      review: null,
      reviewStatus: 'pending',
      surfaceId,
      gradeContext: {
        surfaceId, source: 'influencer', id: influencer.id, appId: null,
        recipientRole, recipientTier, appliedRole: '', appliedDate: '',
      },
    });
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
    const { source, id, angle = '' } = body;
    const tone = String(body.tone || '').trim();

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
    const suppliedReason  = String(body.reason || '').trim();
    const reason          = (suppliedReason || resolved?.reason || '').trim();
    const src             = source || resolved?.source || 'ta';
    const recipientTier   = resolveInfluenceTier({
      notes: body.notes || resolved?.notes || '',
      title: recipientRole,
    }).tier;
    if (!name) {
      return res.status(400).json({ error: 'Provide a recipient: source+id from the connect queue, or a name.' });
    }
    if (resolved?.id != null) {
      const context = getPersonContext(src, resolved.id);
      const decision = canContact({ timeline: context?.timeline || [], channel: 'linkedin', company: recipientCompany, policy: getOutreachPolicy() });
      if (!decision.allowed && !body.override) return res.json({ blocked: true, blocks: decision.blocks, nextEligible: decision.nextEligible });
      if (!decision.allowed) logOutreachOverride({ contactRef: `${src}:${resolved.id}`, channel: 'linkedin', blocks: decision.blocks });
    }

    const idn = getIdentity();

    const relatedApps = findRelatedApps(recipientCompany);
    const topApp = relatedApps.find(app => ACTIVE_STATUSES.includes(app.status)) || relatedApps[0];
    const submittedApp = findSubmittedApplication(relatedApps);
    const appliedRole = submittedApp?.role || '';
    const appliedDate = submittedApp?.date || '';
    const companyResearch = topApp ? loadCompanyResearch(topApp.report) : '';

    // "Why connect" anchor for a TA / gatekeeper contact: a fellow-operator framing.
    const angleHint = angle ? ` (${angle})` : '';
    const guidance = reason
      ? `Anchor on this specific context${angleHint}: ${reason}`
      : `Anchor on ${name}'s work${recipientRole ? ` as ${recipientRole}` : ''}${recipientCompany ? ` at ${recipientCompany}` : ''} and on ${idn.firstName} being a fellow operator in the GTM / RevOps / analytics space, not a job seeker${angleHint}.`;

    // One model call, not two. This used to redraft at a stricter target when the
    // note overran 300 characters, which cost a second full rubric call on the
    // plan path. fitConnectNote trims at a sentence boundary and preserves the
    // sign-off, so an overrun is repaired deterministically instead of by asking
    // the model again. finishDraft's own hardFit is a blunt slice that can cut
    // mid-word, so it is left off here and fitConnectNote owns the cap.
    const basePacket = resolved?.id != null && ['ta', 'referral'].includes(src)
      ? buildPacket({ source: src, id: resolved.id, kind: 'connect_note' })
      : buildPacketFromFields({
        kind: 'connect_note', name, role: recipientRole, company: recipientCompany,
        notes: [guidance, tone ? toneInstruction(tone) : ''].filter(Boolean).join(' · '),
        tier: recipientTier, relatedApps,
        research: companyResearch,
      });
    const packet = resolved?.id != null && ['ta', 'referral'].includes(src)
      ? mergeConnectPacketContext(basePacket, {
        tone,
        reason: suppliedReason,
        angleGuidance: angle ? guidance : '',
        referralTarget: src === 'referral' ? resolved?.reason || '' : '',
      })
      : basePacket;
    const prompt = buildAugustPrompt(packet);
    const result = parseDraftText(await generateText(prompt, {
      model: draftModel(), maxTokens: 900, label: `draft:${packet.surfaceId}`,
    }));
    if (!result?.body) return res.status(500).json({ error: 'Could not parse connection note from model output' });
    const note = await finishDraft({
      body: result.body, surface: 'connect_note_influencer', cadence: false,
      ...finishOptionsFor(packet),
    });
    // Trimming is deterministic but not free: an overrun gets cut at the last
    // sentence boundary, and when none is late enough it ends at a word boundary
    // mid-thought. Say so rather than shipping a silently shortened note.
    const truncated = note.body.length > 300;
    const fitted = fitConnectNote(note.body, idn.firstName);
    if (truncated) {
      console.warn('[connect-note] trimmed %d chars to fit the 300 cap', note.body.length - fitted.length);
    }
    const gradeId = id ?? resolved?.id ?? null;
    res.json({ response: fitted.text, length: fitted.length, truncated, review: null, reviewStatus: 'pending', surfaceId: 'connect_note_influencer', gradeContext: {
      surfaceId: 'connect_note_influencer', source: src, id: gradeId, appId: topApp?.id ?? null,
      recipientRole, recipientTier, appliedRole, appliedDate,
    }, recipient: { source: src, id: gradeId, name } });
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
    const name = recipient.name || (body.name || '').trim();
    const recipientRole = recipient.role || '';
    const company = recipient.company || '';
    const relatedApps = findRelatedApps(company);
    const topApp = relatedApps.find(app => ACTIVE_STATUSES.includes(app.status)) || relatedApps[0];
    const submittedApp = findSubmittedApplication(relatedApps);
    const appliedRole = submittedApp?.role || '';
    const appliedDate = submittedApp?.date || '';
    const recipientTier = resolveInfluenceTier({ notes: recipient.notes, title: recipientRole }).tier;
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
    const packet = buildPacket({ source, id, kind: 'li_followup' });
    const prompt = buildAugustPrompt(packet);
    const result = parseDraftText(await generateText(prompt, {
      model: draftModel(), maxTokens: 900, label: `draft:${packet.surfaceId}`,
    }));
    if (!result?.body) return res.status(500).json({ error: 'Could not parse follow-up message from model output' });
    const fu = await finishDraft({
      body: result.body, surface: 'li_followup',
      cadence: false,
      ...finishOptionsFor(packet),
    });
    res.json({ response: fu.body, length: fu.body.length, review: null, reviewStatus: 'pending', surfaceId: 'li_followup', gradeContext: {
      surfaceId: 'li_followup', source, id, appId: topApp?.id ?? null,
      recipientRole, recipientTier, appliedRole, appliedDate,
    }, recipient: { source: 'ta', id, name }, inmail: !connected });
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

