#!/usr/bin/env node
/**
 * followups-cap.test.mjs — the Follow-Ups InMail gate + per-company daily cap.
 *
 * WHY THIS EXISTS (two bugs this pins):
 * 1. The out-of-InMail gate keyed only on selfLastTouch, but a pending invite whose
 *    pipeline status is 'Sent' can have an empty correspondence-log index. Such a
 *    contact slipped the gate and was surfaced with zero credits — you cannot send it.
 *    isInmailBlocked now keys on the SAME alreadyInvited signal the send button uses.
 * 2. The old "reached out today → hold the whole company" rule capped a company at ONE
 *    contact/day. The cap raises that to N DIFFERENT contacts/company/day, counting
 *    distinct people rather than raw messages and seeding from those already reached
 *    today.
 *
 * The cap is exercised through canContact (lib/outreach-policy.mjs), which is the
 * one place it lives. It used to have a second implementation in followups.mjs,
 * assignPerCompanyDailyHeld, which survived the move to a single decider with
 * nothing but this file still calling it. Tests that keep dead code alive are how
 * a duplicate rule looks maintained, so both were removed together.
 *
 * Run: node tests/followups-cap.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { isInmailBlocked } from '../dashboard-web/server/lib/followups.mjs';
import { canContact } from '../dashboard-web/server/lib/outreach-policy.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('followups-cap.test.mjs');

// ── isInmailBlocked ──────────────────────────────────────────────────────────
const OUT = { inmailOut: true };
check(isInmailBlocked({ channel: 'linkedin', status: 'Sent' }, { inmailOut: false }) === false,
  'never blocked while credits remain');
check(isInmailBlocked({ channel: 'email', status: 'Sent' }, OUT) === false,
  'email contact is never InMail-blocked');
check(isInmailBlocked({ channel: 'both', status: 'Sent' }, OUT) === false,
  'dual-channel contact is never blocked (email still sendable)');
check(isInmailBlocked({ channel: 'linkedin', freeDm: true, status: 'Sent' }, OUT) === false,
  'free DM (1st-degree connection) is never blocked');
check(isInmailBlocked({ channel: 'linkedin', status: 'Responded', companyOutreach: {} }, OUT) === false,
  'not-yet-invited LinkedIn first touch is a free connection request → not blocked');
check(isInmailBlocked({ channel: 'linkedin', status: 'Responded', companyOutreach: { selfLastTouch: { date: '2026-08-01' } } }, OUT) === true,
  'already-touched LinkedIn-only contact is blocked at 0 credits');
// THE GAP FIX: status 'Sent' but no logged self-touch — used to slip through.
check(isInmailBlocked({ channel: 'linkedin', status: 'Sent', companyOutreach: {} }, OUT) === true,
  "pending 'Sent' invite with no logged touch is STILL recognized as InMail-needing");

// ── the per-company daily cap, via canContact ────────────────────────────────
// Only the perCompanyPerDay rule is under test, so the policy disables the other
// time-based rules; otherwise a fixture would trip the minimum-gap rule instead
// and the assertions would pass for the wrong reason.
const POLICY = { perCompanyPerDay: 3, minDaysBetweenTouches: 0, maxTouchesPer30d: Infinity, awaitingReplyHold: 0 };
const NOW = new Date('2026-08-22T00:00:00Z');
const held = (opts) => canContact({
  timeline: [], channel: 'email', policy: POLICY, now: NOW, ...opts,
}).blocks.some(b => b.rule === 'perCompanyPerDay');

// The cap counts people already reached at that company today.
check(held({ source: 'ta', company: 'Acme', companyTouches: { count: 2 } }) === false,
  'under the cap at a company, a target-talent contact surfaces');
check(held({ source: 'ta', company: 'Acme', companyTouches: { count: 3 } }) === true,
  'at the cap, the next target-talent contact at that company is held');

// Already messaged this PERSON today. A per-person guard, so it holds for every
// book, including the ones exempt from the per-company cap below.
check(held({ source: 'ta', company: 'Acme', companyTouches: { count: 0, selfSentToday: true } }) === true,
  'a contact already messaged today is held');
check(held({ source: 'referral', company: 'Acme', companyTouches: { count: 0, selfSentToday: true } }) === true,
  'an exempt book is still held after messaging that person today');

// Referrals are your own network spread across many companies, so two sharing an
// employer is coincidence, not a coordinated approach at one target.
check(held({ source: 'referral', company: 'Acme', companyTouches: { count: 9 } }) === false,
  'referrals are exempt from the per-company cap');
check(held({ source: 'influencer', company: 'Acme', companyTouches: { count: 9 } }) === false,
  'influencers are exempt from the per-company cap');

// Every influencer has a blank company, so before this they all normalized to one
// empty key and the whole book competed for three slots a day.
check(held({ source: 'ta', company: '', companyTouches: { count: 9 } }) === false,
  'a blank company never groups rows into one bucket');
check(held({ source: 'ta', company: '   ', companyTouches: { count: 9 } }) === false,
  'a whitespace-only company counts as blank');

// A guard that skips when unsure is not a guard.
check(held({ company: 'Acme', companyTouches: { count: 9 } }) === true,
  'a row with no source is still capped');

console.log(`
${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
