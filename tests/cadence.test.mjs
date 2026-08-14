#!/usr/bin/env node
/**
 * cadence.test.mjs -- the cadence analyzer (lib/cadence-core.mjs, re-exported via
 * dashboard-web/server/lib/text-hygiene.mjs) and the rhythm-revision helper's
 * non-LLM behavior (dashboard-web/server/lib/cadence-revise.mjs).
 *
 * Also a regression guard: server/lib/cadence.mjs is the WEEKLY habit-cadence
 * tracker, a different file that must keep exporting computeStreak. (The rhythm
 * helper lives in cadence-revise.mjs precisely so it does not collide with it.)
 *
 * Run: node tests/cadence.test.mjs
 */
import { analyzeCadence, formatCadenceReport } from '../dashboard-web/server/lib/text-hygiene.mjs';
import { reviseForCadence } from '../dashboard-web/server/lib/cadence-revise.mjs';
import { computeStreak } from '../dashboard-web/server/lib/cadence.mjs';
import { experienceBullets } from '../dashboard-web/server/routes/resume-cadence.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('cadence.test.mjs');

// ── analyzer ────────────────────────────────────────────────────────────────
const MONOTONE = Array.from({ length: 8 }, (_, i) =>
  `Stacked the pallets in aisle number ${i} and logged each carton against the printed manifest sheet`).join('\n');
const VARIED = [
  'We shipped on time.', 'It stuck.', 'No new software.',
  'The night crew had been guessing at pallet counts for weeks, so I set up a simple scan-in step at the dock and the numbers finally matched.',
  'Returns used to pile up in a corner that nobody really owned or tracked or cleared.',
  'Now every carton gets scanned the moment it comes back.', 'Just a habit and a cheap barcode reader.',
].join('\n');

const mono = analyzeCadence(MONOTONE);
const vary = analyzeCadence(VARIED);
check(!mono.insufficient && mono.score < 45, `monotone scores low (${mono.score})`);
check(mono.flags.some((f) => f.type === 'low-variance'), 'monotone flags low-variance');
check(!vary.insufficient && vary.score > 65, `varied scores high (${vary.score})`);
check(analyzeCadence('one.\ntwo.').insufficient === true, 'too-few-lines is insufficient');
check(analyzeCadence('one.\ntwo.').score === null, 'insufficient score is null');
check(analyzeCadence(null).insufficient === true, 'null is insufficient, not a throw');
check(/cadence:/.test(formatCadenceReport(mono)), 'formatCadenceReport renders');

// ── revise helper: the non-LLM short-circuits (no model call) ────────────────
const empty = await reviseForCadence('');
check(empty.revised === false && empty.reason === 'empty', 'revise: empty input short-circuits');
const tiny = await reviseForCadence('One short line.\nAnother short line.');
check(tiny.revised === false && tiny.reason === 'too-short', 'revise: too-short input is left unchanged');

// ── resume bullet extraction (feeds GET /api/resume/cadence) ─────────────────
const CV_FIXTURE = [
  '# Jane Doe',
  'City | 555-0100 | jane@example.com',
  '## Professional Summary',
  'A prose summary paragraph that is not a bullet and must be skipped.',
  '## Core Competencies',
  'Baking, Inventory, Scheduling',
  '## Professional Experience',
  '### Corner Bakery | Head Baker | 2020-2024',
  '*An italic role-context line, not an achievement bullet.*',
  '- Baked the morning bread and pastries for the front case.',
  '- Trained three new hires on the proofing schedule.',
  '#### Village Cafe | Line Cook | 2018-2020',
  '- Ran the lunch line and kept ticket times under target.',
  '## Earlier Experience',
  '- This bullet is outside Professional Experience and must be skipped.',
  '## Technical Skills',
  '- Also outside; skip.',
].join('\n');
const cvBullets = experienceBullets(CV_FIXTURE);
check(cvBullets.length === 3, `extracts only the 3 experience bullets (got ${cvBullets.length})`);
check(cvBullets.every((b) => !b.startsWith('-')), 'bullet markers are stripped');
check(!cvBullets.some((b) => /italics|Summary|outside|Also outside/.test(b)), 'skips italic context, summary, and out-of-section bullets');
check(experienceBullets('# No experience section here\nsome text').length === 0, 'no Professional Experience heading -> no bullets');

// ── regression: the WEEKLY cadence tracker is a different, intact module ─────
check(typeof computeStreak === 'function', 'weekly-cadence tracker (cadence.mjs) still exports computeStreak');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
