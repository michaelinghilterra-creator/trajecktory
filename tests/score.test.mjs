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
  levelRank, applyLevelFloor, leadTitle, DEFAULT_MINIMUM_LEVEL,
} from '../lib/score.mjs';

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;

console.log('score.test.mjs');

// The arithmetic assertions below pass an EXPLICIT weight set rather than relying
// on DEFAULT_WEIGHTS, because the two are different things: the maths is a contract,
// the weights are policy the user retunes in config/profile.yml. When these shared a
// number, zeroing the comp weight broke nine assertions about addition. The current
// policy is asserted on its own terms in the POLICY section at the bottom.
const BALANCED = Object.freeze({ fit: 0.35, northStar: 0.25, level: 0.15, comp: 0.15, location: 0.10 });

// ── the balanced default, all dimensions present, clean ──────────────────────
// weightedAvg = 5*.35 + 4*.25 + 4*.15 + 3*.15 + 5*.10 = 1.75+1.0+0.6+0.45+0.5 = 4.30
const allClean = [
  { key: 'fit', val: 5 }, { key: 'northStar', val: 4 }, { key: 'level', val: 4 },
  { key: 'comp', val: 3 }, { key: 'location', val: 5 }, { key: 'redFlags', val: 5 },
];
const r1 = deriveScore(allClean, { weights: BALANCED });
check(r1.derivable === true, 'all dimensions present → derivable');
check(near(r1.score, 4.3), `headline is the weighted average (got ${r1.score}, want 4.3)`);
check(r1.penalty === 0, 'a clean red-flags rating (5) applies no penalty');
check(r1.contributions.length === 5, 'a contribution row per present positive dimension');
check(near(r1.contributions.reduce((a, c) => a + c.points, 0), 4.3), 'contribution points reconstruct the pre-penalty average');
check(r1.contributions.find(c => c.key === 'fit').weight === 0.35, 'weight is exposed per contribution (traceable)');

// ── red-flag penalty ─────────────────────────────────────────────────────────
const severe = deriveScore(allClean.map(d => d.key === 'redFlags' ? { key: 'redFlags', val: 0 } : d), { weights: BALANCED });
check(near(severe.penalty, 1.5) && near(severe.score, 2.8), `severe red flags subtract the full penalty (4.3 - 1.5 = 2.8, got ${severe.score})`);
const partial = deriveScore(allClean.map(d => d.key === 'redFlags' ? { key: 'redFlags', val: 3 } : d), { weights: BALANCED });
check(near(partial.penalty, 0.6), `a partial red-flags rating scales the penalty ((5-3)/5*1.5=0.6, got ${partial.penalty})`);
const customCap = deriveScore(allClean.map(d => d.key === 'redFlags' ? { key: 'redFlags', val: 0 } : d), { weights: BALANCED, redFlagPenalty: 2 });
check(near(customCap.score, 2.3), `a custom penalty cap is honored (4.3 - 2.0 = 2.3, got ${customCap.score})`);

// ── renormalization when a dimension is missing ──────────────────────────────
// Drop Location: present weights .35/.25/.15/.15 sum .90; renorm → 4.2222
const noLoc = deriveScore([
  { key: 'fit', val: 5 }, { key: 'northStar', val: 4 }, { key: 'level', val: 4 }, { key: 'comp', val: 3 },
], { weights: BALANCED });
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

// ── hard ceiling (blockers that must cap the score) ─────────────────────────
// A strong-on-paper role (weighted average 4.3) with a hard location blocker must
// not read as a good match. A 10%-weighted Location dimension cannot cap it; the
// ceiling can.
const capped = deriveScore(allClean, { weights: BALANCED, ceiling: 1.5 });
check(capped.score === 1.5 && capped.ceilingApplied === true, `a hard ceiling caps the headline (4.3 → 1.5, got ${capped.score})`);
const noCap = deriveScore(allClean, { weights: BALANCED, ceiling: 5 });
check(noCap.score === 4.3 && noCap.ceilingApplied === false, 'a ceiling above the average does not change the score');
check(deriveScore(allClean, { weights: BALANCED }).ceiling === null, 'no ceiling by default');

// The score BEFORE the cap has to come back too. A drawer that prints the
// arithmetic under a capped headline otherwise shows a sum that does not equal its
// own total, with nothing saying why, which is the exact dishonesty this module
// exists to remove. Reconstructing it by subtracting rounded intermediates is not
// good enough, so it is returned rather than inferred.
check(capped.uncapped === 4.3, `the pre-cap score is returned alongside the capped one (got ${capped.uncapped})`);
check(noCap.uncapped === noCap.score, 'with no cap in play, uncapped equals the headline');
check(deriveScore(allClean, { weights: BALANCED }).uncapped === 4.3, 'uncapped is present even when no ceiling was passed');

// ── POLICY: comp is rated but not scored (2026-07-24) ────────────────────────
// An aspiration informs, a floor gates. A pay target is a number the user can miss
// and still want the job, so it must not lower a score that decides whether they
// apply at all. Weighted, it did the opposite at both ends: a role paying under the
// user's floor still cleared the apply threshold on fit alone, and a role paying far
// above the band scored highest of all. The hard floor is a scoreCeiling instead,
// which a strong fit cannot outvote. These lock that decision so a future retune is
// a deliberate act, not a silent drift.
check(DEFAULT_WEIGHTS.comp === 0, 'comp carries no weight by default (rated and shown, never scored)');
const policy = deriveScore(allClean);
check(!policy.contributions.some(c => c.key === 'comp'), 'a zero-weight comp contributes no points and no contribution row');
check(policy.dimsPresent.length === 4, 'the four scored dimensions are fit, northStar, level, location');
const w = policy.weightsUsed;
check(near(w.fit, 0.41, 0.01) && near(w.northStar, 0.29, 0.01) && near(w.level, 0.18, 0.01) && near(w.location, 0.12, 0.01),
  `dropping comp renormalizes the rest to .41/.29/.18/.12 (got ${JSON.stringify(w)})`);
