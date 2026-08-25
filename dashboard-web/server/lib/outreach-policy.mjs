import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.mjs';
import { summarizeThread, outreachCapState, isChannelCapped } from './correspondence-context.mjs';
import { isLinkedInEntry, isLinkedInInvite } from './channels.mjs';
import { OUTREACH_DEFAULTS } from './profile.mjs';

const DAY_MS = 86400000;
const day = value => String(value || '').slice(0, 10);
const channelKey = value => {
  const key = String(value || '').toLowerCase();
  return key === 'linkedin' || key === 'both' ? key : 'email';
};
const addDays = (value, count) => {
  const d = new Date(`${day(value)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
};

function normalizedPolicy(policy = {}) {
  return {
    ...OUTREACH_DEFAULTS,
    ...policy,
    coldOutreachCap: { ...OUTREACH_DEFAULTS.coldOutreachCap, ...(policy.coldOutreachCap || {}) },
  };
}

// Which books the per-company daily cap applies to.
//
// It exists to stop you landing in three inboxes at one employer on the same
// morning, which is a real risk when you are working several gatekeepers at a
// company you have applied to. Referrals are not that: they are your own network
// spread across a hundred companies, and two of them sharing an employer is a
// coincidence, not a coordinated approach. Capping them held warm contacts back
// for no benefit.
//
// A blank company is skipped for every book. Every influencer has one, so they
// all normalized to the same empty key and the entire book competed for three
// slots a day. An empty company is not a company.
//
// Written as an EXEMPT list, not an applies-to list, so an unknown or missing
// source still gets the cap. A guard that skips when it is unsure is not a guard.
const PER_COMPANY_EXEMPT_SOURCES = new Set(['referral', 'influencer']);
function perCompanyApplies(source, company) {
  if (!String(company || '').trim()) return false;
  return !PER_COMPANY_EXEMPT_SOURCES.has(source);
}

export function canContact({ timeline = [], channel = 'email', source = '', company = '', companyTouches = 0, canInfluence, inmail = {}, policy = {}, now = new Date() } = {}) {
  const p = normalizedPolicy(policy);
  if (p.enabled === false) return { allowed: true, blocks: [], nextEligible: null };
  const events = Array.isArray(timeline) ? timeline : [];
  const today = now.toISOString().slice(0, 10);
  const wanted = channelKey(channel);
  const sent = events.filter(e => e.direction === 'Sent');
  const blocks = [];
  const timed = [];

  // Touches that anchor the message-gap clock on a channel. A LinkedIn connection
  // request is NOT a message touch: it is a request to connect, and the follow-up
  // clock starts when they ACCEPT, not when the invite is sent. So invites are
  // excluded here — they neither start the gap nor advance the widening touch count.
  // (A pending invite is instead held by the invitePending rule below; a mis-tagged
  // invite stored on the email channel therefore stops inflating the email count.)
  const channelSent = (ch) => sent
    .filter(e => !isLinkedInInvite(e.subject))
    .filter(e => channelKey(e.channel || (isLinkedInEntry(e) ? 'linkedin' : 'email')) === ch);

  // Newest outbound touch on one channel. Sorted defensively: the enforcement
  // timeline arrives ascending, but this must not silently read the wrong message
  // if a caller ever hands over an unsorted array.
  const newestOn = (ch) => channelSent(ch)
    .map(e => e.at || e.timestamp)
    .filter(Boolean)
    .sort()
    .at(-1);

  // Required gap before the NEXT touch on this channel. With a schedule set, the
  // gap widens with the number of prior touches already sent on this channel: the
  // 2nd touch waits schedule[0], the 3rd schedule[1], and the last entry repeats
  // for everything after. Without a schedule it is the flat minDaysBetweenTouches,
  // which is exactly the pre-schedule behavior.
  const schedule = Array.isArray(p.touchGapSchedule) && p.touchGapSchedule.length ? p.touchGapSchedule : null;
  const gapFor = (ch) => {
    if (!schedule) return p.minDaysBetweenTouches;
    const prior = channelSent(ch).length; // touches already on this channel; next is prior+1
    return schedule[Math.min(Math.max(prior - 1, 0), schedule.length - 1)];
  };

  // A 'both' row means "reach this person somehow", so it is blocked on the gap
  // rule only when EVERY channel is inside the window. One clear channel is still
  // actionable. Treating 'both' as "no channel to check" would have exempted
  // dual-channel contacts from the minimum gap entirely, which is the opposite of
  // the intent: those are the high-value people most at risk of being over-worked.
  const gapChannels = wanted === 'both' ? ['linkedin', 'email'] : [wanted];
  const gapHits = gapChannels
    .map(ch => ({ ch, at: newestOn(ch), gap: gapFor(ch) }))
    .filter(hit => hit.at && day(hit.at) && today < addDays(hit.at, hit.gap));

  if (gapHits.length === gapChannels.length && gapHits.length > 0) {
    // Report the channel that frees up first, so nextEligible is the soonest the
    // person can be reached at all rather than the last channel to clear.
    const soonest = gapHits
      .map(hit => ({ ...hit, until: addDays(hit.at, hit.gap) }))
      .sort((a, b) => a.until.localeCompare(b.until))[0];
    const elapsed = Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day(soonest.at)}T00:00:00Z`)) / DAY_MS));
    const where = wanted === 'both' ? 'on every channel you have' : 'on this channel';
    // With a schedule active, say which touch this is and why the gap is what it is,
    // so a widening hold (e.g. 6 days before touch 3) does not read as a bug.
    const nextTouchNum = channelSent(soonest.ch).length + 1;
    const cadenceNote = schedule
      ? ` This is touch #${nextTouchNum}, so the gap is ${soonest.gap} day${soonest.gap === 1 ? '' : 's'} (it widens as you follow up more).`
      : '';
    blocks.push({
      rule: 'minDaysBetweenTouches',
      reason: `You messaged them ${elapsed === 0 ? 'today' : `${elapsed} day${elapsed === 1 ? '' : 's'} ago`} ${where}.${cadenceNote}`,
      until: soonest.until,
    });
    timed.push(soonest.until);
  }

  const windowStart = new Date(now.getTime() - 30 * DAY_MS);
  const recentSent = sent.filter(e => {
    const t = Date.parse(e.at || e.timestamp || '');
    return Number.isFinite(t) && t >= windowStart.getTime();
  });
  if (Number.isFinite(p.maxTouchesPer30d) && recentSent.length >= p.maxTouchesPer30d) {
    const sorted = recentSent.map(e => e.at || e.timestamp).sort();
    const until = p.maxTouchesPer30d === 0 ? null : addDays(sorted[sorted.length - p.maxTouchesPer30d], 30);
    blocks.push({ rule: 'maxTouchesPer30d', reason: `You have reached this person ${recentSent.length} times in the last 30 days.`, until });
    if (until) timed.push(until);
  }

  const messages = events.map(e => ({ timestamp: e.at || e.timestamp, direction: e.direction, channel: e.channel, subject: e.subject, body: e.body }));
  const thread = summarizeThread(messages, { now, recentDays: p.awaitingReplyHold });
  if (p.awaitingReplyHold > 0 && thread.recentPitch) {
    const until = addDays(thread.lastSub.timestamp, p.awaitingReplyHold + 1);
    blocks.push({ rule: 'awaitingReplyHold', reason: 'A recent substantive message is still awaiting a reply.', until });
    timed.push(until);
  }

  const capState = outreachCapState(messages, { caps: p.coldOutreachCap });
  if (isChannelCapped(capState, wanted)) blocks.push({ rule: 'coldOutreachCap', reason: 'This channel is blocked until they reply.', until: null });

  const companyCount = Array.isArray(companyTouches) ? companyTouches.length : Number(companyTouches?.count ?? companyTouches) || 0;
  const selfSentToday = !!companyTouches?.selfSentToday;
  const influentialSentToday = !!companyTouches?.influentialSentToday;
  // Already messaged this PERSON today. Applies to every book, and is not the
  // per-company rule despite sharing its name here.
  if (selfSentToday) {
    blocks.push({ rule: 'perCompanyPerDay', reason: 'You already contacted this person today.', until: addDays(today, 1) });
  } else if (perCompanyApplies(source, company) && companyCount >= p.perCompanyPerDay) {
    blocks.push({ rule: 'perCompanyPerDay', reason: `You have already contacted ${companyCount} people at this company today.`, until: addDays(today, 1) });
  }

  // Deliberately asymmetric: reaching a decision-maker holds a later gatekeeper
  // until tomorrow, but reaching a gatekeeper must never delay the person who can
  // actually decide. Protecting a process note is not worth spending the motion.
  if (influentialSentToday && canInfluence === false && perCompanyApplies(source, company)) {
    blocks.push({
      rule: 'sameDayStakeholderGap',
      reason: 'You reached a decision-maker at this company today. This one can wait a day.',
      until: addDays(today, 1),
    });
  }

  if (wanted === 'linkedin' && inmail.alreadyInvited && inmail.exhausted && !inmail.freeDm) {
    blocks.push({ rule: 'inmailBudget', reason: 'No InMail credits remain for this LinkedIn message.', until: null });
  }
  // Preserve the scarce tail of the allowance for contacts who can move the
  // hiring decision instead of spending it on whichever gatekeeper appears first.
  if (wanted === 'linkedin' && inmail.alreadyInvited && !inmail.freeDm && !inmail.exhausted &&
      Number.isFinite(inmail.remaining) && inmail.remaining <= p.inmailReserveFloor && inmail.canInfluence === false) {
    blocks.push({ rule: 'inmailReserve', reason: 'Saving the last InMail credits for people who can move the decision.', until: null });
  }

  const permanent = blocks.some(b => b.until == null);
  const nextEligible = blocks.length === 0 || permanent ? null : timed.concat(blocks.map(b => b.until).filter(Boolean)).sort().at(-1) || null;
  return { allowed: blocks.length === 0, blocks, nextEligible };
}

export function logOutreachOverride({ contactRef, channel, blocks, now = new Date() }) {
  const file = path.join(DATA_DIR, 'outreach-overrides.tsv');
  if (!fs.existsSync(file)) fs.writeFileSync(file, 'timestamp\tcontact_ref\tchannel\trules\n', 'utf8');
  const clean = value => String(value || '').replace(/[\t\r\n]/g, ' ');
  const rules = (blocks || []).map(b => b.rule).join(',');
  fs.appendFileSync(file, `${now.toISOString()}\t${clean(contactRef)}\t${clean(channel)}\t${clean(rules)}\n`, 'utf8');
}
