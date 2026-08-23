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
// Default channel per lane: professional and build-in-public land on LinkedIn.
const LANE_CHANNEL = { professional: 'linkedin', trajecktory: 'linkedin' };
const MAX_ACTIVITY = 200; // keep the log bounded; oldest events fall off

// Content-series post types (the recurring "lens" of each post) and the
// performance metrics the Content tab tracks. A post may carry an optional
// `type`, a short `title`/label, and a `metrics` object filled in after it is
// published. All are additive: older posts simply lack them.
const TYPES = new Set(['origin', 'builder', 'myth', 'rigor', 'craft', 'service', 'journey', 'product', 'serial']);
const METRIC_NUM_KEYS = ['impressions', 'reactions', 'comments', 'reposts', 'saves', 'linkClicks', 'profileViews', 'followers', 'connReqs', 'inboundDms', 'repoClicks', 'repoStars'];

function normType(type) { return TYPES.has(type) ? type : ''; }
function toNum(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0; }

// Merge a metrics patch onto an existing metrics object (or a fresh one).
// Numeric fields are coerced to non-negative integers; whoEngaged/notes are
// free text; checkedAt is stamped every time metrics are saved.
function normMetrics(patch = {}, existing = null) {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  for (const k of METRIC_NUM_KEYS) {
    if (patch[k] !== undefined) base[k] = toNum(patch[k]);
    else if (base[k] === undefined) base[k] = 0;
  }
  base.whoEngaged = patch.whoEngaged !== undefined ? String(patch.whoEngaged == null ? '' : patch.whoEngaged) : (base.whoEngaged || '');
  base.notes = patch.notes !== undefined ? String(patch.notes == null ? '' : patch.notes) : (base.notes || '');
  base.checkedAt = new Date().toISOString();
  return base;
}

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

function createPost({ text, source = 'user', lane = 'professional', channel, linkComment = '', type = '', title = '', metrics = null, status = 'draft' } = {}) {
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
    type: normType(type),
    title: String(title == null ? '' : title).trim(),
    text: clean,
    linkComment: String(linkComment == null ? '' : linkComment).trim(),
    status: STATUSES.has(status) ? status : 'draft',
    scheduledFor: null,
    metrics: metrics ? normMetrics(metrics, null) : null,
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
  if (patch.type !== undefined) {
    const t = normType(patch.type);
    if (t !== (p.type || '')) { p.type = t; edited = true; }
  }
  if (patch.title !== undefined) {
    const tt = String(patch.title == null ? '' : patch.title).trim();
    if (tt !== (p.title || '')) { p.title = tt; edited = true; }
  }
  if (patch.metrics !== undefined && patch.metrics && typeof patch.metrics === 'object') {
    p.metrics = normMetrics(patch.metrics, p.metrics || null);
    edited = true;
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

// One post by id (or null). Read-only convenience for routes.
function getPost(id) { return readStore().posts.find(p => p.id === id) || null; }

// Record that a post was pushed to Buffer: stash Buffer's own id/permalink under
// `p.buffer` (so we never double-schedule it and can pull its metrics later) and
// move it to 'scheduled'. The user-facing scheduledFor is left untouched — it is
// the local time they chose; Buffer's confirmed UTC lives in p.buffer.dueAt.
function attachBuffer(id, buffer = {}, extra = {}) {
  const store = readStore();
  const idx = store.posts.findIndex(p => p.id === id);
  if (idx === -1) return null;
  const p = store.posts[idx];
  p.buffer = {
    id: buffer.id || null,
    status: buffer.status || null,
    dueAt: buffer.dueAt || null,
    externalLink: buffer.externalLink || null,
    pushedAt: new Date().toISOString(),
    // A first comment that Buffer's free plan could not auto-attach, so the user
    // must paste it as the first comment when the post goes live. Empty when the
    // comment was attached automatically (paid plan) or there was none.
    pendingFirstComment: extra.pendingFirstComment || '',
  };
  p.status = 'scheduled';
  p.updatedAt = new Date().toISOString();
  store.posts[idx] = p;
  logActivity(store, 'pushed', p, buffer.dueAt ? `to Buffer for ${buffer.dueAt}` : 'to Buffer');
  writeStore(store);
  return p;
}

// Fold metrics pulled from Buffer into a post's tracker metrics. Only the
// Buffer-provided keys are overwritten; the off-platform fields the user tracks
// by hand (profile views, connection requests, DMs, repo clicks/stars, whoEngaged,
// notes) are preserved. `autoFields` records which keys came from Buffer so the UI
// can mark them as synced rather than typed.
function applyBufferMetrics(id, { metrics = {}, updatedAt = null } = {}) {
  const store = readStore();
  const idx = store.posts.findIndex(p => p.id === id);
  if (idx === -1) return null;
  const p = store.posts[idx];
  const base = (p.metrics && typeof p.metrics === 'object') ? { ...p.metrics } : {};
  const autoFields = [];
  for (const [k, v] of Object.entries(metrics)) {
    if (!METRIC_NUM_KEYS.includes(k)) continue;
    base[k] = Math.max(0, Math.round(Number(v) || 0));
    autoFields.push(k);
  }
  for (const k of METRIC_NUM_KEYS) if (base[k] === undefined) base[k] = 0;
  base.whoEngaged = base.whoEngaged || '';
  base.notes = base.notes || '';
  base.autoFields = autoFields;
  base.bufferAt = updatedAt || new Date().toISOString();
  base.checkedAt = new Date().toISOString();
  p.metrics = base;
  p.updatedAt = new Date().toISOString();
  store.posts[idx] = p;
  logActivity(store, 'metrics', p, `synced ${autoFields.length} metric(s) from Buffer`);
  writeStore(store);
  return { post: p, autoFields };
}

export {
  readStore, writeStore, listPosts, listQueued,
  createPost, updatePost, deletePost, getPost, attachBuffer, applyBufferMetrics,
  newPostId, LANE_CHANNEL, LANES, CHANNELS, STATUSES, TYPES,
};
