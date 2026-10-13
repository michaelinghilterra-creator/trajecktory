import { DATA_DIR } from '../config.mjs';
import { parseApplicationsMd } from './applications.mjs';
import { resolvePeople } from './contact-identity.mjs';
import { readPins } from './contact-links.mjs';
import { appendFollowupRow } from './followups.mjs';
import {
  parseReferralsMd,
  readReferralCorrespondence,
  resolveReferralLink,
  updateReferralLine,
  writeReferralCorrespondence,
} from './referrals.mjs';
import {
  matchByCompany,
  parseTargetTalentMd,
  readTTCorrespondence,
  updateTTLine,
  writeTTCorrespondence,
} from './target-talent.mjs';
import { applyTargetTalentCorrespondenceSideEffects } from './target-talent-correspondence.mjs';
import { classifyInbound } from '../../../lib/inbound-classify.mjs';
import { localStamp, localToday } from '../../../lib/local-date.mjs';
import { logWritesEnabled, withLogWrite } from '../../../lib/log-writes.mjs';

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function personName(personRef, taRows, referralRows) {
  const person = resolvePeople({
    ta: taRows,
    referrals: referralRows,
    influencers: [],
    pins: readPins(),
  }).find(item => item.refs.includes(personRef));
  return person?.name || '';
}

function validateBackfillStamp(sentAt) {
  const value = String(sentAt || '');
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) throw codedError('BAD_INPUT', 'sentAt must be a local timestamp in YYYY-MM-DD HH:MM format');
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, 0, 0);
  if (date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
    || date.getHours() !== hour
    || date.getMinutes() !== minute) {
    throw codedError('BAD_INPUT', 'sentAt must be a real local calendar date and time');
  }
  if (value > localStamp()) throw codedError('BAD_INPUT', 'sentAt cannot be later than now');
  return value;
}

function laterLastTouch(current, candidate) {
  return !current || candidate > current ? candidate : current;
}

function isDuplicateBackfill(messages, entry) {
  const subject = entry.subject.trim().toLowerCase();
  // Same minute, not just the same day: two real replies in one thread share a
  // subject and a date, and only an exact send time says they are one message.
  const minute = entry.timestamp.slice(0, 16);
  return messages.some(message => String(message.timestamp || '').slice(0, 16) === minute
    && message.direction === entry.direction
    && String(message.subject || '').trim().toLowerCase() === subject);
}

