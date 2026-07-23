import express from 'express';
import fs from 'fs';
import { collectWeeklyMetrics } from '../lib/weekly-collect.mjs';
import { evaluateFloors } from '../lib/review-thresholds.mjs';
import { REVIEW_LOG_PATH, BUILD_LOCK_PATH } from '../config.mjs';
import { logConnect, readConnects } from '../lib/connects.mjs';

export const router = express.Router();

// GET /api/metrics/weekly — the current week's leading indicators + floor
// evaluation, for the dashboard tracking view. Same numbers the CLI reviews.
router.get('/api/metrics/weekly', (req, res) => {
  try {
    const { weekStart, weekEnd, metrics } = collectWeeklyMetrics(new Date());
    res.json({ weekStart, weekEnd, metrics, floors: evaluateFloors(metrics) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/review/status — the last review and the current build-lock state.
router.get('/api/review/status', (req, res) => {
  try {
    let lock = { locked: false };
    try { lock = JSON.parse(fs.readFileSync(BUILD_LOCK_PATH, 'utf8')); } catch { /* none yet */ }
    let log = [];
    try { log = JSON.parse(fs.readFileSync(REVIEW_LOG_PATH, 'utf8')) || []; } catch { /* none yet */ }
    res.json({ lock, lastReview: log[log.length - 1] || null, history: log.slice(-8) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET/POST /api/linkedin/connects — read or append the manual connect tally that
// feeds the weekly LinkedIn-connects floor.
router.get('/api/linkedin/connects', (req, res) => {
  try { res.json({ connects: readConnects() || [] }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/api/linkedin/connects', (req, res) => {
  try {
    const { name, source, date } = req.body || {};
    const list = logConnect({ name, source, date });
    res.json({ ok: true, total: list.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
