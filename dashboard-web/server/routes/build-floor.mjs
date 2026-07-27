import express from 'express';
import { floorStatus, togglePto, useReset } from '../lib/rolling-floor.mjs';

export const router = express.Router();

// ── Rolling outreach floor (v1) ─────────────────────────────────────────────────
// The live build-cap gate. See lib/rolling-floor.mjs for the model.

// GET /api/build-floor — the live status (trailing count, floor, window, gate).
router.get('/api/build-floor', (req, res) => {
  try { res.json(floorStatus(new Date())); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/build-floor/pto { date, on } — mark (on:true, default) or clear a day off.
router.post('/api/build-floor/pto', (req, res) => {
  try {
    const { date, on } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      return res.status(400).json({ error: 'A date (YYYY-MM-DD) is required.' });
    }
    res.json(togglePto(date, on !== false, new Date()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/build-floor/reset — use the monthly reset (starts the grace period).
// 409 when one has already been used this calendar month; the body still carries
// the current status so the UI can refresh in place.
router.post('/api/build-floor/reset', (req, res) => {
  try {
    const r = useReset(new Date());
    if (!r.ok) return res.status(409).json({ error: r.reason, status: r.status });
    res.json(r.status);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