// A rated-but-unweighted dimension must not be mistaken for a derivable report:
// falling back to the authored number is right, fabricating a 0 is not.
const compOnly = deriveScore([{ key: 'comp', val: 5 }]);
check(compOnly.derivable === false && compOnly.score === null, 'comp alone is not derivable (no fabricated headline from an unscored dimension)');
// The floor still bites, because it is a ceiling rather than a weight.
const belowFloor = deriveScore(allClean, { ceiling: 2.0 });
check(belowFloor.score === 2.0 && belowFloor.ceilingApplied === true, 'pay below the hard floor caps the headline regardless of fit');

// ── loadScoringWeights ───────────────────────────────────────────────────────
check(Object.keys(DEFAULT_WEIGHTS).length === SCORE_DIMENSIONS.length, 'a default weight exists for every canonical dimension');
check(near(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0), 0.85), 'the scored default weights sum to 0.85 (comp is 0), renormalized at derive time');
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

// ── POLICY: level floor — Manager and up is a full level match (2026-08-17) ──
// The search scope is open from Manager level up. A Manager+ title is NEVER a
// downlevel, so the `level` dimension is floored to 5 before the headline is derived.
// This drifted three times as prose, so it is locked here.
check(DEFAULT_MINIMUM_LEVEL === 'Manager', 'the default minimum accepted level is Manager');

// leadTitle strips trailing context so a role that REPORTS to a Director is not read
// as one — the exact bug the Propel "Lead (reports to Director…)" title would trigger.
check(leadTitle('Lead (reports to Director of Strategy & Operations)') === 'Lead', 'leadTitle drops "(reports to Director…)" context');
check(leadTitle('Senior Manager, GTM Strategy') === 'Senior Manager', 'leadTitle keeps the title, drops the trailing comma clause');
check(leadTitle('VP / Head of Revenue') === 'VP', 'leadTitle splits on a slash separator');

// levelRank classifies the candidate's own title.
check(levelRank('Manager') === 1 && levelRank('Senior Manager') === 1, 'Manager / Senior Manager rank at the Manager tier');
check(levelRank('Director') === 2 && levelRank('Senior Director') === 2 && levelRank('Head of Analytics') === 2, 'Director / Head rank above Manager');
check(levelRank('VP of RevOps') === 3 && levelRank('Chief Revenue Officer') === 3, 'VP / C-level rank highest');
check(levelRank('Analyst') === 0 && levelRank('Associate') === 0, 'IC titles rank below Manager');
check(levelRank('Lead') === null && levelRank('Principal') === null && levelRank('Staff Engineer') === null, 'ambiguous senior-IC titles are unclassified (not auto-promoted)');
check(levelRank('Lead (reports to Director of Strategy & Operations)') === null, 'a Lead that reports to a Director is still unclassified, not a Director');

// applyLevelFloor raises the level dimension only for in-scope titles.
const dimsSM = [{ key: 'fit', val: 4 }, { key: 'level', val: 3, max: 5 }, { key: 'northStar', val: 4 }];
const floored = applyLevelFloor(dimsSM, 'Senior Manager');
check(floored.floored === true && floored.from === 3, 'a Senior Manager title floors the level dimension (from 3)');
check(floored.dims.find(d => d.key === 'level').val === 5, 'the floored level dimension is raised to 5');
check(dimsSM.find(d => d.key === 'level').val === 3, 'applyLevelFloor is pure — the input dims are not mutated');
const notFloored = applyLevelFloor(dimsSM, 'Analyst');
check(notFloored.floored === false && notFloored.dims.find(d => d.key === 'level').val === 3, 'a below-Manager title leaves the level rating alone');
const leadNotFloored = applyLevelFloor(dimsSM, 'Lead (reports to Director of Strategy & Operations)');
check(leadNotFloored.floored === false, 'a contaminated "Lead (reports to Director…)" title is NOT floored');
const already5 = applyLevelFloor([{ key: 'level', val: 5, max: 5 }], 'VP');
check(already5.floored === false, 'an already-maxed level dimension is not re-floored (idempotent)');

// minimum_level is configurable: raise it to Director and a Senior Manager no longer floors.
check(applyLevelFloor(dimsSM, 'Senior Manager', 'Director').floored === false, 'raising minimum_level to Director stops Senior Manager from flooring');
check(applyLevelFloor(dimsSM, 'Director', 'Director').floored === true, 'at minimum_level Director, a Director title still floors');

// loadScoringWeights surfaces minimum_level (default + override).
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-lvl-'));
const pf2 = path.join(tmp2, 'profile.yml');
check(loadScoringWeights(path.join(tmp2, 'none.yml')).minimumLevel === 'Manager', 'loadScoringWeights defaults minimumLevel to Manager');
fs.writeFileSync(pf2, 'scoring:\n  minimum_level: "Director"\n');
check(loadScoringWeights(pf2).minimumLevel === 'Director', 'loadScoringWeights reads scoring.minimum_level from profile.yml');
fs.rmSync(tmp2, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
