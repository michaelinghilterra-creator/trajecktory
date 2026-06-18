/**
 * lib/discard.mjs — pure auto-discard decision for the tracker merge.
 *
 * Extracted from merge-tracker.mjs so the gating threshold and exemptions can
 * be unit-tested directly. This is the logic that decides whether a low-fit
 * evaluation silently disappears from the pipeline, so it is the highest-value
 * branch to lock down with tests. The orphan test-auto-discard.mjs that had
 * drifted from this logic is replaced by tests against this module.
 */

// An Evaluated entry whose score is at or below this is auto-discarded.
export const AUTO_DISCARD_SCORE = 2.5;

// Parse a score cell ("4.2/5", "**3.5**", "3") into a number. Returns 0 when
// nothing parses, which (being <= AUTO_DISCARD_SCORE) means an unparseable
// score is treated as a discard candidate — preserving merge-tracker's
// original behavior.
export function parseScore(s) {
  const m = String(s ?? '').replace(/\*\*/g, '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
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
export function shouldAutoDiscard({ status, score, notes }) {
  if (status !== 'Evaluated') return false;
  if (isExemptFromAutoDiscard(notes)) return false;
  return parseScore(score) <= AUTO_DISCARD_SCORE || recommendsAgainst(notes);
}
