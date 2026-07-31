import express from 'express';
import { saveToken, clearToken, tokenStatus, listChannels } from '../lib/buffer.mjs';

export const router = express.Router();

// GET /api/buffer/channels — live-verify the key and report which of LinkedIn / X
// are connected in Buffer (with the account names), so the Publish view can show
// exactly where posts will go. A bad/expired key surfaces here as a 400.
router.get('/api/buffer/channels', async (req, res) => {
  try {
    res.json(await listChannels());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/buffer/status — is a Buffer key stored? Returns only a masked hint,
// never the key itself.
router.get('/api/buffer/status', (req, res) => {
  try {
    res.json(tokenStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/buffer/connect { token } — store the user's personal Buffer API key
// in the gitignored data/buffer-token.json. Does NOT call the Buffer API yet;
// verification of the key against api.buffer.com is a separate, later step.
router.post('/api/buffer/connect', (req, res) => {
  try {
    const token = (req.body && req.body.token) || '';
    if (!token || !String(token).trim()) return res.status(400).json({ error: 'Paste your Buffer API key.' });
    saveToken(token);
    res.json(tokenStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/buffer/disconnect — remove the stored key.
router.post('/api/buffer/disconnect', (req, res) => {
  try {
    clearToken();
    res.json({ connected: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
