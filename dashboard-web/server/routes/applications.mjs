import express from 'express';
import fs from 'fs';
import path from 'path';
import { OUTPUT_DIR } from '../config.mjs';
import { parseApplicationsMd, patchRowInMd, rejectionTimingStats } from '../lib/applications.mjs';
import { recordApplyDate } from '../lib/sidecars.mjs';
import { ALL_STATUSES } from '../lib/statuses.mjs';
import { mdToHtml, escapeHtml } from '../lib/html.mjs';

export const router = express.Router();

// ── Routes ────────────────────────────────────────────────────────────────────

// GET /output-preview/:file — render .md files from output/ as HTML
router.get('/output-preview/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const filePath = path.join(OUTPUT_DIR, file);
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
  const raw = fs.readFileSync(filePath, 'utf8');
  const body = mdToHtml(raw);
  // No scripts in a rendered output document; lock it down (defense-in-depth).
  res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data: http: https:");
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(file)}</title>
<style>
  body{font-family:'Georgia',serif;max-width:720px;margin:60px auto;padding:0 24px;color:#1a1a1a;line-height:1.7;font-size:15px}
  h1,h2,h3{font-family:'Arial',sans-serif;margin:1.4em 0 0.4em}
  h1{font-size:22px} h2{font-size:18px} h3{font-size:15px}
  blockquote{border-left:3px solid #ccc;margin:12px 0;padding:8px 16px;color:#444;background:#f9f9f9}
  p{margin:0.8em 0}
  strong{font-weight:600}
  @media print{body{margin:0.5in}}
</style>
</head><body>${body}</body></html>`);
});

// GET /api/applications — return all rows as JSON
router.get('/api/applications', (req, res) => {
  try {
    res.json(parseApplicationsMd());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/applications/:id — update status and/or notes
router.patch('/api/applications/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, notes, company, eventDate } = req.body;

    if (status && !ALL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status: ${status}` });
    }

    // A bad date is rejected outright rather than quietly ignored. The body is
    // destructured against a fixed allowlist, so an unrecognised field vanishes
    // with no error — which would let a broken client look like it was saving
    // dates while writing none. Fail loudly instead.
    if (eventDate !== undefined && eventDate !== null && eventDate !== '') {
      if (typeof eventDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
        return res.status(400).json({ error: `Invalid eventDate: ${eventDate} (expected YYYY-MM-DD)` });
      }
      const parsed = new Date(`${eventDate}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== eventDate) {
        return res.status(400).json({ error: `Invalid eventDate: ${eventDate} is not a real date` });
      }
      const today = new Date().toISOString().slice(0, 10);
      if (eventDate > today) {
        return res.status(400).json({ error: `Invalid eventDate: ${eventDate} is in the future` });
      }
      if (eventDate < '2000-01-01') {
        return res.status(400).json({ error: `Invalid eventDate: ${eventDate} is implausibly old` });
      }
    }
    const when = eventDate || undefined;

    const updates = {};
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;

    const ok = patchRowInMd(id, updates, { company, eventDate: when });
    if (!ok) return res.status(404).json({ error: `Row ${id} not found` });

    // Capture the real apply date the first time a row goes Applied, so
    // follow-up cadence counts from when the user actually applied — not the
    // evaluation/scrape date in the Date column. An explicit eventDate is the
    // user correcting the anchor, so it is allowed to overwrite.
    if (status === 'Applied') recordApplyDate(id, when, { force: !!when });

    // Read back the updated row — use company to disambiguate duplicate ids
    const rows = parseApplicationsMd();
    const updated = (company && rows.find(r => r.id === id && r.company === company))
      || rows.find(r => r.id === id);
    res.json(updated || { id, ...updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/insights/rejection-timing — avg/median days from application to the
// date a row was marked Rejected, derived from the status-event sidecar.
router.get('/api/insights/rejection-timing', (req, res) => {
  try {
    res.json(rejectionTimingStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

