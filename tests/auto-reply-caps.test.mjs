#!/usr/bin/env node
/**
 * auto-reply-caps.test.mjs pins how inbound classification affects outreach caps.
 *
 * Run: node tests/auto-reply-caps.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { outreachCapState } from '../dashboard-web/server/lib/correspondence-context.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('auto-reply-caps.test.mjs');

const sent = Array.from({ length: 3 }, (_, i) => ({
  direction: 'Sent',
  channel: 'LinkedIn',
  subject: `LinkedIn message ${i + 1}`,
  body: 'Invented outreach fixture.',
}));
const received = (subject, body) => ({ direction: 'Received', channel: 'Email', subject, body });
const autoReply = received('Automatic reply: your note', 'I am out of the office this week.');
const departure = received('Staffing update', 'Morgan Reed is no longer with Northwind.');
const acceptance = received('Accepted LinkedIn connection request', '');
const human = received('Re: your note', 'Thanks for reaching out. I would be glad to talk.');

const autoState = outreachCapState([...sent, autoReply]);
check(autoState.linkedin.capped === true, 'an automatic reply does not lift a reached LinkedIn cap');

const humanState = outreachCapState([...sent, human]);
check(humanState.linkedin.capped === false, 'a genuine human reply lifts a reached LinkedIn cap');

for (const [message, expected, label] of [
  [autoReply, false, 'automatic reply'],
  [departure, false, 'departure notice'],
  [acceptance, false, 'invite acceptance'],
  [human, true, 'human reply'],
]) {
  check(outreachCapState([...sent, message]).hasReply === expected, `hasReply is ${expected} for an ${label}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
