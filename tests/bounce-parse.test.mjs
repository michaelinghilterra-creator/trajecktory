#!/usr/bin/env node
/**
 * bounce-parse.test.mjs — unit tests for lib/bounce-parse.mjs.
 *
 * The note strings below are MODELED on the shapes real outreach notes take, but
 * every company, person, and address is INVENTED and every domain is an
 * RFC-2606 reserved name (.example / .test), so nothing here is a real contact.
 * The point of the miner is to be conservative: it must call a row bounced only
 * when the CURRENT address is the one that died, and must NOT kill a corrected
 * address whose note merely describes an OLD bounce. These tests pin that line.
 *
 * Run: node tests/bounce-parse.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { classifyBounce, mineNotesForBounce } from '../lib/bounce-parse.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('bounce-parse.test.mjs');

// ── classifyBounce: live DSN messages ────────────────────────────────────────
const hard = classifyBounce(
  'Final-Recipient: rfc822; rolsen@harborsearch.example\nDiagnostic-Code: smtp; 550 5.1.1 user unknown',
  { subject: 'Delivery Status Notification (Failure)', from: 'mailer-daemon@mail.example' });
check(hard.kind === 'hard', 'DSN 550/5.1.1 user unknown → hard');
check(hard.address === 'rolsen@harborsearch.example', 'DSN final-recipient address extracted');
check(hard.code === '5.1.1' || hard.code === '550', 'DSN code captured');

const soft = classifyBounce(
  'Your message was deferred. 4.2.2 mailbox full, will retry for 19 hours.',
  { subject: 'Delivery delayed', from: 'mailer-daemon@mail.example' });
check(soft.kind === 'soft', 'DSN 4.2.2 deferred/quota → soft, NOT hard');

const notBounce = classifyBounce(
  'Thanks, this looks interesting — can you send times next week?',
  { subject: 'Re: Director, RevOps', from: 'taylor.brooks@zenithhr.example' });
check(notBounce.kind === 'none', 'a normal human reply → none (never mistaken for a bounce)');

const daemonNoCode = classifyBounce('This is the mail system at host mx.mail.example.',
  { subject: 'Undelivered Mail Returned to Sender', from: 'MAILER-DAEMON@mail.example' });
check(daemonNoCode.kind === 'soft', 'a DSN with no classifiable code → soft (never kill on ambiguity)');

// ── mineNotesForBounce: a clear, current-address hard bounce ──────────────────
const clearHard = mineNotesForBounce(
  'EMAIL BOUNCED 2026-06-10 — do not reach out again', 'jlowe@tallanpartners.example');
check(clearHard.verdict === 'bounced' && clearHard.confidence === 'high',
  'EMAIL BOUNCED + do not reach out → bounced, high confidence');
check(clearHard.date === '2026-06-10', 'bounce date mined');

// ── THE TRAP: a corrected address ────────────────────────────────────────────
// The note describes a bounce of the OLD @lakeside-retained.example address; the
// current cell is the corrected @crestlinesearch.example. Miner must NOT call it
// bounced. The emailCell arg carries the CURRENT address exactly as the real file
// does — this is what caught the bug the clean-arg version missed: scanning the
// cell made the current address look "mentioned as bounced" and wrongly killed it.
const correctedA = mineNotesForBounce(
  'First send to JHarlow@lakeside-retained.example BOUNCED 2026-06-08. Corrected to @crestlinesearch.example (verified via directory). Resend after verification.',
  'jharlow@crestlinesearch.example',
  'JHarlow@crestlinesearch.example');
check(correctedA.verdict === 'corrected',
  'CORRECTED-address trap: bounce of an old address does NOT kill the current one');
check(correctedA.confidence === 'low', 'corrected → low confidence, never auto-written');

// Same trap, phrased as a "was X — STALE, use @new" correction, current address
// sitting in its own cell.
const correctedB = mineNotesForBounce(
  'Email corrected 2026-06-08 (was KFenwick@lakeside-retained.example — STALE; the team\'s old addresses no longer work — confirmed when JHarlow@lakeside-retained.example bounced). Use @crestlinesearch.example. Verify before send.',
  'kfenwick@crestlinesearch.example',
  'KFenwick@crestlinesearch.example');
check(correctedB.verdict === 'corrected',
  'current address in its own cell is NOT read as bounced when the note is a correction');

// ── soft bounce only ─────────────────────────────────────────────────────────
const softNote = mineNotesForBounce(
  'SOFT BOUNCE 2026-06-13 — deferred (server timeout, 19h retry remaining); revisit if permanent failure',
  'nsorensen@summitadvisors.example');
check(softNote.verdict === 'soft', 'SOFT BOUNCE only → soft (address left alone)');

// ── auto-synthesized invalid, matches current ────────────────────────────────
const autoInvalid = mineNotesForBounce(
  '⚠️ EMAIL BOUNCED 2026-06-08 — chris.bell@nimbusdata.example is invalid (auto-synthesized by Reconcile, never verified).',
  'chris.bell@nimbusdata.example');
check(autoInvalid.verdict === 'invalid' && autoInvalid.confidence === 'high',
  'auto-synthesized address that bounced → invalid, high confidence');

// ── multi-pattern bounce, likely org wall / left company ─────────────────────
const multi = mineNotesForBounce(
  'Bounced on okafor@ and s.okafor@brightwave.example (both dominant patterns); likely left company — re-verify on LinkedIn before retrying',
  'okafor@brightwave.example');
check(multi.verdict === 'blocked', 'two patterns bounced → blocked/left-company candidate');
check(multi.confidence === 'low', 'multi-pattern → low confidence (human confirms org-wall vs left)');

// ── unverified-but-never-bounced is NOT a bounce ─────────────────────────────
const neverBounced = mineNotesForBounce(
  '⚠ EMAIL UNVERIFIED — same auto-synthesized pattern as a sibling row. Cleared preemptively; use LinkedIn or verify before re-adding.',
  '');
check(neverBounced.verdict === null || neverBounced.verdict === 'corrected',
  'unverified-but-no-bounce → not a hard bounce verdict');

// ── legacy inline [bounced …] email tag (two domains, org-wall shape) ────────
const legacyTag = mineNotesForBounce(
  'Reach out via LinkedIn instead.',
  'p.hale@claritycloud.example',
  'p.hale@claritycloud.example [bounced 2026-06-11: p.hale@claritycloud.example, phale@getclaritycloud.example]');
check(['bounced', 'blocked', 'invalid'].includes(legacyTag.verdict),
  'legacy [bounced …] email tag is recognized as a bounce signal');

// ── clean row with no bounce anything ────────────────────────────────────────
const clean = mineNotesForBounce('Regional partner — priority candidate.', 'jsmith@example.com');
check(clean.verdict === null, 'a clean note → no verdict');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
