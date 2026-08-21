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
 *    contact/day. assignPerCompanyDailyHeld raises that to N DIFFERENT contacts/company/
 *    day, counting distinct people (not raw messages) and seeding from those already
 *    reached today.
 *
 * Run: node tests/followups-cap.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { isInmailBlocked, assignPerCompanyDailyHeld } from '../dashboard-web/server/lib/followups.mjs';

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

// ── assignPerCompanyDailyHeld ────────────────────────────────────────────────
const mk = (company, extra = {}) => ({ company, companyOutreach: {}, ...extra });

// 5 fresh contacts at one company, cap 3 → first 3 shown, last 2 held.
{
  const items = [mk('Acme'), mk('Acme'), mk('Acme'), mk('Acme'), mk('Acme')];
  assignPerCompanyDailyHeld(items, { perCompany: 3 });
  const held = items.map(i => i.heldDaily);
  check(JSON.stringify(held) === JSON.stringify([false, false, false, true, true]),
    'cap 3: first 3 at a company surface, the rest are held');
}

// Seeded by contacts already reached today: 2 already → only 1 more surfaces.
{
  const co = { companyContactsSentToday: 2 };
  const items = [mk('Globex', { companyOutreach: { ...co } }), mk('Globex', { companyOutreach: { ...co } }), mk('Globex', { companyOutreach: { ...co } })];
  assignPerCompanyDailyHeld(items, { perCompany: 3 });
  check(JSON.stringify(items.map(i => i.heldDaily)) === JSON.stringify([false, true, true]),
    '2 already reached today + cap 3 → only 1 more new contact surfaces');
}

// A contact already messaged today is held (done) and does NOT consume an extra slot
// beyond the seed it is already inside.
{
  const items = [
    mk('Initech', { companyOutreach: { companyContactsSentToday: 1, selfSentToday: { channel: 'email' } } }),
    mk('Initech', { companyOutreach: { companyContactsSentToday: 1 } }),
    mk('Initech', { companyOutreach: { companyContactsSentToday: 1 } }),
    mk('Initech', { companyOutreach: { companyContactsSentToday: 1 } }),
  ];
  assignPerCompanyDailyHeld(items, { perCompany: 3 });
  // row0 held (already messaged today); rows 1-2 fill the remaining 2 slots; row3 held.
  check(JSON.stringify(items.map(i => i.heldDaily)) === JSON.stringify([true, false, false, true]),
    'already-messaged-today contact is held and does not eat an extra slot');
}

// Blocked/capped rows do not spend a company's daily slots.
{
  const items = [
    mk('Umbrella', { inmailBlocked: true }),
    mk('Umbrella', { capped: true }),
    mk('Umbrella'), mk('Umbrella'), mk('Umbrella'),
  ];
  assignPerCompanyDailyHeld(items, { perCompany: 3 });
  // The 3 real rows all fit under the cap because the blocked/capped rows spent nothing.
  check(items[2].heldDaily === false && items[3].heldDaily === false && items[4].heldDaily === false,
    'inmailBlocked / capped rows do not consume daily slots');
}

// Companies are independent.
{
  const items = [mk('A'), mk('A'), mk('B'), mk('A'), mk('B')];
  assignPerCompanyDailyHeld(items, { perCompany: 2 });
  check(items[0].heldDaily === false && items[1].heldDaily === false && items[3].heldDaily === true,
    'per-company counters are independent (A hits its cap without affecting B)');
  check(items[2].heldDaily === false && items[4].heldDaily === false,
    'B still has slots after A is capped');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
