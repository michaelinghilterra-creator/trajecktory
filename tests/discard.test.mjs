#!/usr/bin/env node
/**
 * discard.test.mjs — unit tests for lib/discard.mjs, the auto-discard gate
 * that decides whether a low-fit evaluation silently leaves the pipeline.
 *
 * Replaces the orphaned, drifted test-auto-discard.mjs. The threshold is
 * `score < 3.5`; the cowork/self-sourced/
 * referral exemptions still apply. These tests assert the ACTUAL merge-tracker
 * behavior against the single source of truth (lib/discard.mjs AUTO_DISCARD_SCORE).
 *
 * Run: node tests/discard.test.mjs   (exit 0 = pass, 1 = fail)
 */

import {
  shouldAutoDiscard,
  recommendsAgainst,
  isExemptFromAutoDiscard,
  parseScore,
  scoreIsParseable,
  isRequeueableDiscard,
  AUTO_DISCARD_SCORE,
  REQUEUE_FLOOR,
} from '../lib/discard.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('discard.test.mjs');

// Threshold boundary: score below 3.5 is discarded, 3.5 is kept.
// The boundary is strict: the threshold is kept and the next tenth is discarded.
check(AUTO_DISCARD_SCORE === 3.5, 'threshold is 3.5');
check(shouldAutoDiscard({ status: 'Evaluated', score: `${AUTO_DISCARD_SCORE}/5`, notes: '' }) === false,
  'score at the threshold is KEPT');
check(shouldAutoDiscard({ status: 'Evaluated', score: `${AUTO_DISCARD_SCORE - 0.1}/5`, notes: '' }) === true,
  'score just below the threshold is discarded');
check(shouldAutoDiscard({ status: 'Evaluated', score: `${REQUEUE_FLOOR}/5`, notes: '' }) === true,
  'score at the requeue floor is discarded');
check(shouldAutoDiscard({ status: 'Evaluated', score: `${AUTO_DISCARD_SCORE + 0.1}/5`, notes: '' }) === false,
  'score above the threshold is kept');
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
check(isExemptFromAutoDiscard('[reinstated] recovered report') === false,
  'reinstated tag is not exempt');
check(shouldAutoDiscard({ status: 'Evaluated', score: '3.4/5', notes: '[reinstated] recovered report' }) === true,
  'low-score reinstated row is still auto-discarded');

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

// ── Drift guard: an unparseable/empty score is a broken eval, kept for retry ────
check(scoreIsParseable('2.4/5') === true, 'scoreIsParseable true for a real score');
check(scoreIsParseable('n/a') === false && scoreIsParseable('') === false,
  'scoreIsParseable false for "n/a" and empty');
check(shouldAutoDiscard({ status: 'Evaluated', score: 'n/a', notes: '' }) === false,
  'unparseable score is NOT discarded (broken eval → retry, not a real 0)');
check(shouldAutoDiscard({ status: 'Evaluated', score: '', notes: '' }) === false,
  'empty score is NOT discarded');
check(shouldAutoDiscard({ status: 'Evaluated', score: 'n/a', notes: 'do not apply' }) === true,
  'an explicit do-not-apply verdict still discards even without a number');

// ── Re-queueable near-threshold discard (Slice 7.5) ─────────────────────────────
// A Discarded row scored in [REQUEUE_FLOOR, AUTO_DISCARD_SCORE) is eligible for a
// one-click re-evaluate; anything else is not.
check(REQUEUE_FLOOR === 3.0, 'requeue floor is 3.0');
check(isRequeueableDiscard({ status: 'Discarded', score: AUTO_DISCARD_SCORE - 0.1 }) === true, 'a near-threshold discard is re-queueable');
check(isRequeueableDiscard({ status: 'Discarded', score: REQUEUE_FLOOR }) === true, 'the floor is re-queueable');
check(isRequeueableDiscard({ status: 'Discarded', score: REQUEUE_FLOOR - 0.1 }) === false, 'a score below the floor is not re-queueable');
check(isRequeueableDiscard({ status: 'Discarded', score: AUTO_DISCARD_SCORE }) === false, 'the cut is not re-queueable');
check(isRequeueableDiscard({ status: 'Discarded', score: AUTO_DISCARD_SCORE + 0.2 }) === false, 'an above-cut score is not re-queueable');
check(isRequeueableDiscard({ status: 'Evaluated', score: AUTO_DISCARD_SCORE - 0.1 }) === false, 'a live status is never re-queued this way');
check(isRequeueableDiscard({ status: 'Rejected', score: AUTO_DISCARD_SCORE - 0.1 }) === false, 'a company rejection is not a near-threshold auto-discard');
check(isRequeueableDiscard({ status: 'Discarded', score: `${REQUEUE_FLOOR + 0.2}/5` }) === true, 'accepts a raw score cell');
check(isRequeueableDiscard({ status: 'Discarded', score: 'n/a' }) === false, 'an unparseable score is not re-queueable');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
