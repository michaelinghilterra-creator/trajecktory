/**
 * lib/google.mjs — the Gmail READ path: OAuth token refresh, message fetch, and
 * the pure classification/decision core behind /api/google/*.
 *
 * WHY THIS EXISTS
 * Outreach went dark on 2026-06-24 when the Gmail machinery was deleted. The
 * credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in dashboard-web/.env) and
 * a live refresh token (data/google-tokens.json, scoped gmail.modify) survived,
 * so the read path is rebuilt here without re-consenting. This module READS only:
 * it lists and fetches messages, recognizes bounces (via lib/bounce-parse.mjs)
 * and replies, and decides what to record. It never sends. Sending stays out, by
 * design and by scope.
 *
 * THE POINT is auto-logging. When a reply or a bounce lands, record it in the
 * moment (a note, a status flip) instead of reconstructing stage history from
 * memory weeks later. That reconstruction is what made the search post-mortem
 * take four passes and is what corrupted status-events.tsv. This is the permanent
 * fix for the data problem underneath the whole plan.
 *
 * SHAPE: the network functions (getAccessToken, listMessages, getMessage) take an
 * injectable `fetchImpl` so they are testable, and the pure decision core
 * (parseGmailMessage, classifyReply, matchAddress, scanDecisions) is unit tested
 * with invented message fixtures. No live inbox is touched by the tests.
 */

import fs from 'fs';
import crypto from 'crypto';
import { GOOGLE_TOKENS_PATH, GOOGLE_SYNC_PATH } from '../config.mjs';
import { classifyBounce } from '../../../lib/bounce-parse.mjs';
import { normalizeCompany } from '../../../lib/identity.mjs';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// The only scope this integration ever requests. Read-only by design: the whole
// point is reading bounces and replies, never sending. Least privilege on purpose.
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

// Draft-writing needs a send-capable scope (Google has no draft-only scope). We
// request gmail.compose and NEVER call send: this module implements drafts.create
// and nothing else — grep this file, there is no send wrapper. The read scope
// stays too so the reply/bounce sweep keeps working. The user re-consents to both.
export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
export const GMAIL_SCOPES = `${GMAIL_READONLY_SCOPE} ${GMAIL_COMPOSE_SCOPE}`;

// ── Token + sync-cursor storage ──────────────────────────────────────────────
function readTokens() {
  try { return JSON.parse(fs.readFileSync(GOOGLE_TOKENS_PATH, 'utf8')); }
  catch { return null; }
}
function writeTokens(t) {
  fs.writeFileSync(GOOGLE_TOKENS_PATH, JSON.stringify(t, null, 2) + '\n');
}
// The Gmail scan cursor: which message ids we have already processed, so a
// re-scan is idempotent and never double-logs a reply or re-flips a bounce.
function readSync() {
  try {
    const s = JSON.parse(fs.readFileSync(GOOGLE_SYNC_PATH, 'utf8')) || {};
    // handledReplies: msgId → { action, appId, date }, so a reply already logged to
    // an application is hidden on the next (full-rescan) sweep instead of showing up
    // again as un-actioned. Keyed by Gmail message id, which is stable across sweeps.
    // lastPreviewAt: when a read-only reply sweep last ran (manual or auto), so the UI
    // can show "checked N days ago" and nudge when stale. Surfaced here so every
    // writeSync round-trip preserves it — a caller that read a stripped object and
    // wrote it back would otherwise clobber the stamp to absent.
    return { seenMessageIds: s.seenMessageIds || [], lastCheckedAt: s.lastCheckedAt || null, handledReplies: s.handledReplies || {}, lastPreviewAt: s.lastPreviewAt || null };
  } catch { return { seenMessageIds: [], lastCheckedAt: null, handledReplies: {}, lastPreviewAt: null }; }
}
function writeSync(s) {
  fs.writeFileSync(GOOGLE_SYNC_PATH, JSON.stringify(s, null, 2) + '\n');
}

// Space-separated scope string → array.
function tokenScopes(tokens) {
  return String(tokens?.scope || '').split(/\s+/).filter(Boolean);
}

