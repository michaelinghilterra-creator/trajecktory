import express from 'express';
import { execFile, spawn } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
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

// POST /api/system/restart — relaunch the dashboard so a just-applied update
// takes effect (Node reloads the new server code + the UI is rebuilt). Bundle-
// only: it runs the installed launcher one level up from the app tree. A dev
// checkout has no launcher, so it returns 400 and the UI falls back to a manual
// "reopen / reload" message.
router.post('/api/system/restart', (req, res) => {
  const installDir = resolve(ROOT_DIR, '..');               // {app}; app tree is {app}\trajecktory
  const launcher = join(installDir, 'launch-trajecktory.ps1');
  const stopper = join(installDir, 'stop-trajecktory.ps1');
  if (!existsSync(launcher)) {
    return res.status(400).json({ error: 'Restart is only available in the installed app.' });
  }
  // Detached so it outlives this server when the stopper kills it: wait a beat
  // (so this response is delivered), stop the current server, then relaunch —
  // which rebuilds the UI and starts a fresh server that reclaims the same port.
  // TJK_NO_OPEN keeps it from popping a second browser window; the user's current
  // tab reloads itself once the new server answers.
  const cmd = `Start-Sleep -Seconds 1; try { & "${stopper}" } catch {}; $env:TJK_NO_OPEN='1'; & "${launcher}"`;
  try {
    spawn('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', cmd],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch (e) {
    return res.status(500).json({ error: 'Failed to launch restart: ' + e.message });
  }
  res.json({ ok: true });
});

export { updateJobs };
