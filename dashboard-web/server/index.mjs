import express from 'express';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import { randomBytes } from 'crypto';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { STATIC, OUTPUT_DIR, PORT, HOST } from './config.mjs';
import { router as applicationsRoutes } from './routes/applications.mjs';
import { router as followupsRoutes } from './routes/followups.mjs';
import { router as applyRoutes, applyJobs } from './routes/apply.mjs';
import { router as workflowRoutes, workflowJobs } from './routes/workflow.mjs';
import { router as agentRoutes, agentJobs } from './routes/agent.mjs';
import { router as triageRoutes } from './routes/triage.mjs';
import { router as recruitersRoutes } from './routes/recruiters.mjs';
import { router as targetTalentRoutes } from './routes/target-talent.mjs';
import { router as ttReconcileRoutes } from './routes/tt-reconcile.mjs';
import { router as linkedinSsiRoutes } from './routes/linkedin-ssi.mjs';
import { router as linkedinDraftsRoutes } from './routes/linkedin-drafts.mjs';
import { router as reportsRoutes } from './routes/reports.mjs';
import { router as insightsRoutes } from './routes/insights.mjs';
import { router as setupRoutes } from './routes/setup.mjs';
import { router as setupModulesRoutes } from './routes/setup-modules.mjs';
import { router as notesRoutes } from './routes/notes.mjs';
import { router as cadenceRoutes } from './routes/cadence.mjs';
import { router as todosRoutes } from './routes/todos.mjs';
import { router as interviewRoutes } from './routes/interview.mjs';
import { router as googleRoutes } from './routes/google.mjs';
import { router as systemRoutes, updateJobs } from './routes/system.mjs';
import { getIdentity } from './lib/profile.mjs';

// ── Process-level safety net ─────────────────────────────────────────────────
// This dashboard is a long-lived local server for a non-technical user. A single
// bad request must never take the whole thing down. The most common trigger is a
// file read that lands while another process is renaming or rewriting data
// underneath it (a scan, a tracker merge, an in-app update, or a dev editing
// files). Express does not catch rejections thrown from async route handlers, so
// without these a transient error would exit the process and the dashboard would
// vanish mid-use. We log loudly (root causes stay findable) and keep serving.
process.on('unhandledRejection', (reason) => {
  console.error(`[${new Date().toISOString()}] UNHANDLED REJECTION (server kept alive):`, reason);
});
process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] UNCAUGHT EXCEPTION (server kept alive):`, err);
});

const app = express();

// The dashboard has no user accounts; it is a local single-user tool. These
// two controls keep it that way even though it speaks HTTP:
//   1. CORS is scoped to localhost origins (any port) instead of wildcard, so
//      a page on another site cannot read the dashboard's API responses.
//   2. A per-start token, delivered as a SameSite=Strict cookie when the
//      dashboard HTML loads, is required on every state-changing request.
//      The browser sends the cookie automatically on same-origin requests, so
//      the UI needs no changes; a cross-site (CSRF) request never carries it.
//      CLI/curl callers can instead pass the x-tjk-token header printed at
//      startup. The token rotates on restart, so reload the page after one.
const AUTH_TOKEN = randomBytes(24).toString('hex');
const AUTH_COOKIE = 'tjk_token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

app.use(cors({
  origin(origin, cb) {
    // No Origin header = same-origin / non-browser client (curl, the CLI).
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '12mb' })); // 12mb so the Launchpad can accept a base64 CV upload

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

// Hand the SPA its token cookie on any top-level HTML navigation (covers '/',
// '/index.html', and the deep-link SPA fallback), so it is present before any
// fetch the page makes.
app.use((req, res, next) => {
  if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
    res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${AUTH_TOKEN}; Path=/; SameSite=Strict; HttpOnly`);
  }
  next();
});

