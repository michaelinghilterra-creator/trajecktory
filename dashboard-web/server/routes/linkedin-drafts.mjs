// LinkedIn SSI draft generation (Claude-backed): split from linkedin-ssi.mjs to
// keep each module focused and under the size budget.
import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { generateText, readProjectFile, draftModel } from '../lib/anthropic.mjs';
import { loadInfluencer, toneInstruction, fitConnectNote, buildConnectPrompt } from '../lib/linkedin-ssi.mjs';
import { computeConnectQueue } from '../lib/followups.mjs';
import { getIdentity } from '../lib/profile.mjs';

export const router = express.Router();

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
    res.json({ response: response.trim() });
  } catch (err) {
    console.error('Error generating response:', err);
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
      return text.trim();
    };

    // First pass: aim for 280 to leave margin
    let response = await callClaude(280);
    // Retry once with stricter target if over
    if (response.length > 300) {
      response = await callClaude(250);
    }
    // Still over? Deterministically trim to the 300-char cap, keeping the sign-off.
    if (response.length > 300) {
      response = fitConnectNote(response, id.firstName).text;
    }
    res.json({ response, length: response.length });
  } catch (err) {
    console.error('Error generating connect request:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/linkedin-drafts/connect-queue — contacts reachable only via LinkedIn
// (a real handle, no sendable email): the fallback outreach lane for people whose
// address bounced, is org-blocked, or was never verifiable. Spans TA + recruiters.
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
// (TA or recruiter), or raw { name, role, company, reason, firstName } for an
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
      const queue = computeConnectQueue();
      resolved = queue.find(r => r.source === source && String(r.id) === String(id)) || null;
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

    let cvMd = '';
    try { cvMd = readProjectFile(ROOT_DIR, 'cv.md'); } catch {}
    const cvExcerpt = cvMd ? cvMd.slice(0, 3500) : '(CV not available)';
    const idn = getIdentity();

    // Source-specific "why connect" anchor. External recruiters place GTM / RevOps
    // leaders, so a credible-operator signal is appropriate; TA leads are peers.
    const angleHint = angle ? ` (${angle})` : '';
    const guidance = reason
      ? `Anchor on this specific context${angleHint}: ${reason}`
      : src === 'recruiter'
        ? `${idn.firstName} is a Director / Senior Director Revenue Operations and analytics leader. ${name}${recipientCompany ? ` at ${recipientCompany}` : ''} places GTM / RevOps leaders. Connect as a credible operator worth knowing for current and future searches${angleHint}; professional, not desperate.`
        : `Anchor on ${name}'s work${recipientRole ? ` as ${recipientRole}` : ''}${recipientCompany ? ` at ${recipientCompany}` : ''} and on ${idn.firstName} being a fellow operator in the GTM / RevOps / analytics space, not a job seeker${angleHint}.`;

    const buildPrompt = (targetMax) => buildConnectPrompt({
      senderName: idn.fullName, senderFirst: idn.firstName, senderHeadline: idn.headline,
      recipientName: name, recipientFirst, recipientRole, recipientCompany,
      guidance, cvExcerpt, tone, toneText: toneInstruction(tone), targetMax,
    });

    let response = (await generateText(buildPrompt(280), { model: draftModel(), maxTokens: 220 })).trim();
    if (response.length > 300) {
      response = (await generateText(buildPrompt(250), { model: draftModel(), maxTokens: 220 })).trim();
    }
    if (response.length > 300) {
      response = fitConnectNote(response, idn.firstName).text;
    }
    res.json({ response, length: response.length, recipient: { source: src, id: id ?? resolved?.id ?? null, name } });
  } catch (err) {
    console.error('Error generating connect note:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/linkedin-ssi/tracker — record weekly SSI update

