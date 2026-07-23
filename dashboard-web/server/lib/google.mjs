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
    return { seenMessageIds: s.seenMessageIds || [], lastCheckedAt: s.lastCheckedAt || null };
  } catch { return { seenMessageIds: [], lastCheckedAt: null }; }
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
    return { connected: false, connectedEmail: null, scopes: [], canReadMail: false, expired: true, expiresAt: null };
  }
  const scopes = tokenScopes(tokens);
  const expiresAt = tokens.expiry_date || null;
  return {
    connected: true,
    connectedEmail: tokens.connectedEmail || null,
    scopes,
    canReadMail: scopes.some(s => /gmail\.(readonly|modify)/.test(s)),
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
export function buildAuthUrl({ clientId, redirectUri, state, codeChallenge, scope = GMAIL_READONLY_SCOPE }) {
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
    // Tier-2: an unknown sender may still be about a known company (a first email
    // from careers@company.example, or a TA person not yet on file). Attach the guess.
    const companyGuess = (!contact && fromAddr) ? matchByCompanyDomain(fromAddr, apps) : null;
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
  googleStatus, getAccessToken, listMessages, getMessage,
  parseGmailMessage, extractEmail, classifyReply, matchAddress, matchByCompanyDomain, scanDecisions,
  exchangeCode, fetchProfileEmail, candidateAppsFor,
};
