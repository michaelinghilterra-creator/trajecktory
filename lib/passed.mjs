// Passed (Definitions v1 section 3) replaces SKIP, Not a Fit, Discarded and Closed. The four answered different
// questions, so a Passed row carries a reason, kept as a tag at the start of the notes cell: [passed: not_a_fit].
// oldLabel() maps a row back to the label it would have had, so a reader that still needs the distinction (a
// posting that closed is not a role you turned down) gets the same answer before and after a row is migrated.
// Pure functions; nothing here reads or writes a file.

export const PASSED_REASONS = Object.freeze(['not_a_fit', 'skip', 'discarded', 'posting_closed', 'withdrew', 'low_score']);

const TAG = /\[passed:\s*([a-z_]+)\s*\]\s*/i;

// The label each reason had before Passed. withdrew and low_score were Discarded; a row with no reason was
// Discarded too, the broadest of the four.
const OLD_LABEL = Object.freeze({
  not_a_fit: 'Not a Fit',
  skip: 'SKIP',
  discarded: 'Discarded',
  posting_closed: 'Closed',
  withdrew: 'Discarded',
  low_score: 'Discarded',
});

const REASON_FOR_OLD_LABEL = Object.freeze({
  'Not a Fit': 'not_a_fit',
  SKIP: 'skip',
  Discarded: 'discarded',
  Closed: 'posting_closed',
});

/** The reason tag in a notes cell, or null when there is none or it is not a known reason. */
export function passedReasonOf(notes) {
  const m = TAG.exec(String(notes ?? ''));
  const reason = m ? m[1].toLowerCase() : null;
  return PASSED_REASONS.includes(reason) ? reason : null;
}

/** The notes with any reason tag removed. */
export function stripPassedReason(notes) {
  return String(notes ?? '').replace(TAG, '').trim();
}

/** The notes with exactly one reason tag at the front, replacing any earlier one. */
export function withPassedReason(notes, reason) {
  if (!PASSED_REASONS.includes(reason)) throw new Error(`Unknown passed reason: ${reason}`);
  const rest = stripPassedReason(notes);
  return rest ? `[passed: ${reason}] ${rest}` : `[passed: ${reason}]`;
}

/**
 * The reason a row with an old status should carry when it becomes Passed. An auto discard for a low score
 * says so in its notes and keeps that finer reason.
 */
export function reasonForOldStatus(status, notes) {
  const base = REASON_FOR_OLD_LABEL[status];
  if (!base) return null;
  if (status === 'Discarded' && /\bauto-discarded:\s*score\b/i.test(String(notes ?? ''))) return 'low_score';
  return base;
}

/** The label a row would have under the four old statuses. Any other status is returned unchanged. */
export function oldLabel(status, notes) {
  if (status !== 'Passed') return status;
  return OLD_LABEL[passedReasonOf(notes)] || 'Discarded';
}

/** True for a posting that went away before the person could act: Closed, or Passed for posting_closed. */
export function isPostingClosed(row) {
  return oldLabel(row?.status, row?.notes) === 'Closed';
}
