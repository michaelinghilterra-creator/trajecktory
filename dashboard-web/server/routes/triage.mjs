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
const DISMISSED_TSV = () => path.join(ROOT_DIR, 'data', 'triage-dismissed.tsv');

// URLs the user dismissed ("not a match"). Durable so the cards never resurface:
// GET hides them, and the triage mode is told to skip them on the next scan.
// One `url\tdate` line per dismissal.
function loadDismissed() {
  const set = new Set();
  let text = '';
  try { text = fs.readFileSync(DISMISSED_TSV(), 'utf8'); } catch { return set; }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('url\t')) continue; // blank or header
    set.add(line.split('\t')[0].trim());
  }
  return set;
}

// GET /api/triage/results — parsed cards, best-score first, deduped to the most
// recent line per URL (a re-triage of the same URL supersedes the older score).
router.get('/api/triage/results', (req, res) => {
  try {
    let text = '';
    try { text = fs.readFileSync(TRIAGE_TSV(), 'utf8'); } catch { return res.json({ cards: [] }); }
    const byUrl = new Map();
    const dismissed = loadDismissed();
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const c = line.split('\t');
      if (c[0] === 'url' || c.length < 6) continue; // header or malformed (need all 6 columns)
      if (dismissed.has(c[0])) continue; // user dismissed this role ("not a match")
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

// POST /api/triage/dismiss { url } — mark a triaged role "not a match". Records
// the URL durably so GET hides it and the next scan's triage skips it. Because
// triage rows live only here (never in applications.md), this touches nothing in
// the tracker or analytics. Idempotent.
router.post('/api/triage/dismiss', (req, res) => {
  try {
    const url = String((req.body && req.body.url) || '').trim();
    if (!url) return res.status(400).json({ error: 'A "url" is required.' });
    if (/[\t\r\n]/.test(url)) return res.status(400).json({ error: 'Invalid url (control characters).' });
    if (!loadDismissed().has(url)) {
      const file = DISMISSED_TSV();
      const header = fs.existsSync(file) ? '' : 'url\tdate\n';
      const date = new Date().toISOString().slice(0, 10);
      fs.appendFileSync(file, `${header}${url}\t${date}\n`, 'utf8');
    }
    res.json({ ok: true, dismissed: url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/triage/undismiss { url } — undo a dismissal (supports an "undo"
// affordance). The card reappears on the next results fetch.
router.post('/api/triage/undismiss', (req, res) => {
  try {
    const url = String((req.body && req.body.url) || '').trim();
    if (!url) return res.status(400).json({ error: 'A "url" is required.' });
    const file = DISMISSED_TSV();
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return res.json({ ok: true, restored: url }); }
    const kept = text.split('\n').filter((raw) => {
      const line = raw.trim();
      if (!line) return false;
      if (line.startsWith('url\t')) return true; // keep header
      return line.split('\t')[0].trim() !== url;
    });
    fs.writeFileSync(file, kept.length ? kept.join('\n') + '\n' : '', 'utf8');
    res.json({ ok: true, restored: url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
