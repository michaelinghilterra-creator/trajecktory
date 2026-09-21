/**
 * sequences.mjs (route) — outreach sequence API.
 *
 * GET  /api/sequences/templates         — list available sequence templates
 * GET  /api/sequences/:source/:id       — get current sequence state for a contact
 * POST /api/sequences/:source/:id/start — start a sequence for a contact
 * POST /api/sequences/:source/:id/advance — mark current step done, advance clock
 * POST /api/sequences/:source/:id/pause   — pause (e.g., reply received)
 * POST /api/sequences/:source/:id/resume  — un-pause
 *
 * Draft generation is NOT done here — the follow-up draft endpoint
 * (/api/followups/:appNum/draft) and the TA draft endpoint already handle that.
 * A dedicated sequence-draft endpoint will be added when the UI builds the
 * template-aware draft experience (item 6 of the contact-centric outreach build).
 *
 * HITL guarantee: nothing in this route sends a message. Sequences only track
 * state; the user approves every draft before it leaves their inbox.
 */

import express from 'express';
import {
  startSequence, advanceSequence, pauseSequence, resumeSequence,
  expectedNextChannel, getSequence, getTemplate, getAllTemplates,
} from '../lib/sequences.mjs';
import { contactChannelBucket } from '../lib/followups.mjs';
import { parseTargetTalentMd } from '../lib/target-talent.mjs';

export const router = express.Router();

const VALID_SOURCES = new Set(['ta']);

function parseContact(req, res) {
  const { source, id } = req.params;
  if (!VALID_SOURCES.has(source)) {
    res.status(400).json({ error: `source must be one of: ${[...VALID_SOURCES].join(', ')}` });
    return null;
  }
  const numId = parseInt(id, 10);
  if (isNaN(numId)) {
    res.status(400).json({ error: 'id must be an integer' });
    return null;
  }
  return { source, id: numId };
}

// GET /api/sequences/templates
router.get('/api/sequences/templates', (req, res) => {
  try { res.json({ templates: getAllTemplates() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/sequences/:source/:id
router.get('/api/sequences/:source/:id', (req, res) => {
  const contact = parseContact(req, res);
  if (!contact) return;
  try {
    const state = getSequence(contact.source, contact.id);
    res.json({ state });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/sequences/:source/:id/start  { sequenceId, startDate? }
router.post('/api/sequences/:source/:id/start', (req, res) => {
  const contact = parseContact(req, res);
  if (!contact) return;
  try {
    const { sequenceId, startDate } = req.body || {};
    if (!sequenceId) return res.status(400).json({ error: 'sequenceId required' });
    const result = startSequence(contact.source, contact.id, sequenceId, startDate);
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /api/sequences/:source/:id/advance  { date?, channel? }
router.post('/api/sequences/:source/:id/advance', (req, res) => {
  const contact = parseContact(req, res);
  if (!contact) return;
  try {
    const { date, channel: requestedChannel } = req.body || {};
    const talent = contact.source === 'ta'
      ? parseTargetTalentMd().find(row => Number(row.id) === contact.id)
      : null;
    let result;
    if (talent) {
      let channel;
      if (requestedChannel != null) {
        channel = String(requestedChannel).toLowerCase();
        if (!['linkedin', 'email'].includes(channel)) {
          return res.status(400).json({ error: 'channel must be linkedin or email' });
        }
      }
      const { hasEmail, hasLinkedIn } = contactChannelBucket(talent);
      const available = { email: hasEmail, linkedin: hasLinkedIn };
      const state = getSequence(contact.source, contact.id);
      const template = getTemplate(state?.sequenceId);
      if (!channel && expectedNextChannel(state, template) === 'either') {
        channel = hasLinkedIn ? 'linkedin' : 'email';
      }
      result = advanceSequence(contact.source, contact.id, date, channel, { available });
    } else {
      result = advanceSequence(contact.source, contact.id, date);
    }
    res.json({ ok: true, ...result });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// POST /api/sequences/:source/:id/pause  { date? }
router.post('/api/sequences/:source/:id/pause', (req, res) => {
  const contact = parseContact(req, res);
  if (!contact) return;
  try {
    const { date } = req.body || {};
    const entry = pauseSequence(contact.source, contact.id, date);
    res.json({ ok: true, entry });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/sequences/:source/:id/resume
router.post('/api/sequences/:source/:id/resume', (req, res) => {
  const contact = parseContact(req, res);
  if (!contact) return;
  try {
    const entry = resumeSequence(contact.source, contact.id);
    res.json({ ok: true, entry });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
