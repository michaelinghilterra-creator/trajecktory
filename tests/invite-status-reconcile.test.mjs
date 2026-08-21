#!/usr/bin/env node
/**
 * invite-status-reconcile.test.mjs — the invite -> status self-heal.
 *
 * WHY THIS EXISTS
 * A recorded LinkedIn invite must keep the LinkedIn axis at >= 'Invite Pending', so the
 * queue never re-pitches someone already invited (163 contacts drifted before the
 * backfill). earliestInviteDate is the core signal: the date of the first Sent LinkedIn
 * connection request in a contact's correspondence, ignoring emails and received
 * messages. If it stops recognizing an invite, the self-heal silently stops healing.
 *
 * Run: node tests/invite-status-reconcile.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { earliestInviteDate } from '../dashboard-web/server/lib/invite-status-reconcile.mjs';
import { LINKEDIN_INVITE_SUBJECT } from '../dashboard-web/server/lib/channels.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('invite-status-reconcile.test.mjs');

const invite = (d) => ({ timestamp: d, direction: 'Sent', subject: LINKEDIN_INVITE_SUBJECT, body: '' });

check(earliestInviteDate([invite('2026-08-10')]) === '2026-08-10',
  'returns the invite date for a single Sent LinkedIn connection request');
check(earliestInviteDate([invite('2026-08-10 14:00'), invite('2026-07-01')]) === '2026-07-01',
  'returns the EARLIEST invite when several exist (date-only slice)');
check(earliestInviteDate([]) === '',
  'no correspondence -> empty (nothing to advance)');
check(earliestInviteDate([{ timestamp: '2026-08-10', direction: 'Sent', subject: 'Outreach email', body: '' }]) === '',
  'an email touch is NOT an invite');
check(earliestInviteDate([{ timestamp: '2026-08-10', direction: 'Received', subject: LINKEDIN_INVITE_SUBJECT, body: '' }]) === '',
  'a RECEIVED message with the invite subject does not count as an invite you sent');
check(earliestInviteDate([{ timestamp: '2026-08-10', direction: 'Sent', channel: 'LinkedIn', subject: 'LinkedIn connection request (2nd try)', body: '' }]) === '2026-08-10',
  'tolerates trailing detail on the invite subject ("(2nd try)")');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