// Require the token on state-changing requests (which include the agent-spawn
// and workflow routes, all POST). Reads stay open so the UI loads cleanly.
app.use((req, res, next) => {
  if (!MUTATING_METHODS.has(req.method)) return next();
  const provided = readCookie(req, AUTH_COOKIE) || req.headers['x-tjk-token'];
  if (provided === AUTH_TOKEN) return next();
  res.status(403).json({
    error: 'Forbidden: missing or invalid dashboard token. Reload the dashboard in your browser, or pass the x-tjk-token header printed at server startup.',
  });
});
// Lightweight request logger so long-running endpoints (tt-reconcile/discover,
// Claude drafts) are visible in server stdout for debugging.
app.use((req, res, next) => {
  if (req.path === '/' || /\.(css|js|jsx|woff2?|ico|png|svg)$/.test(req.path)) return next();
  const t0 = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - t0;
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`);
  });
  next();
});
// Use revalidation (no-cache) instead of no-store so the browser can reuse
// transpiled bundles when ETags match — UI fixes still take effect on refresh.
app.use(express.static(STATIC, {
  etag: true,
  setHeaders: (res, filepath) => {
    if (/\.(jsx|js|css|html)$/.test(filepath)) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));
app.use('/output', express.static(OUTPUT_DIR));

// ── Mount per-domain routers (same order the routes were defined in) ──────────
// Rate-limit the API surface as defense-in-depth for the exposed case (HOST=0.0.0.0).
// Mounted AFTER the static + /output handlers (so SPA bundle loads are never throttled)
// and BEFORE every router (so all API handlers and the SPA fallback are covered). The
// ceiling is far above a single user's polling; it only trips on a flood from a LAN peer
// when the server is deliberately exposed; inert in the default localhost case. Also
// satisfies CodeQL js/missing-rate-limiting across the route surface.
app.use(rateLimit({
  windowMs: 60 * 1000,     // 1 minute
  limit: 1000,             // per IP per minute (~16 req/s sustained); raise if polling ever trips it
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down and retry shortly.' },
}));

app.use(applicationsRoutes);
app.use(followupsRoutes);
app.use(applyRoutes);
app.use(workflowRoutes);
app.use(agentRoutes);
app.use(triageRoutes);
app.use(recruitersRoutes);
app.use(targetTalentRoutes);
app.use(ttReconcileRoutes);
app.use(linkedinSsiRoutes);
app.use(linkedinDraftsRoutes);
app.use(reportsRoutes);
app.use(insightsRoutes);
app.use(setupRoutes);
app.use(setupModulesRoutes);
app.use(notesRoutes);
app.use(cadenceRoutes);
app.use(todosRoutes);
app.use(interviewRoutes);
app.use(googleRoutes);
app.use(systemRoutes);

// Public identity for the frontend's signature blocks, so no name/email/phone
// is hardcoded in the client bundle. Reads config/profile.yml via the cached
// loader. Open GET (reads stay unauthenticated like the rest of the UI data).
app.get('/api/identity', (req, res) => res.json(getIdentity()));

// SPA deep-link fallback. Express 5 (path-to-regexp v8) requires named
// wildcards, so the Express 4 bare '*' becomes '/*splat' (the match is unused;
// we always serve index.html).
app.get('/*splat', (req, res) => {
  res.sendFile(path.join(STATIC, 'index.html'));
});

// ── Final error handler ──────────────────────────────────────────────────────
// Any error passed to next(err) — a synchronous throw in a handler, a sendFile
// failure, a CORS rejection — lands here and returns a clean 500 instead of a
// hung request. Async-handler rejections are caught by the process net above;
// the per-route try/catch blocks turn those into 500s too. Must stay last.
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Request error on %s %s:`, req.method, req.path, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err && err.message ? err.message : 'Internal server error' });
});

// Bound the in-memory job maps so a long-running server does not accumulate
// finished jobs forever (they were only ever .set, never deleted). Keep every
// running job plus the most recent N terminal (done/error) ones; Map preserves
// insertion order, so evict the oldest terminal entries first. A running job is
// never evicted, so status polling for active jobs is unaffected.
const MAX_TERMINAL_JOBS = 50;
function pruneJobMap(map) {
  const terminalIds = [];
  for (const [id, job] of map) {
    if (!job || job.status !== 'running') terminalIds.push(id);
  }
  const excess = terminalIds.length - MAX_TERMINAL_JOBS;
  for (let i = 0; i < excess; i++) map.delete(terminalIds[i]);
}
const _jobSweep = setInterval(() => {
  pruneJobMap(applyJobs);
  pruneJobMap(workflowJobs);
  pruneJobMap(agentJobs);
  pruneJobMap(updateJobs);
}, 5 * 60 * 1000);
if (_jobSweep.unref) _jobSweep.unref();

// Open the dashboard in the bundled Chromium as a clean app window, so it lands
// there no matter how the server was started (the launcher, npm start, or Claude
// Code starting it directly). Gated to the installed bundle: only fires when a
// bundled Chromium is found (via PLAYWRIGHT_BROWSERS_PATH or ../../ms-playwright).
// A normal dev checkout has neither, so `npm start` never pops a window. Disable
// with TJK_NO_OPEN=1.
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
// The bundled Playwright Chromium ships under ../../ms-playwright; its presence
// marks the installed bundle (a dev checkout doesn't have it there).
function isInstalledBundle() {
  try { return existsSync(path.resolve(SERVER_DIR, '../../ms-playwright')); } catch { return false; }
}
function openDashboardWindow(url) {
  // Open the user's DEFAULT browser (they get tabs and their own profile), but
  // only in the installed bundle so a dev `npm start` never pops a browser.
  // Disable with TJK_NO_OPEN=1.
  if (process.env.TJK_NO_OPEN || HOST === '0.0.0.0' || HOST === '::') return;
  if (!isInstalledBundle()) return;
  try {
    // `start` (via cmd) launches whatever browser the user set as default.
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch { /* never let opening a browser break the server */ }
}

app.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' || HOST === '::' ? `your machine on port ${PORT} (all interfaces)` : `http://localhost:${PORT}`;
  console.log(`trajecktory Dashboard → ${shown}`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    console.log('  ⚠ Bound to all interfaces with no authentication — anyone on your network can reach this.');
  }
  console.log(`  Auth token for CLI/curl (x-tjk-token header): ${AUTH_TOKEN}`);
  openDashboardWindow(`http://localhost:${PORT}`);
});

