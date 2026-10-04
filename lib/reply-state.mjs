// The reply records the Gmail sweep keeps for the person's own decisions: which messages were handled and how
// (handledReplies), which senders were marked not job-related (notRelatedSenders), and which messages are parked
// with no application (unmatchedReplies). They are projected from the event store into reply-state.json so undoing a
// decision is a void (D-10) instead of a direct file edit. The Gmail scan bookmarks (seenMessageIds, lastCheckedAt,
// lastPreviewAt) are NOT here: nothing undoes a bookmark, so they stay plain state in google-sync.json.
// Pure functions: nothing here reads or writes a file or opens the store.

export const REPLY_STATE_FILE = 'reply-state.json';
export const REPLY_STATE_DEFINITIONS_VERSION = 'v1';
export const REPLY_STATE_KEYS = Object.freeze(['handledReplies', 'notRelatedSenders', 'unmatchedReplies']);

export const REPLY_DISMISSED_EVENT_TYPE = 'reply_dismissed';
export const SENDER_NOT_RELATED_EVENT_TYPE = 'sender_not_related';
export const REPLY_UNMATCHED_EVENT_TYPE = 'reply_unmatched';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A reply state with all three sets present and empty. */
export function emptyReplyState() {
  return { handledReplies: {}, notRelatedSenders: {}, unmatchedReplies: {} };
}

/** The three sets of a document, each guaranteed to be a plain object. Anything else in the document is dropped. */
export function normalizeReplyState(doc) {
  const out = emptyReplyState();
  if (!isPlainObject(doc)) return out;
  for (const key of REPLY_STATE_KEYS) {
    if (isPlainObject(doc[key])) out[key] = doc[key];
  }
  return out;
}

/**
 * Splits a google-sync.json object into its reply sets and everything else (the scan bookmarks and any key added
 * later). Input is not modified.
 */
export function splitSync(sync) {
  const source = isPlainObject(sync) ? sync : {};
  const cursors = {};
  for (const [key, value] of Object.entries(source)) {
    if (!REPLY_STATE_KEYS.includes(key)) cursors[key] = value;
  }
  return { cursors, state: normalizeReplyState(source) };
}

function nestedSet(key, subkey, value) {
  return { file: REPLY_STATE_FILE, op: 'json_nested_set', key, subkey: String(subkey), value };
}
function nestedDelete(key, subkey) {
  return { file: REPLY_STATE_FILE, op: 'json_nested_delete', key, subkey: String(subkey) };
}

/** Effect recording how a message was handled. record: { action, appId, date }. */
export function handledReplySet(msgId, record) { return nestedSet('handledReplies', msgId, record); }
export function handledReplyDelete(msgId) { return nestedDelete('handledReplies', msgId); }
/** Effect remembering a sender the person marked not job-related. record: { date }. */
export function notRelatedSenderSet(address, record) { return nestedSet('notRelatedSenders', address, record); }
/** Effects parking a message with no application, or taking it off the parked list. */
export function unmatchedReplySet(msgId, entry) { return nestedSet('unmatchedReplies', msgId, entry); }
export function unmatchedReplyDelete(msgId) { return nestedDelete('unmatchedReplies', msgId); }

/**
 * The effects an attached reply owns: it is handled against that application and leaves the parked list. Spliced
 * into the reply_attached event so one void undoes the note, the handled record and the unparking together.
 */
export function replyAttachedStateEffects({ msg_id, application_id, action, occurred_on } = {}) {
  return [
    handledReplySet(msg_id, { action, appId: Number(application_id), date: occurred_on }),
    unmatchedReplyDelete(msg_id),
  ];
}

/** A reply the person dismissed: handled with no application, no note, no status change. */
export function buildReplyDismissedEvent({ msg_id, occurred_on, definitions_version = REPLY_STATE_DEFINITIONS_VERSION } = {}) {
  return {
    type: REPLY_DISMISSED_EVENT_TYPE,
    occurred_on,
    source: 'dashboard',
    definitions_version,
    payload: {
      msg_id,
      action: 'dismiss',
      legacy_effects: [
        handledReplySet(msg_id, { action: 'dismiss', appId: null, date: occurred_on }),
        unmatchedReplyDelete(msg_id),
      ],
    },
  };
}

/**
 * A reply marked not job-related: hidden like a dismissal, and the sender is remembered so later sweeps drop their
 * email too. address may be empty (the sender could not be read), in which case only the message is hidden.
 */
export function buildSenderNotRelatedEvent({ msg_id, address, occurred_on, definitions_version = REPLY_STATE_DEFINITIONS_VERSION } = {}) {
  const effects = [
    handledReplySet(msg_id, { action: 'not-related', appId: null, date: occurred_on }),
    unmatchedReplyDelete(msg_id),
  ];
  if (address) effects.push(notRelatedSenderSet(address, { date: occurred_on }));
  return {
    type: SENDER_NOT_RELATED_EVENT_TYPE,
    occurred_on,
    source: 'dashboard',
    definitions_version,
    payload: { msg_id, action: 'not-related', sender: address || null, legacy_effects: effects },
  };
}

/** A reply parked on the unmatched list with its evidence and no application (E-4). entry is stored as given. */
export function buildReplyUnmatchedEvent({ msg_id, entry, occurred_on, definitions_version = REPLY_STATE_DEFINITIONS_VERSION } = {}) {
  return {
    type: REPLY_UNMATCHED_EVENT_TYPE,
    occurred_on,
    source: 'dashboard',
    definitions_version,
    payload: {
      msg_id,
      action: 'unmatched',
      legacy_effects: [
        unmatchedReplySet(msg_id, entry),
        handledReplySet(msg_id, { action: 'unmatched', appId: null, date: occurred_on }),
      ],
    },
  };
}
