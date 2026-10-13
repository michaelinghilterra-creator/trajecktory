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
import { companyCompatible } from '../../../lib/contact-match.mjs';

const sourceOrder = { influencer: 0, referral: 1, ta: 2, app: 3 };
const normalizeBody = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
const normalizeSubject = value => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();

function personNames(person) {
  const names = [];
  const ta = person?.members?.ta;
  const referral = person?.members?.referral;
  const influencer = person?.members?.influencer;
  if (ta) names.push([ta.first, ta.last].filter(Boolean).join(' '));
  if (referral?.name) names.push(referral.name);
  if (influencer?.name) names.push(influencer.name);
  return names.map(name => String(name).replace(/\([^)]*\)/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function personEmails(person) {
  return Object.values(person?.members || {}).map(row => String(row?.email || '').trim().split(/\s+/)[0].toLowerCase()).filter(email => email.includes('@'));
}

function personCompanies(person) {
  const ta = person?.members?.ta;
  const referral = person?.members?.referral;
  const influencer = person?.members?.influencer;
  return [ta?.company, referral?.where, influencer?.company].map(value => String(value || '').trim()).filter(Boolean);
}

function namesPerson(contact, names) {
  const normalized = String(contact || '').replace(/\([^)]*\)/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (names.includes(normalized)) return true;
  const tokens = normalized.split(' ');
  if (tokens.length < 2) return false;
  return names.some(name => {
    const personTokens = name.split(' ');
    return personTokens.length >= 2 && tokens[0] === personTokens[0] && tokens.at(-1) === personTokens.at(-1);
  });
}

function emailPerson(contact, emails) {
  const value = String(contact || '').trim().toLowerCase();
  const bracketed = value.match(/<([^>]+)>/);
  const email = (bracketed ? bracketed[1] : value).trim().split(/\s+/)[0];
  return email.includes('@') && emails.includes(email);
}

function senderEmail(sender) {
  const value = String(sender || '').trim().toLowerCase();
  const bracketed = value.match(/<([^>]+)>/);
  return (bracketed ? bracketed[1] : value).trim();
}

// An ATS often sends as the same mailbox on a company subdomain
// (pat@recruiting.examplecorp.test for pat@examplecorp.test). Same local part plus
// a subdomain of the person's own domain counts; anything looser does not.
function senderMatches(sender, emails) {
  const address = senderEmail(sender);
  if (emails.includes(address)) return true;
  const [local, domain] = address.split('@');
  if (!local || !domain) return false;
  return emails.some(email => {
    const [personLocal, personDomain] = email.split('@');
    return personLocal === local && Boolean(personDomain) && domain.endsWith(`.${personDomain}`);
  });
}

function noteMessageKind(direction, channel) {
  if (direction === 'Received') return 'reply-received';
  return /linkedin/i.test(String(channel)) ? 'dm-sent' : 'email-sent';
}

function followupChannel(value) {
  const written = String(value || '').trim();
  if (/linkedin/i.test(written)) return { channel: 'LinkedIn', kind: 'dm-sent' };
  if (/^email$/i.test(written)) return { channel: 'Email', kind: 'email-sent' };
  return { channel: written, kind: 'touch-sent' };
}

function calendarDay(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function withinCalendarDays(left, right, days) {
  const leftDay = calendarDay(left);
  const rightDay = calendarDay(right);
  return leftDay != null && rightDay != null && Math.abs(leftDay - rightDay) <= days * 86400000;
}

export function buildApplicationMessages(person, { followups = [], appNotes = {}, apps = [] } = {}) {
  const events = [];
  const names = personNames(person);
  const emails = personEmails(person);
  const companies = personCompanies(person);
  const compatible = company => companies.some(personCompany => companyCompatible(company, personCompany));

  for (const row of followups || []) {
    if ((!namesPerson(row?.contact, names) && !emailPerson(row?.contact, emails)) || !compatible(row?.company)) continue;
    if (/^Cross-logged from/.test(String(row?.notes || ''))) continue;
    const { channel, kind } = followupChannel(row?.channel);
    const appNum = Number(row?.appNum);
    const subjectMatch = String(row?.notes || '').match(/Subject:\s*([^\r\n]*)/i);
    events.push({
      at: row?.date,
      kind,
      direction: 'Sent',
      channel,
      subject: subjectMatch ? subjectMatch[1].trim() : `Follow-up re: ${row?.role || ''} (#${row?.appNum})`,
      body: row?.notes || '',
      store: 'app',
      ref: `app:${appNum}`,
      appNum,
      origin: `followup:${row?.n}`,
    });
  }

  const appsById = new Map((apps || []).map(app => [String(app?.id), app]));
  for (const [appId, notes] of Object.entries(appNotes || {})) {
    const app = appsById.get(String(appId));
    if (!app || !compatible(app.company) || !Array.isArray(notes)) continue;
    const appNum = Number(appId);
    for (const [index, note] of notes.entries()) {
      let event = null;
      if (note?.kind === 'message' && person?.refs?.includes(note.contactRef)) {
        const direction = note.direction || 'Sent';
        const channel = note.channel || 'Email';
        event = {
          at: note.timestamp,
          kind: noteMessageKind(direction, channel),
          direction,
          channel,
          subject: note.subject || '',
          body: note.body ?? note.text ?? '',
        };
      } else if (String(note?.text || '').startsWith('### Reply logged (') && senderMatches(note?.sender, emails)) {
        const lines = String(note.text).split(/\r?\n/);
        const subjectMatch = String(lines[1] || '').match(/:\s(.*?)\s\[/);
        const blankLine = lines.findIndex(line => line === '');
        event = {
          at: note.timestamp,
          kind: 'reply-received',
          direction: 'Received',
          channel: 'Email',
          subject: subjectMatch ? subjectMatch[1].trim() : '',
          body: blankLine >= 0 ? lines.slice(blankLine + 1).join('\n') : '',
        };
      }
      if (!event) continue;
      events.push({ ...event, store: 'app', ref: `app:${appNum}`, appNum, origin: `note:${appId}:${index}` });
    }
  }

  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => String(a.event.at).localeCompare(String(b.event.at)) || a.event.ref.localeCompare(b.event.ref) || a.index - b.index)
    .map(({ event }) => event);
}

export function mergeDisplayTimeline(displayTimeline, appMessages) {
  const existing = displayTimeline || [];
  const kept = (appMessages || []).filter(message => !existing.some(event => {
    const sameDate = String(event.at).slice(0, 10) === String(message.at).slice(0, 10);
    const sameChannel = normalizeSubject(event.channel) === normalizeSubject(message.channel);
    const subject = normalizeSubject(message.subject);
    const sameSubject = subject && subject === normalizeSubject(event.subject);
    if (String(message.origin || '').startsWith('followup:')) {
      if (sameDate && new RegExp(`App #${message.appNum}(?!\\d)`).test(String(event.body || ''))) return true;
      if (event.direction === 'Sent' && sameDate && sameChannel) return true;
    }
    if (event.direction !== message.direction) return false;
    const sameBody = sameChannel && normalizeBody(event.body) === normalizeBody(message.body);
    if (sameDate && (sameSubject || sameBody)) return true;
    return message.direction === 'Received' && sameSubject && withinCalendarDays(event.at, message.at, 7);
  }));
  return [...existing, ...kept]
    .map((event, index) => ({ event, index }))
    .sort((a, b) => String(a.event.at).localeCompare(String(b.event.at)) || sourceOrder[a.event.store] - sourceOrder[b.event.store] || a.index - b.index)
    .map(({ event }) => event);
}

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
