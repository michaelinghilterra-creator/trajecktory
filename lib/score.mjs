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
];
export const RED_FLAGS_KEY = 'redFlags';

// Balanced, fit-led default (chosen 2026-07-23). Sums to 1.0. A user can retune
// these in config/profile.yml without touching code.
export const DEFAULT_WEIGHTS = Object.freeze({ fit: 0.35, northStar: 0.25, level: 0.15, comp: 0.15, location: 0.10 });

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
export function deriveScore(dims = [], { weights = DEFAULT_WEIGHTS, redFlagPenalty = DEFAULT_RED_FLAG_PENALTY } = {}) {
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

  const score = round1(clamp(weightedAvg - penalty, 0, 5));
  return {
    derivable: true,
    score,
    contributions: raw.map(c => ({ key: c.key, val: round1(c.val), weight: round2(c.weight), points: round2(c.points) })),
    penalty: round1(penalty),
    weightsUsed: Object.fromEntries(raw.map(c => [c.key, round2(c.weight)])),
    dimsPresent: present.map(p => p.key),
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
  const out = { weights: { ...DEFAULT_WEIGHTS }, redFlagPenalty: DEFAULT_RED_FLAG_PENALTY };
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
    }
  } catch { /* missing or invalid profile → defaults */ }
  return out;
}

// Convenience: read the label for a dimension key (for display fallbacks).
export function dimensionLabel(key) {
  const d = SCORE_DIMENSIONS.find(x => x.key === key);
  return d ? d.label : key;
}
