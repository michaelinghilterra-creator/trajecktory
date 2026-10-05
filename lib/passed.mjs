// Passed (Definitions v1 section 3) replaces SKIP, Not a Fit, Discarded and Closed. The four answered different
// questions, so a Passed row carries a reason, kept as a tag at the start of the notes cell: [passed: not_a_fit].
// oldLabel() maps a row back to the label it would have had, so a reader that still needs the distinction (a
// posting that closed is not a role you turned down) gets the same answer before and after a row is migrated.
// Pure functions; nothing here reads or writes a file.

export const PASSED_REASONS = Object.freeze(['not_a_fit', 'skip', 'discarded', 'posting_closed', 'withdrew', 'low_score']);


// The four retired labels as the status-vocabulary entries they used to be in templates/states.yml. This is the ONE
// place that lists them: states.yml no longer does, and the readers that need to recognise them in old data (status
// history, backups, batch input) add them back with withRetiredStates(). They sit immediately before Passed, where
// they were in the file, so every derived list keeps its order. The reason each one maps to is REASON_FOR_OLD_LABEL.
export const RETIRED_STATES = Object.freeze([
  Object.freeze({ id: 'discarded', label: 'Discarded', aliases: Object.freeze(['descartado', 'descartada', 'cerrada', 'cancelada']), description: 'Discarded by candidate or offer closed', dashboard_group: 'discarded' }),
  Object.freeze({ id: 'skip', label: 'SKIP', aliases: Object.freeze(['no_aplicar', 'no aplicar', 'skip', 'monitor']), description: "Doesn't fit, don't apply", dashboard_group: 'skip' }),
  Object.freeze({ id: 'closed', label: 'Closed', aliases: Object.freeze(['no longer available', 'expired', 'nla', 'posting closed', 'role closed']), description: 'Job posting is no longer available or has been closed', dashboard_group: 'closed' }),
  Object.freeze({ id: 'not_a_fit', label: 'Not a Fit', aliases: Object.freeze(['not a fit', 'naf', 'no fit', 'poor fit']), description: 'Role evaluated and determined to be a poor fit: signal noise, wrong level, wrong domain', dashboard_group: 'not_a_fit' }),
]);

/**
 * The states list from templates/states.yml with the four retired states put back immediately before Passed (or at
 * the end when the file has no Passed entry). Returns a new array; the input is not changed. Entries are copies, so a
 * reader that sorts or edits its list cannot change the shared constants.
 */
export function withRetiredStates(states) {
  const list = Array.isArray(states) ? states : [];
  const copies = RETIRED_STATES.map(s => ({ ...s, aliases: [...s.aliases] }));
  const at = list.findIndex(s => s && s.id === 'passed');
  if (at < 0) return [...list, ...copies];
  return [...list.slice(0, at), ...copies, ...list.slice(at)];
}

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
