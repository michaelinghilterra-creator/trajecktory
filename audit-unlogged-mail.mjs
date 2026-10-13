#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import {
  getAccessToken,
  listMessages,
  getMessage,
  parseGmailMessage,
} from './dashboard-web/server/lib/google.mjs';
import { parseTargetTalentMd, readTTCorrespondence } from './dashboard-web/server/lib/target-talent.mjs';
import {
  parseReferralsMd,
  readReferralCorrespondence,
  resolveReferralLink,
} from './dashboard-web/server/lib/referrals.mjs';
import { parseFollowupsMd } from './dashboard-web/server/lib/followups.mjs';
import { readAppNotes } from './dashboard-web/server/lib/notes.mjs';
import { senderMatches } from './dashboard-web/server/lib/contact-timeline.mjs';

const DAY_MS = 86400000;
const MAX_PER_QUERY = 500;
const MESSAGE_CONCURRENCY = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];
const METADATA_HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date'];

const defaultReaders = {
  readTa: parseTargetTalentMd,
  readReferrals: parseReferralsMd,
  readTaCorrespondence: readTTCorrespondence,
  readReferralCorrespondence,
  readFollowups: parseFollowupsMd,
  readAppNotes,
  resolveReferralLink,
  listMessages,
  getMessage,
  parseMessage: parseGmailMessage,
};

function localDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultSince(now) {
  const date = new Date(now instanceof Date ? now.getTime() : now);
  date.setDate(date.getDate() - 30);
  return localDate(date);
}

function normalizeEmail(value) {
  return String(value || '')
    .replace(/\s*\[v:[^\]]*\]/gi, '')
    .trim()
    .toLowerCase();
}

function addresses(value) {
  return [...String(value || '').matchAll(/[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,255}\.[a-z]{2,24}/gi)]
    .map(match => match[0].toLowerCase());
}

function rawHeader(raw, name) {
  const headers = raw?.payload?.headers || [];
  return headers.find(header => String(header?.name || '').toLowerCase() === name.toLowerCase())?.value || '';
}

function calendarDay(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function withinOneDay(left, right) {
  const leftDay = calendarDay(left);
  const rightDay = calendarDay(right);
  return leftDay !== null && rightDay !== null && Math.abs(leftDay - rightDay) <= DAY_MS;
}

function normalizedName(value) {
  return String(value || '').replace(/\([^)]*\)/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim();
}

function namesPerson(contact, name) {
  const candidate = normalizedName(contact);
  const person = normalizedName(name);
  if (!candidate || !person) return false;
  if (candidate === person) return true;
  const candidateTokens = candidate.split(' ');
  const personTokens = person.split(' ');
  return candidateTokens.length >= 2
    && personTokens.length >= 2
    && candidateTokens[0] === personTokens[0]
    && candidateTokens.at(-1) === personTokens.at(-1);
}

function contactIndex(taRows, referralRows) {
  const index = new Map();
  const add = (email, person) => {
    const clean = normalizeEmail(email);
    if (!clean.includes('@')) return;
    if (!index.has(clean)) index.set(clean, []);
    index.get(clean).push(person);
  };
  for (const row of taRows) {
    add(row.email, {
      source: 'ta', id: row.id, ref: `ta:${row.id}`,
      name: [row.first, row.last].filter(Boolean).join(' ').trim(),
      company: row.company || '', row,
    });
  }
  for (const row of referralRows) {
    add(row.email, {
      source: 'referral', id: row.id, ref: `referral:${row.id}`,
      name: row.name || '', company: row.where || '', row,
    });
  }
  return index;
}

function matchingPeople(address, index) {
  const clean = normalizeEmail(address);
  const matches = [];
  for (const [email, people] of index) {
    if (senderMatches(clean, [email])) matches.push(...people);
  }
  return matches;
}

function noteHasMessageId(appNotes, messageId) {
  if (!messageId) return false;
  return Object.values(appNotes || {}).some(notes => Array.isArray(notes)
    && notes.some(note => String(note?.msgId || '') === String(messageId)));
}

function correspondenceFor(person, taRows, readers) {
  if (person.source === 'ta') return readers.readTaCorrespondence(person.id) || [];
  const own = readers.readReferralCorrespondence(person.id) || [];
  const twin = readers.resolveReferralLink(person.row, taRows);
  if (!twin?.contact?.id) return own;
  return [...own, ...(readers.readTaCorrespondence(twin.contact.id) || [])];
}

function isLogged({ person, direction, date, messageId, taRows, followups, appNotes, readers }) {
  if (correspondenceFor(person, taRows, readers).some(entry => (
    entry?.direction === direction && withinOneDay(entry?.timestamp, date)
  ))) return true;
  if (direction === 'Sent' && followups.some(row => namesPerson(row?.contact, person.name)
    && withinOneDay(row?.date, date))) return true;
  return direction === 'Received' && noteHasMessageId(appNotes, messageId);
}

async function listQuery(query, accessToken, fetchImpl, listImpl) {
  const found = [];
  let pageToken = '';
  const seenTokens = new Set();
  do {
    let nextPageToken = '';
    const pageFetch = async (url, init) => {
      const requestUrl = new URL(url);
      if (pageToken) requestUrl.searchParams.set('pageToken', pageToken);
      const response = await fetchImpl(requestUrl.toString(), init);
      return {
        ok: response.ok,
        status: response.status,
        text: () => response.text(),
        json: async () => {
          const body = await response.json();
          nextPageToken = String(body?.nextPageToken || '');
          return body;
        },
      };
    };
    const page = await listImpl({
      q: query,
      accessToken,
      max: MAX_PER_QUERY - found.length,
      fetchImpl: pageFetch,
    });
    found.push(...(page || []).slice(0, MAX_PER_QUERY - found.length));
    if (!nextPageToken || found.length >= MAX_PER_QUERY || seenTokens.has(nextPageToken)) break;
    seenTokens.add(nextPageToken);
    pageToken = nextPageToken;
  } while (found.length < MAX_PER_QUERY);
  return found;
}

function retryableQuotaError(error) {
  const status = Number(error?.status) || Number(String(error?.message || '').match(/\((\d{3})\)/)?.[1]);
  if (status === 429) return true;
  if (status !== 403) return false;
  const detail = `${error?.body || ''} ${error?.message || ''}`;
  return /rateLimitExceeded|quota/i.test(detail);
}

async function fetchMessage(item, { accessToken, fetchImpl, getImpl, sleep }) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await getImpl({
        id: item.id,
        accessToken,
        fetchImpl,
        format: 'metadata',
        metadataHeaders: METADATA_HEADERS,
      });
    } catch (error) {
      if (!retryableQuotaError(error) || attempt === RETRY_DELAYS_MS.length) return null;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  return null;
}