// ── Connection status (pure given tokens + clock) ────────────────────────────
// Returns only non-secret facts (no token values) so it is safe to hand a UI.
function googleStatus(tokens = readTokens(), now = Date.now()) {
  if (!tokens || !tokens.refresh_token) {
    return { connected: false, connectedEmail: null, scopes: [], canReadMail: false, canDraft: false, expired: true, expiresAt: null };
  }
  const scopes = tokenScopes(tokens);
  const expiresAt = tokens.expiry_date || null;
  return {
    connected: true,
    connectedEmail: tokens.connectedEmail || null,
    scopes,
    canReadMail: scopes.some(s => /gmail\.(readonly|modify)/.test(s)),
    canDraft: scopes.some(s => /gmail\.(compose|modify)/.test(s)),
    expired: !expiresAt || expiresAt <= now,
    expiresAt,
  };
}

// ── Access token, refreshed when stale ───────────────────────────────────────
// Injectable fetch + clock for tests. Persists the refreshed access token so the
// next call reuses it until it expires. Never logs or returns the refresh token.
async function getAccessToken({
  tokens = readTokens(), now = Date.now(), fetchImpl = fetch, save = writeTokens, marginMs = 60_000,
} = {}) {
  if (!tokens || !tokens.refresh_token) throw new Error('Google is not connected (no refresh token).');
  // Still valid with margin → reuse.
  if (tokens.access_token && tokens.expiry_date && tokens.expiry_date - marginMs > now) {
    return tokens.access_token;
  }
  const clientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in dashboard-web/.env');
  }
  const body = new URLSearchParams({
    client_id: clientId, client_secret: clientSecret,
    refresh_token: tokens.refresh_token, grant_type: 'refresh_token',
  });
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Google token refresh failed (${res.status}). ${String(txt).slice(0, 160)}`);
  }
  const j = await res.json();
  const updated = {
    ...tokens,
    access_token: j.access_token || tokens.access_token,
    token_type: j.token_type || tokens.token_type,
    // Google returns expires_in seconds; store an absolute epoch ms for the cache.
    expiry_date: now + ((Number(j.expires_in) || 3600) * 1000),
  };
  if (j.id_token) updated.id_token = j.id_token;
  save(updated);
  return updated.access_token;
}

// ── Connection health (does the refresh token still work?) ───────────────────
// googleStatus.expired reflects the ACCESS token (≈1h life), which is stale most
// of the time and refreshes silently, so it is a poor "should I reconnect?" signal
// (it screams expired every hour). The only way to know the weekly Testing-mode
// REFRESH token is still alive is to try a refresh. checkHealth does exactly that,
// reusing getAccessToken (a no-op network-wise when the cached access token is
// still valid), and classifies the outcome:
//   not_connected — no refresh token on file
//   ok            — a valid access token was obtained (cached or freshly refreshed)
//   reconnect     — the refresh failed (token expired/revoked): only re-consent fixes it
// It also reports sweep freshness (days since the last preview) so the UI can nudge
// when it has been a while. Injectable fetch + clock for tests; returns non-secret
// facts only (no token values).
async function checkHealth({ tokens = readTokens(), now = Date.now(), fetchImpl = fetch } = {}) {
  const sync = readSync();
  const last = sync.lastPreviewAt || sync.lastCheckedAt || null;
  const parsed = last ? Date.parse(last) : NaN;
  const daysSinceCheck = Number.isFinite(parsed) ? Math.floor((now - parsed) / 86_400_000) : null;
  const base = { connectedEmail: tokens?.connectedEmail || null, lastCheckedAt: last, daysSinceCheck };
  if (!tokens || !tokens.refresh_token) {
    return { connected: false, healthy: false, reason: 'not_connected', ...base };
  }
  try {
    await getAccessToken({ tokens, now, fetchImpl });
    return { connected: true, healthy: true, reason: 'ok', ...base };
  } catch {
    // The refresh token is expired or revoked. A silent refresh cannot recover it;
    // the user has to re-consent. This is the one case worth a proactive nudge.
    return { connected: true, healthy: false, reason: 'reconnect', ...base };
  }
}

// ── OAuth connect (reconnect flow) ───────────────────────────────────────────
// The June refresh token died (Testing-mode 7-day expiry), and fixing the console
// does not revive it: the only way to a fresh token is re-consent. This is the
// consent-URL + code-exchange half. The client is a DESKTOP OAuth client, which
// uses the loopback method — the dashboard listens on localhost and Google allows
// any local port without a pre-registered redirect URI, so redirect_uri is built
// from the running server's own host and the installed-app random port is a
// non-issue. PKCE (S256) is used even though the client has a secret, because it
// is the current best practice for installed apps and costs nothing here.

// PKCE S256 challenge: base64url(sha256(verifier)). Pure; unit-tested against a
// known vector.
export function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(String(verifier)).digest('base64url');
}
// A fresh PKCE verifier + its challenge. Random, so not asserted directly.
export function newPkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: pkceChallenge(verifier) };
}
// An opaque CSRF/state token tying a callback back to the request that began it.
export function randomState() {
  return crypto.randomBytes(16).toString('hex');
}

// Build the Google consent URL. Pure given its inputs. access_type=offline plus
// prompt=consent guarantees a refresh token even on a re-consent (Google withholds
// one on a silent re-grant otherwise, which is exactly the case here).
export function buildAuthUrl({ clientId, redirectUri, state, codeChallenge, scope = GMAIL_SCOPES }) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${p.toString()}`;
}

