#!/usr/bin/env node
/**
 * score.test.mjs — the single-source scoring engine (lib/score.mjs).
 *
 * deriveScore turns a per-dimension breakdown (judgment) into the headline
 * (arithmetic). These lock the contract the whole redesign rests on:
 *   - the headline IS the weighted average, minus a red-flag penalty;
 *   - weights renormalize over the dimensions actually present;
 *   - no known positive dimension → not derivable (never a fabricated 0);
 *   - unknown/legacy keys are ignored, never corrupt the result;
 *   - loadScoringWeights reads config/profile.yml and falls back cleanly.
 *
 * Run: node tests/score.test.mjs   (exit 0 = pass, 1 = fail)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  deriveScore, loadScoringWeights, DEFAULT_WEIGHTS, DEFAULT_RED_FLAG_PENALTY, SCORE_DIMENSIONS, dimensionLabel,
} from '../lib/score.mjs';

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

console.log('score.test.mjs');

// ── the balanced default, all dimensions present, clean ──────────────────────
// weightedAvg = 5*.35 + 4*.25 + 4*.15 + 3*.15 + 5*.10 = 1.75+1.0+0.6+0.45+0.5 = 4.30
const allClean = [
  { key: 'fit', val: 5 }, { key: 'northStar', val: 4 }, { key: 'level', val: 4 },
  { key: 'comp', val: 3 }, { key: 'location', val: 5 }, { key: 'redFlags', val: 5 },
];
const r1 = deriveScore(allClean);
check(r1.derivable === true, 'all dimensions present → derivable');
check(near(r1.score, 4.3), `headline is the weighted average (got ${r1.score}, want 4.3)`);
check(r1.penalty === 0, 'a clean red-flags rating (5) applies no penalty');
check(r1.contributions.length === 5, 'a contribution row per present positive dimension');
check(near(r1.contributions.reduce((a, c) => a + c.points, 0), 4.3), 'contribution points reconstruct the pre-penalty average');
check(r1.contributions.find(c => c.key === 'fit').weight === 0.35, 'weight is exposed per contribution (traceable)');

// ── red-flag penalty ─────────────────────────────────────────────────────────
const severe = deriveScore(allClean.map(d => d.key === 'redFlags' ? { key: 'redFlags', val: 0 } : d));
check(near(severe.penalty, 1.5) && near(severe.score, 2.8), `severe red flags subtract the full penalty (4.3 - 1.5 = 2.8, got ${severe.score})`);
const partial = deriveScore(allClean.map(d => d.key === 'redFlags' ? { key: 'redFlags', val: 3 } : d));
check(near(partial.penalty, 0.6), `a partial red-flags rating scales the penalty ((5-3)/5*1.5=0.6, got ${partial.penalty})`);
const customCap = deriveScore(allClean.map(d => d.key === 'redFlags' ? { key: 'redFlags', val: 0 } : d), { redFlagPenalty: 2 });
check(near(customCap.score, 2.3), `a custom penalty cap is honored (4.3 - 2.0 = 2.3, got ${customCap.score})`);

// ── renormalization when a dimension is missing ──────────────────────────────
// Drop Location: present weights .35/.25/.15/.15 sum .90; renorm → 4.2222
const noLoc = deriveScore([
  { key: 'fit', val: 5 }, { key: 'northStar', val: 4 }, { key: 'level', val: 4 }, { key: 'comp', val: 3 },
]);
check(near(noLoc.score, 4.2), `a missing dimension renormalizes the rest, not deflates (got ${noLoc.score})`);
check(near(noLoc.contributions.reduce((a, c) => a + c.weight, 0), 1.0, 0.02), 'present weights renormalize to sum ~1.0');

// ── max normalization ────────────────────────────────────────────────────────
const withMax = deriveScore([{ key: 'fit', val: 10, max: 10 }, { key: 'northStar', val: 5, max: 5 }]);
check(near(withMax.contributions.find(c => c.key === 'fit').val, 5), 'val is normalized against its max (10/10 → 5)');

// ── not derivable → null (never a fabricated 0) ──────────────────────────────
const none = deriveScore([]);
check(none.derivable === false && none.score === null, 'no dimensions → not derivable, score null');
const onlyRed = deriveScore([{ key: 'redFlags', val: 0 }]);
check(onlyRed.derivable === false && onlyRed.score === null, 'red flags alone (no positive dims) → not derivable');
const onlyUnknown = deriveScore([{ key: 'vibes', val: 5 }, { key: 'foo', val: 4 }]);
check(onlyUnknown.derivable === false, 'unknown keys alone → not derivable (legacy rows never fabricate a score)');

// ── unknown keys ignored alongside known ones ────────────────────────────────
const mixed = deriveScore([{ key: 'fit', val: 4 }, { key: 'vibes', val: 1 }]);
check(mixed.derivable === true && near(mixed.score, 4), 'an unknown key is ignored; the lone known dim drives the score');

// ── clamping ─────────────────────────────────────────────────────────────────
const over = deriveScore([{ key: 'fit', val: 99 }]);
check(over.score === 5, 'a rating above scale is clamped to 5');
const under = deriveScore([{ key: 'fit', val: 0 }, { key: 'redFlags', val: 0 }]);
check(under.score === 0, 'weighted average minus penalty is clamped at 0, never negative');

// ── loadScoringWeights ───────────────────────────────────────────────────────
check(Object.keys(DEFAULT_WEIGHTS).length === SCORE_DIMENSIONS.length, 'a default weight exists for every canonical dimension');
check(near(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0), 1.0), 'default weights sum to 1.0');
check(dimensionLabel('fit') === 'Fit / CV Match' && dimensionLabel('nope') === 'nope', 'dimensionLabel maps known keys and passes through unknown');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-score-'));
const pf = path.join(tmp, 'profile.yml');
fs.writeFileSync(pf, 'scoring:\n  weights:\n    fit: 0.5\n    northStar: 0.2\n    level: 0.1\n    comp: 0.1\n    location: 0.1\n  redFlagPenalty: 2.5\n');
const loaded = loadScoringWeights(pf);
check(loaded.weights.fit === 0.5 && loaded.redFlagPenalty === 2.5, 'loadScoringWeights reads the scoring block from profile.yml');
fs.writeFileSync(pf, 'scoring:\n  weights:\n    fit: 0.6\n');
const partialLoad = loadScoringWeights(pf);
check(partialLoad.weights.fit === 0.6 && partialLoad.weights.comp === DEFAULT_WEIGHTS.comp, 'a partial scoring block overrides only what it sets, defaults fill the rest');
check(partialLoad.redFlagPenalty === DEFAULT_RED_FLAG_PENALTY, 'an omitted redFlagPenalty falls back to the default');
const missing = loadScoringWeights(path.join(tmp, 'does-not-exist.yml'));
check(missing.weights.fit === DEFAULT_WEIGHTS.fit, 'a missing profile falls back to defaults, never throws');
fs.writeFileSync(pf, 'scoring:\n  weights:\n    fit: not-a-number\n    comp: -0.3\n');
const badLoad = loadScoringWeights(pf);
check(badLoad.weights.fit === DEFAULT_WEIGHTS.fit && badLoad.weights.comp === DEFAULT_WEIGHTS.comp, 'non-numeric and negative weights are ignored (typo cannot zero a dimension)');
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
