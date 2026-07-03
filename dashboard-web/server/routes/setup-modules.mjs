// Setup sub-tab modules that need server work beyond the deterministic Launchpad
// endpoints in setup.mjs:
//   - Tell Me About Yourself: a Claude-written 90-second elevator pitch, tweakable
//     by seniority / industry / interview stage / length. Runs on the Claude plan
//     (generateText, keyless by default), the same path Insights uses.
//   - Change Log: serves the Release-Please CHANGELOG.md as structured entries.
import express from 'express';
import fs from 'fs';
import path from 'path';
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
    const { seniority = 'Director', industry = '', interviewStage = 'Recruiter screen', length = '90s' } = req.body || {};
    const id = getIdentity();
    const profile = loadProfileContext();           // modes/_profile.md, trimmed
    let cv = '';
    try { cv = fs.readFileSync(path.resolve(ROOT_DIR, 'cv.md'), 'utf8').slice(0, 3500); } catch { /* pre-onboarding */ }
    const words = LENGTH_WORDS[length] || 220;

    if (!profile && !cv) {
      return res.status(422).json({ error: 'Finish your Launchpad profile (CV + edge) first so the pitch has something to work from.' });
    }

    const sys = `You are an interview coach. Write a spoken "Tell me about yourself" answer the candidate can deliver out loud — natural, confident, first person. Not a bio, not a cover letter.

RULES:
- About ${words} words (a ${length} spoken answer). Stay close to that length.
- First person, conversational, no corporate filler, no em dashes.
- Open with a one-line identity hook, give 2-3 proof points anchored in real experience from the profile/CV, then close on why this kind of role now.
- Frame for a ${seniority}-level candidate.${industry ? ` Tailor the language and examples to the ${industry} industry.` : ''}
- Audience is the ${interviewStage}: ${interviewStage === 'Hiring manager' ? 'go deeper on scope, impact, and how you operate.' : interviewStage === 'Final loop' ? 'emphasize leadership, judgment, and fit for the specific team.' : 'keep it crisp and high-level, focused on fit and trajectory.'}
- Use only facts supported by the profile/CV. Do not invent employers, titles, or metrics.
- Output ONLY the pitch text. No preamble, no headings, no quotes around it.`;

    const parts = [];
    if (id.fullName) parts.push(`## Candidate\n${id.fullName}${id.headline ? ` — ${id.headline}` : ''}`);
    if (profile) parts.push(`## Profile (modes/_profile.md)\n\n${profile}`);
    if (cv) parts.push(`## CV (cv.md, trimmed)\n\n${cv}`);
    parts.push(`Write the ${length} "Tell me about yourself" answer now.`);

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

// GET /api/setup/changelog — current version + parsed release notes (newest first).
router.get('/api/setup/changelog', (req, res) => {
  try {
    let version = '';
    try { version = fs.readFileSync(VERSION_FILE, 'utf8').trim(); } catch { /* dev checkout */ }
    let md = '';
    try { md = fs.readFileSync(CHANGELOG_MD, 'utf8'); } catch { /* no changelog yet */ }
    const entries = parseChangelog(md).filter(e => e.date && e.date >= CHANGELOG_SINCE);
    res.json({ version, entries });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
