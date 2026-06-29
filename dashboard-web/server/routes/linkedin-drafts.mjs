// LinkedIn SSI draft generation (Claude-backed): split from linkedin-ssi.mjs to
// keep each module focused and under the size budget.
import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { generateText, readProjectFile } from '../lib/anthropic.mjs';
import { loadInfluencer, toneInstruction } from '../lib/linkedin-ssi.mjs';
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

    const response = await generateText(prompt, { model: 'claude-haiku-4-5', maxTokens: 300 });
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
      const text = await generateText(buildPrompt(targetMax), { model: 'claude-haiku-4-5', maxTokens: 220 });
      return text.trim();
    };

    // First pass: aim for 280 to leave margin
    let response = await callClaude(280);
    // Retry once with stricter target if over
    if (response.length > 300) {
      response = await callClaude(250);
    }
    // Smart trim: if still over 300, cut at last sentence boundary before 285 and reattach sign-off
    if (response.length > 300) {
      const SIGNOFF = `Thanks, ${id.firstName}`;
      const budget = 300 - SIGNOFF.length - 1; // 1 for the space/newline before sign-off
      const escFirst = id.firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let body = response.replace(new RegExp('\\s*Thanks,?\\s*' + escFirst + '\\.?\\s*$', 'i'), '').trim();
      if (body.length > budget) {
        const slice = body.slice(0, budget);
        // Prefer last sentence end (. ! ?) within the slice
        const lastSentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
        if (lastSentence > budget * 0.5) {
          body = slice.slice(0, lastSentence + 1);
        } else {
          // Fall back to last word boundary
          const lastSpace = slice.lastIndexOf(' ');
          body = (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).replace(/[,;:]+$/, '') + '.';
        }
      }
      response = `${body} ${SIGNOFF}`;
    }
    res.json({ response, length: response.length });
  } catch (err) {
    console.error('Error generating connect request:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/linkedin-ssi/tracker — record weekly SSI update

