// routes/coach.mjs — the AI Coach endpoints. Chat runs on the Claude plan by
// default (generateText → claude-cli when no key), grounded in the coach knowledge
// base plus the user's live state. It only PROPOSES actions; /act executes one
// after the user confirms. Mirrors the posts feature's route+lib+generateText shape.
import express from 'express';
import { generateText, draftModel } from '../lib/anthropic.mjs';
import { cleanProse } from '../lib/text-hygiene.mjs';
import { getIdentity } from '../lib/profile.mjs';
import {
  getMessages, appendMessage, clearMessages, getCachedBrief, setCachedBrief,
  coachState, buildSystemPrompt, buildChatPrompt, briefPrompt, parseAction, executeAction,
} from '../lib/coach.mjs';

export const router = express.Router();

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// GET /api/coach/history — the full rolling transcript.
router.get('/api/coach/history', (req, res) => {
  try { res.json({ messages: getMessages() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/coach/brief — the proactive daily brief. Cached per calendar day so
// opening the Coach repeatedly costs one generation a day; ?refresh=1 forces it.
router.get('/api/coach/brief', async (req, res) => {
  try {
    const today = localToday();
    const cached = getCachedBrief();
    if (!req.query.refresh && cached && cached.date === today && cached.text) {
      return res.json({ brief: cached.text, cached: true });
    }
    const state = coachState();
    const system = buildSystemPrompt(state, getIdentity());
    const text = cleanProse((await generateText(briefPrompt(state), { system, model: draftModel(), maxTokens: 320 })).trim());
    if (text) setCachedBrief(text, today);
    res.json({ brief: text, cached: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/coach/message { message } — one chat turn. Persists the user turn and
// the coach reply; returns the reply plus any single proposed action.
router.post('/api/coach/message', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Type a message first.' });
    if (message.length > 4000) return res.status(400).json({ error: 'That message is too long — try a shorter question.' });

    const prior = getMessages();                    // history BEFORE this turn
    appendMessage({ role: 'user', text: message });

    const state = coachState();
    const system = buildSystemPrompt(state, getIdentity());
    const raw = await generateText(buildChatPrompt(prior, message), { system, model: draftModel(), maxTokens: 700 });
    const { text, action } = parseAction(raw);
    // Clean the human-facing prose only; the action object (already peeled off by
    // parseAction) is never touched.
    const replyText = cleanProse(text) || "I'm here — could you say a bit more about what you're trying to do?";
    const saved = appendMessage({ role: 'coach', text: replyText, action });
    res.json({ reply: { id: saved.id, text: replyText, action, ts: saved.ts } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/coach/act { action } — execute a confirmed action, then log a short
// confirmation into the transcript so the history reads coherently.
router.post('/api/coach/act', (req, res) => {
  try {
    const action = req.body?.action;
    const result = executeAction(action);   // re-validates; throws on anything unsafe
    appendMessage({ role: 'coach', text: `✓ ${result.message}` });
    res.json({ ok: true, message: result.message });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/coach/clear — wipe the transcript (keeps the cached brief).
router.post('/api/coach/clear', (req, res) => {
  try { clearMessages(); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
