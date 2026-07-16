import express from 'express';
import { listSessions, getRunsheet, getPrep } from '../lib/interview.mjs';

export const router = express.Router();

// GET /api/interview/sessions — every company prep folder, split into the ones
// you are actively interviewing with and the archive.
router.get('/api/interview/sessions', (req, res) => {
  try {
    res.json(listSessions());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/interview/runsheet/:id/:round — parsed frontmatter + the derived
// collision/hero warnings, for the Live board. 404 when the round has no .run.md.
router.get('/api/interview/runsheet/:id/:round', (req, res) => {
  try {
    const sheet = getRunsheet(req.params.id, req.params.round);
    if (sheet.error) return res.status(404).json({ error: sheet.error });
    res.json(sheet);
  } catch (err) {
    // A malformed sidecar lands here: parseRunsheet's message names the exact
    // problem ("Frontmatter is not valid JSON: ..."), which is more useful than
    // pretending the file is absent.
    res.status(500).json({ error: err.message });
  }
});

// GET /api/interview/prep/:id/:round — the prep prose, for the Prep subtab.
router.get('/api/interview/prep/:id/:round', (req, res) => {
  try {
    const prep = getPrep(req.params.id, req.params.round);
    if (prep.error) return res.status(404).json({ error: prep.error });
    res.json(prep);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