// Exchange an authorization code for tokens (PKCE verifier + client secret).
// Injectable fetch + clock for tests. Normalizes to the on-disk token shape that
// getAccessToken/googleStatus read. Never logs a token.
async function exchangeCode({ code, redirectUri, codeVerifier, clientId, clientSecret, fetchImpl = fetch, now = Date.now() }) {
  const body = new URLSearchParams({
    code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: codeVerifier,
  });
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Google code exchange failed (${res.status}). ${String(txt).slice(0, 160)}`);
  }
  const j = await res.json();
  return {
    refresh_token: j.refresh_token || null,
    access_token: j.access_token || null,
    token_type: j.token_type || 'Bearer',
    scope: j.scope || GMAIL_READONLY_SCOPE,
    expiry_date: now + ((Number(j.expires_in) || 3600) * 1000),
  };
}

// The connected mailbox address, read from the Gmail profile. Needs only a gmail
// read scope, so we learn who connected without asking for openid/email. Returns
// null on any failure (non-fatal: the connection still works without the label).
async function fetchProfileEmail({ accessToken, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(`${GMAIL_BASE}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const j = await res.json();
    return j.emailAddress || null;
  } catch { return null; }
}

// ── Gmail read wrappers (network; injectable fetch) ──────────────────────────
async function listMessages({ q = '', accessToken, max = 50, fetchImpl = fetch } = {}) {
  const url = `${GMAIL_BASE}/messages?q=${encodeURIComponent(q)}&maxResults=${max}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail list failed (${res.status})`);
  const j = await res.json();
  return j.messages || []; // [{ id, threadId }]
}
async function getMessage({ id, accessToken, fetchImpl = fetch } = {}) {
  const url = `${GMAIL_BASE}/messages/${id}?format=full`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail get failed (${res.status})`);
  return res.json();
}

// ── Draft creation (network; injectable fetch) — CREATE ONLY, NEVER SEND ───────
// The one write this integration performs. It calls drafts.create and nothing
// else: there is deliberately no send wrapper anywhere in this module, so the most
// this code can do with the compose scope is leave an UNSENT draft in Gmail. The
// user reviews and sends every draft by hand.

// Build an RFC 2822 message and base64url-encode it for the Gmail API. Pure. UTF-8
// body; a non-ASCII subject is RFC 2047 encoded so it survives transport.
export function buildRawEmail({ to, subject = '', body = '' }) {
  if (!to || !/@/.test(String(to))) throw new Error('createDraft: a valid "to" address is required');
  const encSubject = /[^\x00-\x7F]/.test(subject)
    ? `=?UTF-8?B?${Buffer.from(String(subject), 'utf8').toString('base64')}?=`
    : String(subject);
  const headers = [
    `To: ${to}`,
    `Subject: ${encSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];
  const mime = `${headers.join('\r\n')}\r\n\r\n${String(body)}`;
  return Buffer.from(mime, 'utf8').toString('base64url');
}

// Create a Gmail DRAFT (never sends). Returns { id, messageId }. Injectable fetch.
async function createDraft({ to, subject, body, accessToken, fetchImpl = fetch } = {}) {
  const raw = buildRawEmail({ to, subject, body });
  const res = await fetchImpl(`${GMAIL_BASE}/drafts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { raw } }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Gmail draft create failed (${res.status}). ${String(txt).slice(0, 160)}`);
  }
  const j = await res.json();
  return { id: j.id || null, messageId: j.message?.id || null };
}

