#!/usr/bin/env node
/**
 * gmail-url-safety.test.mjs: unit tests for Gmail message URL construction.
 *
 * WHY THIS EXISTS
 * A message id reaches the Gmail client from an HTTP route parameter, and the
 * resulting request carries the user's OAuth token. These tests prove unsafe
 * path material is rejected before fetch and list query values stay bounded and
 * encoded, without an OAuth token or network access.
 *
 * Run: node tests/gmail-url-safety.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { getMessage, listMessages } from '../dashboard-web/server/lib/google.mjs';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('gmail-url-safety.test.mjs');

const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async url => {
  calls.push(String(url));
  return { ok: true, status: 200, json: async () => ({ messages: [] }) };
};

try {
  const validId = '18f0Abc_def-123';
  calls.length = 0;
  await getMessage({ id: validId, accessToken: 'invented-token' });
  check(calls.length === 1 && calls[0] === `${GMAIL_BASE}/messages/${validId}?format=full`,
    'a well-formed message id produces the exact Gmail message URL');

  const unsafeIds = [
    '../../../../drive/v3/files',
    '..%2f..%2fprofile',
    'abc?alt=media',
    'abc#frag',
    'abc/def',
    'abc.def',
    'has space',
    '',
    null,
    undefined,
    'a'.repeat(200),
  ];
  for (const id of unsafeIds) {
    calls.length = 0;
    let error = null;
    try {
      await getMessage({ id, accessToken: 'invented-token' });
    } catch (caught) {
      error = caught;
    }
    check(error instanceof Error, `rejects unsafe message id fixture ${unsafeIds.indexOf(id) + 1}`);
    check(error?.message === 'Gmail get failed (bad message id)',
      `does not echo unsafe message id fixture ${unsafeIds.indexOf(id) + 1}`);
    check(calls.length === 0, `rejects unsafe message id fixture ${unsafeIds.indexOf(id) + 1} before fetch`);
  }

  for (const max of ['50&alt=media', NaN, 0, -1, 1e9, 'abc']) {
    calls.length = 0;
    await listMessages({ q: '', max, accessToken: 'invented-token' });
    const url = new URL(calls[0]);
    const value = url.searchParams.get('maxResults');
    const numeric = Number(value);
    check(calls.length === 1 && /^\d+$/.test(value) && numeric >= 1 && numeric <= 500,
      `normalizes max fixture ${String(max)} to a bounded integer`);
    check(!url.searchParams.has('alt'), `max fixture ${String(max)} cannot inject a query parameter`);
  }

  calls.length = 0;
  const query = 'from:person@example.test project & update';
  await listMessages({ q: query, accessToken: 'invented-token' });
  check(calls.length === 1
    && calls[0].includes('q=from%3Aperson%40example.test%20project%20%26%20update')
    && new URL(calls[0]).searchParams.get('q') === query,
  'encodes a Gmail query containing a space and an ampersand');
} finally {
  globalThis.fetch = originalFetch;
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
