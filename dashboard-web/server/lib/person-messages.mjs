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

export function logPersonMessage({
  personRef,
  appNum,
  direction = 'Sent',
  channel = 'Email',
  subject,
  body,
  today = localToday(),
  stamp = localStamp(),
} = {}) {
  const match = /^(ta|referral):(\d+)$/.exec(String(personRef || ''));
  if (!match) throw codedError('BAD_PERSON', 'personRef must identify an existing TA or referral person');

  const cleanSubject = String(subject || '').trim();
  const cleanBody = String(body || '').trim();
  if (!['Sent', 'Received'].includes(direction)) throw codedError('BAD_INPUT', 'direction must be Sent or Received');
  if (!cleanSubject || !cleanBody) throw codedError('BAD_INPUT', 'subject and body required');

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
  const name = personName(personRef, taRows, referralRows)
    || (source === 'ta' ? `${row.first || ''} ${row.last || ''}`.trim() : row.name || '');
  const entry = { timestamp: stamp, direction, channel: normalizedChannel, subject: cleanSubject, body: cleanBody };
  const link = source === 'referral' ? resolveReferralLink(row, taRows) : null;
  let result = { ok: true, personRef, linkedTo: link ? `ta:${link.contact.id}` : null, followupN: null };

  const save = () => {
    if (source === 'ta') {
      const messages = readTTCorrespondence(id);
      messages.push(entry);
      writeTTCorrespondence(id, messages);
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
    } else {
      if (link) {
        const messages = readTTCorrespondence(link.contact.id);
        messages.push(entry);
        writeTTCorrespondence(link.contact.id, messages);
        updateTTLine(link.contact.id, { lastTouch: today });
      } else {
        const messages = readReferralCorrespondence(id);
        messages.push(entry);
        writeReferralCorrespondence(id, messages);
      }
      const updates = { lastTouch: today };
      if (row.status === 'Not Asked' || !row.status) updates.status = 'Catching Up';
      else if (direction === 'Received' && row.status === 'Asked') updates.status = 'Responded';
      updateReferralLine(id, updates);
    }

    if (direction === 'Sent' && app) {
      result = {
        ...result,
        followupN: appendFollowupRow({
          appNum: app.id,
          date: today,
          company: app.company,
          role: app.role,
          channel: normalizedChannel,
          contact: name,
          notes: `Cross-logged from person card · Subject: ${cleanSubject}`,
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