// Fetch many messages with bounded concurrency. Once the sweep searches beyond the
// inbox it can list 150+ ids, and fetching them one at a time is the slow part, so
// run a small pool instead. Order is not preserved (callers re-derive everything
// from message content). A single unreadable message is skipped, never aborts the
// sweep. getImpl is injectable for tests.
async function fetchMessagesConcurrent(ids = [], { accessToken, concurrency = 10, getImpl = getMessage } = {}) {
  const out = [];
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++]?.id;
      try { out.push(await getImpl({ id, accessToken })); } catch { /* skip unreadable */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length || 1) }, worker));
  return out;
}

// ── Pure parsing + classification ────────────────────────────────────────────
function _b64urlDecode(data) {
  if (!data) return '';
  try { return Buffer.from(data, 'base64url').toString('utf8'); } catch { return ''; }
}

// Flatten a Gmail API message object into the fields we actually reason over.
// Walks the MIME tree for a text/plain body, falling back to stripped HTML, then
// to the snippet. Pure.
function parseGmailMessage(raw) {
  const payload = raw?.payload || {};
  const headers = payload.headers || [];
  const h = (name) => {
    const found = headers.find(x => (x.name || '').toLowerCase() === name.toLowerCase());
    return found ? found.value : '';
  };
  let text = '';
  const walk = (part) => {
    if (!part) return;
    const mime = part.mimeType || '';
    if (mime === 'text/plain' && part.body?.data) text += _b64urlDecode(part.body.data) + '\n';
    else if (mime === 'text/html' && part.body?.data && !text) {
      text += _b64urlDecode(part.body.data).replace(/<[^>]+>/g, ' ') + '\n';
    }
    if (Array.isArray(part.parts)) part.parts.forEach(walk);
  };
  walk(payload);
  if (!text && payload.body?.data) text = _b64urlDecode(payload.body.data);
  return {
    id: raw?.id || null,
    threadId: raw?.threadId || null,
    from: h('From'),
    to: h('To'),
    subject: h('Subject'),
    date: h('Date'),
    snippet: raw?.snippet || '',
    labelIds: raw?.labelIds || [],
    text: (text.trim() || raw?.snippet || ''),
  };
}

