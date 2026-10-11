// Dry-run planner for re-classifying stored email_received events. Stored events keep the kind and sentiment they were
// classified under, so a change to the classifier (see INBOUND_CLASSIFIER_VERSION) leaves history on the old rules.
// This reads each event's reply note, classifies it again with the current rules, and reports what would move. It
// writes nothing and holds no sender, subject or body in its result.
// Pure function: nothing here reads or writes a file or opens the store.

import { parseReplyNote } from './data-review.mjs';
import { classifyForEvent, INBOUND_EVENT_TYPE, replyKey } from './inbound-events.mjs';

const label = (kind, sentiment) => (sentiment ? `${kind}/${sentiment}` : String(kind));

function noteIndex(notes) {
  const byKey = new Map();
  for (const [appId, list] of Object.entries(notes || {})) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const parsed = parseReplyNote(entry);
      if (!parsed) continue;
      byKey.set(replyKey({ msg_id: entry.msgId, application_id: appId, note_timestamp: entry.timestamp }), parsed);
    }
  }
  return byKey;
}

/**
 * events: visible email_received events (any other type is ignored); notes: app-notes.json parsed.
 * Returns { counts, changes, humanReplies, apps }:
 *   counts        { events, noNote, unchanged, changed, byTransition: { 'human/positive -> receipt': n } }
 *   changes       one entry per event that would move, by event id: { event_id, application_id, key, from, to, sentiment_source }
 *   humanReplies  { before, after } number of human events
 *   apps          { reply: { before, after }, positive: { before, after } } number of applications with a human /
 *                 positive human reply
 * An event with no matching note keeps its stored kind and sentiment in the before and after numbers.
 */
export function planInboundReclassification({ events = [], notes = {} } = {}) {
  const byKey = noteIndex(notes);
  const counts = { events: 0, noNote: 0, unchanged: 0, changed: 0, byTransition: {} };
  const changes = [];
  const humanReplies = { before: 0, after: 0 };
  const reply = { before: new Set(), after: new Set() };
  const positive = { before: new Set(), after: new Set() };

  for (const event of events) {
    if (!event || event.type !== INBOUND_EVENT_TYPE || !event.payload || typeof event.payload !== 'object') continue;
    counts.events += 1;
    const appId = String(event.application_id);
    const stored = { kind: event.payload.kind, sentiment: event.payload.sentiment ?? null };
    let now = { ...stored, sentiment_source: null };

    const parsed = byKey.get(event.payload.key);
    if (!parsed) counts.noNote += 1;
    else {
      const cls = classifyForEvent({ subject: parsed.subject, body: parsed.body, sentiment: parsed.sentiment, sender: parsed.sender });
      now = { kind: cls.kind, sentiment: cls.sentiment, sentiment_source: cls.sentiment_source || null };
    }

    const from = label(stored.kind, stored.sentiment);
    const to = label(now.kind, now.sentiment);
    if (from === to) counts.unchanged += 1;
    else {
      counts.changed += 1;
      const transition = `${from} -> ${to}`;
      counts.byTransition[transition] = (counts.byTransition[transition] || 0) + 1;
      changes.push({ event_id: event.id, application_id: appId, key: event.payload.key, from, to, sentiment_source: now.sentiment_source });
    }

    if (stored.kind === 'human') {
      humanReplies.before += 1;
      reply.before.add(appId);
      if (stored.sentiment === 'positive') positive.before.add(appId);
    }
    if (now.kind === 'human') {
      humanReplies.after += 1;
      reply.after.add(appId);
      if (now.sentiment === 'positive') positive.after.add(appId);
    }
  }

  changes.sort((a, b) => Number(a.event_id) - Number(b.event_id));
  return {
    counts,
    changes,
    humanReplies,
    apps: {
      reply: { before: reply.before.size, after: reply.after.size },
      positive: { before: positive.before.size, after: positive.after.size },
    },
  };
}
