#!/usr/bin/env node
/**
 * Mount the real posts router against an isolated posts store. Buffer's GraphQL
 * API is stubbed so the suite needs no key, no network, and no real posts.
 *
 * Buffer publishes on its own schedule, so the metrics sync is the only place
 * the tracker learns a post went out. A sync that pulls metrics but leaves the
 * status alone shows published posts as scheduled forever.
 */

import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('buffer-sync-status');
process.env.TJK_DATA_DIR = sandbox;

fs.writeFileSync(path.join(sandbox, 'buffer-token.json'), JSON.stringify({ token: 'test-token' }), 'utf8');

const post = (id, status, bufferId) => ({
  id, title: id, text: `Example post ${id}`, lane: 'professional', channel: 'linkedin',
  status, scheduledFor: '2026-01-06T14:00:00.000Z', buffer: { id: bufferId },
});
const postsFile = path.join(sandbox, 'posts.json');
fs.writeFileSync(postsFile, JSON.stringify({
  version: 1,
  posts: [
    post('p_sent', 'scheduled', 'b_sent'),
    post('p_pending', 'scheduled', 'b_pending'),
    post('p_sent_empty', 'scheduled', 'b_sent_empty'),
    post('p_already', 'published', 'b_already'),
    post('p_gone', 'scheduled', 'b_gone'),
  ],
  activity: [],
}, null, 2), 'utf8');

const BUFFER = {
  b_sent: { status: 'sent', metrics: [{ type: 'impressions', value: 120, unit: 'count' }, { type: 'likes', value: 4, unit: 'count' }] },
  b_pending: { status: 'scheduled', metrics: [{ type: 'impressions', value: 0, unit: 'count' }] },
  b_sent_empty: { status: 'sent', metrics: [] },
  b_already: { status: 'sent', metrics: [{ type: 'impressions', value: 50, unit: 'count' }] },
  b_gone: null,
};

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (url !== 'https://api.buffer.com') throw new Error(`Unexpected fetch: ${url}`);
  const { variables } = JSON.parse(init.body);
  const found = BUFFER[variables.id];
  const data = { post: found ? { id: variables.id, status: found.status, metricsUpdatedAt: null, metrics: found.metrics } : null };
  return { ok: true, status: 200, json: async () => ({ data }) };
};

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/posts.mjs');
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0, failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
};

try {
  const response = await nativeFetch(`${base}/api/posts/pull-metrics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await response.json();
  const store = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
  const byId = Object.fromEntries(store.posts.map(p => [p.id, p]));
  const resultFor = id => body.results.find(r => r.id === id);
  const publishedEvents = id => store.activity.filter(a => a.action === 'published' && a.postId === id).length;

  check(response.status === 200, 'sync responds 200');
  check(byId.p_sent.status === 'published', 'a post Buffer reports sent becomes published');
  check(byId.p_sent.metrics.impressions === 120 && byId.p_sent.metrics.reactions === 4, 'its metrics are still synced');
  check(byId.p_pending.status === 'scheduled', 'a post Buffer still has scheduled stays scheduled');
  check(byId.p_sent_empty.status === 'published', 'a sent post with no metrics yet is still marked published');
  check(resultFor('p_sent_empty').status === 'pending', 'a sent post with no metrics yet is reported pending');
  check(byId.p_gone.status === 'scheduled', 'a post missing on Buffer keeps its status');
  check(resultFor('p_gone').status === 'gone', 'a post missing on Buffer is reported gone');
  check(byId.p_already.status === 'published', 'an already published post stays published');
  check(publishedEvents('p_already') === 0, 'an already published post logs no second publish event');
  check(publishedEvents('p_sent') === 1 && publishedEvents('p_sent_empty') === 1, 'each newly published post logs exactly one publish event');
  check(body.synced === 3 && body.pending === 1 && body.failed === 1, 'sync counts are 3 synced, 1 pending, 1 failed');
} finally {
  server.close();
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
