import express from 'express';
import { readTemplate, saveTemplate, deriveToday, logTask, computeStreak } from '../lib/cadence.mjs';

export const router = express.Router();

// GET /api/cadence — full weekly template (seeded starter if the file is absent)
router.get('/api/cadence', (req, res) => {
  try {
    res.json(readTemplate());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cadence { tasks } — replace the template (editor save)
router.put('/api/cadence', (req, res) => {
  try {
    const tasks = req.body && Array.isArray(req.body.tasks) ? req.body.tasks : null;
    if (!tasks) return res.status(400).json({ error: 'tasks array is required' });
    res.json(saveTemplate(tasks));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cadence/today — today's scheduled tasks + completion state
router.get('/api/cadence/today', (req, res) => {
  try {
    res.json(deriveToday());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cadence/log { taskId, done?, pomodorosDone? } — update today's log
router.post('/api/cadence/log', (req, res) => {
  try {
    const { taskId, done, pomodorosDone } = req.body || {};
    if (!taskId) return res.status(400).json({ error: 'taskId is required' });
    res.json(logTask(taskId, { done, pomodorosDone }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cadence/streak — consistency stats { current, best, last7 }
router.get('/api/cadence/streak', (req, res) => {
  try {
    res.json(computeStreak());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
