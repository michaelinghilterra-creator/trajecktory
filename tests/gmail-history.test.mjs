#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';
import { localStamp } from '../lib/local-date.mjs';

const sandbox = makeSandbox('gmail-history');
process.env.TJK_DATA_DIR = sandbox;
process.env.GOOGLE_CLIENT_ID = 'invented-client';
process.env.GOOGLE_CLIENT_SECRET = 'invented-secret';

const selfEmail = 'example.owner@example.test';
const personEmail = 'example.personone@example.test';

function raw({ id, threadId = 'thread1', from, to = selfEmail, subject = 'Hello', date, text = 'New content', snippet = 'Snippet' }) {
  return {
    id,
    threadId,
    snippet,
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: from },
        { name: 'To', value: to },
        { name: 'Subject', value: subject },
        { name: 'Date', value: date },
      ],
      body: { data: Buffer.from(text).toString('base64url') },
    },
  };
}

const { stripQuotedReply } = await import('../dashboard-web/server/lib/google.mjs');
const { findHistory } = await import('../dashboard-web/server/lib/gmail-history.mjs');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

console.log('gmail-history.test.mjs');

check(stripQuotedReply('Fresh answer\n\nOn Monday, April 7, 2025 wrote:\nOld answer') === 'Fresh answer',
  'quoted reply introduced by On wrote is removed');
check(stripQuotedReply('Fresh answer\n> Old answer') === 'Fresh answer',
  'a quoted block is removed');
check(stripQuotedReply('Fresh answer\n----- Original Message -----\nOld answer') === 'Fresh answer',
  'an original message marker is removed');
check(stripQuotedReply('Fresh answer\nReply directly to this message or click the link\nThanks') === 'Fresh answer\nThanks',
  'Jobvite boilerplate is removed');
check(stripQuotedReply('WARNING - External Email\nFresh answer') === 'Fresh answer',
  'the external email banner is removed');
check(stripQuotedReply('> Only quoted text') === '> Only quoted text',
  'an empty cleaned body falls back to the original');
const longStarted = Date.now();
const longCleaned = stripQuotedReply('x'.repeat(300000));
check(longCleaned.length === 20000 && Date.now() - longStarted < 2000,
  'a long body is capped and finishes quickly');

let capturedQuery = '';
const threadMessages = [
  raw({ id: 'received', from: `Example Personone <${personEmail}>`, date: 'Mon, 7 Apr 2025 09:00:00 -0500' }),
  raw({ id: 'sent', from: `Example Owner <${selfEmail}>`, to: personEmail, date: 'Mon, 7 Apr 2025 10:00:00 -0500' }),
  raw({ id: 'third', from: 'Example Persontwo <example.persontwo@example.test>', date: 'Mon, 7 Apr 2025 11:00:00 -0500' }),
  raw({ id: 'excluded', from: `Example Personone <${personEmail}>`, date: 'Mon, 7 Apr 2025 12:00:00 -0500' }),
  raw({ id: 'automated', from: `Example Personone <${personEmail}>`, subject: 'Reminder: interview', date: 'Mon, 7 Apr 2025 13:00:00 -0500' }),
];
const commonFind = {
  accessToken: 'invented-token',
  selfEmail,
  listImpl: async ({ q }) => { capturedQuery = q; return [{ id: 'listed', threadId: 'thread1' }]; },
  getImpl: async () => { throw new Error('individual fetch should not run'); },
  getThreadImpl: async () => ({ id: 'thread1', messages: threadMessages }),
};

let history = await findHistory({ ...commonFind, name: 'Example Personone', email: personEmail, excludeMsgIds: ['excluded'], afterDate: '2025-03-01' });
check(capturedQuery === `(from:${personEmail} OR to:${personEmail} OR cc:${personEmail}) after:2025/03/01`,
  'email history builds one scoped Gmail query');
check(history.items.some(item => item.msgId === 'sent') && history.items.some(item => item.msgId === 'received'),
  'thread expansion includes both the person message and the self sent reply');
check(!history.items.some(item => item.msgId === 'third'), 'third party messages are dropped');
check(history.items.find(item => item.msgId === 'sent')?.direction === 'Sent'
  && history.items.find(item => item.msgId === 'received')?.direction === 'Received',
  'direction is derived from selfEmail');
check(history.items.find(item => item.msgId === 'automated')?.skip === 'automated',
  'a reminder is marked automated');
check(!history.items.some(item => item.msgId === 'excluded'), 'excluded message ids are removed');
check(history.items.map(item => item.msgId).join(',') === 'received,sent,automated', 'history is sorted oldest first');

await findHistory({ ...commonFind, name: 'Example Personone<script>', email: '', afterDate: '' });
check(capturedQuery === 'from:"Example Persononescript"', 'name only relay search is sanitized and quoted');
history = await findHistory({ ...commonFind, name: '', email: '' });
check(history.items.length === 0 && history.truncated === false, 'no identity returns an empty history');
history = await findHistory({ ...commonFind, name: 'Example Personone', email: personEmail, max: 2 });
check(history.items.length === 2 && history.truncated === true, 'the result is capped and marked truncated');
let badEmailThrew = false;
try { await findHistory({ ...commonFind, email: 'alex@example.test OR from:example.persontwo@example.test' }); } catch { badEmailThrew = true; }
check(badEmailThrew, 'a query bending email address is rejected');

