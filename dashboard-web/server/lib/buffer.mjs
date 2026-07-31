import fs from 'fs';
import { BUFFER_TOKEN_PATH } from '../config.mjs';

// ── Buffer personal API key store ───────────────────────────────────────────
// Buffer's third-party OAuth is closed, but a single user can mint a PERSONAL
// API key (Buffer → Settings → Developers) and use it as a bearer token against
// the GraphQL API at https://api.buffer.com. We store that key in
// data/buffer-token.json (gitignored DATA_DIR, same home as the Google token).
//
// The key is a SECRET: never log it, never return it whole to the client. The
// status helper returns only a masked hint. Nothing here calls the Buffer API
// yet — this file is just the credential store, so a token can be saved securely
// before any push/pull logic is built on top of it and verified.

export function readToken() {
  try {
    const raw = JSON.parse(fs.readFileSync(BUFFER_TOKEN_PATH, 'utf8'));
    const t = raw && typeof raw.token === 'string' ? raw.token.trim() : '';
    return t || null;
  } catch { return null; }
}

export function saveToken(token) {
  const t = String(token == null ? '' : token).trim();
  if (!t) throw new Error('Buffer API key is required');
  fs.writeFileSync(BUFFER_TOKEN_PATH, JSON.stringify({ token: t, connectedAt: new Date().toISOString() }, null, 2) + '\n');
  return true;
}

export function clearToken() {
  try { fs.unlinkSync(BUFFER_TOKEN_PATH); } catch { /* already gone */ }
  return true;
}

export function hasToken() { return !!readToken(); }

// A UI-safe status: the connected flag and a masked hint, never the key itself.
export function tokenStatus() {
  const t = readToken();
  if (!t) return { connected: false };
  let connectedAt = null;
  try { connectedAt = JSON.parse(fs.readFileSync(BUFFER_TOKEN_PATH, 'utf8')).connectedAt || null; } catch { /* ignore */ }
  return { connected: true, hint: '••••' + t.slice(-4), connectedAt };
}

// ── Buffer GraphQL API ──────────────────────────────────────────────────────
// Buffer's single API endpoint is a GraphQL POST to https://api.buffer.com with
// the personal key as a bearer token. Everything below (list channels, count the
// queue, schedule a post) goes through gql(). The schema was introspected live
// before this was written, so the field names, enums, and the createPost result
// union are the real ones, not guesses.

const BUFFER_API = 'https://api.buffer.com';

// Fallback scheduled-post cap if Buffer's real limit can't be read. The actual
// cap is read live from the org plan (Free ~10, Essentials 5000+) via getLimits,
// and the push ultimately trusts Buffer's own LimitReachedError, so this is only
// a floor for messaging when the API is unreachable.
export const DEFAULT_CAP = 10;

// Our internal channel key -> Buffer's `service` string. X is 'twitter' in Buffer.
const SERVICE_FOR = { linkedin: 'linkedin', x: 'twitter' };

