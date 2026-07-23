import express from 'express';
import { listSessions, getRunsheet, getPrep, getDoc } from '../lib/interview.mjs';
import { parseApplicationsMd } from '../lib/applications.mjs';
import { readAppNotes, addNote } from '../lib/notes.mjs';
import { INTERVIEW_STAGES } from '../lib/statuses.mjs';
import { pendingDebriefs, debriefTemplate, formatDebriefNote, isDebriefFor } from '../lib/debrief.mjs';

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

// GET /api/interview/doc/:id/:key — a company-level document (intel report or
// cheat sheet). These live beside the round files but carry no round number, so
// they get their own route rather than being wedged into /prep/:round.
router.get('/api/interview/doc/:id/:key', (req, res) => {
  try {
    const doc = getDoc(req.params.id, req.params.key);
    if (doc.error) return res.status(404).json({ error: doc.error });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Debrief capture ──────────────────────────────────────────────────────────
// The instrumentation that turns the screen (where most processes quietly end and
// almost nothing is captured) into a real dataset. The UI fires a prompt
// on any interview-stage change; these endpoints back it.

// GET /api/interview/debriefs/pending — rounds whose current status is an
// interview stage with no debrief yet. Sourced from current status, not the
// backfilled event log (see lib/debrief.mjs).
router.get('/api/interview/debriefs/pending', (req, res) => {
  try {
    const apps = parseApplicationsMd();
    const notes = readAppNotes();
    res.json({ pending: pendingDebriefs({ apps, notes }) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/interview/debriefs/template?stage=&id= — the fill-in skeleton, seeded
// with the app's company/role when an id is given.
router.get('/api/interview/debriefs/template', (req, res) => {
  try {
    const stage = String(req.query.stage || '');
    const id = req.query.id != null && req.query.id !== '' ? parseInt(req.query.id, 10) : null;
    let company = '', role = '';
    if (id != null && !Number.isNaN(id)) {
      const app = parseApplicationsMd().find(a => a.id === id);
      if (app) { company = app.company; role = app.role; }
    }
    const date = new Date().toISOString().slice(0, 10);
    res.json({ stage, template: debriefTemplate(stage, { company, role, date }) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/interview/debriefs/:id — save a debrief. Body: { stage, fields?, text? }.
// `fields` is the structured form; `text` is freeform (the header is added if
// absent so detection still works). Persisted via addNote to data/app-notes.json.
router.post('/api/interview/debriefs/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid application id' });
    const { stage, fields, text } = req.body || {};
    if (!stage || !INTERVIEW_STAGES.includes(stage)) {
      return res.status(400).json({ error: `Provide an interview stage (one of: ${INTERVIEW_STAGES.join(', ')}). Got: ${stage}` });
    }
    const app = parseApplicationsMd().find(a => a.id === id);
    const date = new Date().toISOString().slice(0, 10);
    let note;
    if (text && String(text).trim()) {
      note = isDebriefFor(text, stage)
        ? String(text).trim()
        : `### Debrief: ${stage} (${date})\n\n${String(text).trim()}`;
    } else {
      note = formatDebriefNote(stage, fields || {}, { date, company: app?.company, role: app?.role });
    }
    const history = addNote(id, note);
    res.json({ ok: true, notes: history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
