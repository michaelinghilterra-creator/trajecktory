import express from 'express';
import fs from 'fs';
import { collectWeeklyMetrics } from '../lib/weekly-collect.mjs';
import { evaluateFloors } from '../lib/review-thresholds.mjs';
import { runWeeklyReview } from '../lib/weekly-run.mjs';
import { REVIEW_LOG_PATH, BUILD_LOCK_PATH } from '../config.mjs';
import { logConnect, readConnects } from '../lib/connects.mjs';
import { actionSeries, applicationCohorts } from '../lib/activity.mjs';

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

// GET /api/activity/actions — daily counts of things the USER did, not rows the
// scanner produced. See lib/activity.mjs for why that distinction is the point.
router.get('/api/activity/actions', (req, res) => {
  try {
    const days = Math.min(180, Math.max(7, parseInt(req.query.days, 10) || 60));
    res.json(actionSeries({ days }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/activity/cohorts — applications grouped by the week they were SENT,
// with what became of each week. The only view here that can compare one week's
// approach against another's; everything else is a snapshot.
router.get('/api/activity/cohorts', (req, res) => {
  try {
    const weeks = Math.min(26, Math.max(2, parseInt(req.query.weeks, 10) || 8));
    res.json(applicationCohorts({ weeks }));
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

// POST /api/review/run — freeze THIS week into the review log and (re)compute the
// build lock, then return the same status shape GET /api/review/status serves so
// the caller can update in place. This is the deliberate snapshot: once a week is
// logged its numbers stop moving, so the week-over-week view reads frozen history
// rather than a live recompute. Runs the exact engine weekly-review.mjs runs.
router.post('/api/review/run', (req, res) => {
  try {
    const { weekStart, weekEnd, lock, entry, history } = runWeeklyReview({ now: new Date() });
    res.json({ ok: true, weekStart, weekEnd, lock, lastReview: entry, history: history.slice(-8) });
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
