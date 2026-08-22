import express from 'express';
import { exec } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { ROOT_DIR } from '../config.mjs';
import { WORKFLOW_STEPS, tailLines } from '../lib/workflow.mjs';

export const router = express.Router();

// How many URLs are waiting to be evaluated. Counts unchecked "- [ ]" lines in
// data/pipeline.md (dead "- [!]" and done "- [x]" are excluded). The dashboard
// shows this on the Evaluate step so the user sees the queue depth and knows to
// run another batch, instead of learning it only from the agent's freeform log.
router.get('/api/pipeline/pending', (_req, res) => {
  try {
    const text = readFileSync(join(ROOT_DIR, 'data/pipeline.md'), 'utf8');
    // Count unchecked rows the eval can actually read: an http(s) posting OR a
    // local:jds/ snapshot (resolve-jds writes these for SPA postings so they ARE
    // evaluable). Counting http-only undercounted a queue of snapshotted roles as
    // 0, which read as "nothing to evaluate" — and blocks the pre-eval spend gate.
    // Keep this in sync with countPipelinePending() in routes/agent.mjs.
    const pending = (text.match(/^\s*-\s*\[ \]\s+(?:https?:\/\/|local:)/gm) || []).length;
    res.json({ pending });
  } catch {
    res.json({ pending: 0 });
  }
});

// Postings the eval could NOT read (Workday / Ashby single-page apps). Rather than
// stitch a JD from search results — which shipped closed roles as confident scores —
// the eval logs them to data/needs-manual-jd.tsv and defers to the user: confirm the
// posting is live, then paste the JD text into the Paste-a-JD box for a real eval.
// GET lists them; POST /resolve removes one once the user has handled it.
const NEEDS_MANUAL = 'data/needs-manual-jd.tsv';
router.get('/api/pipeline/needs-manual', (_req, res) => {
  try {
    const text = readFileSync(join(ROOT_DIR, NEEDS_MANUAL), 'utf8');
    const items = text.split('\n').slice(1)               // skip header row
      .map(l => l.split('\t'))
      .filter(c => c[0] && /^https?:\/\//.test(c[0].trim()))
      .map(c => ({ url: c[0].trim(), company: (c[1] || '').trim(), role: (c[2] || '').trim() }));
    res.json({ items });
  } catch {
    res.json({ items: [] });
  }
});
router.post('/api/pipeline/needs-manual/resolve', (req, res) => {
  const url = ((req.body && req.body.url) || '').trim();
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const p = join(ROOT_DIR, NEEDS_MANUAL);
    const lines = readFileSync(p, 'utf8').split('\n');
    const kept = lines.slice(1).filter(l => l && l.split('\t')[0].trim() !== url);
    writeFileSync(p, [lines[0], ...kept].join('\n') + (kept.length ? '\n' : ''));
    res.json({ ok: true, remaining: kept.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Workflow Runner ──────────────────────────────────────────────────────────
// Lets the dashboard sidebar drive the morning workflow with single clicks.
// Each step shells out to the corresponding node script and streams stdout
// into a job record the frontend polls.

const workflowJobs = new Map();
router.post('/api/workflow/:step', (req, res) => {
  const step = req.params.step;
  // hasOwn, not a bare lookup: WORKFLOW_STEPS is an object literal, so it
  // inherits Object.prototype and `step=constructor` (or toString, valueOf) finds
  // a TRUTHY value that is not a step. `def.cmd` is then undefined and exec()
  // throws from inside the handler. Own-property only, so the allow-list is
  // actually a list.
  const def = Object.hasOwn(WORKFLOW_STEPS, step) ? WORKFLOW_STEPS[step] : null;
  if (!def || typeof def.cmd !== 'string') return res.status(400).json({ error: `Unknown step: ${step}` });

  const jobId = `wf-${step}-${Date.now()}`;
  workflowJobs.set(jobId, { step, status: 'running', label: def.label, output: '', startedAt: Date.now() });

  const projectRoot = ROOT_DIR;
  const child = exec(def.cmd, { cwd: projectRoot, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
    const job = workflowJobs.get(jobId) || {};
    const output = (stdout || '') + (stderr ? '\n[stderr]\n' + stderr : '');
    if (err && err.code !== 0) {
      workflowJobs.set(jobId, { ...job, status: 'error', error: err.message, output, summary: tailLines(output), finishedAt: Date.now() });
    } else {
      workflowJobs.set(jobId, { ...job, status: 'done', output, summary: def.summarize(output), finishedAt: Date.now() });
    }
  });

  res.json({ jobId });
});

// GET /api/workflow/status/:jobId — poll a workflow job
router.get('/api/workflow/status/:jobId', (req, res) => {
  const job = workflowJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  // Truncate output for transport — full content stays in memory if needed
  res.json({ ...job, output: (job.output || '').slice(-4000) });
});


export { workflowJobs };

