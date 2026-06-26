import express from 'express';
import { getNotes, addNote, deleteNote } from '../lib/notes.mjs';

export const router = express.Router();

// GET /api/notes/:id — chronological note history for an application
router.get('/api/notes/:id', (req, res) => {
  try {
    res.json(getNotes(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notes/:id { text } — append a timestamped note entry
router.post('/api/notes/:id', (req, res) => {
  try {
    const text = (req.body && req.body.text != null) ? String(req.body.text).trim() : '';
    if (!text) return res.status(400).json({ error: 'Note text is required' });
    res.json(addNote(req.params.id, text));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notes/:id { timestamp } — remove one entry by its timestamp
router.delete('/api/notes/:id', (req, res) => {
  try {
    const timestamp = req.body && req.body.timestamp;
    if (!timestamp) return res.status(400).json({ error: 'timestamp is required' });
    res.json(deleteNote(req.params.id, timestamp));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
