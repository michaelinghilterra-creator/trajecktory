/**
 * lib/correspondence-context.mjs — turn a contact's raw correspondence log into
 * the small amount of thread STATE a drafter needs to write the genuine NEXT
 * message rather than re-pitching something already sent.
 *
 * WHY THIS EXISTS
 * The follow-up drafters read the last few messages purely as "context, do not
 * repeat" and then still drove a full pitch. So a contact who was messaged two
 * days ago got a fresh reintroduction that read as if we had forgotten we just
 * wrote them. This computes whether a SUBSTANTIVE message already went out
 * recently (and is unanswered), so the prompt can branch to a short nudge that
 * references the prior note instead of repeating it.
 *
 * A pure LinkedIn connection-request invite is NOT a substantive message: it is
 * a handshake, not a pitch, so it never triggers nudge mode. Pure (no I/O) so it
 * stays unit-testable; pass `now` to make the day math deterministic.
 */
import { isLinkedInInvite, isLinkedInEntry } from './channels.mjs';
import { classifyInbound } from '../../../lib/inbound-classify.mjs';

// Cold-outreach ceilings per channel. The LinkedIn count INCLUDES the connection
// request, so 3 = connect + two follow-ups. A real reply lifts the cap entirely.
export const COLD_OUTREACH_CAPS = { linkedin: 3, email: 3 };

const DAY_MS = 86400000;

// Per-channel cold-outreach cap state for a contact. Counts OUTBOUND touches per
// channel (LinkedIn includes the connect request; email is everything else). A
// real inbound reply means a live conversation, which lifts BOTH caps. An invite
// acceptance, automatic reply, or departure notice is not a conversation and
// therefore must leave the cold-outreach guardrails in place.
export function outreachCapState(messages, opts = {}) {
  const msgs = Array.isArray(messages) ? messages : [];
  const caps = { ...COLD_OUTREACH_CAPS, ...(opts.caps || {}) };
  const sent = msgs.filter(m => m.direction === 'Sent');
  const hasReply = msgs.some(m => m.direction === 'Received' && classifyInbound(m) === 'human');
  const liSent = sent.filter(m => isLinkedInEntry(m)).length;
  const emSent = sent.filter(m => !isLinkedInEntry(m)).length;
  const mk = (n, cap) => ({ sent: n, cap, capped: !hasReply && n >= cap });
  return { hasReply, linkedin: mk(liSent, caps.linkedin), email: mk(emSent, caps.email) };
}

// Whether a queue row on `channel` should rest (capped with no reply). A 'both'
// row rests only when BOTH channels are exhausted — an open channel is still
// actionable.
export function isChannelCapped(capState, channel) {
  if (!capState) return false;
  if (channel === 'linkedin') return !!capState.linkedin.capped;
  if (channel === 'email') return !!capState.email.capped;
  if (channel === 'both') return !!(capState.linkedin.capped && capState.email.capped);
  return false;
}
const dayOf = (m) => String(m?.timestamp || '').slice(0, 10);

// Calendar days between a stamped date and now, in the user's own timezone.
//
// This used to floor only ONE side: the message date was parsed to local midnight
// and then subtracted from `now` as a raw instant, so the answer moved with the
// timezone. The same thread read as 2 days old in one zone and 3 in another,
// which surfaced as a test that passed locally and failed in CI. Correspondence
// timestamps are stamped with LOCAL dates, so the honest comparison floors both
// ends to local midnight and counts whole calendar days, which is what a person
// means by "three days ago".
//
// It matters more than it did: this now feeds awaitingReplyHold in the outreach
// guardrail, so an off-by-one here decides whether somebody is contactable.
function daysBetween(dateStr, now) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(dateStr || ''))) return null;
  const d = new Date(dateStr.slice(0, 10) + 'T00:00:00');
  if (isNaN(d)) return null;
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((nowMidnight - d) / DAY_MS);
}

export function summarizeThread(messages, opts = {}) {
  const msgs = Array.isArray(messages) ? messages : [];
  const now = opts.now instanceof Date && !isNaN(opts.now) ? opts.now : new Date();
  const recentDays = Number.isFinite(opts.recentDays) ? opts.recentDays : 10;

  const sent = msgs.filter(m => m.direction === 'Sent');
  const received = msgs.filter(m => m.direction === 'Received');
  // The last message a follow-up must not repeat is the last SUBSTANTIVE one — a
  // real note, not the connection-request handshake.
  const substantive = sent.filter(m => !isLinkedInInvite(m.subject));
  const lastSub = substantive[substantive.length - 1] || null;
  const lastInbound = received[received.length - 1] || null;

  const daysSinceLastSub = lastSub ? daysBetween(dayOf(lastSub), now) : null;
  // A reply on/after the last substantive message means the thread moved on; it
  // is no longer an unanswered nudge.
  const repliedSinceLastSub = !!(lastSub && lastInbound && dayOf(lastInbound) >= dayOf(lastSub));
  const recentPitch = !!(lastSub && daysSinceLastSub != null && daysSinceLastSub <= recentDays && !repliedSinceLastSub);

  // Render the last few messages fuller than a one-line tail, oldest → newest, so
  // the model can see what was actually said and avoid echoing it.
  const threadBlock = msgs.slice(-4).map(m => {
    const ch = m.channel === 'LinkedIn' ? 'LinkedIn' : 'Email';
    const bodyOneLine = String(m.body || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    return `- ${dayOf(m)} [${m.direction} · ${ch}] ${m.subject ? m.subject + ': ' : ''}${bodyOneLine}`;
  }).join('\n');

  const ago = daysSinceLastSub === 0 ? 'today' : `${daysSinceLastSub} day${daysSinceLastSub === 1 ? '' : 's'} ago`;
  let stateLine;
  if (!msgs.length) stateLine = 'No prior messages on file.';
  else if (recentPitch) stateLine = `A substantive message already went out ${ago} (on ${dayOf(lastSub)}) with no reply since. This is a SHORT follow-up nudge, NOT a re-pitch.`;
  else if (lastSub) stateLine = `The last substantive message was ${ago} (${dayOf(lastSub)})${repliedSinceLastSub ? ', and they have since replied' : ''}.`;
  else stateLine = 'Only a connection request has gone out so far; no substantive message yet.';

  return { count: msgs.length, lastSub, lastInbound, daysSinceLastSub, repliedSinceLastSub, recentPitch, threadBlock, stateLine };
}
