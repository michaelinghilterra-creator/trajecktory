#!/usr/bin/env node
/**
 * verify-contacts.test.mjs — unit tests for the pure API→state mapping in
 * verify-contacts.mjs. Uses FABRICATED verifier JSON only (no network, no real
 * addresses). Importing the script must NOT run its CLI main() — the direct-run
 * guard at the bottom of verify-contacts.mjs is what makes this safe.
 *
 * Run: node tests/verify-contacts.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { mapMillionVerifier, mapHunter } from '../verify-contacts.mjs';
import { mapHunterFind } from '../find-contacts.mjs';
import { isStateSendable } from '../lib/email-verify.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('verify-contacts.test.mjs');

// ── MillionVerifier mapping ──────────────────────────────────────────────────
check(mapMillionVerifier({ result: 'ok', quality: 'good' }).state === 'ok', 'MV ok/good → ok');
check(mapMillionVerifier({ result: 'ok', quality: 'good' }).score === 90, 'MV ok/good → score 90');
check(mapMillionVerifier({ result: 'ok', quality: 'risky' }).state === 'ok', 'MV ok/risky-quality still → ok (deliverable)');
check(mapMillionVerifier({ result: 'catch_all' }).state === 'risky', 'MV catch_all → risky');
check(mapMillionVerifier({ result: 'unknown' }).state === 'risky', 'MV unknown → risky (inconclusive, sendable)');
check(mapMillionVerifier({ result: 'invalid' }).state === 'invalid', 'MV invalid → invalid');
check(mapMillionVerifier({ result: 'disposable' }).state === 'invalid', 'MV disposable → invalid');
check(mapMillionVerifier({ result: 'error' }) === null, 'MV error → null (no write, retry later)');
check(mapMillionVerifier({}) === null, 'MV empty/unrecognized → null');

// ── Hunter mapping ───────────────────────────────────────────────────────────
check(mapHunter({ data: { result: 'deliverable', status: 'valid', score: 97 } }).state === 'ok', 'Hunter deliverable → ok');
check(mapHunter({ data: { result: 'deliverable', status: 'valid', score: 97 } }).score === 97, 'Hunter carries the score');
check(mapHunter({ data: { result: 'undeliverable', status: 'invalid' } }).state === 'invalid', 'Hunter undeliverable → invalid');
check(mapHunter({ data: { result: 'risky', status: 'accept_all' } }).state === 'risky', 'Hunter accept_all → risky');
check(mapHunter({ data: { result: 'risky', status: 'webmail' } }).state === 'risky', 'Hunter webmail → risky');
check(mapHunter({ data: { status: 'disposable' } }).state === 'invalid', 'Hunter disposable → invalid');
check(mapHunter({ data: { result: 'risky', status: 'unknown' } }).state === 'risky', 'Hunter unknown → risky');
check(mapHunter({}) === null, 'Hunter empty → null');

// ── Every non-null verdict lands on a real verification state, and only ok/risky
//    are sendable (dead states must never pass the gate). ──────────────────────
for (const j of [{ result: 'ok', quality: 'good' }, { result: 'catch_all' }, { result: 'invalid' }]) {
  const v = mapMillionVerifier(j);
  if (v.state === 'invalid') check(!isStateSendable(v.state), `MV ${j.result} verdict is NOT sendable`);
  else check(isStateSendable(v.state), `MV ${j.result} verdict is sendable`);
}

// ── Hunter Email Finder mapping (find-contacts.mjs) ──────────────────────────
check(mapHunterFind({ data: { email: 'sam.carter@northgate.example', score: 95 } }).email === 'sam.carter@northgate.example', 'finder returns the email');
check(mapHunterFind({ data: { email: 'Sam.Carter@Northgate.Example', score: 95 } }).email === 'sam.carter@northgate.example', 'finder lowercases the email');
check(mapHunterFind({ data: { email: 'x@y.example', score: 80 } }).score === 80, 'finder carries the confidence score');
check(mapHunterFind({ data: { email: null } }) === null, 'finder: no email → null');
check(mapHunterFind({}) === null, 'finder: empty response → null');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
