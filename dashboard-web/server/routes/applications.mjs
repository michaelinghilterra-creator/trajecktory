import express from 'express';
import fs from 'fs';
import path from 'path';
import { OUTPUT_DIR, ROOT_DIR } from '../config.mjs';
import { parseApplicationsMd, patchRowInMd, removeRowFromMd, rejectionTimingStats } from '../lib/applications.mjs';
import { readResponseProgressStats } from '../lib/response-timing.mjs';
import { recordApplyDate } from '../lib/sidecars.mjs';
import { pushObsidianNote } from '../lib/obsidian.mjs';
import { ALL_STATUSES } from '../lib/statuses.mjs';
import { mdToHtml, escapeHtml } from '../lib/html.mjs';
import { isRequeueableDiscard } from '../../../lib/discard.mjs';
import { canonicalUrl } from '../../../lib/identity.mjs';

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

// GET /jd-preview/:file — render a captured JD snapshot from jds/ as HTML.
// This is the "Open JD" target for a self-sourced role whose url is a local:
// path (or the $file garbage a broken batch wrote): the posting has no live web
// URL, but its JD was snapshotted into jds/ at eval time. basename() strips any
// path so a poisoned frontmatter cell like ../../secret cannot escape jds/.
router.get('/jd-preview/:file', (req, res) => {
  const file = path.basename(req.params.file);
  const filePath = path.join(ROOT_DIR, 'jds', file);
  if (!file.endsWith('.md') || !fs.existsSync(filePath)) return res.status(404).send('JD snapshot not found');
  const raw = fs.readFileSync(filePath, 'utf8');
  const body = mdToHtml(raw);
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

    // Detect the transition INTO Applied. We push a vault note only when a row
    // that was NOT already Applied becomes Applied — not on every save where the
    // status happens to be Applied — so an unrelated notes edit never overwrites
    // a note the user has since hand-edited in Obsidian.
    const before = parseApplicationsMd();
    const prevRow = (company && before.find(r => r.id === id && r.company === company))
      || before.find(r => r.id === id);
    const becomingApplied = status === 'Applied' && (!prevRow || prevRow.status !== 'Applied');

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

    // Automatic Obsidian note on apply. The Apply button already does this via
    // the apply job; marking Applied from the status dropdown used to skip it
    // entirely, which is why applied roles were missing from the vault. Fire the
    // same shared push here. It self-skips when Obsidian isn't set up and never
    // throws, so a vault hiccup cannot break the status change. Fire-and-forget:
    // the status change is already persisted, so we don't make the client wait.
    if (becomingApplied && updated) {
      pushObsidianNote({ row: updated, appliedDate: when })
        .then((r) => { if (r && r.ok) console.log(`[obsidian] wrote ${r.notePath}`); })
        .catch(() => { /* pushObsidianNote already logs; never surfaces here */ });
    }

    res.json(updated || { id, ...updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/applications/:id/requeue — put a near-threshold Discarded role back
// in the eval queue (Slice 7.5). A noisy 2.9 just under the 3.0 auto-discard cut
// should stay eligible for a re-run rather than hardening as a permanent reject.
//
// Mechanism: DELETE the tracker row (so it leaves the decided-index — otherwise
// reconcileHandled would instantly re-check-off its pipeline row and merge-tracker
// would dedup the fresh eval against the stale reject) and append its URL back to
// data/pipeline.md as an unchecked "- [ ]" row. The next Evaluate re-runs it from
// scratch. Only near-threshold Discards qualify; a decisive low score is refused.
router.post('/api/applications/:id/requeue', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id' });
    const company = typeof req.body?.company === 'string' ? req.body.company : undefined;

    const rows = parseApplicationsMd();
    const row = (company && rows.find(r => r.id === id && r.company === company)) || rows.find(r => r.id === id);
    if (!row) return res.status(404).json({ error: `Row ${id} not found` });
    if (!isRequeueableDiscard({ status: row.status, score: row.score })) {
      return res.status(400).json({ error: 'Only a near-threshold Discarded role (score 2.5–2.9) can be re-queued.' });
    }
    if (!row.url) {
      return res.status(400).json({ error: 'This role has no posting URL to re-evaluate.' });
    }

    // Remove from the tracker (un-decide it), then queue it. Order matters: if the
    // append somehow fails we have still un-decided the row, which a later scan can
    // re-add — the reverse (queued but still decided) would be silently suppressed.
    const removed = removeRowFromMd(id, { company: row.company });
    if (!removed) return res.status(404).json({ error: `Row ${id} not found` });

    // Append an unchecked pipeline row unless the same posting is already queued.
    const pipelinePath = path.join(ROOT_DIR, 'data/pipeline.md');
    let text = '';
    try { text = fs.readFileSync(pipelinePath, 'utf8'); } catch { text = ''; }
    const canon = canonicalUrl(row.url);
    const already = text.split('\n').some(line => {
      const m = line.match(/^\s*-\s*\[ \]\s+(\S+)/);
      return m && (m[1] === row.url || (canon && canonicalUrl(m[1]) === canon));
    });
    if (!already) {
      const line = `- [ ] ${row.url} | ${row.company} | ${row.role}`;
      const sep = text && !text.endsWith('\n') ? '\n' : '';
      fs.writeFileSync(pipelinePath, `${text}${sep}${line}\n`, 'utf8');
    }
    res.json({ ok: true, requeued: true, url: row.url, alreadyQueued: already });
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

// GET /api/insights/response-progress: cohort silence and fast decisions.
router.get('/api/insights/response-progress', (req, res) => {
  try {
    res.json(readResponseProgressStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

