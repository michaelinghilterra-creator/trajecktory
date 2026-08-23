#!/usr/bin/env node
/**
 * posts-composer.test.mjs — server/lib/posts.mjs (the Posts composer store).
 * Hermetic: points TJK_DATA_DIR at a temp dir so it exercises the real write
 * paths without touching the user's data/posts.json.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const tmp = makeSandbox("posts");
process.env.TJK_DATA_DIR = tmp;

// Import AFTER setting the env, so config.mjs resolves POSTS_PATH into the temp dir.
const { createPost, updatePost, deletePost, listPosts, listQueued } =
  await import('../dashboard-web/server/lib/posts.mjs');

let n = 0;
const ok = (m) => { n++; console.log('  ok ' + m); };

// create: professional lane maps to the linkedin channel, starts as a draft
const p = createPost({ text: 'First draft', source: 'user', lane: 'professional' });
assert.equal(p.status, 'draft');
assert.equal(p.source, 'user');
assert.equal(p.lane, 'professional');
assert.equal(p.channel, 'linkedin');
ok('create: professional lane -> linkedin channel, status draft, source user');

// trajecktory lane maps to x; claude source is preserved
const p2 = createPost({ text: 'Build log', source: 'claude', lane: 'trajecktory' });
assert.equal(p2.channel, 'x');
assert.equal(p2.source, 'claude');
ok('create: trajecktory lane -> x channel, source claude');

// empty text is refused
assert.throws(() => createPost({ text: '   ' }), /required/);
ok('create: empty text refused');

// edit logs an "edited" event
updatePost(p.id, { text: 'First draft, revised' });
// queue transition sets status + scheduledFor and logs "queued", not "edited"
const q = updatePost(p.id, { status: 'queued', scheduledFor: '2026-08-01T15:00:00.000Z' });
assert.equal(q.status, 'queued');
assert.equal(q.scheduledFor, '2026-08-01T15:00:00.000Z');
ok('update: queue transition sets status and scheduledFor');

// listQueued returns only queued posts
const queued = listQueued();
assert.equal(queued.length, 1);
assert.equal(queued[0].id, p.id);
ok('listQueued returns only queued posts');

// activity log records each action in order
const actions = listPosts().activity.map((a) => a.action);
assert.deepEqual(actions, ['created', 'generated', 'edited', 'queued']);
ok('activity log records created/generated/edited/queued in order');

// an unknown status is ignored (post stays queued, no throw)
assert.equal(updatePost(p.id, { status: 'bogus' }).status, 'queued');
ok('update: unknown status is ignored');

// delete removes the post and logs "deleted"; unknown id returns false
assert.equal(deletePost(p.id), true);
assert.equal(deletePost('nope'), false);
const after = listPosts();
assert.equal(after.posts.length, 1);
assert.equal(after.activity.at(-1).action, 'deleted');
ok('delete removes the post and logs deleted');

// the store is actually written to disk under the temp DATA_DIR
assert.ok(fs.existsSync(path.join(tmp, 'posts.json')));
ok('posts.json persisted to the configured data dir');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n posts-composer: ${n} checks passed`);
