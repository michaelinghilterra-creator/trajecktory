import express from 'express';
import { parseReferralsMd, appendReferralRows, updateReferralLine, deleteReferralLine, REFERRAL_STATUSES } from '../lib/referrals.mjs';

export const router = express.Router();

// ── Referrals ─────────────────────────────────────────────────────────────────
// The warm channel: people in the user's own network who can introduce them or
// flag an application internally. CRUD over data/referrals.md. No LLM, no
// correspondence log — the reconnect/ask templates are static UI copy the user
// personalizes and sends themselves.

// GET /api/referrals — list all + the status vocabulary for the UI's dropdown.
router.get('/api/referrals', (req, res) => {
  try {
    const rows = parseReferralsMd().map(({ raw, ...rest }) => rest);
    res.json({ referrals: rows, statuses: REFERRAL_STATUSES });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/referrals — add one person. Only `name` is required.
router.post('/api/referrals', (req, res) => {
  try {
    const { name, how, where, target, status, lastTouch, notes } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'A name is required.' });
    if (status && !REFERRAL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${REFERRAL_STATUSES.join(', ')}` });
    }
    const [written] = appendReferralRows([{ name, how, where, target, status, lastTouch, notes }]);
    res.json({ ok: true, id: written.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/referrals/:id — update any mutable cell.
router.patch('/api/referrals/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, how, where, target, status, lastTouch, notes } = req.body || {};
    if (status && !REFERRAL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${REFERRAL_STATUSES.join(', ')}` });
    }
    const ok = updateReferralLine(id, { name, how, where, target, status, lastTouch, notes });
    if (!ok) return res.status(404).json({ error: 'Referral not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/referrals/:id — remove a person from the tracker.
router.delete('/api/referrals/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ok = deleteReferralLine(id);
    if (!ok) return res.status(404).json({ error: 'Referral not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
