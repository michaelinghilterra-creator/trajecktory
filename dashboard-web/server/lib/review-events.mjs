// E-7: excluding a weekly-review item, with a reason, in the event store. With the event store off there is
// nowhere to keep an exclusion, so reads return nothing and writes refuse instead of pretending. Mirrors
// dashboard-web/server/lib/interview-events.mjs.
import { DATA_DIR } from '../config.mjs';
import { appendEvents, readEvents } from '../../../lib/event-store.mjs';
import { logWritesEnabled, withLogRead, withLogWrite } from '../../../lib/log-writes.mjs';
import { REVIEW_ITEM_EXCLUDED_TYPE, buildReviewItemExcludedEvent, reviewResolutionsFromEvents } from '../../../lib/review-resolutions.mjs';

/** The current exclusion for each item key. Map of item_key to { reason, occurred_on, event_id, item_kind }. Empty when the store is off. */
export function readReviewResolutions(dataDir = DATA_DIR) {
  if (!logWritesEnabled(dataDir)) return new Map();
  return withLogRead(dataDir, (store) => reviewResolutionsFromEvents([
    ...readEvents(store, { type: REVIEW_ITEM_EXCLUDED_TYPE }),
    ...readEvents(store, { type: 'event_undone' }),
  ]));
}

/** Exclude one item with a reason. Returns the stored event id. Throws when the event store is off. */
export function excludeReviewItem(fields, dataDir = DATA_DIR) {
  if (!logWritesEnabled(dataDir)) {
    const error = new Error('The event store is off, so an exclusion cannot be kept yet.');
    error.code = 'STORE_OFF';
    throw error;
  }
  const event = buildReviewItemExcludedEvent(fields);
  return withLogWrite(dataDir, (store) => appendEvents(store, [event]));
}
