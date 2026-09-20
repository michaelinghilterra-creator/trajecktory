// E-7: excluding a weekly-review item with a reason, instead of fixing the thing it flags. Pure functions over
// event lists; nothing here reads or writes a file. Resolving an item (confirming an interview, attaching a
// reply, updating a status) already has its own route from D-1/E-2/E-3/E-6 and just makes the item stop showing
// up on the next rebuild. Excluding is for the other case: the person looked at it and is deliberately leaving
// it as is for now, with a reason on record. The report can then say how many rows were counted (not flagged,
// or flagged and fixed) and how many were excluded (flagged, looked at, left with a reason).
import { visibleEvents } from './void-events.mjs';

export const REVIEW_ITEM_KINDS = Object.freeze(['unconfirmed_interview', 'scheduled', 'newer_message', 'unmatched_reply']);
export const REVIEW_ITEM_EXCLUDED_TYPE = 'review_item_excluded';

/** The stable key one weekly-review item is tracked under, whatever week it currently falls in. */
export function reviewItemKey(kind, item) {
  if (kind === 'unconfirmed_interview' || kind === 'scheduled') {
    return `interview|${item.application_id}|${String(item.stage ?? '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
  }
  if (kind === 'newer_message' || kind === 'unmatched_reply') {
    return `${kind}|${item.application_id}|${item.message_id}`;
  }
  throw new TypeError('kind');
}

/**
 * The event that excludes one item, with a reason. application_id is carried at the top level (not just inside
 * item_key) so E-6 undo blocks it the same way every other dashboard action is blocked: only by a newer change
 * on the SAME application, never by an unrelated exclusion elsewhere.
 */
export function buildReviewItemExcludedEvent({ application_id, item_kind, item_key, reason, occurred_on, definitions_version = 'v1' } = {}) {
  if (!REVIEW_ITEM_KINDS.includes(item_kind)) throw new TypeError('item_kind');
  if (typeof item_key !== 'string' || item_key.trim() === '') throw new TypeError('item_key');
  if (typeof reason !== 'string' || reason.trim() === '') throw new TypeError('reason');
  const id = String(application_id ?? '').trim();
  if (id === '') throw new TypeError('application_id');
  return {
    type: REVIEW_ITEM_EXCLUDED_TYPE,
    occurred_on,
    source: 'dashboard',
    application_id: id,
    definitions_version,
    payload: { item_kind, item_key, reason: reason.trim() },
  };
}

/**
 * The current exclusion for each item key, newest wins, voided ones dropped. Map of item_key to
 * { reason, occurred_on, event_id, item_kind }.
 */
export function reviewResolutionsFromEvents(events) {
  const sorted = visibleEvents(events).filter((e) => e.type === REVIEW_ITEM_EXCLUDED_TYPE).sort((a, b) => a.id - b.id);
  const byKey = new Map();
  for (const event of sorted) {
    const p = event.payload ?? {};
    if (typeof p.item_key !== 'string') continue;
    byKey.set(p.item_key, { reason: p.reason, occurred_on: event.occurred_on, event_id: event.id, item_kind: p.item_kind });
  }
  return byKey;
}
