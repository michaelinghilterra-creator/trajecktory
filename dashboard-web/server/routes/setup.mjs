import express from 'express';
import fs from 'fs';
import path from 'path';
import { exec, spawn } from 'child_process';
import { SETUP_ROOT, SETUP_FILES, setupSetScalar, SETUP_SCALAR_FIELDS, setupComputeState, SETUP_GUARDRAIL, SETUP_CV_FULL, setupHandoffPrompt } from '../lib/setup.mjs';
import { modelsState, validateSetting } from '../lib/pricing.mjs';
import { checkWorkspaceTrust, trustWorkspace } from '../lib/workspace-trust.mjs';
import { APPLICATIONS_TEMPLATE_CSV, CONTACTS_TEMPLATE_CSV } from '../lib/csv.mjs';

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
  // Being signed in is necessary but not sufficient: an untrusted workspace lets
  // the CLI start and then silently strips WebSearch/WebFetch from the agent, so
  // report it alongside sign-in and let the sidebar warn BEFORE a run is paid for.
  const trust = checkWorkspaceTrust();
  res.json({
    signedIn,
    workspaceTrusted: trust.ok,
    trustReason: trust.reason,
    trustKey: trust.trustKey,
    trustMessage: trust.message,
    trustLosing: trust.losing,
  });
});