async function mapConcurrent(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function runAudit({
  since,
  fetchImpl = fetch,
  getToken = getAccessToken,
  now = new Date(),
  readers = {},
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const source = { ...defaultReaders, ...readers };
  const sinceDate = since || defaultSince(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDate) || localDate(`${sinceDate}T12:00:00`) !== sinceDate) {
    throw new Error('since must be a valid date in YYYY-MM-DD format');
  }

  const taRows = source.readTa() || [];
  const referralRows = source.readReferrals() || [];
  const followups = source.readFollowups() || [];
  const appNotes = source.readAppNotes() || {};
  const index = contactIndex(taRows, referralRows);
  const accessToken = await getToken({ fetchImpl });
  const queries = [
    { direction: 'Sent', query: `in:sent after:${sinceDate}` },
    { direction: 'Received', query: `in:inbox after:${sinceDate}` },
  ];
  const missing = [];
  let checked = 0;
  let unchecked = 0;

  for (const { direction, query } of queries) {
    const messageIds = await listQuery(query, accessToken, fetchImpl, source.listMessages);
    const messages = await mapConcurrent(messageIds, MESSAGE_CONCURRENCY, item => (
      fetchMessage(item, { accessToken, fetchImpl, getImpl: source.getMessage, sleep })
    ));
    for (const raw of messages) {
      if (!raw) {
        unchecked++;
        continue;
      }
      const message = source.parseMessage(raw);
      const date = localDate(message.date || (raw?.internalDate ? Number(raw.internalDate) : ''));
      const candidates = direction === 'Sent'
        ? addresses([message.to, rawHeader(raw, 'Cc')].filter(Boolean).join(', '))
        : addresses(message.from);
      const people = new Map();
      for (const address of candidates) {
        for (const person of matchingPeople(address, index)) people.set(person.ref, person);
      }
      for (const person of people.values()) {
        checked++;
        if (isLogged({
          person, direction, date, messageId: message.id || raw?.id,
          taRows, followups, appNotes, readers: source,
        })) continue;
        missing.push({
          date,
          direction,
          person: person.name,
          ref: person.ref,
          company: person.company,
          subject: message.subject || '',
        });
      }
    }
  }

  missing.sort((a, b) => b.date.localeCompare(a.date)
    || a.person.localeCompare(b.person)
    || a.ref.localeCompare(b.ref));
  return { checked, unchecked, missing };
}

function printTable(result) {
  console.log('date | direction | person (ref) | company | subject');
  console.log('--- | --- | --- | --- | ---');
  for (const row of result.missing) {
    const clean = value => String(value || '').replace(/[|\r\n]+/g, ' ').trim();
    console.log(`${clean(row.date)} | ${clean(row.direction)} | ${clean(row.person)} (${clean(row.ref)}) | ${clean(row.company)} | ${clean(row.subject)}`);
  }
  console.log(`${result.checked} messages to/from known contacts checked, ${result.missing.length} not logged, ${result.unchecked} unchecked`);
}

async function main(argv = process.argv.slice(2)) {
  let since;
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') json = true;
    else if (arg === '--since') since = argv[++index];
    else throw new Error('Usage: node audit-unlogged-mail.mjs [--since YYYY-MM-DD] [--json]');
  }
  const result = await runAudit({ since });
  if (json) console.log(JSON.stringify(result, null, 2));
  else printTable(result);
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
  }
}
