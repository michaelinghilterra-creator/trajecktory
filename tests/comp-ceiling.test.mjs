#!/usr/bin/env node
/**
 * comp-ceiling.test.mjs — the comp floor ceiling is computed in code, not
 * authored by the evaluating model.
 *
 * WHY THIS EXISTS:
 * A local model capped a "Widget Strategy & Planning, Sr. Manager" posting at
 * 2.0, giving the reason "stated pay top is below the hard floor" for a base band
 * whose TOP was comfortably ABOVE the floor. The same run capped a second role for
 * missing the target_range, which is an aspiration and explicitly not a cap
 * (modes/oferta.md). Both roles score above 4.0 in the tracker: the arithmetic
 * error silently deleted the two best roles in the batch.
 *
 * Two defects compounded, and a fix for either one alone still fails the first
 * case below:
 *   1. the comparison was inverted, and
 *   2. every dollar figure in the string was flattened into one band, so
 *      "base + bonus + equity" was not separated from the base range.
 *
 * The failure is SILENT — a capped score is a valid score, and a discarded role
 * leaves no trace. Tests are the only guard.
 *
 * EVERY FIGURE HERE IS INVENTED, including the floor. The real floor lives in the
 * gitignored config/profile.yml; writing it into a tracked test would ship the
 * user's compensation data to every clone. verify-no-pii.mjs enforces this, and
 * it caught exactly that mistake in the first draft of this file.
 *
 * Run: node tests/comp-ceiling.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { parseMoney, parseCompBand, compCeiling, COMP_FLOOR_CEILING } from '../lib/score.mjs';

let passed = 0, failed = 0;
function check(cond, label) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL: ${label}`);
}
function section(name) { console.log(`\n${name}`); }

const FLOOR = 120000;              // invented, not the configured floor
const ceil = (s) => compCeiling(s, { minimum: FLOOR });

section('parseMoney');
check(parseMoney('$210K') === 210000, '$210K -> 210000');
check(parseMoney('$210,000') === 210000, '$210,000 -> 210000');
check(parseMoney('$1.2M') === 1200000, '$1.2M -> 1200000');
check(parseMoney(null) === null, 'null -> null');
check(parseMoney('competitive') === null, 'non-numeric -> null');

section('THE REGRESSION: inversion AND base/OTE flattening together');
{
  // Band top is above the floor; the model called it "below the floor".
  const stated = '$93,300-$175,000 base + bonus + equity';
  const band = parseCompBand(stated);
  check(band.baseTop === 175000, `base top is 175000, got ${band.baseTop}`);
  const r = ceil(stated);
  check(r.ceiling === null, `gets NO ceiling (got ${r.ceiling}, reason ${r.reason})`);
  check(r.reason === 'clears-floor', `reason is clears-floor, got ${r.reason}`);
}

section('THE REGRESSION: an aspiration is not a floor');
{
  // Clears the floor but sits below the (higher) target range. Must not cap:
  // compCeiling never reads target_range at all.
  const r = ceil('$165,000 - $185,000 annually + benefits');
  check(r.ceiling === null, `gets NO ceiling (got ${r.ceiling})`);
  check(r.baseTop === 185000, `base top 185000, got ${r.baseTop}`);
}

section('a band genuinely below the floor still caps');
{
  const r = ceil('$98,000-$110,000 USD');
  check(r.ceiling === COMP_FLOOR_CEILING, `below-floor band caps at ${COMP_FLOOR_CEILING}, got ${r.ceiling}`);
  check(r.reason === 'base-top-below-floor', `reason is base-top-below-floor, got ${r.reason}`);
}
check(ceil('$80,000 - $95,000 base').ceiling === COMP_FLOOR_CEILING, 'a clearly low base caps');
check(ceil('$119,999').ceiling === COMP_FLOOR_CEILING, 'just under the floor caps');
check(ceil('$120,000').ceiling === null, 'exactly at the floor does NOT cap');

section('base is separated from OTE');
{
  const band = parseCompBand('$95K base, $264K OTE');
  check(band.baseTop === 95000, `labelled base wins over OTE, got ${band.baseTop}`);
  check(ceil('$95K base, $264K OTE').ceiling === COMP_FLOOR_CEILING,
    'a low base caps even when OTE is large');
}
check(parseCompBand('$199,000 - $240,000 base + 25% STI + equity').baseTop === 240000,
  'STI and equity do not raise the base top');

section('ambiguity fails OPEN (no ceiling)');
check(ceil('Not disclosed').ceiling === null, 'undisclosed -> no ceiling');
check(ceil('').ceiling === null, 'empty -> no ceiling');
check(ceil(null).ceiling === null, 'null -> no ceiling');
check(ceil('Competitive salary and equity package').ceiling === null, 'prose-only -> no ceiling');
{
  // An OTE figure with no labelled base: guessing which number is base is how
  // the original bug happened. Refuse instead.
  const band = parseCompBand('$264,000 OTE');
  check(band.ambiguous === true && band.baseTop === null, 'unlabelled OTE is ambiguous, no baseTop');
  check(ceil('$264,000 OTE').ceiling === null, 'unlabelled OTE -> no ceiling');
}
{
  const r = ceil('CAN base pay range: $101,000-$151,000');
  check(r.ceiling === null, 'foreign currency -> no ceiling (FX makes the floor ambiguous)');
  check(parseCompBand('CAN base pay range: $101,000-$151,000').foreign === true, 'CAN is flagged foreign');
}
check(ceil('£90,000 - £105,000').ceiling === null, 'GBP -> no ceiling');

section('no floor configured -> never caps');
check(compCeiling('$50,000', {}).ceiling === null, 'missing minimum -> no ceiling');
check(compCeiling('$50,000', { minimum: null }).ceiling === null, 'null minimum -> no ceiling');
check(compCeiling('$50,000', { minimum: '$120K' }).ceiling === COMP_FLOOR_CEILING,
  'minimum accepted as a string');

section('INVARIANT: a base top at or above the floor NEVER produces a ceiling');
{
  let violations = 0;
  for (let top = FLOOR; top <= 400000; top += 2500) {
    for (const s of [`$${top}`, `$${top - 40000}-$${top}`, `$${top - 40000}-$${top} base + bonus`]) {
      const r = ceil(s);
      if (r.ceiling !== null) { violations++; if (violations <= 3) console.error(`    violated by: ${s} -> ${r.ceiling} (${r.reason})`); }
    }
  }
  check(violations === 0, `no ceiling for any band topping out at or above the floor (${violations} violations)`);
}

section('en-dash and em-dash ranges parse');
check(parseCompBand('$160,000—$190,000').baseTop === 190000, 'em dash range');
check(parseCompBand('$160,000–$190,000').baseTop === 190000, 'en dash range');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
