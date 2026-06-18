#!/usr/bin/env node
/**
 * discard.test.mjs — unit tests for lib/discard.mjs, the auto-discard gate
 * that decides whether a low-fit evaluation silently leaves the pipeline.
 *
 * Replaces the orphaned, drifted test-auto-discard.mjs (which asserted a
 * `score < 3.0` threshold and no cowork exemption, neither of which the real
 * code does). These tests assert the ACTUAL merge-tracker behavior.
 *
 * Run: node tests/discard.test.mjs   (exit 0 = pass, 1 = fail)
 */

import {
  shouldAutoDiscard,
  recommendsAgainst,
  isExemptFromAutoDiscard,
  parseScore,
  AUTO_DISCARD_SCORE,
} from '../lib/discard.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('discard.test.mjs');

// ── Threshold boundary (the exact value the orphan test got wrong) ──────────────
check(AUTO_DISCARD_SCORE === 2.5, 'threshold is 2.5');
check(shouldAutoDiscard({ status: 'Evaluated', score: '2.5/5', notes: '' }) === true,
  'score 2.5 is discarded (at-or-below boundary)');
check(shouldAutoDiscard({ status: 'Evaluated', score: '2.4/5', notes: '' }) === true,
  'score 2.4 is discarded');
check(shouldAutoDiscard({ status: 'Evaluated', score: '2.6/5', notes: '' }) === false,
  'score 2.6 is kept');
check(shouldAutoDiscard({ status: 'Evaluated', score: '2.9/5', notes: '' }) === false,
  'score 2.9 is KEPT (the orphan test wrongly discarded this)');
check(shouldAutoDiscard({ status: 'Evaluated', score: '4.2/5', notes: '' }) === false,
  'score 4.2 is kept');

// ── Status gating ───────────────────────────────────────────────────────────
check(shouldAutoDiscard({ status: 'Applied', score: '1.0/5', notes: '' }) === false,
  'non-Evaluated status is never auto-discarded');
check(shouldAutoDiscard({ status: 'Offer', score: '0.5/5', notes: '' }) === false,
  'Offer is never auto-discarded regardless of score');

// ── Exemptions ──────────────────────────────────────────────────────────────
check(shouldAutoDiscard({ status: 'Evaluated', score: '1.0/5', notes: '[cowork] partner co' }) === false,
  'cowork tag is exempt even at score 1.0');
check(shouldAutoDiscard({ status: 'Evaluated', score: '1.0/5', notes: '[self-sourced] https://x' }) === false,
  'self-sourced tag is exempt');
check(shouldAutoDiscard({ status: 'Evaluated', score: '1.0/5', notes: '[referral: Jane]' }) === false,
  'referral tag is exempt');
check(isExemptFromAutoDiscard('mid-sentence [self-sourced] note') === true,
  'self-sourced detected anywhere in notes');
check(isExemptFromAutoDiscard('plain note') === false,
  'no tag means not exempt');

// ── recommendsAgainst phrases ─────────────────────────────────────────────────
check(shouldAutoDiscard({ status: 'Evaluated', score: '4.8/5', notes: 'Hard no on location' }) === true,
  'high score still discarded when notes say hard no');
check(recommendsAgainst('requires relocation to Berlin') === true, 'requires relocation matches');
check(recommendsAgainst('international relocation needed') === true, 'international relocation matches');
check(recommendsAgainst('do not apply') === true, 'do not apply matches');
check(recommendsAgainst('great fit, apply now') === false, 'positive note does not match');

// ── parseScore behavior (incl. the unparseable -> 0 -> discard quirk) ───────────
check(parseScore('4.2/5') === 4.2, 'parseScore reads 4.2/5');
check(parseScore('**3.5**') === 3.5, 'parseScore strips bold');
check(parseScore('') === 0, 'parseScore of empty is 0');
check(shouldAutoDiscard({ status: 'Evaluated', score: 'n/a', notes: '' }) === true,
  'unparseable score (0) is discarded, matching original behavior');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
