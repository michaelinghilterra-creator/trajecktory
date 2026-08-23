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

result = canContact({ timeline: [sent('2026-08-19'), sent('2026-08-20')], channel: 'email', companyTouches: 3, now, policy: { maxTouchesPer30d: 2, awaitingReplyHold: 10, coldOutreachCap: { email: 2, linkedin: 3 }, perCompanyPerDay: 3 } });
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

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
