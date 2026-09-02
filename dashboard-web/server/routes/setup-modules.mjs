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
import { ROOT_DIR, DATA_DIR } from '../config.mjs';
import { cleanNote, fetchReleases, parseReleaseBody } from '../lib/release-notes.mjs';
import { generateText } from '../lib/anthropic.mjs';
import { cleanProse } from '../lib/text-hygiene.mjs';
import { getIdentity } from '../lib/profile.mjs';
import { loadProfileContext } from '../lib/insights.mjs';
import { buildActivities, weeklyCounts, employersInActivities, toTwcCsv, enrichEmployers, ENRICH_MAX } from '../lib/twc.mjs';
import { getArchetypeRules } from '../lib/profile.mjs';

export const router = express.Router();

// DATA_DIR, never ROOT_DIR + 'data'. See tests/data-dir-sandbox.test.mjs.
const PITCH_FILE = path.resolve(DATA_DIR, 'elevator-pitch.json');
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

    const pitch = cleanProse((await generateText(parts.join('\n\n'), {
      // Alias, not a hardcoded id, so it honors the user's Sonnet version pin
      // (generateText resolves it via resolveModelId).
      model: 'sonnet',
      maxTokens: 1200,
      system: sys,
    })).trim());

    const tweaks = { seniority, industry, interviewStage, length };
    const out = { pitch, tweaks, generated_at: new Date().toISOString() };
    try {
      fs.mkdirSync(path.dirname(PITCH_FILE), { recursive: true });
      fs.writeFileSync(PITCH_FILE, JSON.stringify(out, null, 2));
    } catch { /* non-fatal: still return the pitch */ }
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
    if (it) { ensureSec(); sec.items.push({ type: 'bullet', text: cleanNote(it[1]) }); inProse = false; continue; }
    // Free-text paragraph: fold consecutive lines into a single clean note.
    // Same {type, text} item shape as parseReleaseBody, because the same two
    // components render whichever of the two sources answered.
    const prose = ln.trim();
    if (prose) {
      ensureSec();
      const last = sec.items[sec.items.length - 1];
      if (inProse && last) {
        last.text = cleanNote(last.text + ' ' + prose);
      } else {
        sec.items.push({ type: 'prose', text: cleanNote(prose) }); inProse = true;
      }
    }
  }
  return entries;
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

// ─── TWC work-search report ───────────────────────────────────────────────────
// Texas Workforce Commission unemployment work-search log, assembled from the
// user's own applications / interviews / follow-ups. Data assembly + web-search
// employer enrichment live in lib/twc.mjs; these routes are thin. Dates are
// validated against the ISO shape, same as agent.mjs cost-history — a malformed
// value degrades to open-ended rather than filtering on garbage.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoOrUndef = (v) => (ISO_DATE_RE.test(String(v || '')) ? String(v) : undefined);

