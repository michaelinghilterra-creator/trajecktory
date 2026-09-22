#!/usr/bin/env node
/**
 * ceiling-basis.test.mjs — which KIND of ceiling a report carries must be
 * declared in a field, never inferred from its prose.
 *
 * WHY THIS EXISTS:
 * deriveReportScore recomputes a COMP ceiling in code, because "is this band
 * below the floor" is arithmetic and models invert it. It decided whether a
 * ceiling was comp-related by matching /\b(comp|pay|salary|base|band|floor|OTE)\b/
 * against the free-text ceilingReason. That is wrong in both directions:
 *
 *   FALSE POSITIVE  a LOCATION cap whose reason mentions "base pay" is silently
 *                   replaced by a comp computation, discarding a real blocker.
 *   GAMEABLE        an evaluator can choose words that miss the pattern. One did,
 *                   and reported doing so deliberately, which is how this surfaced.
 *
 * Same defect as levelRank matching "Manager" inside "Product Manager":
 * attribution by substring over text that was written for humans.
 *
 * The failure is SILENT either way. A wrongly recomputed ceiling is still a valid
 * number, and the report still parses.
 *
 * Run: node tests/ceiling-basis.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { deriveReportScore } from '../compute-scores.mjs';

let passed = 0, failed = 0;
const check = (c, l) => { if (c) passed++; else { failed++; console.error(`  FAIL: ${l}`); } };
const section = (n) => console.log(`\n${n}`);

const CFG = {
  weights: { fit: 0.35, northStar: 0.25, level: 0.15, comp: 0, location: 0.10, buildDepth: 0 },
  redFlagPenalty: 1.5,
  minimumLevel: 'Manager',
  // Invented floor. The real one lives in the gitignored config/profile.yml and
  // must never appear in a tracked test; verify-no-pii.mjs caught exactly that in
  // the first draft of this file, as it did for tests/comp-ceiling.test.mjs.
  compMinimum: 120000,
  nonManagementTitles: [],
  // Invented tiers, deliberately NOT the shipped ones, so a case here proves the
  // cap came from config rather than from a default that happens to agree.
  buildDepthCeilings: { 0: 1.5, 1: 1.5, 2: 2.5 },
};

// A strong role: without any ceiling this derives well above 4.
function report(extra) {
  const fm = {
    schema: 'trajecktory-report/v1', id: 1, company: 'Acme', role: 'Director of Widgets',
    date: '2026-01-01', url: '', jdSnapshot: '',
    summary: { seniority: 'Director', compStated: '$205,000 - $264,000 base' },
    levelMatch: { jdLevel: 'Director' },
    globalScore: [
      { key: 'fit', dim: 'Fit', val: 5, max: 5 },
      { key: 'northStar', dim: 'North Star', val: 5, max: 5 },
      { key: 'level', dim: 'Level', val: 5, max: 5 },
      { key: 'comp', dim: 'Comp', val: 5, max: 5 },
      { key: 'location', dim: 'Location', val: 5, max: 5 },
      { key: 'buildDepth', dim: 'Build', val: 5, max: 5 },
      { key: 'redFlags', dim: 'Red Flags', val: 5, max: 5 },
    ],
    ...extra,
  };
  return `---\n${JSON.stringify(fm, null, 2)}\n---\n\n## A) Block\n\nbody\n`;
}
const score = (extra) => { const r = deriveReportScore(report(extra), CFG); return r.ok ? r.score : `ERR:${r.reason}`; };

section('baseline');
check(score({}) === 5, `no ceiling derives 5 (got ${score({})})`);

section('THE REGRESSION: a non-comp ceiling whose PROSE mentions pay is NOT recomputed');
{
  // Under the old substring rule this hit "base"/"pay" and was replaced by a comp
  // computation. The band clears the floor, so the location blocker vanished and a
  // role that must be capped scored a clean 5.
  const s = score({
    scoreCeiling: 1.5,
    ceilingBasis: 'location',
    ceilingReason: 'NYC hybrid required, a hard-no metro. Base pay is fine at $205K-$264K.',
  });
  check(s === 1.5, `location cap survives prose that mentions base pay (got ${s})`);
}
{
  const s = score({
    scoreCeiling: 2.0, ceilingBasis: 'level',
    ceilingReason: 'Individual contributor seat below the Manager minimum; salary band is strong.',
  });
  check(s === 2, `level cap survives prose mentioning salary band (got ${s})`);
}
{
  const s = score({
    scoreCeiling: 2.0, ceilingBasis: 'requirement',
    ceilingReason: 'Requires an admin certification the CV lacks. Comp is above floor.',
  });
  check(s === 2, `requirement cap survives prose mentioning comp and floor (got ${s})`);
}

section('a declared BUILD DEPTH ceiling is recomputed from the rating, not authored');
{
  // The base fixture rates buildDepth 5, which is outside the configured tiers,
  // so declaring the basis must REMOVE the authored cap rather than honour it.
  // This case used to assert the opposite; the tiers moved into config on
  // 2026-09-22 and mapping a rating to a cap is arithmetic, like comp.
  const s = score({
    scoreCeiling: 2.0, ceilingBasis: 'buildDepth',
    ceilingReason: 'Hands-on implementation is the majority mandate. Comp is above floor.',
  });
  check(s === 5, `a rating of 5 adds no ceiling, discarding the authored 2.0 (got ${s})`);
}
{
  // Same declaration, a rating that IS in the tiers. 1.5 is this file's invented
  // tier, not the shipped 2.0, which is how we know it came from config.
  const s = score({
    scoreCeiling: 4.0, ceilingBasis: 'buildDepth',
    ceilingReason: 'Builder seat wearing a leadership title.',
    globalScore: [
      { key: 'fit', dim: 'Fit', val: 5, max: 5 },
      { key: 'northStar', dim: 'North Star', val: 5, max: 5 },
      { key: 'level', dim: 'Level', val: 5, max: 5 },
      { key: 'comp', dim: 'Comp', val: 5, max: 5 },
      { key: 'location', dim: 'Location', val: 5, max: 5 },
      { key: 'buildDepth', dim: 'Build', val: 1, max: 5 },
      { key: 'redFlags', dim: 'Red Flags', val: 5, max: 5 },
    ],
  });
  check(s === 1.5, `a rating of 1 takes the CONFIGURED tier, not the authored 4.0 (got ${s})`);
}

section('a declared COMP ceiling IS recomputed from the band');
{
  // Authored 2.0, but the stated base tops well above the configured floor.
  // Code must discard the wrong cap entirely.
  const s = score({
    scoreCeiling: 2.0, ceilingBasis: 'comp',
    ceilingReason: 'Stated pay top is below the hard floor',
  });
  check(s === 5, `an inverted comp cap is discarded when the band clears the floor (got ${s})`);
}
{
  // A band genuinely below the floor still caps, even if the model authored nothing.
  const s = score({
    scoreCeiling: null, ceilingBasis: 'comp', ceilingReason: 'pay below floor',
    summary: { seniority: 'Director', compStated: '$70,000 - $95,000 base' },
  });
  check(s === 2, `a genuinely low band caps at 2.0 (got ${s})`);
}

section('basis is matched case-insensitively and trimmed');
for (const b of ['comp', 'COMP', ' Comp ']) {
  const s = score({ scoreCeiling: 2.0, ceilingBasis: b, ceilingReason: 'x' });
  check(s === 5, `basis "${b}" recognised as comp (got ${s})`);
}

section('BACKWARD COMPATIBILITY: no ceilingBasis means the authored number stands');
{
  // Every historical report predates this field. Guessing their basis from prose
  // is exactly what is being removed, so they must be left alone.
  const s = score({ scoreCeiling: 1.5, ceilingReason: 'Base pay below the floor' });
  check(s === 1.5, `a legacy report with no basis keeps its authored ceiling (got ${s})`);
}
{
  const s = score({ scoreCeiling: 1.5 });
  check(s === 1.5, `legacy report with no reason at all keeps its ceiling (got ${s})`);
}

section('an unknown basis does not trigger recomputation');
for (const b of ['visa', 'other', 'requirement', '']) {
  const s = score({ scoreCeiling: 2.0, ceilingBasis: b, ceilingReason: 'pay below floor' });
  check(s === 2, `basis "${b}" leaves the authored ceiling alone (got ${s})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
