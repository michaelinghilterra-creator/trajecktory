import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { listPosts, listQueued, createPost, updatePost, deletePost, LANE_CHANNEL } from '../lib/posts.mjs';
import { generateText, readProjectFile, draftModel } from '../lib/anthropic.mjs';
import { getIdentity } from '../lib/profile.mjs';

export const router = express.Router();

// GET /api/posts — all posts + activity log
router.get('/api/posts', (req, res) => {
  try {
    res.json(listPosts());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/posts/queue — just the queued posts, for Claude / the Buffer MCP to
// pick up and schedule. Kept separate so an automation can poll it cheaply.
router.get('/api/posts/queue', (req, res) => {
  try {
    res.json({ queue: listQueued() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/posts { text, source?, lane?, channel?, linkComment?, type?, title?,
// metrics?, status? } — create a post/tracker entry
router.post('/api/posts', (req, res) => {
  try {
    const { text, source, lane, channel, linkComment, type, title, metrics, status } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'text is required' });
    res.json(createPost({ text, source, lane, channel, linkComment, type, title, metrics, status }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/posts/:id — edit text/lane/channel/linkComment, or move status
router.patch('/api/posts/:id', (req, res) => {
  try {
    const updated = updatePost(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Post not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/posts/:id — remove
router.delete('/api/posts/:id', (req, res) => {
  try {
    if (!deletePost(req.params.id)) return res.status(404).json({ error: 'Post not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/posts/generate { lane, channel?, topic? } — draft a post with Claude,
// in the user's voice, grounded in their CV. Saves it as a 'claude'-source draft
// and returns it, so it shows up in the composer for the user to edit.
router.post('/api/posts/generate', async (req, res) => {
  try {
    const { lane = 'professional', channel, topic = '' } = req.body || {};
    const useLane = lane === 'trajecktory' ? 'trajecktory' : 'professional';
    const useChannel = channel || LANE_CHANNEL[useLane];

    let cvMd = '';
    try { cvMd = readProjectFile(ROOT_DIR, 'cv.md'); } catch {}
    const cvExcerpt = cvMd ? cvMd.slice(0, 3500) : '(CV not available)';
    const id = getIdentity();
    const topicLine = topic && topic.trim()
      ? `TOPIC the user asked for (write about this specifically): ${topic.trim()}`
      : 'No topic was given. Pick one concrete idea from the CV grounding below (a real result, a lesson, a point of view) and build the post around it.';

    const prompt = useLane === 'trajecktory'
      ? `You are drafting a short build-in-public post for X (Twitter) from ${id.fullName}, about an open-source project they built called trajecktory: a local, AI-driven job-search command center (scan, evaluate, tailor resumes, track, follow up) with an honest analytics dashboard.

${topicLine}

VOICE: a builder sharing what they made and what they learned. Concrete, a little dry, no hype.

HARD RULES:
- Aim for under 280 characters. One tight thought, not a thread.
- NO em dashes. Use periods, commas, colons, or parentheses.
- No hashtag soup: at most one, only if it genuinely fits.
- No "excited to announce", no marketing voice, no emojis unless one truly earns its place.
- Do not put a URL in the post body; the link goes in a reply, so leave it out.
- Return ONLY the post text, ready to paste. No quotes, no preface, no explanation.`
      : `You are drafting a LinkedIn post from ${id.fullName} (${id.headline}, based in ${id.location}). The goal is credible thought-leadership that makes a hiring manager or peer in Revenue Operations and analytics want to follow ${id.firstName}. It is NOT a job-search announcement.

${topicLine}

ABOUT ${id.firstName.toUpperCase()} (ground the post in this real experience, do not copy verbatim):
${cvExcerpt}

VOICE: an operator sharing a specific, earned point of view. Lead with the insight, not with yourself.

HARD RULES:
- One to three short paragraphs. LinkedIn length, scannable, not an essay.
- Open with the idea, never with "I" or a generic hook like "Here's the thing".
- NO em dashes. Use periods, commas, colons, semicolons, or parentheses.
- No self-promotion, no "I'm open to work", no "reach out". Give value.
- Do not put a URL in the post body; any link goes in the first comment, so leave it out.
- At most one or two relevant hashtags at the very end, or none.
- No emojis unless one genuinely earns its place.
- Return ONLY the post text, ready to paste. No quotes, no preface, no explanation.`;

    const text = (await generateText(prompt, { model: draftModel(), maxTokens: 500 })).trim();
    if (!text) return res.status(502).json({ error: 'The model returned an empty draft. Try again.' });
    // Persist as a Claude-sourced draft so it lands in the composer, editable.
    const post = createPost({ text, source: 'claude', lane: useLane, channel: useChannel });
    res.json(post);
  } catch (err) {
    console.error('Error generating post:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/posts/reply { comment, postText?, tone? } — draft an on-message reply
// to a comment on one of the user's posts, in the content-series voice. Returns
// the reply text only; nothing is persisted (the user copies it to the platform).
router.post('/api/posts/reply', async (req, res) => {
  try {
    const { comment, postText = '', tone = '' } = req.body || {};
    if (!comment || !String(comment).trim()) return res.status(400).json({ error: 'comment is required' });

    const id = getIdentity();
    const ctx = String(postText || '').trim();
    const toneLine = tone && String(tone).trim() ? `- Extra tone note from the author: ${String(tone).trim()}.\n` : '';

    const prompt = `You are drafting ${id.fullName}'s reply to a comment on one of their LinkedIn/X posts. ${id.firstName}${id.headline ? ` (${id.headline})` : ''} is running a public content series about their job search, told with an operator's eye, using an open-source tool they built called trajecktory.

${ctx ? `THE POST the comment is on (reply in this context):\n"""\n${ctx.slice(0, 1500)}\n"""\n` : 'No post context was provided; reply to the comment on its own terms.\n'}
THE COMMENT to reply to:
"""
${String(comment).trim().slice(0, 1200)}
"""

VOICE AND MESSAGE RULES (follow every one):
- Senior operator voice. Warm, direct, specific. No corporate filler, no "Great question!", no "Thanks for sharing!".
- Keep the series message straight: trajecktory is the tool that made the search measurable, never a magic job-getter. NEVER state or imply an offer count, a screen count, or an application total. If a number helps, use a ratio or general framing, never a personal scoreboard.
- Add something specific or genuinely useful; do not just thank and agree. If the commenter disagrees, engage honestly. If they ask about the tool, it is free and open source.
- Never invent a fact, metric, or claim that is not in the post above.
- Under 60 words. NO em dashes; use periods, commas, colons, semicolons, or parentheses.
${toneLine}- Return ONLY the reply text, ready to paste. No quotes, no preface, no explanation.`;

    const reply = (await generateText(prompt, { model: draftModel(), maxTokens: 320 })).trim();
    if (!reply) return res.status(502).json({ error: 'The model returned an empty reply. Try again.' });
    res.json({ ok: true, reply });
  } catch (err) {
    console.error('Error generating comment reply:', err);
    res.status(500).json({ error: err.message });
  }
});