// POST /api/setup/trust-workspace — mark this install's folder trusted so Claude
// Code stops discarding its permissions.allow list. Deliberately a user-initiated
// button and never an automatic repair: this flips a security flag, and the trust
// dialog exists precisely so a program cannot answer it for you. Backs up
// .claude.json next to itself before writing.
router.post('/api/setup/trust-workspace', (req, res) => {
  try {
    const before = checkWorkspaceTrust();
    if (before.ok) return res.json({ ok: true, alreadyTrusted: true, trustKey: before.trustKey });
    const { trustKey, backup } = trustWorkspace();
    const after = checkWorkspaceTrust();
    if (!after.ok) return res.status(500).json({ ok: false, error: 'Trust flag written but still reads untrusted.', trustKey });
    res.json({ ok: true, trustKey, backup });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
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

// ── Per-section model selection + cost ────────────────────────────────────────
// The Models & Cost settings let the user pick which model runs each workflow
// section (Triage / Agent Scan / Evaluate / Insights / Drafts) and tune the
// Evaluate batch size, with approximate per-run costs. Selections persist as
// TJK_* keys in dashboard-web/.env via the same writeEnvKey mechanism as the API
// key (so a change takes effect on the next run with no restart). pricing.mjs is
// the single source of truth for options, defaults, validation, and estimates.

// GET /api/setup/models — current selections, allowed options, per-choice cost
// estimates, batch knobs, and a full-run total. hasKey gates whether $ figures
// apply (API-key path) or the plan path (no per-token cost) is in effect.
router.get('/api/setup/models', (req, res) => {
  try { res.json(modelsState({ keyPresent: keyPresent('ANTHROPIC_API_KEY') })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/setup/models { section, value } — set one section's model (alias) or
// a batch knob. Validated against the pricing.mjs allow-list (security: the value
// becomes a --model argv element in agent.mjs), then written to .env + live env.
router.post('/api/setup/models', (req, res) => {
  const { section, value } = req.body || {};
  const v = validateSetting(section, value);
  if (!v.ok) return res.status(400).json({ error: v.error });
  try {
    writeEnvKey(v.envKey, v.value);
    res.json(modelsState({ keyPresent: keyPresent('ANTHROPIC_API_KEY') }));
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
// ── GET /api/setup/template/:kind — blank CSVs to fill in ───────────────────
// The Import step used to be a stub that copied a generic prompt, and the
// reported reaction to it was that the flow could not be trusted enough to use.
// A file you fill in and hand back is a contract you can see; a prompt that
// rewrites your tracker is not.
//
// Applications is download-only for now. Turning a filled-in sheet into tracker
// rows has to go through formatTrackerLine and merge-tracker, because a
// hand-rolled row is still a valid-looking row and the damage shows up later as
// a column holding the wrong thing. Shipping the template without the importer
// is the honest half: a half-working importer that corrupts a tracker is worse
// than none.
const SETUP_TEMPLATES = {
  applications: { file: 'applications-template.csv', body: () => APPLICATIONS_TEMPLATE_CSV },
  contacts:     { file: 'contacts-template.csv',     body: () => CONTACTS_TEMPLATE_CSV },
};

router.get('/api/setup/template/:kind', (req, res) => {
  const t = SETUP_TEMPLATES[req.params.kind];
  if (!t) return res.status(404).json({ error: 'no such template' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${t.file}"`);
  res.send(t.body());
});

// ── POST /api/setup/preview-matches ──────────────────────────────────────────
// "Would this filter actually find me anything?" — answered in seconds, before
// the user spends an hour tuning config they cannot evaluate.
//
// A beta tester completed the entire setup and only then discovered the filter
// matched almost nothing (report 2026-07-21). Nothing in the flow gave them a
// feedback loop: they chose titles, chose companies, and got no signal until the
// first real scan. This is that loop.
//
// Zero LLM cost. It samples a handful of enabled tracked companies, pulls their
// public ATS JSON, and runs the SAME buildTitleFilter / buildLocationFilter the
// real scan uses — importing them rather than reimplementing, so the preview can
// never drift from the thing it is previewing.
//
// Deliberately a SAMPLE, not a full scan: this runs synchronously while the user
// waits, so it trades completeness for an answer in a few seconds. The response
// says how many companies it sampled so the number is never mistaken for a
// complete scan result.
// 20, not 8. The boards are fetched in parallel so the wall-clock cost is nearly
// flat, and 8 was small enough to mislead: on a mature 600-company portals.yml it
// covered ~1% and confidently reported "nothing matches" from companies the user
// never targeted. The client also scales its wording to the coverage ratio, since
// no sample size makes a 1% slice a verdict.
const PREVIEW_SAMPLE = 20;
const PREVIEW_TIMEOUT_MS = 8000;

function previewAtsEndpoint(company) {
  const url = company.careers_url || '';
  if (company.api && company.api.includes('greenhouse')) return { type: 'greenhouse', url: company.api };
  let m = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (m) return { type: 'ashby', url: `https://api.ashbyhq.com/posting-api/job-board/${m[1]}` };
  m = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (m) return { type: 'lever', url: `https://api.lever.co/v0/postings/${m[1]}?mode=json` };
  m = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (m) return { type: 'greenhouse', url: `https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs` };
  return null;
}

function previewParse(type, json) {
  if (type === 'greenhouse') return (json.jobs || []).map(j => ({ title: j.title, location: j.location?.name || '' }));
  if (type === 'lever')      return (json || []).map(j => ({ title: j.text, location: j.categories?.location || '' }));
  if (type === 'ashby')      return (json.jobs || []).map(j => ({ title: j.title, location: j.location || '' }));
  return [];
}

router.post('/api/setup/preview-matches', async (req, res) => {
  try {
    const [{ buildTitleFilter, buildLocationFilter }, yaml] = await Promise.all([
      import('../../../lib/scan-core.mjs'),
      import('js-yaml'),
    ]);
    const portalsPath = path.join(SETUP_ROOT, 'portals.yml');
    if (!fs.existsSync(portalsPath)) {
      return res.json({ error: 'No portals.yml yet. Run the preflight check first and it will be created for you.' });
    }
    const portals = yaml.default.load(fs.readFileSync(portalsPath, 'utf8')) || {};
    const titleOk = buildTitleFilter(portals.title_filter);
    const locOk = buildLocationFilter(portals.title_filter);

    const enabled = (portals.tracked_companies || []).filter(c => c.enabled !== false && c.careers_url);
    // Spread the sample across the list instead of taking the first N: the file
    // is grouped by sector, so the head of the list is one sector and would give
    // a badly skewed answer.
    const step = Math.max(1, Math.floor(enabled.length / PREVIEW_SAMPLE));
    const sample = [];
    for (let i = 0; i < enabled.length && sample.length < PREVIEW_SAMPLE; i += step) sample.push(enabled[i]);

    let seen = 0, titleBlocked = 0, geoBlocked = 0, reached = 0;
    const examples = [];
    await Promise.all(sample.map(async (company) => {
      const ep = previewAtsEndpoint(company);
      if (!ep) return;
      try {
        const r = await fetch(ep.url, { signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS) });
        if (!r.ok) return;
        const postings = previewParse(ep.type, await r.json());
        reached++;
        for (const p of postings) {
          if (!p.title) continue;
          seen++;
          if (!titleOk(p.title)) { titleBlocked++; continue; }
          if (!locOk(p.location)) { geoBlocked++; continue; }
          if (examples.length < 12) examples.push({ title: p.title, location: p.location, company: company.name });
        }
      } catch { /* one unreachable board must not fail the whole preview */ }
    }));

    const matched = seen - titleBlocked - geoBlocked;
    res.json({
      sampledCompanies: sample.length,
      reachedCompanies: reached,
      totalCompanies: enabled.length,
      seen, matched, titleBlocked, geoBlocked,
      examples,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Tracked companies: see all of them, and turn any of them off ─────────────
// The Launchpad only ever showed companies STAGED for the next merge, so once an
// employer landed in portals.yml the interface had no way to show it or touch
// it. Removing one meant Claude Desktop or the CLI. The report was blunt about
// what that costs: users need to see ALL companies and be able to X them off.
//
// Two deliberate choices:
//
// 1. MATCH ON careers_url, NOT name. A company that migrates ATS keeps its name
//    and gains a new board, so name matching can hit the wrong row (or two rows)
//    where the URL is unique. company-audit.mjs matches on name, which is a
//    known sharp edge, not a pattern to copy.
//
// 2. DISABLE, NEVER DELETE. Setting `enabled: false` is what AGENTS.md calls a
//    tombstone, and it is what stops a dead slug being rediscovered from a stale
//    pipeline URL and silently re-added. Deleting the row would lose that, and
//    lose whatever scan tuning and notes it carries. It is also reversible,
//    which matters a great deal more for a button than for a CLI flag.
//
// Edits are line-based, never a js-yaml round trip: this file is 4000+ lines of
// hand-tuned entries, comments, retest policies and tombstone notes, and
// re-serialising it would discard all of that while looking like it worked.
// split('\n') / join('\n') preserves the file's CRLF endings, because the \r
// stays attached to the end of each line and is never stripped.
function portalsPath() { return path.join(SETUP_ROOT, 'portals.yml'); }

// One backup per day, not one per click: this is a safety net, not a version
// store, and a toggle-happy afternoon should not bury the repo in files.
function backupPortalsOncePerDay() {
  const src = portalsPath();
  if (!fs.existsSync(src)) return;
  const day = new Date().toISOString().slice(0, 10);
  const dest = `${src}.bak-${day}-dashboard`;
  if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
}

router.get('/api/setup/companies', (req, res) => {
  try {
    const p = portalsPath();
    if (!fs.existsSync(p)) return res.json({ companies: [] });
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    const companies = [];
    let cur = null;
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '');
      const nameM = line.match(/^\s*-\s*name:\s*(.+?)\s*$/);
      if (nameM) {
        if (cur) companies.push(cur);
        cur = { name: nameM[1], careers_url: null, enabled: true, note: null };
        continue;
      }
      if (!cur) continue;
      const urlM = line.match(/^\s*careers_url:\s*(\S+)/);
      if (urlM) { cur.careers_url = urlM[1]; continue; }
      const enM = line.match(/^\s*enabled:\s*(true|false)\s*(?:#\s*(.*))?$/);
      if (enM) { cur.enabled = enM[1] === 'true'; if (enM[2]) cur.note = enM[2].trim(); }
    }
    if (cur) companies.push(cur);
    // Only rows that actually name a board are addressable.
    res.json({ companies: companies.filter(c => c.careers_url) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/api/setup/companies/toggle', (req, res) => {
  try {
    const { careers_url: url, enabled } = req.body || {};
    if (!url || typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'careers_url and enabled are required' });
    }
    const p = portalsPath();
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'portals.yml not found' });

    const lines = fs.readFileSync(p, 'utf8').split('\n');
    const urlIdx = lines.findIndex(l => l.replace(/\r$/, '').match(/^\s*careers_url:\s*(\S+)/)?.[1] === url);
    if (urlIdx < 0) return res.status(404).json({ error: 'company not found' });

    // Walk out from the URL line to the enabled line of the SAME entry, stopping
    // at the next "- name:" so a company with no enabled line never steals the
    // following company's.
    let target = -1;
    for (let i = urlIdx + 1; i < lines.length; i++) {
      const l = lines[i].replace(/\r$/, '');
      if (/^\s*-\s*name:/.test(l)) break;
      if (/^\s*enabled:\s*(true|false)/.test(l)) { target = i; break; }
    }
    if (target < 0) {
      for (let i = urlIdx - 1; i >= 0 && i > urlIdx - 12; i--) {
        const l = lines[i].replace(/\r$/, '');
        if (/^\s*-\s*name:/.test(l)) break;
        if (/^\s*enabled:\s*(true|false)/.test(l)) { target = i; break; }
      }
    }
    if (target < 0) return res.status(422).json({ error: 'no enabled: line found for that company' });

    backupPortalsOncePerDay();
    const cr = lines[target].endsWith('\r') ? '\r' : '';
    const indent = lines[target].match(/^\s*/)[0];
    lines[target] = enabled
      ? `${indent}enabled: true${cr}`
      : `${indent}enabled: false  # turned off in the dashboard${cr}`;
    fs.writeFileSync(p, lines.join('\n'));
    res.json({ ok: true, careers_url: url, enabled });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

