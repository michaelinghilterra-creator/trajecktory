import express from 'express';
import { exec } from 'child_process';
import { ROOT_DIR } from '../config.mjs';
import { WORKFLOW_STEPS, tailLines } from '../lib/workflow.mjs';

export const router = express.Router();

// ── Workflow Runner ──────────────────────────────────────────────────────────
// Lets the dashboard sidebar drive the morning workflow with single clicks.
// Each step shells out to the corresponding node script and streams stdout
// into a job record the frontend polls.

const workflowJobs = new Map();
router.post('/api/workflow/:step', (req, res) => {
  const step = req.params.step;
  const def = WORKFLOW_STEPS[step];
  if (!def) return res.status(400).json({ error: `Unknown step: ${step}` });

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

