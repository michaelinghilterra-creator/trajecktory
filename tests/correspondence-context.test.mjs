#!/usr/bin/env node
/**
 * correspondence-context.test.mjs — summarizeThread(): does a drafter have what it
 * needs to write the NEXT message instead of re-pitching? Pure + deterministic
 * (a fixed `now`), so no sandbox or I/O.
 */
import { summarizeThread, outreachCapState, isChannelCapped, COLD_OUTREACH_CAPS } from '../dashboard-web/server/lib/correspondence-context.mjs';

let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) { console.log(`  ✅ ${msg}`); passed++; } else { console.log(`  ❌ ${msg}`); failed++; } };
console.log('correspondence-context.test.mjs');

const now = new Date('2026-08-20T12:00:00');
const invite = { timestamp: '2026-08-01 09:00', direction: 'Sent', channel: 'LinkedIn', subject: 'LinkedIn connection request', body: 'Would love to connect.' };
const pitch5d = { timestamp: '2026-08-15 16:54', direction: 'Sent', channel: 'LinkedIn', subject: 'LinkedIn message', body: 'I applied for the RevOps role, here is why I fit.' };

// Empty thread
const a = summarizeThread([], { now });
check(a.count === 0 && a.recentPitch === false, 'empty thread: no recent pitch');
check(/no prior messages/i.test(a.stateLine), 'empty thread: state line says none on file');

// Only a connection-request invite — a handshake, not a pitch
const b = summarizeThread([invite], { now });
check(b.lastSub === null && b.recentPitch === false, 'invite only: not a substantive pitch');
check(/only a connection request/i.test(b.stateLine), 'invite only: state line reflects handshake-only');

// Invite + a substantive message 5 days ago, no reply → nudge mode
const c = summarizeThread([invite, pitch5d], { now });
check(c.recentPitch === true, 'substantive message 5d ago, unanswered → recentPitch true');
check(c.daysSinceLastSub === 5, 'daysSinceLastSub computed correctly (5)');
check(/nudge/i.test(c.stateLine), 'state line flags nudge, not re-pitch');
check(c.threadBlock.includes('LinkedIn') && c.threadBlock.trim().split('\n').length === 2, 'threadBlock renders both messages with channel');

// Substantive message long ago → outside the recent window
const d = summarizeThread([{ ...pitch5d, timestamp: '2026-07-15 10:00' }], { now });
check(d.recentPitch === false && d.daysSinceLastSub === 36, 'substantive message 36d ago → not recent');

// Substantive message, then a reply → thread moved on, no nudge
const e = summarizeThread([
  { ...pitch5d, timestamp: '2026-08-17 10:00' },
  { timestamp: '2026-08-18 08:00', direction: 'Received', channel: 'LinkedIn', subject: 'Re: LinkedIn message', body: 'Thanks, will take a look.' },
], { now });
check(e.repliedSinceLastSub === true && e.recentPitch === false, 'a reply after the last message clears nudge mode');

// ── outreachCapState / isChannelCapped ───────────────────────────────────────
const capLi = (subject) => ({ direction: 'Sent', channel: 'LinkedIn', subject, body: 'x' });
const capInvite = capLi('LinkedIn connection request');
const capDm = capLi('LinkedIn message');
const capEmail = { direction: 'Sent', channel: 'Email', subject: 'Following up', body: 'x' };
const capAccept = { direction: 'Received', channel: 'LinkedIn', subject: 'Accepted LinkedIn connection request', body: 'Accepted LinkedIn connection request' };
const capReply = { direction: 'Received', channel: 'LinkedIn', subject: 'Re: hi', body: 'thanks, will look' };

check(COLD_OUTREACH_CAPS.linkedin === 3 && COLD_OUTREACH_CAPS.email === 3, 'default caps are 3 / 3');

// LinkedIn: connect (counts) + 2 follow-ups = 3, no reply → capped
const s1 = outreachCapState([capInvite, capDm, capDm]);
check(s1.linkedin.sent === 3 && s1.linkedin.capped === true, 'connect + 2 DMs = 3 LinkedIn touches → capped');
// connect + 1 = 2 → not yet
check(outreachCapState([capInvite, capDm]).linkedin.capped === false, 'connect + 1 DM = 2 → not capped');
// acceptance notice does NOT count as a reply, so the cap still holds
check(outreachCapState([capInvite, capDm, capDm, capAccept]).linkedin.capped === true, 'acceptance notice does not lift the cap');
// a real reply lifts the cap even at/over the ceiling
const s2 = outreachCapState([capInvite, capDm, capDm, capReply]);
check(s2.hasReply === true && s2.linkedin.capped === false, 'a real reply lifts the LinkedIn cap');
// email counted independently
const s3 = outreachCapState([capEmail, capEmail, capEmail]);
check(s3.email.sent === 3 && s3.email.capped === true && s3.linkedin.sent === 0, 'three emails → email capped, LinkedIn untouched');

// isChannelCapped: 'both' rests only when BOTH channels are exhausted
const mixed = outreachCapState([capInvite, capDm, capDm, capEmail]);  // LinkedIn 3 (capped), email 1 (open)
check(isChannelCapped(mixed, 'linkedin') === true, "isChannelCapped('linkedin') true when LinkedIn exhausted");
check(isChannelCapped(mixed, 'email') === false, "isChannelCapped('email') false when email has room");
check(isChannelCapped(mixed, 'both') === false, "isChannelCapped('both') false while one channel is open");
const bothMax = outreachCapState([capInvite, capDm, capDm, capEmail, capEmail, capEmail]);
check(isChannelCapped(bothMax, 'both') === true, "isChannelCapped('both') true when both exhausted");

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
