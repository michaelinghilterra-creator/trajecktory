// Setup sub-tab modules that need server work beyond the deterministic Launchpad
// endpoints in setup.mjs:
//   - Tell Me About Yourself: a Claude-written 90-second elevator pitch, tweakable
//     by seniority / industry / interview stage / length. Runs on the Claude plan
//     (generateText, keyless by default), the same path Insights uses.
//   - Change Log: serves the GitHub release notes as structured entries, falling
//     back to the Release-Please CHANGELOG.md when offline.
import express from 'express';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { ROOT_DIR } from '../config.mjs';
import { generateText } from '../lib/anthropic.mjs';
import { getIdentity } from '../lib/profile.mjs';
import { loadProfileContext } from '../lib/insights.mjs';

export const router = express.Router();

const PITCH_FILE = path.resolve(ROOT_DIR, 'data', 'elevator-pitch.json');
const CHANGELOG_MD = path.resolve(ROOT_DIR, 'CHANGELOG.md');
const VERSION_FILE = path.resolve(ROOT_DIR, 'VERSION');
// Dashboard changelog view starts here; older upstream releases are hidden.
const CHANGELOG_SINCE = '2026-05-08';

// Approx spoken words at ~150 wpm, so the model targets a real speaking length.
const LENGTH_WORDS = { '60s': 150, '90s': 220, '120s': 300 };

function readPitchFile() {
  try { return JSON.parse(fs.readFileSync(PITCH_FILE, 'utf8')); } catch { return null; }
}

// GET /api/setup/pitch — the user's last saved/edited pitch (if any).
router.get('/api/setup/pitch', (req, res) => {
  res.json(readPitchFile() || { pitch: '', tweaks: null, generated_at: null });
});

