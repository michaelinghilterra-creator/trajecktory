import express from 'express';
import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ROOT_DIR } from '../config.mjs';

export const router = express.Router();

// ── Self-update ────────────────────────────────────────────────────────────────
// Thin HTTP wrapper over update-system.mjs so the dashboard can offer a
// one-click update to non-technical users. The updater does the careful work
// (system-files-only checkout, user-data protection, backup + rollback); these
// routes just run it from the project root and surface its result.
//
// Run with the SAME node that runs this server (process.execPath) — in an
// installed bundle that is the portable Node, so we never depend on a system
// Node being on PATH.
const NODE = process.execPath;
const updateJobs = new Map();

// POST /api/system/update-check — run the checker, return its JSON verdict.
// Quick (a shallow git fetch), so it responds inline rather than as a job.
router.post('/api/system/update-check', (req, res) => {
  execFile(NODE, ['update-system.mjs', 'check'],
    { cwd: ROOT_DIR, timeout: 30000, maxBuffer: 1024 * 1024 },
    (err, stdout) => {
      // The checker prints a single JSON line to stdout. git fetch progress
      // goes to stderr, so the last non-empty stdout line is the verdict.
      const line = (stdout || '').trim().split('\n').filter(Boolean).pop() || '';
      let parsed;
      try { parsed = JSON.parse(line); } catch { parsed = { status: 'offline' }; }
      res.json(parsed);
    });
});

// POST /api/system/update-apply — apply the update as a background job.
router.post('/api/system/update-apply', (req, res) => {
  const jobId = `update-${Date.now()}`;
  updateJobs.set(jobId, { status: 'running', output: '', startedAt: Date.now() });
  execFile(NODE, ['update-system.mjs', 'apply'],
    { cwd: ROOT_DIR, timeout: 5 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 },
    (err, stdout, stderr) => {
      const job = updateJobs.get(jobId) || {};
      const output = (stdout || '') + (stderr ? '\n[stderr]\n' + stderr : '');
      // The updater prints BUNDLE_UPDATE_REQUIRED (and exits non-zero) when the
      // code needs a newer heavy bundle than this install ships — that is not a
      // failure, it just means "download the installer".
      const reinstall = /BUNDLE_UPDATE_REQUIRED/.test(output);
      let status;
      if (reinstall) status = 'reinstall-required';
      else if (err) status = 'error';
      else status = 'done';
      updateJobs.set(jobId, { ...job, status, output, finishedAt: Date.now() });
    });
  res.json({ jobId });
});

// GET /api/system/update-apply/:jobId — poll the apply job.
router.get('/api/system/update-apply/:jobId', (req, res) => {
  const job = updateJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ ...job, output: (job.output || '').slice(-4000) });
});

// GET /api/system/version — the currently installed version (from the VERSION
// file). Used by the sidebar to show the real version number.
router.get('/api/system/version', (req, res) => {
  try {
    res.json({ version: readFileSync(join(ROOT_DIR, 'VERSION'), 'utf-8').trim() });
  } catch {
    res.json({ version: null });
  }
});

// POST /api/system/update-dismiss — silence the checker (writes .update-dismissed).
router.post('/api/system/update-dismiss', (req, res) => {
  execFile(NODE, ['update-system.mjs', 'dismiss'],
    { cwd: ROOT_DIR, timeout: 15000 },
    (err) => res.json({ ok: !err }));
});

export { updateJobs };
