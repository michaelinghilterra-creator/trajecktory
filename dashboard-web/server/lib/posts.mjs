import fs from 'fs';
import { randomBytes } from 'crypto';
import { POSTS_PATH } from '../config.mjs';

// ── Social posts composer ──────────────────────────────────────────────────────
// A single JSON sidecar under data/, same pattern as todos.json. Holds the posts
// the user is drafting and queueing, plus an activity log so every create / edit /
// queue / schedule / delete is recorded. Nothing here talks to Buffer: the
// dashboard is the composer + queue, and posting happens through the Buffer MCP
// (driven by Claude Code) after the user approves. A "queued" post is one the
// user has marked ready to schedule; Claude reads the queue and schedules it.
//
// Each post:
//   { id, source:'claude'|'user', lane:'professional'|'trajecktory',
//     channel:'linkedin'|'x', text, linkComment, status:'draft'|'queued'|
//     'scheduled'|'published', scheduledFor:ISO|null, createdAt, updatedAt, order }
// Each activity event:
//   { id, ts, action, postId, detail }

const SOURCES  = new Set(['claude', 'user']);
const LANES     = new Set(['professional', 'trajecktory']);
const CHANNELS  = new Set(['linkedin', 'x']);
const STATUSES  = new Set(['draft', 'queued', 'scheduled', 'published']);
// Default channel per lane: professional lands on LinkedIn, build-in-public on X.
const LANE_CHANNEL = { professional: 'linkedin', trajecktory: 'x' };
const MAX_ACTIVITY = 200; // keep the log bounded; oldest events fall off

function newPostId()     { return 'p_' + randomBytes(4).toString('hex'); }
function newActivityId()  { return 'a_' + randomBytes(4).toString('hex'); }

function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(POSTS_PATH, 'utf8'));
    return {
      posts: Array.isArray(raw.posts) ? raw.posts : [],
      activity: Array.isArray(raw.activity) ? raw.activity : [],
    };
  } catch { return { posts: [], activity: [] }; }
}
function writeStore(store) {
  const out = {
    version: 1,
    posts: store.posts || [],
    activity: (store.activity || []).slice(-MAX_ACTIVITY),
  };
  fs.writeFileSync(POSTS_PATH, JSON.stringify(out, null, 2) + '\n');
}

function logActivity(store, action, post, detail = '') {
  store.activity = store.activity || [];
  store.activity.push({
    id: newActivityId(),
    ts: new Date().toISOString(),
    action,
    postId: post ? post.id : null,
    // A short, safe snippet so the feed is readable without re-fetching the post.
    snippet: post ? String(post.text || '').slice(0, 80) : '',
    lane: post ? post.lane : null,
    channel: post ? post.channel : null,
    detail: String(detail || ''),
  });
}

function normLane(lane)       { return LANES.has(lane) ? lane : 'professional'; }
function normChannel(channel, lane) {
  if (CHANNELS.has(channel)) return channel;
  return LANE_CHANNEL[normLane(lane)] || 'linkedin';
}

// Return the full store: posts (stored order) + activity (newest last).
function listPosts() { return readStore(); }

// Just the queue, for Claude / the Buffer MCP to fetch what needs scheduling.
function listQueued() {
  return readStore().posts.filter(p => p.status === 'queued');
}

function createPost({ text, source = 'user', lane = 'professional', channel, linkComment = '' } = {}) {
  const clean = String(text == null ? '' : text).trim();
  if (!clean) throw new Error('Post text is required');
  const store = readStore();
  const now = new Date().toISOString();
  const maxOrder = store.posts.reduce((m, p) => Math.max(m, p.order || 0), -1);
  const post = {
    id: newPostId(),
    source: SOURCES.has(source) ? source : 'user',
    lane: normLane(lane),
    channel: normChannel(channel, lane),
    text: clean,
    linkComment: String(linkComment == null ? '' : linkComment).trim(),
    status: 'draft',
    scheduledFor: null,
    createdAt: now,
    updatedAt: now,
    order: maxOrder + 1,
  };
  store.posts.push(post);
  logActivity(store, source === 'claude' ? 'generated' : 'created', post);
  writeStore(store);
  return post;
}

// Patch one post by id. Accepts text/lane/channel/linkComment/status/scheduledFor.
// Status transitions are logged with their own action so the feed reads well.
function updatePost(id, patch = {}) {
  const store = readStore();
  const idx = store.posts.findIndex(p => p.id === id);
  if (idx === -1) return null;
  const p = store.posts[idx];
  let edited = false;
  let statusAction = null;

  if (patch.text !== undefined) {
    const clean = String(patch.text || '').trim();
    if (clean && clean !== p.text) { p.text = clean; edited = true; }
  }
  if (patch.lane !== undefined) {
    const lane = normLane(patch.lane);
    if (lane !== p.lane) { p.lane = lane; edited = true; }
  }
  if (patch.channel !== undefined) {
    const channel = normChannel(patch.channel, p.lane);
    if (channel !== p.channel) { p.channel = channel; edited = true; }
  }
  if (patch.linkComment !== undefined) {
    const lc = String(patch.linkComment == null ? '' : patch.linkComment).trim();
    if (lc !== p.linkComment) { p.linkComment = lc; edited = true; }
  }
  if (patch.scheduledFor !== undefined) {
    p.scheduledFor = patch.scheduledFor ? String(patch.scheduledFor) : null;
    edited = true;
  }
  if (patch.status !== undefined && STATUSES.has(patch.status) && patch.status !== p.status) {
    statusAction = { draft: 'unqueued', queued: 'queued', scheduled: 'scheduled', published: 'published' }[patch.status];
    p.status = patch.status;
  }

  p.updatedAt = new Date().toISOString();
  store.posts[idx] = p;
  if (statusAction) logActivity(store, statusAction, p, patch.scheduledFor ? `for ${patch.scheduledFor}` : '');
  else if (edited) logActivity(store, 'edited', p);
  writeStore(store);
  return p;
}

function deletePost(id) {
  const store = readStore();
  const idx = store.posts.findIndex(p => p.id === id);
  if (idx === -1) return false;
  const [removed] = store.posts.splice(idx, 1);
  logActivity(store, 'deleted', removed);
  writeStore(store);
  return true;
}

export {
  readStore, writeStore, listPosts, listQueued,
  createPost, updatePost, deletePost,
  newPostId, LANE_CHANNEL, LANES, CHANNELS, STATUSES,
};
