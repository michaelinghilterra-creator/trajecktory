// lib/score.mjs — the single source of truth for the headline evaluation score.
//
// WHY THIS EXISTS
// An evaluation used to emit a hand-authored headline `score` (0-5) AND a
// per-dimension `globalScore[]` breakdown as two INDEPENDENT numbers, with the
// rubric's "headline = weighted average of the dimensions" enforced nowhere. They
// drifted, and a third number (the Haiku triage score) sat beside them as if
// comparable. Nobody could defend the math.
//
// THE FIX: separate judgment from arithmetic. The model rates each dimension 0-5
// WITH the evidence for that rating (judgment is what it is good at). deriveScore()
// computes the headline as the weighted average minus a red-flag penalty
// (arithmetic). The headline is DERIVED, never authored, so it can never disagree
// with its own breakdown, and every point is traceable. One function owns the math,
// the same discipline the app already enforces for identity (canonicalUrl),
// progression (makeFurthestIdx), and the send gate (isSendable).
//
// deriveScore is PURE (weights are passed in) so it is trivially testable. Reading
// the user's weights from config/profile.yml is the separate loadScoringWeights().

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

// The canonical positive dimensions. `key` is stable and matched by code; `label`
// is for display. The model rates each 0-5 with evidence. Weights live in
// config/profile.yml under `scoring.weights` and default below.
export const SCORE_DIMENSIONS = [
  { key: 'fit',       label: 'Fit / CV Match' },
  { key: 'northStar', label: 'North Star Alignment' },
  { key: 'level',     label: 'Level Match' },
  { key: 'comp',      label: 'Comp' },
  { key: 'location',  label: 'Location / Logistics' },
  { key: 'buildDepth', label: 'Build Depth' },
];
export const RED_FLAGS_KEY = 'redFlags';

// Balanced, fit-led default (chosen 2026-07-23; comp zeroed 2026-07-24). A user
// can retune these in config/profile.yml without touching code.
//
// comp is 0 on purpose. An aspiration informs, a floor gates. A pay target is a
// number you can miss and still want the job, so it must not lower a score that
// decides whether you apply at all: weighting it meant a role paying well under
// the user's floor still cleared the apply threshold on fit alone, while a role
// paying far above the band scored HIGHEST of all, when out-of-band pay is really
// evidence the scope is above the title. The hard floor (compensation.minimum) is
// binary, so it belongs in `ceiling` below, which a strong fit cannot outvote.
// The dimension is still rated and displayed, it just contributes no points.
//
// buildDepth is also 0 on purpose. It is a binary blocker, so a weighted average
// could be outvoted by strong fit while a ceiling cannot. Weighting it would also
// reward the absence of a problem: a 5 for no hands-on demand would add points and
// make a pure-strategy role outscore an otherwise identical role with modest,
// claimable build content. Finally, weights renormalize over dimensions present in
// each evaluation. A positive weight would make reports with buildDepth use a
// different headline formula from older reports without it, silently making scores
// incomparable by vintage. The dimension matters only at the bottom of its range
// and expresses itself through `ceiling`, while remaining rated and displayed.
export const DEFAULT_WEIGHTS = Object.freeze({ fit: 0.35, northStar: 0.25, level: 0.15, comp: 0, location: 0.10, buildDepth: 0 });

// Red flags are a PENALTY, not a weighted positive dimension: a red-flags rating of
// 0-5 (5 = clean, 0 = severe) subtracts up to this many points AFTER the weighted
// average, so a strong-on-paper role with a dealbreaker cannot hide behind a high
// average. Modeling it as a weighted term with a negative value would distort the
// average instead.
export const DEFAULT_RED_FLAG_PENALTY = 1.5;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round1 = (n) => Math.round(n * 10) / 10;   // headline + ratings (0-5)
const round2 = (n) => Math.round(n * 100) / 100; // weights + point contributions (0.35 must not become 0.4)
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Normalize a dimension's rating onto a 0-5 scale given its (optional) max.
function normVal(val, max) {
  const v = num(val); if (v === null) return null;
  const m = num(max) || 5;
  if (m <= 0) return null;
  return clamp((v / m) * 5, 0, 5);
}

// ── Level-match policy ────────────────────────────────────────────────────────
// Agreed 2026-08-17: the search scope is open from Manager level and UP. A JD title
// at Manager or above (Senior Manager, Director, Senior Director, Head, VP, C-level)
// is a FULL level match and must never read as a "downlevel." This rule lived only in
// prose in the rubric and drifted three times in five days, so it is enforced HERE in
// code as well: applyLevelFloor raises the `level` dimension to its max (5) for any
// in-scope title before the headline is derived, so no model rating can drag the
// headline for a Manager+ title. Below-Manager titles are left to the model.
export const DEFAULT_MINIMUM_LEVEL = 'Manager';

