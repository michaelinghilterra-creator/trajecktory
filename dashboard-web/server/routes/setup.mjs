import express from 'express';
import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { SETUP_ROOT, SETUP_FILES, setupSetScalar, SETUP_SCALAR_FIELDS, setupComputeState, SETUP_GUARDRAIL, SETUP_CV_FULL, setupHandoffPrompt } from '../lib/setup.mjs';

export const router = express.Router();

// ── Launchpad / guided setup ──────────────────────────────────────────────────
// Thin, deterministic endpoints backing the visual onboarding module. The
// dashboard NEVER calls an LLM here: generative work (parse CV, draft narrative,
// suggest roles/companies, merge portals.yml) is handed to the user's OWN
// Claude Code via copy-prompt-and-poll. These routes only read config-file
// state, save structured scalar fields, and shell out to existing scripts.
//
// DATA CONTRACT: setup writes touch config only (config/profile.yml,
// modes/_profile.md, data/pipeline.md). They NEVER write applications.md,
// reports/, or scan history.
router.get('/api/setup/state', (req, res) => {
  try { res.json(setupComputeState()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/setup/preflight — run doctor.mjs --json and return parsed checks.
router.post('/api/setup/preflight', (req, res) => {
  exec('node doctor.mjs --json', { cwd: SETUP_ROOT, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
    try { res.json(JSON.parse((stdout || '').trim())); }
    catch { res.status(500).json({ ok: false, error: 'preflight parse failed', raw: (stdout || '').slice(0, 500) }); }
  });
});

// POST /api/claude-login — open a visible console running the bundled `claude login`
// so the user signs in once (enables Evaluate / Scan, which spawn the bundled CLI).
// Only meaningful in the installed bundle, where a bundled claude.cmd sits next to
// the app (../node/claude.cmd from the project root); falls back to PATH otherwise.
// NOTE: the exact console-spawn quoting is pending a clean-VM confirmation.
router.post('/api/claude-login', (req, res) => {
  try {
    const bundled = path.resolve(SETUP_ROOT, '..', 'node', 'claude.cmd');
    const claudeCmd = fs.existsSync(bundled) ? bundled : 'claude.cmd';
    const child = spawn('cmd', ['/c', 'start', 'Sign in to Claude', 'cmd', '/k', claudeCmd, 'login'],
      { detached: true, stdio: 'ignore' });
    // Fire-and-forget console window: if it fails to launch, the async 'error'
    // event has no listener and would surface as an uncaughtException (res has
    // already been sent). Log it instead.
    child.on('error', (e) => console.error('claude-login spawn failed:', e.message));
    child.unref();
    res.json({ ok: true, bundled: fs.existsSync(bundled) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/claude-status — best-effort: is the bundled CLI signed in? `claude
// login` writes credentials under the user's home .claude dir. Detection may miss
// (creds can live elsewhere), so `signedIn: false` means "unknown", not "signed
// out" — the UI keeps the sign-in button available either way.
router.get('/api/claude-status', (req, res) => {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const candidates = [
    path.join(home, '.claude', '.credentials.json'),
    path.join(home, '.claude', 'credentials.json'),
  ];
  const signedIn = candidates.some(p => { try { return fs.existsSync(p); } catch { return false; } });
  res.json({ signedIn });
});

// ── Optional .env-backed keys (drafts + web discovery) ────────────────────────
// Shared helpers for the key endpoints below. They upsert a KEY=value line in
// dashboard-web/.env and mirror it into the live process so it takes effect with
// no restart (spawned scripts like discover.mjs re-read .env on their next run).
// Reads never return the secret, only whether it is present.
const ENV_PATH = path.join(SETUP_ROOT, 'dashboard-web', '.env');
function readEnvKey(name) {
  try {
    const text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
    const m = text.match(new RegExp(`^${name}=(.+)$`, 'm'));
    return m && m[1] ? m[1].trim() : '';
  } catch { return ''; }
}
function writeEnvKey(name, value) {
  let text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const re = new RegExp(`^${name}=.*$`, 'm');
  if (re.test(text)) text = text.replace(re, `${name}=${value}`);
  else text = text.replace(/\s*$/, '') + (text ? '\n' : '') + `${name}=${value}\n`;
  fs.writeFileSync(ENV_PATH, text, 'utf8');
  process.env[name] = value;   // take effect now, no restart needed
}
const keyPresent = (name) => !!((process.env[name] || '').trim() || readEnvKey(name));

// GET /api/setup/anthropic-key — report whether a draft API key is set (never the key).
router.get('/api/setup/anthropic-key', (req, res) => {
  res.json({ hasKey: keyPresent('ANTHROPIC_API_KEY') });
});

// POST /api/setup/anthropic-key { key } — save the user's Anthropic API key to
// dashboard-web/.env AND into the live process (so it works immediately, no restart).
// Powers the AI draft features (cover letters, resume tailoring, outreach). NOT
// needed for Evaluate / Scan, which run on the Claude sign-in.
router.post('/api/setup/anthropic-key', (req, res) => {
  const key = ((req.body && req.body.key) || '').trim();
  if (!key) return res.status(400).json({ error: 'Paste your Anthropic API key (it starts with sk-ant-).' });
  if (!key.startsWith('sk-ant-')) return res.status(400).json({ error: 'That does not look like an Anthropic key. Anthropic keys start with "sk-ant-".' });
  try {
    writeEnvKey('ANTHROPIC_API_KEY', key);
    res.json({ ok: true, hasKey: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/setup/discovery-keys — which optional web-discovery keys are set (never
// the keys). Brave (and optional Muse) power Expand Coverage's web search; without
// them Expand Coverage only registers companies already in your pipeline. Neither is
// needed for API Scan, Agent Scan, or Evaluate.
router.get('/api/setup/discovery-keys', (req, res) => {
  res.json({ brave: keyPresent('BRAVE_API_KEY'), muse: keyPresent('MUSE_API_KEY') });
});

// POST /api/setup/discovery-keys { brave?, muse? } — save either or both optional
// web-discovery keys to dashboard-web/.env. discover.mjs reads them on the next
// Expand Coverage run.
router.post('/api/setup/discovery-keys', (req, res) => {
  const body = req.body || {};
  const saved = [];
  for (const [field, envName] of [['brave', 'BRAVE_API_KEY'], ['muse', 'MUSE_API_KEY']]) {
    if (typeof body[field] === 'string' && body[field].trim()) {
      writeEnvKey(envName, body[field].trim());
      saved.push(field);
    }
  }
  if (!saved.length) return res.status(400).json({ error: 'Paste a Brave or Muse API key first.' });
  try { res.json({ ok: true, saved, brave: keyPresent('BRAVE_API_KEY'), muse: keyPresent('MUSE_API_KEY') }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/setup/healthcheck — run the verify scripts and report pass/fail.
router.post('/api/setup/healthcheck', (req, res) => {
  const cmd = 'node verify-pipeline.mjs && node verify-reports.mjs && node verify-actionable.mjs';
  exec(cmd, { cwd: SETUP_ROOT, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
    const output = (stdout || '') + (stderr ? '\n[stderr]\n' + stderr : '');
    res.json({ ok: !err, output: output.slice(-4000) });
  });
});

// POST /api/setup/handoff/:section — return the prompt to paste into Claude Code.
router.post('/api/setup/handoff/:section', (req, res) => {
  res.json({ prompt: setupHandoffPrompt(req.params.section) });
});

// POST /api/setup/save/:section — write structured scalar fields into profile.yml.
router.post('/api/setup/save/:section', (req, res) => {
  const fields = SETUP_SCALAR_FIELDS[req.params.section];
  if (!fields) return res.status(400).json({ error: `No scalar fields for section: ${req.params.section}` });
  const body = req.body || {};
  try {
    const abs = path.join(SETUP_ROOT, SETUP_FILES.profile);
    let text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    let changed = 0;
    for (const [section, key] of fields) {
      if (!(key in body)) continue;
      const val = body[key];
      // Skip empty values so optional fields left blank don't pollute the file
      // with empty keys. Use /api/setup/reset to explicitly clear a section.
      if (val == null || String(val).trim() === '') continue;
      text = setupSetScalar(text, section, key, val);
      changed++;
    }
    fs.writeFileSync(abs, text, 'utf8');
    res.json({ ok: true, changed, state: setupComputeState() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/setup/reset/:section — blank a section's scalar fields (config only).
router.post('/api/setup/reset/:section', (req, res) => {
  const fields = SETUP_SCALAR_FIELDS[req.params.section];
  if (!fields) return res.status(400).json({ error: `Cannot reset section: ${req.params.section}` });
  try {
    const abs = path.join(SETUP_ROOT, SETUP_FILES.profile);
    let text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    for (const [section, key] of fields) text = setupSetScalar(text, section, key, '');
    fs.writeFileSync(abs, text, 'utf8');
    res.json({ ok: true, state: setupComputeState() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET/POST /api/setup/stage/:key — small JSON staging files under data/setup/
// backing the "split" sections. The dashboard saves the user's deterministic
// picks here (seniority + titles, radius + chosen companies, manual certs); the
// handoff prompts tell the user's Claude Code to read the same file, do the
// generative half (suggestions, careers-url resolution, config writes), and
// write suggestion lists back for the UI to render. Config files are still only
// written by the agent — staging is scratch, never the source of truth.
const SETUP_STAGE_KEYS = new Set(['roles', 'companies', 'certs']);
router.get('/api/setup/stage/:key', (req, res) => {
  if (!SETUP_STAGE_KEYS.has(req.params.key)) return res.status(400).json({ error: 'unknown staging key' });
  const abs = path.join(SETUP_ROOT, 'data', 'setup', `${req.params.key}.json`);
  try { res.json(JSON.parse(fs.readFileSync(abs, 'utf8'))); }
  catch { res.json({}); }
});
router.post('/api/setup/stage/:key', (req, res) => {
  if (!SETUP_STAGE_KEYS.has(req.params.key)) return res.status(400).json({ error: 'unknown staging key' });
  try {
    const dir = path.join(SETUP_ROOT, 'data', 'setup');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${req.params.key}.json`), JSON.stringify(req.body || {}, null, 2));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/setup/cv-upload — stage an uploaded CV file (base64) for the user's
// Claude Code to convert into cv.md. A .docx also seeds templates/cv-master.docx
// (the resume master) when one does not already exist. Conversion is agent work.
router.post('/api/setup/cv-upload', (req, res) => {
  const { filename, dataBase64 } = req.body || {};
  if (!filename || !dataBase64) return res.status(400).json({ error: 'filename and dataBase64 are required' });
  const safe = path.basename(String(filename));
  const ext = path.extname(safe).toLowerCase();
  if (!['.docx', '.pdf', '.md', '.txt'].includes(ext)) {
    return res.status(400).json({ error: `Unsupported file type ${ext || '(none)'}. Use .docx, .pdf, .md, or .txt` });
  }
  try {
    const stageDir = path.join(SETUP_ROOT, 'data', 'setup');
    fs.mkdirSync(stageDir, { recursive: true });
    const buf = Buffer.from(String(dataBase64).replace(/^data:[^,]*,/, ''), 'base64');
    const stagedRel = `data/setup/uploaded-cv${ext}`;
    fs.writeFileSync(path.join(SETUP_ROOT, stagedRel), buf);
    let seededMaster = false;
    if (ext === '.docx') {
      const masterAbs = path.join(SETUP_ROOT, SETUP_FILES.cvMaster);
      if (!fs.existsSync(masterAbs)) {
        fs.mkdirSync(path.dirname(masterAbs), { recursive: true });
        fs.copyFileSync(path.join(SETUP_ROOT, stagedRel), masterAbs);
        seededMaster = true;
      }
    }
    const masterNote = ext === '.docx'
      ? (seededMaster ? ' I also seeded templates/cv-master.docx from it for resume tailoring.'
                      : ' Note: templates/cv-master.docx already exists; do not overwrite it.')
      : '';
    const prompt = `I uploaded my CV to ${stagedRel}. Convert it into a clean cv.md (Summary, Experience, Projects, Education, Skills).${masterNote}${SETUP_CV_FULL} ${SETUP_GUARDRAIL}`;
    res.json({ ok: true, saved: stagedRel, seededMaster, prompt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback — serve index.html for any non-API route

