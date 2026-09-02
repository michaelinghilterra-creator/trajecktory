import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { listPosts, listQueued, createPost, updatePost, deletePost, getPost, attachBuffer, applyBufferMetrics, LANE_CHANNEL } from '../lib/posts.mjs';
import { generateText, readProjectFile, draftModel } from '../lib/anthropic.mjs';
import { cleanProse, stripDraftMeta } from '../lib/text-hygiene.mjs';
import { reviseForCadence } from '../lib/cadence-revise.mjs';
import { getIdentity } from '../lib/profile.mjs';
import { listChannels, createScheduledPost, fetchPostMetrics, toDueIso, SERVICE_FOR } from '../lib/buffer.mjs';

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

// POST /api/posts/push-to-buffer { ids:[postId], dryRun? } — schedule the selected
// posts to Buffer (which publishes them to LinkedIn/X at their scheduled time).
// Idempotent and plan-agnostic:
//   - LinkedIn posts carry their linkComment as the platform first comment (auto
//     on paid plans; on free it's deferred to a manual paste, not a hard failure).
//   - X posts written as numbered threads are split into a real Buffer thread.
//   - The scheduled-post cap is Buffer's, not ours: we schedule earliest-first and
//     only stop a channel if Buffer itself returns a queue-full (LimitReachedError),
//     marking the rest "waiting". So Free (10) and Essentials (5000) both work with
//     no hardcoded number.
//   - A post already carrying a Buffer id is skipped, never scheduled twice.
// dryRun:true validates and reports what WOULD happen without creating anything.
router.post('/api/posts/push-to-buffer', async (req, res) => {
  try {
    const body = req.body || {};
    const ids = Array.isArray(body.ids) ? body.ids.filter(x => typeof x === 'string') : [];
    const dryRun = !!body.dryRun;
    if (!ids.length) return res.status(400).json({ error: 'Select at least one post to push.' });

    const selected = ids.map(getPost).filter(Boolean);
    const missing = ids.length - selected.length;
    const results = selected
      .filter(p => p.channel === 'x')
      .map(p => ({
        id: p.id,
        title: p.title,
        channel: 'x',
        ok: false,
        status: 'stood-down',
        message: 'The X channel has been stood down. This post was not sent.',
      }));

    // Only LinkedIn remains schedulable. Historical X posts are reported above.
    const byChannel = { linkedin: selected.filter(p => p.channel !== 'x') };
    byChannel.linkedin.sort((a, b) => String(a.scheduledFor || '').localeCompare(String(b.scheduledFor || '')));

    let channels = {};
    if (byChannel.linkedin.length) {
      try { channels = await listChannels(); }
      catch (err) {
        if (!results.length) return res.status(400).json({ error: err.message });
        for (const p of byChannel.linkedin) {
          results.push({ id: p.id, title: p.title, channel: 'linkedin', ok: false, status: 'no-channel', message: err.message });
        }
        byChannel.linkedin = [];
      }
    }

    for (const key of ['linkedin']) {
      const group = byChannel[key];
      if (!group.length) continue;
      const label = 'LinkedIn';
      const chan = channels[key];
      if (!chan || !chan.id) {
        for (const p of group) results.push({ id: p.id, title: p.title, channel: key, ok: false, status: 'no-channel', message: `No ${label} account is connected in Buffer.` });
        continue;
      }

      let queueFull = false; // flips once Buffer says this channel's queue is full
      for (const p of group) {
        if (p.buffer && p.buffer.id) { results.push({ id: p.id, title: p.title, channel: key, ok: true, status: 'already', message: 'Already scheduled on Buffer.', bufferId: p.buffer.id }); continue; }
        if (queueFull) { results.push({ id: p.id, title: p.title, channel: key, ok: false, status: 'waiting', message: `${label} queue is full on your Buffer plan. This one waits for a slot to open.` }); continue; }

        // Shape the create input for this channel.
        const text = p.text;
        const firstComment = p.linkComment || '';
        const threadParts = [];

        let dueAtIso;
        try { dueAtIso = toDueIso(p.scheduledFor); }
        catch (err) { results.push({ id: p.id, title: p.title, channel: key, ok: false, status: 'error', message: err.message }); continue; }

        if (dryRun) {
          const extras = [];
          if (threadParts.length) extras.push(`${threadParts.length + 1}-tweet thread`);
          if (firstComment) extras.push('first comment');
          results.push({ id: p.id, title: p.title, channel: key, ok: true, status: 'ready', dueAt: dueAtIso, message: `Ready: schedules for ${dueAtIso}${extras.length ? ' (' + extras.join(', ') + ')' : ''}.` });
          continue;
        }

        try {
          let created, deferredFirstComment = '';
          try {
            created = await createScheduledPost({ channelId: chan.id, service: SERVICE_FOR[key], text, dueAtIso, firstComment, threadParts });
          } catch (err) {
            // Buffer's auto first-comment is a paid feature. On a plan without it,
            // still schedule the post body and hand the comment back for a manual
            // paste, rather than failing the whole post over a comment.
            if (firstComment && /first comment.*(paid|upgrade|plan)/i.test(err.message)) {
              created = await createScheduledPost({ channelId: chan.id, service: SERVICE_FOR[key], text, dueAtIso, firstComment: '', threadParts });
              deferredFirstComment = firstComment;
            } else {
              throw err;
            }
          }
          attachBuffer(p.id, created, { pendingFirstComment: deferredFirstComment });
          results.push({
            id: p.id, title: p.title, channel: key, ok: true, status: 'scheduled',
            dueAt: created.dueAt || dueAtIso, bufferId: created.id, permalink: created.externalLink || null,
            firstCommentDeferred: !!deferredFirstComment,
            message: deferredFirstComment
              ? `Scheduled for ${created.dueAt || dueAtIso}. Buffer's auto first-comment isn't on this plan, so add this as the first comment when it posts: ${deferredFirstComment}`
              : `Scheduled for ${created.dueAt || dueAtIso}.`,
          });
        } catch (err) {
          // Buffer says the queue is full: stop this channel, mark the rest waiting.
          if (err.bufferType === 'LimitReachedError') {
            queueFull = true;
            results.push({ id: p.id, title: p.title, channel: key, ok: false, status: 'waiting', message: `${label} queue is full on your Buffer plan. This one waits for a slot to open.` });
          } else {
            results.push({ id: p.id, title: p.title, channel: key, ok: false, status: 'error', message: err.message });
          }
        }
      }
    }

    const scheduled = results.filter(r => r.ok && (r.status === 'scheduled' || r.status === 'ready')).length;
    const already = results.filter(r => r.status === 'already').length;
    const waiting = results.filter(r => r.status === 'waiting').length;
    const failed = results.filter(r => !r.ok && r.status !== 'waiting').length;
    res.json({ ok: true, dryRun, scheduled, already, waiting, failed, missing, results });
  } catch (err) {
    console.error('push-to-buffer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/posts/pull-metrics { ids? } — pull live engagement from Buffer for our
// pushed posts and auto-fill the tracker. With no ids, syncs every post that has a
// Buffer id. Buffer collects metrics on a daily cadence, so a post shows real
// numbers up to ~24h after it SENDS; before that it reports 'pending'.
router.post('/api/posts/pull-metrics', async (req, res) => {
  try {
    const body = req.body || {};
    const onlyIds = Array.isArray(body.ids) ? body.ids.filter(x => typeof x === 'string') : null;

    const all = listPosts().posts || [];
    const targets = all.filter(p => p.buffer && p.buffer.id && (!onlyIds || onlyIds.includes(p.id)));
    if (!targets.length) return res.json({ ok: true, synced: 0, pending: 0, failed: 0, results: [], note: 'No posts have been pushed to Buffer yet.' });

    const results = [];
    for (const p of targets) {
      try {
        const m = await fetchPostMetrics(p.buffer.id);
        if (!m.found) { results.push({ id: p.id, title: p.title, status: 'gone', message: 'Post not found on Buffer (deleted there?).' }); continue; }
        if (m.filled === 0) {
          results.push({ id: p.id, title: p.title, status: 'pending', bufferStatus: m.status, message: m.status === 'sent' ? 'Sent; Buffer has not reported metrics yet (up to ~24h).' : `Not published yet (${m.status}).` });
          continue;
        }
        applyBufferMetrics(p.id, { metrics: m.metrics, updatedAt: m.updatedAt });
        results.push({ id: p.id, title: p.title, status: 'synced', fields: Object.keys(m.metrics), updatedAt: m.updatedAt, message: `Synced ${m.filled} metric(s).` });
      } catch (err) {
        results.push({ id: p.id, title: p.title, status: 'error', message: err.message });
      }
    }
    const synced = results.filter(r => r.status === 'synced').length;
    const pending = results.filter(r => r.status === 'pending').length;
    const failed = results.filter(r => r.status === 'error' || r.status === 'gone').length;
    res.json({ ok: true, synced, pending, failed, results });
  } catch (err) {
    console.error('pull-metrics error:', err);
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

    const text = (await reviseForCadence(stripDraftMeta(cleanProse((await generateText(prompt, { model: draftModel(), maxTokens: 500 })).trim())), { surface: 'prose' })).text;
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

    const reply = (await reviseForCadence(stripDraftMeta(cleanProse((await generateText(prompt, { model: draftModel(), maxTokens: 320 })).trim())), { surface: 'prose' })).text;
    if (!reply) return res.status(502).json({ error: 'The model returned an empty reply. Try again.' });
    res.json({ ok: true, reply });
  } catch (err) {
    console.error('Error generating comment reply:', err);
    res.status(500).json({ error: err.message });
  }
});
