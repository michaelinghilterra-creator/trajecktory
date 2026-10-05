// Classified inbound email, recorded as email_received events. One event per reply the owner logs or attaches to an
// application. It records WHAT the email was (human reply, application receipt, auto-reply, departure notice,
// acceptance notice) and, for a human reply, the sentiment the owner logged it with, so the reply metrics read a
// stored fact instead of re-parsing note text and re-running the classifier on every read, and a classifier change
// cannot silently rewrite history. The event holds no sender, subject or body (the note keeps the text).
// Pure functions: nothing here reads or writes a file or opens the store.
//
// The date in an event is the day the reply was LOGGED, the same day the note header records, so the metrics read
// the same dates as before. A reply is identified by its key: the Gmail message id when there is one, else the
// application and note timestamp; the 'Responded' status rows have their own key. The reader uses the key to avoid
// counting a reply twice while a note and its event exist side by side.

import { classifyInbound, isApplicationReceipt } from './inbound-classify.mjs';
import { parseReplyNote } from './data-review.mjs';
import { visibleEvents } from './void-events.mjs';

export const INBOUND_EVENT_TYPE = 'email_received';
// The date of the last change to the classification rules or their mapping. Bump it with any change that can move
// a kind, in the same commit as the golden fixtures in tests/inbound-events.test.mjs. Stored events keep the kind and
// the version they were classified under; they are not rewritten when the rules change.
export const INBOUND_CLASSIFIER_VERSION = '2026-10-05';
export const INBOUND_KINDS = Object.freeze(['human', 'receipt', 'auto_reply', 'departure', 'acceptance']);
export const INBOUND_SENTIMENTS = Object.freeze(['positive', 'neutral', 'negative']);
export const INBOUND_SENTIMENT_SOURCES = Object.freeze(['owner', 'rule']);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What kind of email this is and, for a human reply, its sentiment. Same decisions the metrics collector made on
 * every read: a neutral application receipt first, then departure, auto-reply, acceptance, else human.
 */
export function classifyForEvent({ subject, body, sentiment } = {}) {
  let kind;
  if (isApplicationReceipt({ subject, body, sentiment })) kind = 'receipt';
  else {
    const found = classifyInbound({ subject, body });
    kind = found === 'auto-reply' ? 'auto_reply' : found;
  }
  if (kind !== 'human') return { kind, sentiment: null };
  const s = String(sentiment || '').trim().toLowerCase();
  return { kind, sentiment: INBOUND_SENTIMENTS.includes(s) ? s : 'neutral' };
}

/** The identity of a reply: its Gmail message id when it has one, else the application and the note timestamp. */
export function replyKey({ msg_id, application_id, note_timestamp } = {}) {
  if (msg_id) return `msg:${msg_id}`;
  return `note:${application_id}:${note_timestamp}`;
}

/** The identity of a reply recorded only as a 'Responded' status row. */
export function respondedKey({ application_id, date } = {}) {
  return `responded:${application_id}:${date}`;
}

/**
 * One email_received event. source is 'dashboard' for a reply logged now and 'import' for the backfill.
 * attach_event_id links a backfilled reply to the reply_attached event that logged it, so undoing that attach also
 * removes this event. dedupe_key is for imports only (a live reply can be logged, undone and logged again).
 */
export function buildEmailReceivedEvent({
  application_id, msg_id = null, note_timestamp = null, sent_on, kind, sentiment = null,
  sentiment_source = 'owner', source = 'dashboard', attach_event_id = null, dedupe_key = null, key = null,
} = {}) {
  if (application_id === undefined || application_id === null || String(application_id) === '') throw new TypeError('application_id is required');
  if (!DATE.test(String(sent_on || ''))) throw new TypeError('sent_on must be YYYY-MM-DD');
  if (!INBOUND_KINDS.includes(kind)) throw new TypeError(`kind must be one of ${INBOUND_KINDS.join(', ')}`);
  if (kind === 'human' && !INBOUND_SENTIMENTS.includes(sentiment)) throw new TypeError('a human reply needs a sentiment');
  if (kind !== 'human' && sentiment !== null) throw new TypeError('only a human reply carries a sentiment');
  if (!INBOUND_SENTIMENT_SOURCES.includes(sentiment_source)) throw new TypeError('sentiment_source must be owner or rule');
  if (!['dashboard', 'import'].includes(source)) throw new TypeError('source must be dashboard or import');
  const replyId = key || replyKey({ msg_id, application_id, note_timestamp });
  return {
    type: INBOUND_EVENT_TYPE,
    occurred_on: sent_on,
    source,
    application_id: String(application_id),
    definitions_version: 'v1',
    ...(dedupe_key ? { dedupe_key } : {}),
    payload: {
      key: replyId,
      msg_id: msg_id || null,
      note_timestamp: note_timestamp || null,
      sent_on,
      kind,
      sentiment,
      sentiment_source,
      classifier_version: INBOUND_CLASSIFIER_VERSION,
      attach_event_id: attach_event_id ?? null,
    },
  };
}

