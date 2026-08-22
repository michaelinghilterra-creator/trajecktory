/**
 * lib/discard.mjs — pure auto-discard decision for the tracker merge.
 *
 * Extracted from merge-tracker.mjs so the gating threshold and exemptions can
 * be unit-tested directly. This is the logic that decides whether a low-fit
 * evaluation silently disappears from the pipeline, so it is the highest-value
 * branch to lock down with tests. The orphan test-auto-discard.mjs that had
 * drifted from this logic is replaced by tests against this module.
 */

// An Evaluated entry whose score is BELOW this is auto-discarded (i.e. a 3.0 is
// kept, a 2.9 is discarded). Raised from 2.5 on 2026-08-22: 2.5 let too many
// weak-but-not-terrible roles survive. This is the single source of truth for the
// threshold — merge-tracker.mjs and auto-discard-low.mjs import it, so there is
// exactly one number to change.
export const AUTO_DISCARD_SCORE = 3.0;

// Parse a score cell ("4.2/5", "**3.5**", "3") into a number. Returns 0 when
// nothing parses. Callers that gate on the number should first check
// scoreIsParseable — an unparseable score is a broken eval, not a real 0 (see
// shouldAutoDiscard's drift guard).
export function parseScore(s) {
  const m = String(s ?? '').replace(/\*\*/g, '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

// True when the score cell actually carries a number. An empty / "n/a" / garbled
// cell means the eval did not produce a usable score (an interrupted or broken
// run), which must NOT be read as a real 0.
export function scoreIsParseable(s) {
  return /\d/.test(String(s ?? '').replace(/\*\*/g, ''));
}

// True when the agent's notes explicitly recommend against pursuing the role.
export function recommendsAgainst(notes) {
  const notesLower = (notes || '').toLowerCase();
  return /\b(do not apply|do not pursue|recommend against|hard\s*(?:no|blocker|disqualifier)|hard.?disqualifier|location\s+(?:blocker|hard.?no|mismatch|disqualifier)|international\s+relocation|requires\s+(?:relocation|presence\s+in)|not recommended|not applicable)\b/.test(notesLower);
}

// Self-sourced, referral, and cowork entries are always kept for the user to
// decide on, regardless of score.
export function isExemptFromAutoDiscard(notes) {
  const n = notes || '';
  return /\[self-sourced\]/i.test(n) || /\[referral:/i.test(n) || /\[cowork\]/i.test(n);
}

// Returns true if an Evaluated entry should be flipped to Discarded.
//
// Drift guard: an unparseable / empty score is a broken or interrupted eval, NOT
// a real 0, so it is kept for a retry instead of being silently discarded on a
// tooling failure. A parseable score below the threshold still discards, and an
// explicit "do not apply" verdict still discards even without a number.
export function shouldAutoDiscard({ status, score, notes }) {
  if (status !== 'Evaluated') return false;
  if (isExemptFromAutoDiscard(notes)) return false;
  if (recommendsAgainst(notes)) return true;
  if (!scoreIsParseable(score)) return false;   // broken/empty eval → retry, don't discard
  return parseScore(score) < AUTO_DISCARD_SCORE;
}
