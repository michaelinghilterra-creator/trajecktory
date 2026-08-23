// lib/contact-timeline.mjs: every touch on a person, from every store, in one
// ordered list.
//
// WHY THIS EXISTS
// A person can be filed in the referral book, the TA book and the influencer
// list at once, each with its own message log. Reading one of them and calling
// it "the history" is how the app came to report someone as weeks overdue on the
// day they accepted a connection request: the invite going out was in the log,
// and the acceptance was not.
//
// That acceptance is the reason this builds EVENTS, not messages.
// `detectAcceptances` records it by writing a status into data/tt-linkedin.json
// and nowhere else, so it rendered one badge and entered no calculation at all.
// It is read back here as an `invite-accepted` event. On the live data, 12 people
// currently have an acceptance dated later than their last outbound touch, and
// every one of them was being reported as overdue.
//
// TWO VIEWS, AND THE DIFFERENCE IS LOAD BEARING
//   buildTimeline        enforcement. NEVER de-duplicates.
//   buildDisplayTimeline cosmetic. May collapse an obvious cross-store double.
// A false dedupe hides a touch, under-counts the outreach cap, and lets the user
// contact someone again, which is the exact failure this build exists to prevent.
// Over-counting only makes them wait a day. So the errors are deliberately
// asymmetric, and only the view nobody enforces against is allowed to guess.
//
// personLastTouch counts OUTBOUND only, and a Draft is not outbound. Drafts live
// in the same log as sent messages, so counting them would mean saving a draft
// blocks the next draft: a guardrail feeding on its own output.
import { readTTCorrespondence } from './target-talent.mjs';
import { readReferralCorrespondence } from './referrals.mjs';
import { parseCorrespondence } from './correspondence-format.mjs';
import { readLinkedInMap } from './tt-linkedin.mjs';
import { readEngagementLog } from './engagement-log.mjs';
import { isLinkedInEntry, isLinkedInInvite } from './channels.mjs';

const sourceOrder = { influencer: 0, referral: 1, ta: 2 };
const normalizeBody = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

function messagesFor(source, row, ref, opts) {
  const supplied = opts.correspondence?.[ref] ?? row.correspondence;
  if (typeof supplied === 'string') return parseCorrespondence(supplied);
  if (Array.isArray(supplied)) return supplied;
  if (typeof opts.readCorrespondence === 'function') return opts.readCorrespondence(source, row, ref) || [];
  if (source === 'ta') return readTTCorrespondence(row.id);
  if (source === 'referral') return readReferralCorrespondence(row.id);
  return [];
}

function eventKind(message) {
  if (message.direction === 'Received') return 'reply-received';
  if (message.direction !== 'Sent' && message.direction !== 'Draft') return '';
  if (isLinkedInInvite(message.subject)) return 'invite-sent';
  return isLinkedInEntry(message) ? 'dm-sent' : 'email-sent';
}

export function buildTimeline(person, opts = {}) {
  const events = [];
  let index = 0;
  for (const source of ['ta', 'referral', 'influencer']) {
    const row = person?.members?.[source];
    if (!row) continue;
    const ref = `${source}:${row.id}`;
    for (const message of messagesFor(source, row, ref, opts)) {
      const kind = eventKind(message);
      if (!kind) continue;
      events.push({ at: message.timestamp, kind, direction: message.direction, channel: message.channel || (isLinkedInEntry(message) ? 'LinkedIn' : 'Email'), subject: message.subject || '', body: message.body || '', store: source, ref, _index: index++ });
    }
  }

  const ta = person?.members?.ta;
  const linkedinMap = opts.linkedinMap || readLinkedInMap();
  const linked = ta ? linkedinMap[String(ta.id)] : null;
  if (linked?.state === 'Connected' && linked.updated) {
    events.push({ at: linked.updated, kind: 'invite-accepted', direction: 'Received', channel: 'LinkedIn', subject: 'LinkedIn invitation accepted', body: '', store: 'ta', ref: `ta:${ta.id}`, _index: index++ });
  }

  const influencer = person?.members?.influencer;
  const engagementLog = opts.engagementLog || readEngagementLog();
  if (influencer) {
    for (const entry of engagementLog) {
      const sameId = entry.influencerId != null && Number(entry.influencerId) === Number(influencer.id);
      const sameName = String(entry.influencer || '').trim().toLowerCase() === String(influencer.name || '').trim().toLowerCase();
      if (!sameId && !sameName) continue;
      events.push({ at: entry.loggedAt || entry.date, kind: 'engagement', direction: 'Sent', channel: 'LinkedIn', subject: entry.actionType || '', body: entry.message || entry.notes || '', store: 'influencer', ref: `influencer:${influencer.id}`, _index: index++ });
    }
  }

  // Missing times are midnight. Remaining ties use store, ref and read order.
  events.sort((a, b) => String(a.at).localeCompare(String(b.at)) || sourceOrder[a.store] - sourceOrder[b.store] || a.ref.localeCompare(b.ref) || a._index - b._index);
  return events.map(({ _index, ...event }) => event);
}

export function personLastTouch(person, opts = {}) {
  const outbound = buildTimeline(person, opts).filter(event => event.direction === 'Sent');
  return outbound.length ? outbound[outbound.length - 1].at : '';
}

export function buildDisplayTimeline(person, opts = {}) {
  const timeline = buildTimeline(person, opts);
  const groups = new Map();
  for (const event of timeline) {
    const key = `${String(event.at).slice(0, 10)}\u0000${event.direction}\u0000${normalizeBody(event.body)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  const keep = new Set();
  for (const events of groups.values()) {
    const counts = new Map();
    for (const event of events) counts.set(event.store, (counts.get(event.store) || 0) + 1);
    const chosen = [...counts].sort((a, b) => b[1] - a[1] || sourceOrder[a[0]] - sourceOrder[b[0]])[0][0];
    for (const event of events) if (event.store === chosen) keep.add(event);
  }
  return timeline.filter(event => keep.has(event));
}
