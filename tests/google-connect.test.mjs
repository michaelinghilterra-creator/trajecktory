#!/usr/bin/env node
/**
 * google-connect.test.mjs — the OAuth reconnect helpers in lib/google.mjs.
 *
 * Covers the pure/mockable half of the reconnect flow: the PKCE S256 challenge
 * (against the RFC 7636 known vector), the consent-URL builder, the code→token
 * exchange (injected fetch), and the profile-email lookup. The live consent (the
 * user approving in a browser) cannot be unit tested; everything up to and after
 * it can. No network is touched.
 *
 * Run: node tests/google-connect.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { pkceChallenge, buildAuthUrl, exchangeCode, fetchProfileEmail, GMAIL_READONLY_SCOPE, GMAIL_COMPOSE_SCOPE, GMAIL_SCOPES } from '../dashboard-web/server/lib/google.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('google-connect.test.mjs');

// ── PKCE S256, against the RFC 7636 Appendix B vector ────────────────────────
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
check(pkceChallenge(RFC_VERIFIER) === RFC_CHALLENGE, 'PKCE S256 challenge matches the RFC 7636 vector');
check(!/[+/=]/.test(pkceChallenge('anything-at-all')), 'challenge is base64URL (no +, /, or = padding)');

// ── buildAuthUrl ─────────────────────────────────────────────────────────────
const url = buildAuthUrl({
  clientId: '78999004600-example.apps.googleusercontent.com',
  redirectUri: 'http://localhost:3333/api/google/callback',
  state: 'st_abc123',
  codeChallenge: RFC_CHALLENGE,
});
const u = new URL(url);
check(u.origin + u.pathname === 'https://accounts.google.com/o/oauth2/v2/auth', 'auth URL points at Google consent');
check(u.searchParams.get('client_id') === '78999004600-example.apps.googleusercontent.com', 'client_id set');
check(u.searchParams.get('redirect_uri') === 'http://localhost:3333/api/google/callback', 'redirect_uri round-trips exactly');
check(u.searchParams.get('response_type') === 'code', 'response_type=code');
check(u.searchParams.get('scope') === GMAIL_SCOPES, 'scope requests readonly + compose (drafts, never send)');
check(u.searchParams.get('scope').includes(GMAIL_READONLY_SCOPE) && u.searchParams.get('scope').includes(GMAIL_COMPOSE_SCOPE), 'both the read and the compose scopes are present');
check(u.searchParams.get('access_type') === 'offline', 'access_type=offline (so a refresh token is issued)');
check(u.searchParams.get('prompt') === 'consent', 'prompt=consent (so re-consent still yields a refresh token)');
check(u.searchParams.get('state') === 'st_abc123', 'state carried through');
check(u.searchParams.get('code_challenge') === RFC_CHALLENGE && u.searchParams.get('code_challenge_method') === 'S256', 'PKCE challenge + S256 method present');

// ── exchangeCode (injected fetch) ────────────────────────────────────────────
let captured = null;
const okFetch = async (url_, opts) => {
  captured = { url: url_, body: opts.body };
  return { ok: true, json: async () => ({ access_token: 'at_1', refresh_token: 'rt_1', token_type: 'Bearer', scope: GMAIL_READONLY_SCOPE, expires_in: 3600 }) };
};
const tok = await exchangeCode({
  code: 'auth_code_1', redirectUri: 'http://localhost:3333/api/google/callback', codeVerifier: RFC_VERIFIER,
  clientId: 'cid', clientSecret: 'csecret', fetchImpl: okFetch, now: 1_000_000,
});
check(captured.url === 'https://oauth2.googleapis.com/token', 'code exchange posts to the token endpoint');
check(/grant_type=authorization_code/.test(captured.body) && /code_verifier=/.test(captured.body), 'exchange body carries authorization_code grant + PKCE verifier');
check(tok.refresh_token === 'rt_1' && tok.access_token === 'at_1', 'tokens returned');
check(tok.expiry_date === 1_000_000 + 3600 * 1000, 'expiry_date is now + expires_in, in ms');
check(tok.scope === GMAIL_READONLY_SCOPE, 'scope normalized onto the token');

let threw = false;
try {
  await exchangeCode({ code: 'x', redirectUri: 'y', codeVerifier: 'z', clientId: 'c', clientSecret: 's',
    fetchImpl: async () => ({ ok: false, status: 400, text: async () => 'invalid_grant' }) });
} catch (e) { threw = /400/.test(e.message); }
check(threw, 'a non-2xx exchange throws with the status');

// ── fetchProfileEmail (injected fetch) ───────────────────────────────────────
const email = await fetchProfileEmail({ accessToken: 'at', fetchImpl: async () => ({ ok: true, json: async () => ({ emailAddress: 'someone@example.test' }) }) });
check(email === 'someone@example.test', 'profile email read from the Gmail profile');
const nullEmail = await fetchProfileEmail({ accessToken: 'at', fetchImpl: async () => ({ ok: false, status: 403 }) });
check(nullEmail === null, 'a failed profile lookup returns null (non-fatal, connection still valid)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