async function gql(query, variables) {
  const token = readToken();
  if (!token) throw new Error('No Buffer key is saved. Connect Buffer in Setup first.');
  let res;
  try {
    res = await fetch(BUFFER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new Error('Could not reach Buffer (' + err.message + ').', { cause: err });
  }
  let json;
  try { json = await res.json(); } catch { throw new Error('Buffer returned a non-JSON response (HTTP ' + res.status + ').'); }
  if (json.errors && json.errors.length) {
    const msg = json.errors.map(e => e.message).join('; ');
    if (res.status === 401 || /unauthenticated|unauthorized|invalid token/i.test(msg)) {
      throw new Error('Buffer rejected the key (it may be wrong or expired). Reconnect in Setup. [' + msg + ']');
    }
    throw new Error('Buffer: ' + msg);
  }
  if (!res.ok) throw new Error('Buffer API error (HTTP ' + res.status + ').');
  return json.data;
}

// Org id + channels, cached for the life of the process (they do not change
// mid-session). Pass force=true to re-fetch after the user connects a channel.
let _ctx = null;
async function context(force = false) {
  if (_ctx && !force) return _ctx;
  const acc = await gql('{ account { organizations { id name } } }');
  const org = acc && acc.account && acc.account.organizations && acc.account.organizations[0];
  if (!org) throw new Error('No Buffer organization is attached to this key.');
  const chData = await gql(
    'query($org: OrganizationId!){ channels(input:{ organizationId: $org }){ id name service } }',
    { org: org.id }
  );
  const channels = (chData.channels || []).map(c => ({ id: c.id, name: c.name, service: c.service }));
  _ctx = { orgId: org.id, channels };
  return _ctx;
}

// The org's plan limits, read live and cached. scheduledPosts is the cap that
// matters for a bulk push (Free ~10, Essentials 5000+); threadsPerChannel is the
// X-thread cap (Free 1, Essentials 2000); tags > 0 means the plan has tags.
let _limits = null;
export async function getLimits(force = false) {
  if (_limits && !force) return _limits;
  const d = await gql('{ account { organizations { id limits { scheduledPosts scheduledThreadsPerChannel tags channels } } } }');
  const org = d && d.account && d.account.organizations && d.account.organizations[0];
  const L = (org && org.limits) || {};
  const num = (v, dflt) => Number.isFinite(v) ? v : dflt;
  _limits = {
    scheduledPosts: num(L.scheduledPosts, DEFAULT_CAP),
    threadsPerChannel: num(L.scheduledThreadsPerChannel, 1),
    tags: num(L.tags, 0),
    channels: num(L.channels, 0),
  };
  return _limits;
}

// Live-verify the key and report which of our two channels are connected, plus
// the plan limits. Used by the Publish UI so the user sees exactly where posts
// will go and how many the plan allows before pushing.
export async function listChannels() {
  const { channels } = await context(true);
  const pick = key => {
    const c = channels.find(x => x.service === SERVICE_FOR[key]);
    return c ? { key, id: c.id, name: c.name, service: c.service } : { key, id: null, name: null, service: SERVICE_FOR[key] };
  };
  let limits = null;
  try { limits = await getLimits(true); } catch { /* non-fatal: channels still useful */ }
  return { linkedin: pick('linkedin'), x: pick('x'), all: channels, limits };
}

async function channelFor(key) {
  const { channels } = await context();
  const c = channels.find(x => x.service === SERVICE_FOR[key]);
  return c || null;
}

// How many posts already sit in a channel's Buffer queue (status 'scheduled').
async function scheduledCount(channelId) {
  const { orgId } = await context();
  const data = await gql(
    'query($org: OrganizationId!, $ch: ChannelId!){ posts(first: 50, input:{ organizationId: $org, filter:{ channelIds: [$ch], status: scheduled } }){ edges { node { id } } } }',
    { org: orgId, ch: channelId }
  );
  const edges = (data.posts && data.posts.edges) || [];
  return edges.length;
}

// Split an X post that was written as a numbered thread ("1/ ...", "2/ ...") into
// its individual tweets. A boundary is a blank line immediately followed by "N/ ".
// A single tweet with no markers comes back as a one-element array unchanged.
export function splitThread(text) {
  return String(text || '')
    .split(/\n\n(?=\d+\/\s)/)
    .map(s => s.trim())
    .filter(Boolean);
}

// Turn a stored scheduledFor into a UTC ISO instant for Buffer's dueAt.
// A naive value ("2026-08-04T08:00", no timezone) is read in the SERVER's local
// timezone; trajecktory runs on the user's own machine, so that is exactly the
// local time they picked. A value already carrying 'Z' or an offset is absolute.
export function toDueIso(scheduledFor) {
  if (!scheduledFor) throw new Error('This post has no scheduled date yet.');
  const d = new Date(scheduledFor);
  if (isNaN(d.getTime())) throw new Error('Unreadable scheduled date: ' + scheduledFor);
  return d.toISOString();
}

// Schedule one post to Buffer. Returns { id, status, dueAt, externalLink } on
// success; throws with Buffer's own message (limit reached, invalid input, etc.)
// on a typed error so the caller can report it per-post.
async function createScheduledPost({ channelId, service, text, dueAtIso, firstComment = '', threadParts = [] }) {
  const metadata = {};
  if (service === 'linkedin' && firstComment && firstComment.trim()) {
    metadata.linkedin = { firstComment: firstComment.trim() };
  }
  if (service === 'twitter' && threadParts && threadParts.length) {
    metadata.twitter = { thread: threadParts.map(t => ({ text: t })) };
  }
  const input = {
    channelId,
    text,
    dueAt: dueAtIso,
    mode: 'customScheduled',
    schedulingType: 'automatic',
  };
  if (Object.keys(metadata).length) input.metadata = metadata;

  const data = await gql(
    `mutation Push($input: CreatePostInput!) {
      createPost(input: $input) {
        __typename
        ... on PostActionSuccess { post { id status dueAt externalLink } }
        ... on LimitReachedError { message }
        ... on InvalidInputError { message }
        ... on NotFoundError { message }
        ... on UnauthorizedError { message }
        ... on RestProxyError { message code }
        ... on UnexpectedError { message }
      }
    }`,
    { input }
  );
  const r = data.createPost;
  if (!r) throw new Error('Buffer returned no result for this post.');
  if (r.__typename === 'PostActionSuccess') return r.post;
  // Any other member of the union is a typed error carrying a message. Attach the
  // union typename so the caller can tell a queue-full (LimitReachedError) apart
  // from a bad-input error and react per-post.
  const e = new Error(r.message || ('Buffer refused the post (' + r.__typename + ').'));
  e.bufferType = r.__typename;
  throw e;
}

// Buffer's per-post metric types -> our tracker fields. Several Buffer types fold
// into one tracker key (likes+reactions, reposts+shares). Types with no tracker
// slot (reach, views, viewers, quotes, engagementRate, totalTimeWatched) are
// dropped; the off-platform signals (profile views, connection requests, DMs,
// repo clicks/stars) Buffer cannot see, so they stay manual in the tracker.
const METRIC_MAP = {
  impressions: 'impressions',
  reactions: 'reactions', likes: 'reactions',
  comments: 'comments',
  reposts: 'reposts', shares: 'reposts',
  saves: 'saves',
  clicks: 'linkClicks',
  follows: 'followers',
};
// The tracker keys this integration can fill from Buffer (the rest stay manual).
export const BUFFER_METRIC_KEYS = ['impressions', 'reactions', 'comments', 'reposts', 'saves', 'linkClicks', 'followers'];

// Pull one post's live metrics from Buffer, folded into our tracker keys. Metrics
// appear up to ~24h after a post SENDS, so before then this returns an empty
// metrics object plus the post's status (e.g. 'scheduled'/'sent').
export async function fetchPostMetrics(bufferPostId) {
  const d = await gql(
    'query($id: PostId!){ post(input:{ id: $id }){ id status metricsUpdatedAt metrics { type value unit } } }',
    { id: bufferPostId }
  );
  const post = d && d.post;
  if (!post) return { found: false };
  const metrics = {};
  for (const m of (post.metrics || [])) {
    const key = METRIC_MAP[m.type];
    if (!key || m.unit === 'percentage') continue; // engagementRate etc. are derived, not stored
    metrics[key] = (metrics[key] || 0) + Math.round(Number(m.value) || 0);
  }
  return { found: true, status: post.status, updatedAt: post.metricsUpdatedAt || null, metrics, filled: Object.keys(metrics).length };
}

export { context, channelFor, scheduledCount, createScheduledPost, SERVICE_FOR };
