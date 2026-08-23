#!/usr/bin/env node
import { canContact } from '../dashboard-web/server/lib/outreach-policy.mjs';
import { parseOutreachPolicy, OUTREACH_DEFAULTS } from '../dashboard-web/server/lib/profile.mjs';

let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) { console.log(`  ✅ ${msg}`); passed++; } else { console.log(`  ❌ ${msg}`); failed++; } };
const now = new Date('2026-08-22T12:00:00Z');
const sent = (date, channel = 'Email', direction = 'Sent', subject = 'Hello') => ({ at: `${date}T09:00:00Z`, direction, channel, subject, body: 'A substantive note.' });
const decide = (timeline, extra = {}) => canContact({ timeline, channel: 'email', now, policy: { awaitingReplyHold: 0, maxTouchesPer30d: 99, coldOutreachCap: { email: 99, linkedin: 99 } }, ...extra });

console.log('outreach-policy.test.mjs');
let result = decide([sent('2026-08-20')]);
check(!result.allowed && result.blocks.some(b => b.rule === 'minDaysBetweenTouches'), 'same channel touch 2 days ago blocks');
check(result.nextEligible === '2026-08-23', 'next eligible is one day out');
result = decide([sent('2026-08-20', 'LinkedIn')]);
check(!result.blocks.some(b => b.rule === 'minDaysBetweenTouches'), 'different channel does not trigger the gap');
result = decide([sent('2026-08-18')]);
check(!result.blocks.some(b => b.rule === 'minDaysBetweenTouches'), 'touch 4 days ago does not trigger the gap');
result = decide([sent('2026-08-21', 'Email', 'Draft')]);
check(result.allowed, 'a draft does not block');

const capPolicy = { minDaysBetweenTouches: 0, awaitingReplyHold: 0, maxTouchesPer30d: 99, coldOutreachCap: { email: 1, linkedin: 1 } };
result = canContact({ timeline: [sent('2026-08-10'), sent('2026-08-11', 'Email', 'Received', 'Reply')], channel: 'email', now, policy: capPolicy });
check(!result.blocks.some(b => b.rule === 'coldOutreachCap'), 'inbound reply lifts the cold outreach cap');

// source and company are required for the per-company rule to apply at all: it is
// skipped for the exempt books and for a blank company, so a fixture without them
// would be asserting on four blocks while claiming five.
result = canContact({ timeline: [sent('2026-08-19'), sent('2026-08-20')], channel: 'email', source: 'ta', company: 'Acme', companyTouches: 3, now, policy: { maxTouchesPer30d: 2, awaitingReplyHold: 10, coldOutreachCap: { email: 2, linkedin: 3 }, perCompanyPerDay: 3 } });
check(result.blocks.length >= 5, 'all simultaneous blocks are returned');
check(result.nextEligible === null, 'a cap with no reply has no next eligible date');
check(canContact({ timeline: [sent('2026-08-22')], policy: { enabled: false }, now }).allowed, 'disabled policy allows everything');
check(!canContact({ timeline: [sent('2026-08-20')], channel: 'email', now }).allowed, 'absent policy fields use documented defaults');

for (const raw of ['', 'abc', '-1', undefined]) {
  const value = raw === undefined ? '' : raw;
  const text = `outreach:\n  enabled: true\n${raw === undefined ? '' : `  minDaysBetweenTouches: ${value}\n`}`;
  const parsed = parseOutreachPolicy(text);
  check(parsed.minDaysBetweenTouches === OUTREACH_DEFAULTS.minDaysBetweenTouches, `invalid numeric value ${raw === undefined ? 'missing' : JSON.stringify(raw)} uses the default`);
}

// A DM to someone who ACCEPTED your invite costs no InMail credit, so an empty
// credit balance must not block it. This regressed for referrals specifically: the
// connection axis is a target-talent sidecar keyed by TA id, so a guard stopped it
// being read with a referral id, and the guard was then treated as "a referral is
// never connected". An accepted referral was told no credits remained on a card
// that said, two lines above, that the message was a free DM.
//
// The caller derives freeDm from the merged person timeline now, so the assertion
// here is the rule it feeds: freeDm wins over an exhausted balance regardless of
// which book the contact came from.
{
  const exhausted = { exhausted: true, alreadyInvited: true };
  const ask = (source, freeDm) => canContact({
    timeline: [], channel: 'linkedin', source, company: 'Acme',
    inmail: { ...exhausted, freeDm },
    policy: { minDaysBetweenTouches: 0, maxTouchesPer30d: Infinity, awaitingReplyHold: 0, perCompanyPerDay: 99 },
    now,
  }).blocks.some(b => b.rule === 'inmailBudget');

  check(ask('referral', true) === false, 'an accepted referral is a free DM, not an InMail block');
  check(ask('ta', true) === false, 'an accepted target-talent contact is a free DM too');
  check(ask('referral', false) === true, 'a referral who has NOT accepted still blocks at zero credits');
  check(ask('ta', false) === true, 'and so does a target-talent contact');
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