// POST /api/setup/pitch/save — persist the user's edited pitch + tweaks.
router.post('/api/setup/pitch/save', (req, res) => {
  try {
    const { pitch, tweaks } = req.body || {};
    const out = { pitch: String(pitch || ''), tweaks: tweaks || null, generated_at: readPitchFile()?.generated_at || null, saved: true };
    fs.mkdirSync(path.dirname(PITCH_FILE), { recursive: true });
    fs.writeFileSync(PITCH_FILE, JSON.stringify(out, null, 2));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/setup/pitch/generate — body { seniority, industry, interviewStage, length }
router.post('/api/setup/pitch/generate', async (req, res) => {
  try {
    // req.body values can arrive as arrays/objects under parameter tampering, which
    // would break the string sinks below (prompt text + the LENGTH_WORDS[length]
    // object-key lookup). Take each only when it is genuinely a string; otherwise use
    // the default. The typeof guard is the type-narrowing CodeQL requires (a later
    // String() coercion does not satisfy the dataflow — it flags the binding itself).
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const asStr = (v, d) => (typeof v === 'string' ? v : d);
    const seniority = asStr(body.seniority, 'Director');
    const industry = asStr(body.industry, '');
    const interviewStage = asStr(body.interviewStage, 'Recruiter screen');
    const length = asStr(body.length, '90s');
    const id = getIdentity();
    const profile = loadProfileContext();           // modes/_profile.md, trimmed
    let cv = '';
    try { cv = fs.readFileSync(path.resolve(ROOT_DIR, 'cv.md'), 'utf8').slice(0, 3500); } catch { /* pre-onboarding */ }
    const words = LENGTH_WORDS[length] || 220;

    if (!profile && !cv) {
      return res.status(422).json({ error: 'Finish your Launchpad profile (CV + edge) first so the pitch has something to work from.' });
    }

    // Static system prompt: it describes HOW to use the parameters but never
    // interpolates the request body. The user-provided tweaks (length, seniority,
    // industry, stage) go in the user message below instead, so untrusted input
    // can't rewrite the model's instructions (CodeQL js/system-prompt-injection).
    const sys = `You are an interview coach. Write a spoken "Tell me about yourself" answer the candidate can deliver out loud. Natural, confident, first person. Not a bio, not a cover letter.

You will be given, as parameters in the user message, a target length, seniority level, industry, and interview stage. Honor them.

RULES:
- Match the requested spoken length (roughly the given word count). Stay close to it.
- First person, conversational, no corporate filler, no em dashes.
- Open with a one-line identity hook, give 2-3 proof points anchored in real experience from the profile/CV, then close on why this kind of role now.
- Frame the answer for the requested seniority level.
- If an industry is given, tailor the language and examples to it.
- Match the audience to the interview stage: for a hiring manager go deeper on scope, impact, and how you operate; for a final loop emphasize leadership, judgment, and fit for the specific team; otherwise keep it crisp and high-level, focused on fit and trajectory.
- Use only facts supported by the profile/CV. Do not invent employers, titles, or metrics.
- Output ONLY the pitch text. No preamble, no headings, no quotes around it.`;

    const parts = [];
    parts.push(`## Parameters for this pitch
- Length: about ${words} words (${length})
- Seniority: ${seniority}
- Industry: ${industry || '(none specified)'}
- Interview stage: ${interviewStage}`);
    if (id.fullName) parts.push(`## Candidate\n${id.fullName}${id.headline ? ` — ${id.headline}` : ''}`);
    if (profile) parts.push(`## Profile (modes/_profile.md)\n\n${profile}`);
    if (cv) parts.push(`## CV (cv.md, trimmed)\n\n${cv}`);
    parts.push(`Write the "Tell me about yourself" answer now, honoring the parameters above.`);

    const pitch = (await generateText(parts.join('\n\n'), {
      model: 'claude-sonnet-4-6',
      maxTokens: 1200,
      system: sys,
    })).trim();

    const tweaks = { seniority, industry, interviewStage, length };
    const out = { pitch, tweaks, generated_at: new Date().toISOString() };
    try {
      fs.mkdirSync(path.dirname(PITCH_FILE), { recursive: true });
      fs.writeFileSync(PITCH_FILE, JSON.stringify(out, null, 2));
    } catch { /* non-fatal: still return the pitch */ }
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Turn a raw changelog bullet or paragraph into clean, hand-written-looking prose:
// strip commit/issue reference links, any leftover [label](url) markdown, and
// **bold** markers, then sentence-case the first letter.
function cleanNote(text) {
  return String(text)
    .replace(/\s*\([^()]*\[[^\]]+\]\([^)]*\)\)/g, '') // drop ([hash](url)) and (closes [#12](url)) refs
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')          // any remaining [label](url) -> label
    .replace(/\*\*/g, '')                             // bold markers
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^([a-z])/, (_, c) => c.toUpperCase());  // sentence-case
}

// Parse the CHANGELOG.md into structured, skimmable entries. Handles both the
// hand-written keepachangelog format and the Release Please generated format,
// and folds free-text paragraphs (e.g. the upstream-sync note) into a note so
// every entry reads like a hand-written one.
function parseChangelog(md) {
  const entries = [];
  let cur = null, sec = null, inProse = false;
  const ensureSec = () => { if (!sec) { sec = { heading: '', items: [] }; cur.sections.push(sec); } };
  for (const ln of (md || '').split(/\r?\n/)) {
    // Version heading, either format:
    //   ## [1.7.32] - 2026-06-29
    //   ## [1.10.1](https://.../compare/...) (2026-07-02)
    const h = ln.match(/^##\s+\[?([^\]()\s]+)\]?/);
    if (h && /^\d|unreleased/i.test(h[1])) {
      const dm = ln.match(/(\d{4}-\d{2}-\d{2})/);
      cur = { version: h[1], date: dm ? dm[1] : '', sections: [] };
      entries.push(cur); sec = null; inProse = false; continue;
    }
    if (!cur) continue;
    const sh = ln.match(/^###\s+(.+)$/);
    if (sh) { sec = { heading: sh[1].trim(), items: [] }; cur.sections.push(sec); inProse = false; continue; }
    const it = ln.match(/^[-*]\s+(.+)$/);
    if (it) { ensureSec(); sec.items.push(cleanNote(it[1])); inProse = false; continue; }
    // Free-text paragraph: fold consecutive lines into a single clean note.
    const prose = ln.trim();
    if (prose) {
      ensureSec();
      if (inProse && sec.items.length) {
        sec.items[sec.items.length - 1] = cleanNote(sec.items[sec.items.length - 1] + ' ' + prose);
      } else {
        sec.items.push(cleanNote(prose)); inProse = true;
      }
    }
  }
  return entries;
}

// ─── GitHub release notes ────────────────────────────────────────────────────
// CHANGELOG.md is written by Release Please from commit SUBJECTS, so rendering it
// here showed users lines like "Verify-no-pii: flag a tracker company named
// beside an outreach verb" as though it were a feature name. The plain-language
// notes are hand-written on the GitHub release; read those instead. CHANGELOG.md
// stays as the offline fallback, so the panel still works with no network and an
// install that has never reached GitHub behaves exactly as before.
const RELEASE_CACHE = path.resolve(ROOT_DIR, 'data', 'release-notes-cache.json');
const RELEASE_TTL_MS = 6 * 60 * 60 * 1000;
const RELEASE_FALLBACK_SLUG = 'michaelinghilterra-creator/trajecktory';

// Prefer the install's own origin so a fork shows its own notes; fall back to the
// canonical public repo (the same constant update-system.mjs anchors on).
function repoSlug() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT_DIR, encoding: 'utf8', timeout: 4000 }).trim();
    const m = url.match(/github\.com[/:]([^/]+)\/([^/.\s]+)/);
    if (m) return `${m[1]}/${m[2]}`;
  } catch { /* no git, no remote, or not a checkout */ }
  return RELEASE_FALLBACK_SLUG;
}

async function fetchReleases() {
  try {
    const c = JSON.parse(fs.readFileSync(RELEASE_CACHE, 'utf8'));
    if (Date.now() - c.at < RELEASE_TTL_MS && Array.isArray(c.releases)) return c.releases;
  } catch { /* cold or stale cache */ }
  // Unauthenticated: 60 req/hr per IP, hence the cache. A failure here is not an
  // error condition — the caller falls back to the local changelog.
  const res = await fetch(`https://api.github.com/repos/${repoSlug()}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'trajecktory-dashboard' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const releases = (await res.json())
    .filter(r => r && !r.draft && !r.prerelease)
    .map(r => ({
      version: String(r.tag_name || '').replace(/^trajecktory[\s-]*/i, '').replace(/^v/, ''),
      date: String(r.published_at || '').slice(0, 10),
      body: String(r.body || ''),
    }));
  try {
    fs.mkdirSync(path.dirname(RELEASE_CACHE), { recursive: true });
    fs.writeFileSync(RELEASE_CACHE, JSON.stringify({ at: Date.now(), releases }, null, 2));
  } catch { /* cache is an optimisation, not a requirement */ }
  return releases;
}

// Install instructions are the bulk of a release body and are useless in-app: by
// the time this renders, the reader is already installed.
const SKIP_SECTION = /^(install|download|upgrad|getting started)/i;

function parseReleaseBody(body) {
  const sections = [];
  let sec = null, skipping = false, inProse = false;
  const open = (heading) => { sec = { heading, items: [] }; sections.push(sec); inProse = false; };
  for (const ln of String(body).split(/\r?\n/)) {
    const h3 = ln.match(/^###\s+(.+)$/);
    const h2 = !h3 && ln.match(/^##\s+(.+)$/);
    if (h2) {
      const t = h2[1].trim();
      skipping = SKIP_SECTION.test(t);
      // "What changed" is a wrapper, not a section — its ### children carry the headings.
      if (!skipping && !/^what changed/i.test(t)) open(t); else sec = null;
      continue;
    }
    if (h3) { if (!skipping) open(h3[1].trim()); continue; }
    if (skipping) continue;
    const it = ln.match(/^[-*]\s+(.+)$/);
    if (it) { if (!sec) open(''); sec.items.push(cleanNote(it[1])); inProse = false; continue; }
    const prose = ln.trim();
    if (!prose) { inProse = false; continue; }
    if (/^<!--/.test(prose)) continue;
    if (!sec) open('');
    if (inProse && sec.items.length) sec.items[sec.items.length - 1] = cleanNote(`${sec.items[sec.items.length - 1]} ${prose}`);
    else { sec.items.push(cleanNote(prose)); inProse = true; }
  }
  return sections.filter(s => s.items.length);
}

// GET /api/setup/changelog — current version + parsed release notes (newest first).
// `source` tells the UI which it got, so a fallback render can say so rather than
// silently presenting commit subjects as if they were written for a reader.
router.get('/api/setup/changelog', async (req, res) => {
  let version = '';
  try { version = fs.readFileSync(VERSION_FILE, 'utf8').trim(); } catch { /* dev checkout */ }

  let entries = [];
  try {
    entries = (await fetchReleases())
      .filter(r => r.date && r.date >= CHANGELOG_SINCE && r.body.trim())
      .map(r => ({ version: r.version, date: r.date, sections: parseReleaseBody(r.body) }))
      .filter(e => e.sections.length);
  } catch { /* offline, rate-limited, or a fork with no releases */ }

  if (entries.length) return res.json({ version, entries, source: 'release-notes' });

  try {
    const md = fs.readFileSync(CHANGELOG_MD, 'utf8');
    entries = parseChangelog(md).filter(e => e.date && e.date >= CHANGELOG_SINCE);
  } catch { /* no changelog either */ }
  res.json({ version, entries, source: 'changelog-md' });
});
