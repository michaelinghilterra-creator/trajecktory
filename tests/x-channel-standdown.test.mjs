#!/usr/bin/env node
/**
 * x-channel-standdown.test.mjs: X remains readable as history but cannot be
 * created by a lane or sent through the Buffer scheduling route.
 */
import assert from 'node:assert/strict';
import express from 'express';
import { makeSandbox } from './helpers/sandbox.mjs';

const tmp = makeSandbox('x-channel-standdown');
process.env.TJK_DATA_DIR = tmp;

const { createPost, updatePost, LANES, CHANNELS } =
  await import('../dashboard-web/server/lib/posts.mjs');
const { router } = await import('../dashboard-web/server/routes/posts.mjs');

let n = 0;
const ok = (m) => { n++; console.log('  ok ' + m); };

for (const lane of LANES) {
  const post = createPost({ text: `Post for ${lane}`, lane });
  assert.equal(post.channel, 'linkedin');
}
ok('every lane creates LinkedIn posts');

assert.equal(CHANNELS.has('x'), true);
const historical = createPost({ text: 'Historical X post', channel: 'x' });
const updated = updatePost(historical.id, { title: 'Historical result' });
assert.equal(updated.channel, 'x');
ok('x remains valid and survives an unrelated update');

const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
try {
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/posts/push-to-buffer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: [historical.id] }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].ok, false);
  assert.match(body.results[0].message, /X channel has been stood down/i);
  assert.match(body.results[0].message, /not sent/i);
  ok('selected X post is reported as not sent');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\n x-channel-standdown: ${n} checks passed`);
