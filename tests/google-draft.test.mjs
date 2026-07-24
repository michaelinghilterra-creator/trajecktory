#!/usr/bin/env node
/**
 * google-draft.test.mjs — pins the Gmail DRAFT path (create only, never send).
 *
 * buildRawEmail builds a valid RFC 2822 message; createDraft POSTs it to
 * drafts.create with an injectable fetch (no live network). A guard test asserts
 * the module exposes NO send wrapper, so the compose scope can only ever leave an
 * unsent draft.
 *
 * Run: node tests/google-draft.test.mjs   (exit 0 = pass, 1 = fail)
 */

import * as google from '../dashboard-web/server/lib/google.mjs';
const { buildRawEmail, createDraft } = google;

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}
const decode = (b64url) => Buffer.from(b64url, 'base64url').toString('utf8');

console.log('google-draft.test.mjs');

// ── buildRawEmail: valid MIME, headers, UTF-8, subject encoding ───────────────
const raw = buildRawEmail({ to: 'reese@northwind.example', subject: 'Quick intro', body: 'Hi Reese,\n\nGood to connect.\n\nThanks' });
const mime = decode(raw);
check(mime.includes('To: reese@northwind.example'), 'To header present');
check(/^Subject: Quick intro$/m.test(mime), 'plain ASCII subject passes through');
check(/Content-Type: text\/plain; charset="UTF-8"/.test(mime), 'text/plain UTF-8 content type');
check(mime.includes('\r\n\r\n') && mime.split('\r\n\r\n')[1].startsWith('Hi Reese,'), 'headers and body split by a blank line');

const utf8 = decode(buildRawEmail({ to: 'a@b.example', subject: 'Café résumé', body: 'x' }));
check(/Subject: =\?UTF-8\?B\?/.test(utf8), 'a non-ASCII subject is RFC 2047 encoded');

let threw = false;
try { buildRawEmail({ to: '', subject: 's', body: 'b' }); } catch { threw = true; }
check(threw, 'a missing "to" throws rather than building a headerless draft');

// ── createDraft: POSTs to drafts.create, never to send ────────────────────────
let captured = null;
const okFetch = async (url, opts) => {
  captured = { url, opts };
  return { ok: true, json: async () => ({ id: 'draft_123', message: { id: 'msg_456' } }) };
};
const out = await createDraft({ to: 'a@b.example', subject: 'Hi', body: 'Hello', accessToken: 'tok', fetchImpl: okFetch });
check(out.id === 'draft_123' && out.messageId === 'msg_456', 'createDraft returns the draft + message ids');
check(/\/drafts$/.test(captured.url), `POSTs to the drafts endpoint (got ${captured.url})`);
check(!/send/i.test(captured.url), 'the endpoint is NOT a send endpoint');
check(captured.opts.method === 'POST', 'uses POST');
check(captured.opts.headers.Authorization === 'Bearer tok', 'passes the bearer token');
const sentBody = JSON.parse(captured.opts.body);
check(sentBody.message && typeof sentBody.message.raw === 'string', 'body is { message: { raw } }');
check(decode(sentBody.message.raw).includes('To: a@b.example'), 'the posted raw message is the built MIME');

// non-ok response surfaces an error
let failThrew = false;
try {
  await createDraft({ to: 'a@b.example', subject: 's', body: 'b', accessToken: 'tok',
    fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'insufficient scope' }) });
} catch (e) { failThrew = /403/.test(e.message); }
check(failThrew, 'a non-ok Gmail response throws with the status');

// ── Guarantee: the module exposes no send wrapper ─────────────────────────────
const sendExports = Object.keys(google).filter(k => /send/i.test(k));
check(sendExports.length === 0, `no send-capable export exists (found: ${sendExports.join(', ') || 'none'})`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
