import express from 'express';
import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../config.mjs';

export const router = express.Router();

// ── Triage results reader ─────────────────────────────────────────────────────
// The triage agent (`/api/agent/triage`, run on Haiku) appends one line per scored
// posting to data/triage-results.tsv. The dashboard's triage cards read them here.
// Columns: url, company, title, score, rationale, date.
const TRIAGE_TSV = () => path.join(ROOT_DIR, 'data', 'triage-results.tsv');

// GET /api/triage/results — parsed cards, best-score first, deduped to the most
// recent line per URL (a re-triage of the same URL supersedes the older score).
router.get('/api/triage/results', (req, res) => {
  try {
    let text = '';
    try { text = fs.readFileSync(TRIAGE_TSV(), 'utf8'); } catch { return res.json({ cards: [] }); }
    const byUrl = new Map();
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const c = line.split('\t');
      if (c[0] === 'url' || c.length < 4) continue; // header or malformed
      const score = parseFloat(c[3]);
      byUrl.set(c[0], { // later lines win → most recent triage of this URL
        url: c[0],
        company: (c[1] || '').trim(),
        title: (c[2] || '').trim(),
        score: Number.isFinite(score) ? score : null,
        rationale: (c[4] || '').trim(),
        date: (c[5] || '').trim(),
      });
    }
    const cards = Array.from(byUrl.values()).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    res.json({ cards });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