// Pull the bare address out of a "Name <alex@example.test>" header value.
function extractEmail(s) {
  const m = String(s || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

// Reply intent, keyword-heuristic. Negative is checked first, because a rejection
// often contains interview-ish words ("we interviewed many strong candidates").
// Deliberately coarse: this only picks the SUGGESTED action; a human confirms the
// flip. positive = wants to talk / schedule / advance; negative = a pass; neutral
// = a human reply that is neither (logs a note, nudges Applied → Responded).
const REPLY_NEGATIVE_RE = /\b(unfortunately|not (moving|move) forward|decided (to|not) to|move (ahead|forward) with (other|another)|other candidates|will not be (moving|proceeding)|regret to|not (a )?(fit|match)|not the right (fit|match|time)|pursue other|filled the (role|position|seat)|no longer (considering|moving|open)|have to pass|passing on)\b/i;
const REPLY_POSITIVE_RE = /\b(schedul(e|ing)|set up (a )?(call|time|chat|meeting)|book (a )?time|find (a )?time|calendar|availab(le|ility)|when are you (free|available)|phone screen|screening call|next steps?|move you forward|(would |i'?d )?(love|like|happy) to (talk|chat|speak|meet|connect|learn more)|let'?s (talk|chat|connect|set)|great to connect|interview)\b/i;

function classifyReply({ subject = '', text = '' } = {}) {
  const hay = `${subject}\n${text}`;
  if (REPLY_NEGATIVE_RE.test(hay)) return 'negative';
  if (REPLY_POSITIVE_RE.test(hay)) return 'positive';
  return 'neutral';
}

// Match an address to a known contact (target-talent or recruiter) by exact
// email. Rows are passed in, so this is pure and test-covered. Returns null when
// the sender is nobody we track (surfaced as "other", never acted on silently).
function matchAddress(address, { taRows = [], recruiterRows = [] } = {}) {
  const addr = String(address || '').toLowerCase().trim();
  if (!addr) return null;
  const ta = taRows.find(r => (r.email || '').toLowerCase() === addr);
  if (ta) return { source: 'ta', id: ta.id, company: ta.company, name: `${ta.first || ''} ${ta.last || ''}`.trim() };
  const rec = recruiterRows.find(r => (r.email || '').toLowerCase() === addr);
  if (rec) return { source: 'recruiter', id: rec.id, company: rec.firm, name: `${rec.first || ''} ${rec.last || ''}`.trim() };
  return null;
}

// Normalize a company name OR a domain root to a comparable token: lowercase,
// strip common suffixes and all non-alphanumerics, so "XYZ Corp" and "xyzcorp.com"
// both reduce to "xyz".
function _normCompanyToken(s) {
  return String(s || '').toLowerCase()
    .replace(/\.(com|io|co|net|org|ai|app|xyz|dev|inc)$/i, '')
    .replace(/\b(inc|corp|corporation|llc|ltd|limited|co|company|group|holdings|technologies|technology|labs|software|systems|solutions|global)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// Mailbox domains that carry NO company signal: consumer providers and the big
// ATS / recruiting-mail senders. A reply from these can't be company-matched by
// domain (an @greenhouse-mail.io note is about SOME company, not "Greenhouse").
const _GENERIC_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com']);
const _ATS_DOMAIN_RE = /greenhouse|lever|ashbyhq|ashby|workday|myworkday|smartrecruiters|jobvite|icims|bamboohr|hire\.lever|greenhouse-mail|us-greenhouse|myworkdayjobs|paylocity|rippling|gem\.com|goodtime|calendly/i;

function _domainRoot(addr) {
  const at = String(addr || '').split('@')[1] || '';
  const parts = at.toLowerCase().split('.').filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

// Tier-2 match: an unknown SENDER may still be about a known COMPANY. Compare the
// sender's email domain to each application's company name; a strong token overlap
// suggests which application the reply belongs to. This is what catches a first
// email from careers@company.example or a TA person not yet on file. Returns
// { appId, company, confidence } or null. A SUGGESTION for confirmation, never an
// auto-link: a company can mail from an unrelated domain, so a wrong guess must
// cost a glance, not a mis-filed status. Pure.
function matchByCompanyDomain(fromAddr, apps = []) {
  const at = String(fromAddr || '').split('@')[1] || '';
  if (!at || _GENERIC_DOMAINS.has(at.toLowerCase()) || _ATS_DOMAIN_RE.test(at)) return null;
  const root = _normCompanyToken(_domainRoot(fromAddr));
  if (!root || root.length < 3) return null;
  let best = null;
  for (const a of apps) {
    const comp = _normCompanyToken(a.company);
    if (!comp || comp.length < 3) continue;
    const exact = comp === root;
    const overlap = exact || comp.includes(root) || root.includes(comp);
    if (!overlap) continue;
    const confidence = exact ? 'high' : 'medium';
    if (!best || (confidence === 'high' && best.confidence !== 'high')) {
      best = { appId: a.id, company: a.company, confidence };
    }
    if (exact) break;
  }
  return best;
}

// Tier-3 match: the SENDER told us nothing (an ATS or unfamiliar domain), but the
// SUBJECT often names the company outright ("Update on your Kestrel Application").
// A SUGGESTION for confirmation, never an auto-link, exactly like the domain tier.
// Biased toward recall (a missed application update costs more than an extra row
// the user can ignore). Pure.
//
// TWO passes, and the order matters.
//
// Pass 1 searches the FULL company name. Pass 2 searches the DISTINCTIVE core from
// _normCompanyToken, which drops legal suffixes and generic words so "Kestrel, Inc."
// still matches a subject that says only "Kestrel".
//
// Only having pass 2 was a silent hole. The core is what the length guard measures,
// and the guard rejects anything under 4 characters — so a company whose name is
// generic-word-plus-a-short-word could NEVER be subject-matched, however plainly the
// subject named it. "PAR Technology" reduced to "par" and "DHI Group" to "dhi", both
// 3 characters, both skipped, so real interview mail routed through a scheduling tool
// landed in "unknown" every time. The guard itself is right: searching for "par"
// alone would hit "department" and "compare". The mistake was searching ONLY for the
// stripped core, when the full "partechnology" is both present in the subject and far
// too distinctive to collide with anything.
function matchBySubject(subject, apps = []) {
  const hay = normalizeCompany(subject); // lowercase, alphanumeric only (spaces dropped)
  if (hay.length < 4) return null;
  const hit = (a) => ({ appId: a.id, company: a.company, confidence: 'subject' });
  // Pass 1 — full name. Long and specific, so it is safe even when the core is not.
  for (const a of apps) {
    const full = normalizeCompany(a.company);
    if (full && full.length >= 4 && hay.includes(full)) return hit(a);
  }
  // Pass 2 — distinctive core, for subjects naming the company without its generic
  // word. Still guarded at 4 characters: a shorter needle matches subject noise.
  for (const a of apps) {
    const core = _normCompanyToken(a.company);
    if (!core || core.length < 4) continue;
    if (hay.includes(core)) return hit(a);
  }
  return null;
}

// Applications at the same company as a reply, returned as {id, role, status}.
// The reply logger needs an EXPLICIT appId because one company can have several
// open roles, so this surfaces the candidates for the user to choose rather than
// auto-attaching a reply to a guessed one. Match is on the tracker's canonical
// normalizeCompany (lib/identity.mjs): case- and punctuation-insensitive, so
// "Cobalt Systems" and "cobalt systems" match. It does NOT strip legal suffixes,
// so a contact company that differs only by ", Inc." will not collapse — a
// deliberate miss, since under-matching just shows the reply for manual handling
// while over-matching would attach it to the wrong company. Pure; unit-tested.
function candidateAppsFor(company, apps = []) {
  const token = normalizeCompany(company);
  if (!token) return [];
  return apps
    .filter(a => normalizeCompany(a.company) === token)
    .map(a => ({ id: a.id, role: a.role, status: a.status }));
}

// The heart: turn a batch of raw Gmail messages into decisions.
//   bounces[] — DSNs. A HARD bounce for a known contact carries a `flip` to set
//               that address to `bounced` (and status Bounced). Soft bounces are
//               transient: recorded, never flipped (never kill an address on a
//               deferral).
//   replies[] — human replies FROM a known contact, with a suggested sentiment.
//   other[]   — everything else (unknown senders, automated mail), surfaced so a
//               real reply from an unrecognized address is never dropped.
// Pure: all inputs passed in.
function scanDecisions({ messages = [], taRows = [], recruiterRows = [], apps = [] } = {}) {
  const bounces = [], replies = [], other = [];
  for (const raw of messages) {
    const msg = parseGmailMessage(raw);
    const bounce = classifyBounce(msg.text, { subject: msg.subject, from: msg.from });
    if (bounce.kind === 'hard' || bounce.kind === 'soft') {
      const address = bounce.address ? bounce.address.toLowerCase() : null;
      const contact = address ? matchAddress(address, { taRows, recruiterRows }) : null;
      bounces.push({
        msgId: msg.id, kind: bounce.kind, code: bounce.code, address, contact,
        flip: (bounce.kind === 'hard' && contact) ? { source: contact.source, id: contact.id, state: 'bounced' } : null,
      });
      continue;
    }
    const fromAddr = extractEmail(msg.from);
    const contact = fromAddr ? matchAddress(fromAddr, { taRows, recruiterRows }) : null;
    // For an unknown sender, guess the company two ways: tier-2 from the sender's
    // domain (a first email from careers@company.example), then tier-3 from the
    // SUBJECT (an ATS-sent "Update on your <Company> Application", whose sender
    // domain carries no signal). Either is a suggestion for confirmation.
    let companyGuess = !contact ? matchByCompanyDomain(fromAddr, apps) : null;
    if (!contact && !companyGuess) companyGuess = matchBySubject(msg.subject, apps);
    const entry = {
      msgId: msg.id, from: fromAddr, subject: msg.subject,
      sentiment: classifyReply({ subject: msg.subject, text: msg.text }),
      contact, companyGuess, snippet: msg.snippet,
    };
    (contact ? replies : other).push(entry);
  }
  return { bounces, replies, other };
}

export {
  readTokens, writeTokens, readSync, writeSync, tokenScopes,
  googleStatus, getAccessToken, checkHealth, listMessages, getMessage, fetchMessagesConcurrent,
  parseGmailMessage, extractEmail, classifyReply, matchAddress, matchByCompanyDomain, matchBySubject, scanDecisions,
  exchangeCode, fetchProfileEmail, candidateAppsFor, createDraft,
};