/**
 * The replies the events record, in the shape the metrics core reads, and the keys of every visible event (any kind,
 * so a receipt that has an event is not re-read from its note). events: email_received and event_undone events, any
 * order; an undone event is dropped.
 */
export function inboundRepliesFromEvents(events) {
  const replies = {};
  const keys = new Set();
  for (const event of visibleEvents(events || [])) {
    if (event.type !== INBOUND_EVENT_TYPE) continue;
    const payload = event.payload || {};
    if (payload.key) keys.add(payload.key);
    if (payload.kind !== 'human') continue;
    const appId = String(event.application_id);
    if (!replies[appId]) replies[appId] = [];
    replies[appId].push({ sent_on: payload.sent_on, sentiment: payload.sentiment });
  }
  return { replies, keys };
}

/** The visible email_received events a reply_attached leader owns by link (backfilled replies), for undo. */
export function linkedInboundEventIds(events, leaderId) {
  return visibleEvents(events || [])
    .filter((event) => event.type === INBOUND_EVENT_TYPE && event.payload && event.payload.attach_event_id === leaderId)
    .map((event) => event.id);
}

/**
 * The backfill: one event for every reply note and every 'Responded' row that has none yet. Pure.
 *   notes                  app-notes.json parsed: { [appId]: [{ timestamp, text, msgId? }] }
 *   respondedRows          [{ application_id, date }] for status rows labelled Responded
 *   existingKeys           Set of keys already recorded (visible events)
 *   replyAttachedByMsgId   Map from a Gmail message id to the id of the reply_attached event that logged it
 */
export function planInboundBackfill({ notes = {}, respondedRows = [], existingKeys = new Set(), replyAttachedByMsgId = new Map() } = {}) {
  const events = [];
  const counts = { notes: 0, replyNotes: 0, created: 0, alreadyRecorded: 0, linkedToAttach: 0, responded: 0, byKind: {} };
  const seen = new Set(existingKeys);
  for (const appId of Object.keys(notes).sort((a, b) => Number(a) - Number(b))) {
    const entries = Array.isArray(notes[appId]) ? notes[appId] : [];
    for (const entry of entries) {
      counts.notes += 1;
      const parsed = parseReplyNote(entry);
      if (!parsed) continue;
      counts.replyNotes += 1;
      const key = replyKey({ msg_id: entry.msgId, application_id: appId, note_timestamp: entry.timestamp });
      if (seen.has(key)) { counts.alreadyRecorded += 1; continue; }
      seen.add(key);
      const cls = classifyForEvent({ subject: parsed.subject, body: parsed.body, sentiment: parsed.sentiment });
      const attach = entry.msgId ? replyAttachedByMsgId.get(String(entry.msgId)) : undefined;
      if (attach !== undefined) counts.linkedToAttach += 1;
      events.push(buildEmailReceivedEvent({
        application_id: appId, msg_id: entry.msgId || null, note_timestamp: entry.timestamp || null,
        sent_on: parsed.sent_on, kind: cls.kind, sentiment: cls.sentiment, sentiment_source: 'owner', source: 'import',
        attach_event_id: attach ?? null, dedupe_key: `backfill:${key}`, key,
      }));
      counts.byKind[cls.kind] = (counts.byKind[cls.kind] || 0) + 1;
    }
  }
  for (const row of respondedRows) {
    const key = respondedKey(row);
    if (seen.has(key)) { counts.alreadyRecorded += 1; continue; }
    seen.add(key);
    events.push(buildEmailReceivedEvent({
      application_id: row.application_id, sent_on: row.date, kind: 'human', sentiment: 'neutral',
      sentiment_source: 'rule', source: 'import', dedupe_key: `backfill:${key}`, key,
    }));
    counts.responded += 1;
    counts.byKind.human = (counts.byKind.human || 0) + 1;
  }
  counts.created = events.length;
  return { events, counts };
}
