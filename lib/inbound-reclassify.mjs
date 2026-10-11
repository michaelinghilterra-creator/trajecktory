// Dry-run planner for re-classifying stored email_received events. Stored events keep the kind and sentiment they were
// classified under, so a change to the classifier (see INBOUND_CLASSIFIER_VERSION) leaves history on the old rules.
// This reads each event's reply note, classifies it again with the current rules, and reports what would move. It
// writes nothing and holds no sender, subject or body in its result.
// Pure function: nothing here reads or writes a file or opens the store.

import { parseReplyNote } from './data-review.mjs';
import { buildEmailReceivedEvent, classifyForEvent, INBOUND_CLASSIFIER_VERSION, INBOUND_EVENT_TYPE, replyKey } from './inbound-events.mjs';
import { buildVoidEvent } from './void-events.mjs';

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
 *   changes       one entry per event that would move, by event id:
 *                 { event_id, application_id, key, from, to, to_kind, to_sentiment, sentiment_source }
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
      changes.push({
        event_id: event.id, application_id: appId, key: event.payload.key, from, to,
        to_kind: now.kind, to_sentiment: now.sentiment, sentiment_source: now.sentiment_source,
      });
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

/**
 * The events that carry a plan out: for each change, a void of the stored event (reason superseded) and a replacement
 * email_received event with the same key, message id, note timestamp, logged date and attach link, the new kind and
 * sentiment, and the current classifier version. History is not edited; the old event stays and is voided. The attach
 * link is kept so undoing the reply that logged the email still reaches the replacement.
 *   events      the visible email_received events the plan was made from
 *   occurredOn  YYYY-MM-DD the void events are dated
 *   runId       names this run in the void events and in each replacement's dedupe_key
 */
export function buildReclassificationEvents({ events = [], plan, occurredOn, runId } = {}) {
  const byId = new Map(events.map((event) => [event.id, event]));
  const built = [];
  for (const change of plan?.changes || []) {
    const old = byId.get(change.event_id);
    if (!old || !old.payload) throw new Error(`event ${change.event_id} is not among the events given`);
    built.push(buildVoidEvent({
      target_event_id: old.id, reason_code: 'superseded', evidence_ref: `reclassify:${change.key}`,
      actor: 'bulk_script', script: 'reclassify-email-received.mjs', run_id: runId, occurred_on: occurredOn, definitions_version: 'v1',
    }));
    built.push(buildEmailReceivedEvent({
      application_id: old.application_id, msg_id: old.payload.msg_id ?? null, note_timestamp: old.payload.note_timestamp ?? null,
      sent_on: old.payload.sent_on, kind: change.to_kind, sentiment: change.to_sentiment,
      sentiment_source: change.sentiment_source || old.payload.sentiment_source || 'owner', source: 'import',
      attach_event_id: old.payload.attach_event_id ?? null, dedupe_key: `reclassify:${INBOUND_CLASSIFIER_VERSION}:${change.key}`, key: change.key,
    }));
  }
  return built;
}
