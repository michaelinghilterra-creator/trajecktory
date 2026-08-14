// routes/resume-cadence.mjs -- read-only cadence (rhythm) check for the resume.
//
// The resume's achievement bullets are where the "AI tell" of uniform cadence
// bites hardest: a wall of same-length, same-shape bullets reads as machine-made
// even when the words are fine. This reads cv.md, pulls just the Professional
// Experience bullets, and returns the analyzer's verdict. It is FLAG + COACH only,
// it never rewrites the resume; the user keeps control of their own wording.
//
// (Distinct from routes/cadence.mjs, which is the weekly habit-cadence scheduler.)
import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { readProjectFile } from '../lib/anthropic.mjs';
import { analyzeCadence, analyzeStyle } from '../lib/text-hygiene.mjs';

export const router = express.Router();

// Pull only the "- " achievement bullets inside the "## Professional Experience"
// region. Excludes headers, the summary paragraph, competencies/skills lists, and
// the italic *...* role-context lines (which are not achievement bullets).
export function experienceBullets(cvMd) {
  const lines = cvMd.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Professional Experience/i.test(l));
  if (start === -1) return [];
  const bullets = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break; // next H2 ends the section
    if (/^-\s+/.test(lines[i])) bullets.push(lines[i].replace(/^-\s+/, '').trim());
  }
  return bullets;
}

function verdictFor(score) {
  if (score == null) return 'unknown';
  if (score >= 70) return 'varied';
  if (score >= 45) return 'somewhat uniform';
  return 'monotonous';
}

// GET /api/resume/cadence -> { score, verdict, insufficient, units, bulletCount, flags, metrics }
router.get('/api/resume/cadence', (req, res) => {
  try {
    const cvMd = readProjectFile(ROOT_DIR, 'cv.md');
    if (!cvMd || cvMd.startsWith('[cv.md not found]')) {
      return res.status(404).json({ error: 'No cv.md yet. Add your resume in Setup to run a rhythm check.' });
    }
    const bullets = experienceBullets(cvMd);
    const report = analyzeCadence(bullets.join('\n'));
    res.json({
      score: report.score,
      verdict: verdictFor(report.score),
      insufficient: report.insufficient,
      units: report.units,
      bulletCount: bullets.length,
      flags: report.flags,
      metrics: report.metrics,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The Professional Summary paragraph lines (excludes the heading and stops at the
// next H2). Style is checked over the summary + the experience bullets, because
// overused AI vocabulary ("spearheaded", "leveraged", "robust") shows up in both.
function summaryLines(cvMd) {
  const lines = cvMd.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Professional Summary/i.test(l));
  if (start === -1) return [];
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    const t = lines[i].trim();
    if (t) out.push(t);
  }
  return out;
}

function styleVerdict(score) {
  if (score == null) return 'unknown';
  if (score >= 75) return 'plain';
  if (score >= 50) return 'somewhat AI-flavored';
  return 'reads as AI-written';
}

// GET /api/resume/style -> { score, verdict, insufficient, words, flags, counts }
// Flag + coach only; never rewrites. expectBullets is true because a resume is
// meant to be bulleted, so the bullet-overload flag is suppressed here.
router.get('/api/resume/style', (req, res) => {
  try {
    const cvMd = readProjectFile(ROOT_DIR, 'cv.md');
    if (!cvMd || cvMd.startsWith('[cv.md not found]')) {
      return res.status(404).json({ error: 'No cv.md yet. Add your resume in Setup to run a plain-language check.' });
    }
    const text = [...summaryLines(cvMd), ...experienceBullets(cvMd)].join('\n');
    const report = analyzeStyle(text, { expectBullets: true });
    res.json({
      score: report.score,
      verdict: styleVerdict(report.score),
      insufficient: report.insufficient,
      words: report.words,
      flags: report.flags,
      counts: report.counts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
