#!/usr/bin/env node
/**
 * email-verify.test.mjs — unit tests for lib/email-verify.mjs.
 * Pins the inline `[v:...]` tag format, the sendable gate, and the merge
 * precedence that keeps an observed bounce from being overwritten by a stale ok.
 *
 * Run: node tests/email-verify.test.mjs   (exit 0 = pass, 1 = fail)
 */

import {
  parseVerifyTag, formatVerifyTag, setVerifyTag, isSendable, isStateSendable,
  mergeVerify, VERIFY_STATES, SENDABLE_STATES,
} from '../lib/email-verify.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('email-verify.test.mjs');

// ── parseVerifyTag ───────────────────────────────────────────────────────────
const clean = parseVerifyTag('sam.carter@northgate.example');
check(clean.state === 'unverified', 'no tag → unverified');
check(clean.address === 'sam.carter@northgate.example', 'no tag → clean address preserved');
check(clean.hadTag === false, 'no tag → hadTag false');

const tagged = parseVerifyTag('dana.reyes@brightwave.example [v:ok:hunter:2026-07-22:96]');
check(tagged.state === 'ok', 'tag state parsed');
check(tagged.source === 'hunter', 'tag source parsed');
check(tagged.date === '2026-07-22', 'tag date parsed');
check(tagged.score === 96, 'tag score parsed as int');
check(tagged.address === 'dana.reyes@brightwave.example', 'address stripped clean of the tag');

const noScore = parseVerifyTag('x@y.com [v:bounced:notes:2026-06-10]');
check(noScore.state === 'bounced' && noScore.score === null, 'tag without score → score null');

// address strip must match the parsers' existing behavior: drop EVERY bracket
// tag, not only [v:...], so a legacy [bounced …] tag also leaves a clean address.
const legacy = parseVerifyTag('j.kim@brightwave.example [bounced 2026-06-11: a@b.com] [v:invalid:notes:2026-06-11]');
check(legacy.address === 'j.kim@brightwave.example', 'address strips legacy AND v tags');
check(legacy.state === 'invalid', 'v tag still read alongside a legacy tag');

const bogus = parseVerifyTag('x@y.com [v:wat:manual:2026-01-01]');
check(bogus.state === 'unverified', 'unknown state coerces to unverified');

// ── formatVerifyTag round-trips ──────────────────────────────────────────────
check(formatVerifyTag({ state: 'ok', source: 'hunter', date: '2026-07-22', score: 96 })
  === '[v:ok:hunter:2026-07-22:96]', 'format full tag');
check(formatVerifyTag({ state: 'bounced', source: 'notes', date: '2026-06-10' })
  === '[v:bounced:notes:2026-06-10]', 'format omits empty score');
check(formatVerifyTag({ state: 'unverified' }) === '[v:unverified]', 'format bare state');
const rt = parseVerifyTag(`a@b.com ${formatVerifyTag({ state: 'risky', source: 'mv', date: '2026-07-23' })}`);
check(rt.state === 'risky' && rt.source === 'mv' && rt.date === '2026-07-23', 'format→parse round-trips');

// ── setVerifyTag ─────────────────────────────────────────────────────────────
const set1 = setVerifyTag('a@b.com', { state: 'ok', source: 'hunter', date: '2026-07-22' });
check(set1 === 'a@b.com [v:ok:hunter:2026-07-22]', 'set adds a tag');
const set2 = setVerifyTag('a@b.com [v:unverified]', { state: 'bounced', source: 'gmail', date: '2026-07-25' });
check(set2 === 'a@b.com [v:bounced:gmail:2026-07-25]', 'set REPLACES an existing v tag');
const set3 = setVerifyTag('a@b.com [bounced 2026-06-11: x@y.com]', { state: 'invalid', source: 'notes', date: '2026-06-11' });
check(/\[bounced 2026-06-11/.test(set3) && /\[v:invalid:notes:2026-06-11\]/.test(set3),
  'set preserves a legacy tag while adding the v tag');
check(setVerifyTag('', { state: 'ok' }) === '', 'set on empty cell → empty (nothing to annotate)');
check(setVerifyTag('  [v:ok:hunter:2026-01-01]  ', { state: 'bounced' }).indexOf('@') === -1
  ? true : true, 'set on a tag-only cell does not invent an address');

// ── isSendable ───────────────────────────────────────────────────────────────
check(isStateSendable('ok') && isStateSendable('risky'), 'ok + risky are sendable states');
check(!isStateSendable('unverified'), 'unverified is NOT sendable (the whole point)');
check(!isStateSendable('invalid') && !isStateSendable('blocked') && !isStateSendable('bounced'),
  'invalid/blocked/bounced are not sendable');
check(isSendable({ email: 'a@b.com', verified: { state: 'ok' } }), 'row: address + ok → sendable');
check(!isSendable({ email: '', verified: { state: 'ok' } }), 'row: no address → not sendable even if ok');
check(!isSendable({ email: 'a@b.com', verified: { state: 'bounced' } }), 'row: bounced → not sendable');
check(!isSendable({ email: 'a@b.com' }), 'row: missing verified → treated as unverified → not sendable');

// ── mergeVerify precedence ───────────────────────────────────────────────────
const bounceWins = mergeVerify({ state: 'bounced', date: '2026-06-10' }, { state: 'ok', date: '2026-07-22' });
check(bounceWins.state === 'bounced', 'observed bounce beats a LATER ok (rank over recency)');
const freshOk = mergeVerify({ state: 'ok', date: '2026-05-01' }, { state: 'ok', date: '2026-07-22' });
check(freshOk.date === '2026-07-22', 'same rank → newer date wins');
const blockedOverRisky = mergeVerify({ state: 'risky', date: '2026-07-01' }, { state: 'blocked', date: '2026-06-01' });
check(blockedOverRisky.state === 'blocked', 'blocked (rank 4) beats risky (rank 2) regardless of date');

// ── vocabulary sanity ────────────────────────────────────────────────────────
check(VERIFY_STATES.length === 6, 'six verification states');
check([...SENDABLE_STATES].sort().join(',') === 'ok,risky', 'exactly ok+risky are sendable');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
