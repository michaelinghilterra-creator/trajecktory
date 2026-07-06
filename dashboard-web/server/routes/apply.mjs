import express from 'express';
import { parseApplicationsMd } from '../lib/applications.mjs';
import { applyJobs, runApplyJob } from '../lib/apply.mjs';

export const router = express.Router();

// ── Apply Jobs ────────────────────────────────────────────────────────────────
router.post('/api/apply/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { mode = 'manual', company } = req.body;
    const VALID_MODES = ['manual', 'claude', 'byo', 'cover'];
    if (!VALID_MODES.includes(mode)) {
      return res.status(400).json({ error: `Invalid mode: ${mode}` });
    }

    // 'manual' generates the tailored CV, 'claude' adds form responses (both on the
    // Claude plan, or the API key if one is set); 'cover' drafts a standalone cover
    // letter without applying; 'byo' (already-applied) skips generation.
    const rows = parseApplicationsMd();
    const row = (company && rows.find(r => r.id === id && r.company === company))
      || rows.find(r => r.id === id);
    if (!row) return res.status(404).json({ error: `Row ${id} not found` });

    const jobId = `${id}-${Date.now()}`;
    applyJobs.set(jobId, { status: 'running', company: row.company, role: row.role, mode });

    runApplyJob(jobId, row, mode).catch(err => {
      const job = applyJobs.get(jobId) || {};
      applyJobs.set(jobId, { ...job, status: 'error', error: err.message });
    });

    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/apply/status/:jobId — poll job status
router.get('/api/apply/status/:jobId', (req, res) => {
  const job = applyJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});


export { applyJobs };