// GET /api/setup/twc?from=&to= — activities in the range, per-week counts, and the
// distinct employers (with whether each is already cached) that drive look-up.
router.get('/api/setup/twc', (req, res) => {
  try {
    const from = isoOrUndef(req.query.from);
    const to = isoOrUndef(req.query.to);
    const activities = buildActivities({ from, to });
    res.json({
      from: from || null,
      to: to || null,
      count: activities.length,
      activities,
      weeks: weeklyCounts(activities),
      employers: employersInActivities(activities),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/setup/twc/export?from=&to= — the same activities as a CSV attachment
// (the established Content-Disposition download idiom; a GET needs no CSRF token).
router.get('/api/setup/twc/export', (req, res) => {
  try {
    const from = isoOrUndef(req.query.from);
    const to = isoOrUndef(req.query.to);
    const csv = toTwcCsv(buildActivities({ from, to }));
    const stamp = (s) => (s ? String(s) : 'all');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="Work_Search_Log_${stamp(from)}_to_${stamp(to)}.csv"`);
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/setup/twc/enrich  { companies: [names] } — web-search each un-cached
// employer's US HQ address + main phone and cache it. Capped per call for
// rate-limit protection; the client pages through larger sets.
router.post('/api/setup/twc/enrich', async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const companies = Array.isArray(body.companies) ? body.companies.filter(c => typeof c === 'string') : [];
    if (!companies.length) return res.status(400).json({ error: 'companies[] required' });
    if (companies.length > ENRICH_MAX) {
      return res.status(400).json({ error: `Max ${ENRICH_MAX} companies per call (rate-limit protection).` });
    }
    res.json(await enrichEmployers(companies));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Customize — post-onboarding customization status ────────────────────────
// Returns the configured/default status of each customization section so the
// Customize subtab can show cards with status indicators.
function safeRead(rel) {
  try { return fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8'); } catch { return null; }
}

router.get('/api/setup/customize', (req, res) => {
  try {
    const profile = safeRead('config/profile.yml') || '';
    const modeProfile = safeRead('modes/_profile.md') || '';
    const portals = safeRead('portals.yml') || '';
    const sequences = safeRead('templates/outreach-sequences.json') || '';
    const storyBank = safeRead('interview-prep/story-bank.md') || '';
    const articleDigest = safeRead('article-digest.md');

    const hasArchetypeRules = getArchetypeRules().length > 0;

    // Check _profile.md for HTML comment placeholders (template defaults)
    const framingPlaceholder = /<!--\s*Archetype \d\s*-->/.test(modeProfile);
    const framingFilled = /\|\s*\S[^|]*\|\s*\S[^|]*\|\s*\S[^|]*\|\s*\S[^|]*\|/.test(
      modeProfile.split(/## Your Adaptive Framing/i)[1]?.split(/^## /m)[0] || ''
    );
    const evalTuningFilled = (() => {
      const section = (modeProfile.split(/## Your Evaluation Tuning/i)[1] || '').split(/^## /m)[0] || '';
      const hasRealPriority = /^\d+\.\s+\S/m.test(section.replace(/^\d+\.\s+<!--.*?-->\s*$/gm, ''));
      const hasRealDealbreaker = /^-\s+\S/m.test(section.replace(/^-\s+<!--.*?-->\s*$/gm, ''));
      return hasRealPriority || hasRealDealbreaker;
    })();
    const exitFilled = (() => {
      const section = (modeProfile.split(/## Your Exit Narrative/i)[1] || '').split(/^## /m)[0] || '';
      return !/Use the candidate's exit story from/.test(section) || section.length > 300;
    })();
    const crossCuttingFilled = (() => {
      const section = (modeProfile.split(/## Your Cross-cutting Advantage/i)[1] || '').split(/^## /m)[0] || '';
      return !/Technical builder with real-world proof/.test(section) && section.trim().length > 50;
    })();

    // Scoring: compare weights to example defaults
    const exampleWeights = { fit: 0.35, northStar: 0.25, level: 0.15, comp: 0, location: 0.10 };
    const scoringCustomized = (() => {
      const m = profile.match(/fit:\s*([\d.]+)/);
      const n = profile.match(/northStar:\s*([\d.]+)/);
      if (!m || !n) return false;
      return parseFloat(m[1]) !== exampleWeights.fit || parseFloat(n[1]) !== exampleWeights.northStar;
    })();

    // Narrative
    const headline = (profile.match(/headline:\s*"?([^"\n]*)"?/m) || [])[1] || '';
    const superpowers = (profile.match(/superpowers:\s*\n((?:\s+-\s+.*\n?)*)/m) || [])[1] || '';
    const superpowerCount = (superpowers.match(/^\s+-/gm) || []).length;
    const narrativeExampleHeadline = 'ML Engineer turned AI product builder';

    // Outreach cadence
    const minDays = (profile.match(/minDaysBetweenTouches:\s*(\d+)/) || [])[1];
    const maxTouches = (profile.match(/maxTouchesPer30d:\s*(\d+)/) || [])[1];
    const outreachCustomized = (minDays && minDays !== '3') || (maxTouches && maxTouches !== '6');

    // Outreach sequences: check for sales-specific stakeholder types
    const hasSalesStakeholders = /CRO|CFO|VP.Sales|Chief Revenue/i.test(sequences);

    // Story bank
    const storyCount = (storyBank.match(/^##\s+/gm) || []).length;

    // Search queries in portals
    const hasSearchQueries = /search_queries:/i.test(portals) &&
      /^\s+-\s+"?\S/m.test((portals.split(/search_queries:/i)[1] || '').split(/^[a-z_]+:/m)[0] || '');

    // Location policy
    const hasLocationPolicy = /location_policy:/i.test(portals);

    const sections = [
      {
        id: 'scoring', order: 1, group: 'core',
        label: 'Scoring Priorities & Deal-Breakers',
        desc: 'Which evaluation dimensions matter most. What roles to auto-reject.',
        files: ['config/profile.yml (scoring.weights)', 'modes/_profile.md (Evaluation Tuning)'],
        status: (scoringCustomized || evalTuningFilled) ? 'configured' : 'default',
      },
      {
        id: 'outreach-stakeholders', order: 2, group: 'core',
        label: 'Outreach Stakeholders & Messaging',
        desc: 'Who you reach out to and how your messages sound.',
        files: ['templates/outreach-sequences.json', 'modes/_profile.md (Negotiation Scripts)'],
        status: !hasSalesStakeholders ? 'configured' : 'default',
      },
      {
        id: 'voice', order: 3, group: 'core',
        label: 'Voice & Achievement Framing',
        desc: 'Tone, power verbs, prohibited phrases, per-archetype proof points.',
        files: ['modes/_profile.md (Adaptive Framing)'],
        status: (framingFilled && !framingPlaceholder) ? 'configured' : 'default',
      },
      {
        id: 'narrative', order: 4, group: 'core',
        label: 'Narrative & Branding',
        desc: 'Professional headline, superpowers, exit story, proof points.',
        files: ['config/profile.yml (narrative)'],
        status: (headline && headline !== narrativeExampleHeadline && superpowerCount >= 3) ? 'configured' : 'default',
      },
      {
        id: 'exit', order: 5, group: 'core',
        label: 'Exit Narrative & Sensitive Framing',
        desc: 'How short tenures, career gaps, and your transition are framed.',
        files: ['modes/_profile.md (Exit Narrative, Cross-cutting Advantage)'],
        status: (exitFilled && crossCuttingFilled) ? 'configured' : 'default',
      },
      {
        id: 'stories', order: 6, group: 'core',
        label: 'Interview Themes & Story Bank',
        desc: 'STAR+R stories for behavioral interviews and cheat sheets.',
        files: ['interview-prep/story-bank.md'],
        status: storyCount >= 3 ? 'configured' : 'default',
      },
      {
        id: 'search-queries', order: 7, group: 'enhance',
        label: 'Search Queries',
        desc: 'Web search queries for discovering job postings beyond your portals.',
        files: ['portals.yml (search_queries)'],
        status: hasSearchQueries ? 'configured' : 'default',
      },
      {
        id: 'geo', order: 8, group: 'enhance',
        label: 'Geo Pre-Filter',
        desc: 'Home coordinates, commute radius, approved metro areas.',
        files: ['portals.yml (location_policy)', 'config/profile.yml (location)'],
        status: hasLocationPolicy ? 'configured' : 'default',
      },
      {
        id: 'social', order: 9, group: 'enhance',
        label: 'Social & Content Strategy',
        desc: 'LinkedIn presence, content themes, and social proof.',
        files: ['modes/_profile.md (Social & Content Strategy)'],
        status: /social.*content.*strategy|content.*strategy/i.test(modeProfile) ? 'configured' : 'default',
      },
      {
        id: 'cadence', order: 10, group: 'enhance',
        label: 'Outreach Cadence',
        desc: 'Follow-up frequency, spacing, and cold-outreach caps.',
        files: ['config/profile.yml (outreach)'],
        status: outreachCustomized ? 'configured' : 'default',
      },
      {
        id: 'portfolio', order: 11, group: 'enhance',
        label: 'Article Digest / Portfolio',
        desc: 'Proof points from published work, case studies, and projects.',
        files: ['article-digest.md'],
        status: (articleDigest && articleDigest.trim().length > 50) ? 'configured' : 'default',
      },
    ];

    const total = sections.length;
    const configured = sections.filter(s => s.status === 'configured').length;
    res.json({ sections, total, configured });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
