#!/usr/bin/env node
/**
 * gating.test.mjs — a credential-gated feature must be able to say WHY it is off.
 *
 * The bug this locks down is not a crash. Gmail reported the same "not connected"
 * whether the user had never provisioned an OAuth client or simply had not clicked
 * Connect, so the app offered a Connect button to someone with nothing to connect
 * to. Clicking it produced an error naming a file they had never heard of, which
 * reads as a broken product rather than an unstarted setup step.
 *
 * Covers:
 *   - clientConfigured: both halves of the credential required, neither leaked.
 *   - googleStatus: reports `configured` in both branches.
 *   - checkHealth: not_configured wins over not_connected, deliberately.
 *   - countWithheldContacts: what the send gate is silently holding back, and
 *     just as importantly what it is NOT (a key would not rescue those).
 *
 * Every fixture here is invented. Design docs: docs/feature-gating.md.
 *
 * Run: node tests/gating.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

// SANDBOX FIRST, same reasoning as google.test.mjs: config.mjs resolves DATA_DIR at
// import time, so redirecting it has to happen before the module loads, which is why
// the imports below are dynamic. Nothing here writes tokens, but a suite that reads
// the real data/ is one edit away from writing to it.
const tmp = makeSandbox("gating");
process.env.TJK_DATA_DIR = tmp;

const { clientConfigured, googleStatus, checkHealth } = await import('../dashboard-web/server/lib/google.mjs');
const { countWithheldContacts } = await import('../dashboard-web/server/lib/followups.mjs');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('gating.test.mjs');

const NOW = 1_800_000_000_000;
const savedId = process.env.GOOGLE_CLIENT_ID;
const savedSecret = process.env.GOOGLE_CLIENT_SECRET;
const setClient = (id, secret) => {
  if (id == null) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = id;
  if (secret == null) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = secret;
};

// ── clientConfigured ─────────────────────────────────────────────────────────
// Both halves are required. An id without a secret cannot complete the token
// exchange, so treating it as configured just moves the failure to a later,
// more confusing point (consent succeeds, then the callback dies).
setClient(null, null);
check(clientConfigured() === false, 'no credentials → not configured');
setClient('id-only', null);
check(clientConfigured() === false, 'client id without a secret → not configured');
setClient(null, 'secret-only');
check(clientConfigured() === false, 'client secret without an id → not configured');
setClient('   ', '   ');
check(clientConfigured() === false, 'whitespace-only credentials → not configured');
setClient('an-id', 'a-secret');
check(clientConfigured() === true, 'both halves present → configured');
check(clientConfigured() !== 'an-id', 'reports presence, never the value');

// ── googleStatus carries `configured` in BOTH branches ───────────────────────
// The disconnected branch is the one that matters: that is the state the UI has to
// tell apart, and it is the branch that returns early.
setClient('an-id', 'a-secret');
check(googleStatus(null, NOW).configured === true,
  'disconnected status still reports that a client exists');
check(googleStatus({ refresh_token: 'r', scope: '', expiry_date: NOW + 1000 }, NOW).configured === true,
  'connected status reports the client too');
setClient(null, null);
check(googleStatus(null, NOW).configured === false,
  'no client → configured is false, distinct from connected');
check(googleStatus(null, NOW).connected === false,
  'no client → still not connected (the two are reported separately, not merged)');

// ── checkHealth: not_configured takes precedence ─────────────────────────────
await (async () => {
  setClient(null, null);
  // A leftover token file with no client is still unusable, and "reconnect" is the
  // wrong thing to ask for. Asserted WITH a healthy-looking token so the precedence
  // is proven rather than incidental.
  const h = await checkHealth({
    tokens: { refresh_token: 'r', access_token: 'GOOD', expiry_date: NOW + 3_600_000 },
    now: NOW, fetchImpl: () => { throw new Error('should not fetch'); },
  });
  check(h.reason === 'not_configured', 'no client → not_configured, even holding a live-looking token');
  check(h.configured === false && h.connected === false && h.healthy === false,
    'not_configured reports all three flags consistently');
})();

await (async () => {
  setClient('an-id', 'a-secret');
  const h = await checkHealth({ tokens: { access_token: 'x' }, now: NOW, fetchImpl: () => { throw new Error('should not fetch'); } });
  check(h.reason === 'not_connected', 'client present but no refresh token → not_connected');
  check(h.configured === true, 'not_connected still reports the client as configured');
})();

await (async () => {
  setClient('an-id', 'a-secret');
  const h = await checkHealth({
    tokens: { refresh_token: 'r', access_token: 'GOOD', expiry_date: NOW + 3_600_000 },
    now: NOW, fetchImpl: () => { throw new Error('should not fetch'); },
  });
  check(h.reason === 'ok' && h.configured === true, 'working connection is unchanged by the new flag');
})();

// ── countWithheldContacts ────────────────────────────────────────────────────
// What the send gate is holding back for want of a checked address. The exclusions
// are the point: counting rows a key could not rescue would overstate what turning
// verification on actually buys, which is the same dishonesty as showing a zero for
// something that was never measured.
const rows = [
  { id: 1, first: 'Ada',  last: 'Nkemelu', email: 'ada@example.test',   status: 'Sent',    verified: { state: 'unverified' } },
  { id: 2, first: 'Bo',   last: 'Persson', email: 'bo@example.test',    status: 'Sent'  }, // no verified block at all
  { id: 3, first: 'Cy',   last: 'Okafor',  email: '',                   status: 'Sent',    verified: { state: 'unverified' } },
  { id: 4, first: 'Dee',  last: 'Ramires', email: 'dee@example.test',   status: 'Sent',    verified: { state: 'ok' } },
  { id: 5, first: 'Eli',  last: 'Tanaka',  email: 'eli@example.test',   status: 'Sent',    verified: { state: 'bounced' } },
  { id: 6, first: 'Fay',  last: 'Oduya',   email: 'fay@example.test',   status: 'Archived', verified: { state: 'unverified' } },
  { id: 7, first: 'Gus',  last: 'Halvorsen', email: 'gus@example.test', status: 'Sent',    verified: { state: 'risky' } },
];
check(countWithheldContacts({ taRows: rows }) === 2,
  'counts only the unverified-with-an-address rows (an explicit state and a missing one)');
check(countWithheldContacts({ taRows: [rows[2]] }) === 0,
  'a contact with no address is not withheld: there is nothing to send to');
check(countWithheldContacts({ taRows: [rows[4]] }) === 0,
  'a bounced address is not withheld: it was checked and it is dead, a key changes nothing');
check(countWithheldContacts({ taRows: [rows[5]] }) === 0,
  'an archived contact is not withheld: the opportunity is over');
check(countWithheldContacts({ taRows: [rows[3], rows[6]] }) === 0,
  'sendable states (ok, risky) are not withheld');
check(countWithheldContacts({ taRows: [] }) === 0,
  'no contacts → zero, not a crash');

setClient(savedId, savedSecret);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