fs.writeFileSync(path.join(sandbox, 'applications.md'),
  '# Applications Tracker\n\n'
  + '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n'
  + '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n'
  + '| 900001 | 2025-04-01 | Zorblax Widgetry | Example Role | 5/5 | Applied | | | | | https://jobs.example.test/900001 |\n',
  'utf8');
fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), JSON.stringify({ 900001: '2025-04-01' }) + '\n');
fs.writeFileSync(path.join(sandbox, 'target-talent.md'),
  `| 900001 | Zorblax Widgetry | Personone | Example | | Talent Lead | | | | | ${personEmail} | | Not Contacted | | | |\n`,
  'utf8');
fs.writeFileSync(path.join(sandbox, 'google-tokens.json'), JSON.stringify({
  refresh_token: 'invented-refresh',
  access_token: 'invented-access',
  expiry_date: Date.now() + 3600000,
  connectedEmail: selfEmail,
  scope: 'https://www.googleapis.com/auth/gmail.readonly',
}) + '\n');

const routeMessages = {
  current: raw({ id: 'current', from: `Example Personone <${personEmail}>`, date: 'Sun, 20 Apr 2025 09:00:00 -0500' }),
  older: raw({ id: 'older', from: `Example Personone <${personEmail}>`, subject: 'Earlier note', date: 'Mon, 7 Apr 2025 08:00:00 -0500', text: 'Earlier received body' }),
  newer: raw({ id: 'newer', from: `Example Owner <${selfEmail}>`, to: personEmail, subject: 'Later note', date: 'Tue, 8 Apr 2025 10:30:00 -0500', text: 'Later sent body' }),
  auto: raw({ id: 'auto', from: `Example Personone <${personEmail}>`, subject: 'Reminder: interview', date: 'Wed, 9 Apr 2025 10:30:00 -0500' }),
};
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const target = String(url);
  if (target.startsWith('http://127.0.0.1:')) return nativeFetch(url, options);
  if (target.includes('/messages?')) return new Response(JSON.stringify({ messages: [{ id: 'listed', threadId: 'route-thread' }] }), { status: 200 });
  if (target.includes('/threads/route-thread?')) {
    return new Response(JSON.stringify({ id: 'route-thread', messages: Object.values(routeMessages) }), { status: 200 });
  }
  const match = target.match(/\/messages\/([A-Za-z0-9_-]{1,128})\?/);
  if (match && routeMessages[match[1]]) return new Response(JSON.stringify(routeMessages[match[1]]), { status: 200 });
  return new Response('invented Gmail failure', { status: 500 });
};

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/google.mjs');
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const post = (route, body) => nativeFetch(`${base}${route}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).then(async response => ({ status: response.status, body: await response.json() }));

try {
  let response = await post('/api/google/history/preview', { msgId: 'current', name: 'Example Personone', email: personEmail, appId: 900001 });
  check(response.status === 200 && response.body.count === 2 && response.body.skipped === 1,
    'preview returns kept and skipped counts');
  check(response.body.items.every(item => !Object.hasOwn(item, 'body')),
    'preview never returns message bodies');

  response = await post('/api/google/history/backfill', { personRef: 'ta:900001', appId: 900001, msgIds: ['newer', 'missing', 'older', 'auto'] });
  check(response.status === 200 && response.body.logged === 2 && response.body.skipped === 1
    && response.body.failed.length === 1 && response.body.failed[0].msgId === 'missing',
  'backfill continues after a Gmail failure and skips automated mail');
  const correspondencePath = path.join(sandbox, 'target-talent-correspondence', '900001.md');
  const correspondence = fs.readFileSync(correspondencePath, 'utf8');
  // The expected stamps follow the machine's own timezone, so this passes on any runner.
  const olderStamp = localStamp(new Date('Mon, 7 Apr 2025 08:00:00 -0500'));
  const newerStamp = localStamp(new Date('Tue, 8 Apr 2025 10:30:00 -0500'));
  check(correspondence.includes(olderStamp) && correspondence.includes(newerStamp)
    && correspondence.indexOf(olderStamp) < correspondence.indexOf(newerStamp),
    'backfill logs oldest first with original local stamps');

  response = await post('/api/google/history/backfill', { personRef: 'ta:900001', appId: 900001, msgIds: ['older', 'newer'] });
  check(response.status === 200 && response.body.logged === 0 && response.body.duplicates === 2,
    'the same backfill is idempotent and reports duplicates');

  const badInputs = [
    { personRef: 'person:1', appId: 900001, msgIds: ['older'] },
    { personRef: 'ta:900001', appId: 0, msgIds: ['older'] },
    { personRef: 'ta:900001', appId: 900001, msgIds: [] },
  ];
  const badResponses = await Promise.all(badInputs.map(body => post('/api/google/history/backfill', body)));
  check(badResponses.every(item => item.status === 400), 'backfill rejects each invalid input shape with 400');
} finally {
  await new Promise(resolve => server.close(resolve));
  globalThis.fetch = nativeFetch;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0)
