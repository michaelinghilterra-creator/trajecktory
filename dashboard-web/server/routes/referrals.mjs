import express from 'express';
import { parseReferralsMd, appendReferralRows, updateReferralLine, deleteReferralLine, REFERRAL_STATUSES } from '../lib/referrals.mjs';
import { reconcile, parseConnectionsCsv, saveConnections, linkedinStatus, stageForRow, activeFormSet } from '../lib/linkedin-referrals.mjs';

export const router = express.Router();

// ── Referrals ─────────────────────────────────────────────────────────────────
// The warm channel: people in the user's own network who can introduce them or
// flag an application internally. CRUD over data/referrals.md. No LLM, no
// correspondence log — the reconnect/ask templates are static UI copy the user
// personalizes and sends themselves.

// GET /api/referrals — list all + the status vocabulary for the UI's dropdown.
// Each row is annotated with a live-derived `stage` (stage1 = LinkedIn contact
// inside an active-pipeline company, stage2 = other LinkedIn contact, other =
// manually added) so the UI's Stage 1 / Stage 2 subtabs are just filters and a
// Stage-2 contact auto-promotes when you source a JD at their company.
router.get('/api/referrals', (req, res) => {
  try {
    const activeSet = activeFormSet();
    const rows = parseReferralsMd().map(({ raw, ...rest }) => ({ ...rest, stage: stageForRow(rest, activeSet) }));
    res.json({ referrals: rows, statuses: REFERRAL_STATUSES, linkedin: linkedinStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/referrals/reconcile — re-scan the stored LinkedIn haystack against
// the current active pipeline and promote NEW warm paths into the tracker.
// The recurring motion (run after a scan, or by the Reconcile button): Stage 1
// only by default; pass { seedPool: true } to also seed the Stage-2 referrer pool.
router.post('/api/referrals/reconcile', (req, res) => {
  try {
    const result = reconcile({ seedPool: !!(req.body && req.body.seedPool) });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/referrals/import-linkedin — accept a raw LinkedIn Connections.csv
// (body { csv }), replace the stored haystack, then reconcile with the pool
// seeded (the initial big load). Body limit is the app-wide 12mb, enough for a
// ~7k-row export.
router.post('/api/referrals/import-linkedin', (req, res) => {
  try {
    const csv = req.body && req.body.csv;
    if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'Provide the CSV text in { csv }.' });
    const connections = parseConnectionsCsv(csv);
    if (!connections.length) return res.status(400).json({ error: 'No connections parsed — is this a LinkedIn Connections.csv?' });
    saveConnections(connections, 'upload');
    const result = reconcile({ seedPool: true });
    res.json({ ok: true, imported: connections.length, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/referrals/linkedin-status — is a haystack stored, how big, how fresh.
router.get('/api/referrals/linkedin-status', (req, res) => {
  try { res.json(linkedinStatus()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/referrals — add one person. Only `name` is required.
router.post('/api/referrals', (req, res) => {
  try {
    const { name, how, where, target, status, lastTouch, notes } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'A name is required.' });
    if (status && !REFERRAL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${REFERRAL_STATUSES.join(', ')}` });
    }
    const [written] = appendReferralRows([{ name, how, where, target, status, lastTouch, notes }]);
    res.json({ ok: true, id: written.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/referrals/:id — update any mutable cell.
router.patch('/api/referrals/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, how, where, target, status, lastTouch, notes } = req.body || {};
    if (status && !REFERRAL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${REFERRAL_STATUSES.join(', ')}` });
    }
    const ok = updateReferralLine(id, { name, how, where, target, status, lastTouch, notes });
    if (!ok) return res.status(404).json({ error: 'Referral not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/referrals/:id — remove a person from the tracker.
router.delete('/api/referrals/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ok = deleteReferralLine(id);
    if (!ok) return res.status(404).json({ error: 'Referral not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
