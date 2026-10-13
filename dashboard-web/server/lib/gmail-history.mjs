import { classifyReplyAutomation } from '../../../lib/reply-guards.mjs';
import { localStamp } from '../../../lib/local-date.mjs';
import {
  extractEmail,
  getMessage,
  getThread,
  listMessages,
  parseFromHeader,
  parseGmailMessage,
  stripQuotedReply,
} from './google.mjs';

const PLAIN_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}$/;

function same(value, expected) {
  return !!expected && String(value || '').trim().toLowerCase() === String(expected).trim().toLowerCase();
}

export function buildHistoryItem({ raw, selfEmail, name = '', email = '', requireParticipant = true } = {}) {
  const parsed = parseGmailMessage(raw);
  const from = parseFromHeader(parsed.from);
  const fromEmail = from.address || extractEmail(parsed.from) || '';
  const fromPerson = same(fromEmail, email) || same(from.name, name);
  const fromSelf = same(fromEmail, selfEmail);
  if (requireParticipant && !fromPerson && !fromSelf) return null;

  const parsedDate = new Date(parsed.date);
  let skip = null;
  if (Number.isNaN(parsedDate.getTime())) skip = 'no_date';
  const body = stripQuotedReply(parsed.text);
  const automated = classifyReplyAutomation({ subject: parsed.subject, body }) !== 'human'
    || (/@[^@]{0,220}onmicrosoft\.com$/i.test(fromEmail)
      && (/^Reminder:/i.test(parsed.subject) || /^Interview -/i.test(parsed.subject)));
  if (automated && !skip) skip = 'automated';

  return {
    msgId: parsed.id,
    threadId: parsed.threadId,
    direction: fromSelf ? 'Sent' : 'Received',
    date: parsed.date,
    stamp: Number.isNaN(parsedDate.getTime()) ? null : localStamp(parsedDate),
    subject: parsed.subject,
    snippet: parsed.snippet,
    body,
    skip,
  };
}

async function mapConcurrent(values, limit, mapper) {
  const results = new Array(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await mapper(values[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length || 1) }, worker));
  return results;
}

export async function findHistory({
  accessToken,
  selfEmail,
  name,
  email,
  excludeMsgIds = [],
  afterDate,
  listImpl = listMessages,
  getImpl = getMessage,
  getThreadImpl = getThread,
  max = 60,
} = {}) {
  void getImpl;
  const cleanEmail = String(email || '').trim();
  const sanitizedName = String(name || '').replace(/[^A-Za-z0-9 .'@_+-]/g, '').replaceAll('"', '').trim();
  if (cleanEmail && !PLAIN_EMAIL.test(cleanEmail)) throw new Error('Invalid email address');
  if (!cleanEmail && !sanitizedName) return { items: [], truncated: false };

  let q = cleanEmail
    ? `(from:${cleanEmail} OR to:${cleanEmail} OR cc:${cleanEmail})`
    : `from:"${sanitizedName}"`;
  if (afterDate && /^\d{4}-\d{2}-\d{2}$/.test(String(afterDate))) {
    q += ` after:${String(afterDate).replaceAll('-', '/')}`;
  }

  const listed = await listImpl({ q, accessToken, max: 100 });
  const threadIds = [...new Set(listed.map(item => item.threadId).filter(Boolean))].slice(0, 30);
  const threads = await mapConcurrent(threadIds, 5, id => getThreadImpl({ id, accessToken }));
  const excluded = new Set(excludeMsgIds.map(String));
  const items = [];
  for (const thread of threads) {
    for (const raw of thread?.messages || []) {
      if (excluded.has(String(raw?.id))) continue;
      const item = buildHistoryItem({ raw, selfEmail, name: sanitizedName, email: cleanEmail });
      if (item) items.push(item);
    }
  }

  items.sort((left, right) => {
    const leftTime = Date.parse(left.date);
    const rightTime = Date.parse(right.date);
    const safeLeft = Number.isNaN(leftTime) ? Number.MAX_SAFE_INTEGER : leftTime;
    const safeRight = Number.isNaN(rightTime) ? Number.MAX_SAFE_INTEGER : rightTime;
    return safeLeft - safeRight;
  });
  const boundedMax = Math.max(0, Math.trunc(Number(max) || 0));
  return { items: items.slice(0, boundedMax), truncated: items.length > boundedMax };
}
