// Moves the reply decisions that google-sync.json holds today (handledReplies, notRelatedSenders, unmatchedReplies)
// into the event store as one json_snapshot of reply-state.json, so the projection starts out holding exactly what the
// sync file held. Until this has run on a data folder, the event-store readers (readSync with the store on) would see
// empty sets and every handled reply would show up in the sweep again, so it must run BEFORE the new code does.
//
// Pure planning, one append, one verification. Reading and writing the data folder, the backup and the safety
// checks live in cutover-reply-state.mjs. Idempotent: once reply-state.json has any active event, planning reports
// 'already_cut_over' and nothing is appended (a second snapshot would roll the projection back to the old data).

import { insertEvents, withTransaction } from './event-store.mjs';
import { activeLegacyFileEvents, jsonSnapshotPayload, renderLegacyFile } from './legacy-files.mjs';
import { REPLY_STATE_FILE, normalizeReplyState, splitSync } from './reply-state.mjs';

const writerFormat = (value) => `${JSON.stringify(value, null, 2)}\n`;

function parseSync(syncText) {
  if (syncText === null || syncText === undefined) return { present: false, value: {} };
  try {
    const value = JSON.parse(syncText);
    return { present: true, value: value && typeof value === 'object' && !Array.isArray(value) ? value : {} };
  } catch {
    return { present: true, invalid: true, value: {} };
  }
}

/**
 * What the cutover would do. syncText: the raw google-sync.json text (null when absent). Never writes.
 * status: 'already_cut_over' (reply-state.json already has events), 'nothing_to_move' (no sets in the sync file, or
 * it cannot be read), or 'ready'.
 */
export function planReplyStateCutover({ syncText, store }) {
  const parsed = parseSync(syncText);
  const { cursors, state } = splitSync(parsed.value);
  const counts = {
    handled: Object.keys(state.handledReplies).length,
    notRelated: Object.keys(state.notRelatedSenders).length,
    unmatched: Object.keys(state.unmatchedReplies).length,
  };
  const plan = {
    state,
    cursors,
    counts,
    snapshotText: writerFormat(state),
    cursorsText: writerFormat(cursors),
    syncInvalid: Boolean(parsed.invalid),
    setsPresentInSync: ['handledReplies', 'notRelatedSenders', 'unmatchedReplies'].some((key) => Object.hasOwn(parsed.value, key)),
  };
  // An import that found no reply decisions records reply-state.json as absent. That is no data, so it does not count
  // as a cutover; the snapshot below simply supersedes it.
  const hasData = activeLegacyFileEvents(store, REPLY_STATE_FILE)
    .some((event) => !(event.payload?.reason === 'json_snapshot' && event.payload?.exists === false));
  if (hasData) return { ...plan, status: 'already_cut_over' };
  if (parsed.invalid || counts.handled + counts.notRelated + counts.unmatched === 0) return { ...plan, status: 'nothing_to_move' };
  return { ...plan, status: 'ready' };
}

/** Appends the snapshot event for a 'ready' plan. Returns the new event ids. */
export function applyReplyStateCutover(store, plan, { importedOn, definitionsVersion = 'v1' } = {}) {
  if (plan?.status !== 'ready') throw new Error(`cutover is not ready (status: ${plan?.status})`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(importedOn || ''))) throw new Error('importedOn must be YYYY-MM-DD');
  const event = {
    type: 'legacy_record',
    occurred_on: importedOn,
    source: 'import',
    definitions_version: definitionsVersion,
    evidence_ref: `${REPLY_STATE_FILE}#snapshot`,
    dedupe_key: `cutover:${REPLY_STATE_FILE}:snapshot`,
    payload: jsonSnapshotPayload(REPLY_STATE_FILE, plan.snapshotText),
  };
  return withTransaction(store, () => insertEvents(store, [event]));
}

/**
 * Checks the store against the plan after applying: the projected reply-state.json must equal the snapshot text byte
 * for byte, and its three sets must deep-equal the sets the sync file held. Returns a list of problems (empty = ok).
 */
export function verifyReplyStateCutover(store, plan) {
  const problems = [];
  const text = renderLegacyFile(store, REPLY_STATE_FILE);
  if (text !== plan.snapshotText) problems.push('the projected reply-state.json does not match the snapshot byte for byte');
  let projected = null;
  try { projected = normalizeReplyState(text ? JSON.parse(text) : null); } catch { problems.push('the projected reply-state.json is not valid JSON'); }
  if (projected) {
    for (const key of Object.keys(plan.state)) {
      if (JSON.stringify(projected[key]) !== JSON.stringify(plan.state[key])) problems.push(`projected ${key} differs from the sync file's ${key}`);
    }
  }
  return problems;
}
