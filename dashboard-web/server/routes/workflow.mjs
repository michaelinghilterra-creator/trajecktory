import express from 'express';
import { exec } from 'child_process';
import { readFileSync } from 'fs';
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
    const pending = (text.match(/^\s*-\s*\[ \]\s+https?:\/\//gm) || []).length;
    res.json({ pending });
  } catch {
    res.json({ pending: 0 });
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