// Coarse seniority ladder, checked HIGH → LOW so the first hit is the highest rank
// present. Ambiguous senior-IC titles (Lead, Principal, Staff) match nothing and
// return null on purpose — they are NOT auto-promoted; the evaluator rates them.
const LEVEL_LADDER = [
  { rank: 3, res: [/\bvice\s*president\b/, /\bvp\b/, /\bsvp\b/, /\bevp\b/, /\bchief\b/, /\bpresident\b/, /\bpartner\b/, /\bc[tefiopr]o\b/] },
  { rank: 2, res: [/\bdirector\b/, /\bhead\b/] },
  { rank: 1, res: [/\bmanager\b/] },
  { rank: 0, res: [/\bintern\b/, /\bentry[\s-]*level\b/, /\bjunior\b/, /\bassociate\b/, /\bcoordinator\b/, /\bspecialist\b/, /\banalyst\b/, /\brepresentative\b/, /\bindividual\s+contributor\b/] },
];

// Reduce a title/seniority string to just the candidate's OWN title, dropping trailing
// context like "(reports to Director…)" or ", EMEA" that would otherwise contaminate a
// substring scan — a role that reports to a Director is not itself a Director.
export function leadTitle(str) {
  if (typeof str !== 'string') return '';
  return str.split(/[([{,;:/|]|\s[-–—]\s/)[0].trim();
}

// levelRank(title) → 0..3 (higher = more senior), or null when nothing matches
// (unknown / ambiguous senior-IC title). Classifies only the leading title token.
export function levelRank(title) {
  const s = leadTitle(title).toLowerCase();
  if (!s) return null;
  for (const { rank, res } of LEVEL_LADDER) {
    if (res.some((re) => re.test(s))) return rank;
  }
  return null;
}

// applyLevelFloor(dims, detectedLevel, minimumLevel) — floor the `level` dimension to
// its max when the detected JD title sits at or above the minimum accepted level.
// PURE: returns a new dims array, never mutates the input. `floored` is true only when
// a level entry was actually raised (an already-maxed or below-Manager title is left
// alone). Returns the classification ranks too, for an auditable scoreBasis.
export function applyLevelFloor(dims, detectedLevel, minimumLevel = DEFAULT_MINIMUM_LEVEL) {
  const arr = Array.isArray(dims) ? dims : [];
  const minRank = levelRank(minimumLevel);
  const detRank = levelRank(detectedLevel);
  if (minRank === null || detRank === null || detRank < minRank) {
    return { dims: arr, floored: false, detectedRank: detRank, minRank, from: null };
  }
  let floored = false, from = null;
  const out = arr.map((d) => {
    if (d && d.key === 'level') {
      const cur = num(d.val);
      const max = num(d.max) || 5;
      if (cur === null || cur < max) { from = cur; floored = true; return { ...d, val: max, max }; }
    }
    return d;
  });
  return { dims: out, floored, detectedRank: detRank, minRank, from };
}

// deriveScore(dims, { weights, redFlagPenalty }) — the whole ballgame.
//   dims: the globalScore breakdown, an array of { key, val, max? }. Only entries
//         whose key is a known positive dimension contribute to the average; a
//         `redFlags` entry applies a penalty; unknown/legacy keys are ignored, so a
//         stray or old-format row can never corrupt the result.
// Returns { derivable, score, contributions[], penalty, weightsUsed, dimsPresent[] }:
//   - derivable=false (score=null) when NO known positive dimension is present, so a
//     caller falls back to the authored/legacy number rather than publishing a
//     fabricated 0. This is what keeps un-reconstructable legacy reports honest.
//   - weights are RENORMALIZED over the positive dimensions actually present, so a
//     report that omits one (e.g. Location for a fully-remote role) still yields a
//     0-5 headline instead of a deflated one.
//   - contributions carry key/val/weight/points; the raw points sum to the
//     pre-penalty weighted average, so "4.3 = fit 5(x.35) + ..." is reconstructable.
// `ceiling` (optional, 0-5) is a HARD cap applied after the average: some blockers
// (a location you will not work, visa you cannot get) must keep the score low no
// matter how well everything else fits, and a 10%-weighted Location dimension cannot
// do that on its own. The eval sets it explicitly; the code enforces it, so the cap
// is not something the model can forget to apply to its own headline.
export function deriveScore(dims = [], { weights = DEFAULT_WEIGHTS, redFlagPenalty = DEFAULT_RED_FLAG_PENALTY, ceiling = null } = {}) {
  const byKey = new Map();
  for (const d of Array.isArray(dims) ? dims : []) {
    if (!d || typeof d.key !== 'string') continue;
    if (!byKey.has(d.key)) byKey.set(d.key, d); // first entry wins on a duplicate key
  }
  // Positive dimensions that are present with a valid rating AND a positive weight.
  const present = [];
  for (const { key } of SCORE_DIMENSIONS) {
    const w = num(weights?.[key]);
    const d = byKey.get(key);
    if (!d || w === null || w <= 0) continue;
    const v = normVal(d.val, d.max);
    if (v === null) continue;
    present.push({ key, val: v, weight: w });
  }
  const sumW = present.reduce((a, p) => a + p.weight, 0);
  if (sumW <= 0) {
    return { derivable: false, score: null, contributions: [], penalty: 0, weightsUsed: {}, dimsPresent: [] };
  }
  const raw = present.map(p => {
    const rw = p.weight / sumW;         // renormalized weight over present dims
    return { key: p.key, val: p.val, weight: rw, points: p.val * rw };
  });
  const weightedAvg = raw.reduce((a, c) => a + c.points, 0);

  // Red-flag penalty (0 when clean or absent).
  let penalty = 0;
  const rf = byKey.get(RED_FLAGS_KEY);
  if (rf) {
    const cleanliness = normVal(rf.val, rf.max); // 5 = clean, 0 = severe
    const cap = num(redFlagPenalty); const capped = cap === null || cap < 0 ? DEFAULT_RED_FLAG_PENALTY : cap;
    if (cleanliness !== null) penalty = ((5 - cleanliness) / 5) * capped;
  }

  // `uncapped` is the score BEFORE any ceiling: the number the published formula
  // actually adds up to. It is returned separately because a display that prints
  // the arithmetic under a capped headline shows a sum that does not equal its own
  // total, with nothing saying why. That is the exact dishonesty this module exists
  // to remove, so the caller is given both numbers rather than left to subtract
  // rounded intermediates and hope.
  const uncapped = round1(clamp(weightedAvg - penalty, 0, 5));
  let score = uncapped;
  const cap = num(ceiling);
  const ceilingApplied = cap !== null && cap < score;
  if (cap !== null) score = Math.min(score, round1(clamp(cap, 0, 5)));
  return {
    derivable: true,
    score,
    uncapped,
    contributions: raw.map(c => ({ key: c.key, val: round1(c.val), weight: round2(c.weight), points: round2(c.points) })),
    penalty: round1(penalty),
    weightsUsed: Object.fromEntries(raw.map(c => [c.key, round2(c.weight)])),
    dimsPresent: present.map(p => p.key),
    ceiling: cap,
    ceilingApplied,
  };
}

// Resolve the profile.yml path (repo-root config/profile.yml) relative to this file.
function defaultProfilePath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', 'config', 'profile.yml');
}

// Read the user's weights from config/profile.yml (`scoring.weights` +
// `scoring.redFlagPenalty`), falling back to DEFAULT_WEIGHTS for any missing piece.
// Tolerant of a missing or half-written profile (returns defaults), like config.mjs:
// a mid-edit profile must never break scoring. Negative or non-numeric entries are
// ignored so a typo cannot silently zero out a dimension.
export function loadScoringWeights(profilePath = defaultProfilePath()) {
  const out = { weights: { ...DEFAULT_WEIGHTS }, redFlagPenalty: DEFAULT_RED_FLAG_PENALTY, minimumLevel: DEFAULT_MINIMUM_LEVEL };
  try {
    const doc = yaml.load(fs.readFileSync(profilePath, 'utf8'));
    const sc = doc && typeof doc === 'object' ? doc.scoring : null;
    if (sc && typeof sc === 'object') {
      if (sc.weights && typeof sc.weights === 'object') {
        for (const { key } of SCORE_DIMENSIONS) {
          const w = num(sc.weights[key]);
          if (w !== null && w >= 0) out.weights[key] = w;
        }
      }
      const rfp = num(sc.redFlagPenalty);
      if (rfp !== null && rfp >= 0) out.redFlagPenalty = rfp;
      if (typeof sc.minimum_level === 'string' && sc.minimum_level.trim()) out.minimumLevel = sc.minimum_level.trim();
    }
  } catch { /* missing or invalid profile → defaults */ }
  return out;
}

// Convenience: read the label for a dimension key (for display fallbacks).
export function dimensionLabel(key) {
  const d = SCORE_DIMENSIONS.find(x => x.key === key);
  return d ? d.label : key;
}