export function logPersonMessage({
  personRef,
  appNum,
  direction = 'Sent',
  channel = 'Email',
  subject,
  body,
  today = localToday(),
  stamp = localStamp(),
  backfill = false,
  sentAt,
  withFollowup = true,
} = {}) {
  const match = /^(ta|referral):(\d+)$/.exec(String(personRef || ''));
  if (!match) throw codedError('BAD_PERSON', 'personRef must identify an existing TA or referral person');

  const cleanSubject = String(subject || '').trim();
  const cleanBody = String(body || '').trim();
  if (!['Sent', 'Received'].includes(direction)) throw codedError('BAD_INPUT', 'direction must be Sent or Received');
  if (!cleanSubject || !cleanBody) throw codedError('BAD_INPUT', 'subject and body required');
  const backfillStamp = backfill ? validateBackfillStamp(sentAt) : null;
  const touchDate = backfill ? backfillStamp.slice(0, 10) : today;

  const normalizedChannel = channel === 'LinkedIn' ? 'LinkedIn' : 'Email';
  const id = Number(match[2]);
  const source = match[1];
  const taRows = parseTargetTalentMd();
  const referralRows = parseReferralsMd();
  const row = source === 'ta'
    ? taRows.find(item => item.id === id)
    : referralRows.find(item => item.id === id);
  if (!row) throw codedError('BAD_PERSON', `Person ${personRef} not found`);

  const appId = parseInt(appNum, 10);
  const app = Number.isFinite(appId) ? parseApplicationsMd().find(item => item.id === appId) : null;
  const person = resolvePeople({
    ta: taRows,
    referrals: referralRows,
    influencers: [],
    pins: readPins(),
  }).find(item => item.refs.includes(personRef));
  const memberCompanies = [person?.members.ta?.company, person?.members.referral?.where]
    .filter(Boolean)
    .map(company => ({ company }));
  if (app && matchByCompany(memberCompanies, app.company, member => member.company).length === 0) {
    throw codedError('BAD_INPUT', "That person is not at this application's company");
  }
  const name = personName(personRef, taRows, referralRows)
    || (source === 'ta' ? `${row.first || ''} ${row.last || ''}`.trim() : row.name || '');
  const entry = { timestamp: backfill ? backfillStamp : stamp, direction, channel: normalizedChannel, subject: cleanSubject, body: cleanBody };
  const link = source === 'referral' ? resolveReferralLink(row, taRows) : null;
  let result = {
    ok: true,
    personRef,
    linkedTo: link ? `ta:${link.contact.id}` : null,
    followupN: null,
    ...(backfill ? { backfilled: true } : {}),
  };

  const save = () => {
    if (source === 'ta') {
      const messages = readTTCorrespondence(id);
      if (backfill && isDuplicateBackfill(messages, entry)) {
        return { ok: true, skipped: 'duplicate', personRef };
      }
      messages.push(entry);
      writeTTCorrespondence(id, messages);
      if (backfill) {
        updateTTLine(id, { lastTouch: laterLastTouch(row.lastTouch, touchDate) });
      } else {
        const stages = { 'Not Contacted': 0, '': 0, Drafted: 1, Sent: 2, Replied: 3, 'Meeting Scheduled': 4, Connected: 5 };
        const current = stages[row.status || ''] ?? 0;
        const isHumanReply = direction === 'Received' && classifyInbound(entry) === 'human';
        let status = row.status;
        if (direction === 'Sent' && current < 2) status = 'Sent';
        else if (isHumanReply && current < 3) status = 'Replied';
        updateTTLine(id, { status, lastTouch: today });
        applyTargetTalentCorrespondenceSideEffects({
          contact: row,
          id,
          message: entry,
          isHumanReply,
          today,
        });
      }
    } else {
      if (link) {
        const messages = readTTCorrespondence(link.contact.id);
        if (backfill && isDuplicateBackfill(messages, entry)) {
          return { ok: true, skipped: 'duplicate', personRef };
        }
        messages.push(entry);
        writeTTCorrespondence(link.contact.id, messages);
        updateTTLine(link.contact.id, {
          lastTouch: backfill ? laterLastTouch(link.contact.lastTouch, touchDate) : today,
        });
      } else {
        const messages = readReferralCorrespondence(id);
        if (backfill && isDuplicateBackfill(messages, entry)) {
          return { ok: true, skipped: 'duplicate', personRef };
        }
        messages.push(entry);
        writeReferralCorrespondence(id, messages);
      }
      const updates = { lastTouch: backfill ? laterLastTouch(row.lastTouch, touchDate) : today };
      if (!backfill && (row.status === 'Not Asked' || !row.status)) updates.status = 'Catching Up';
      else if (!backfill && direction === 'Received' && row.status === 'Asked') updates.status = 'Responded';
      updateReferralLine(id, updates);
    }

    if (direction === 'Sent' && app && (!backfill || withFollowup !== false)) {
      result = {
        ...result,
        followupN: appendFollowupRow({
          appNum: app.id,
          date: touchDate,
          company: app.company,
          role: app.role,
          channel: normalizedChannel,
          contact: name,
          notes: `Cross-logged from person card · Subject: ${cleanSubject}${backfill ? ' · backfilled' : ''}`,
        }),
      };
    }
    return result;
  };

  if (!logWritesEnabled(DATA_DIR)) return save();
  try {
    return withLogWrite(DATA_DIR, save);
  } catch (error) {
    error.personMessageResult = result;
    throw error;
  }
}
