#!/usr/bin/env node
/**
 * inbound-classify.test.mjs tests conservative inbound message classification.
 *
 * Run: node tests/inbound-classify.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { classifyInbound } from '../lib/inbound-classify.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('inbound-classify.test.mjs');

const cases = [
  ['Automatic reply: Following up on my application', '', 'auto-reply'],
  ['Auto-Reply: your message', '', 'auto-reply'],
  ['Out of Office: re your note', '', 'auto-reply'],
  ['OOO 3/1 - 3/8 Re: a role', '', 'auto-reply'],
  ['', 'Thank you for your email. I am currently out of the office and will return next week.', 'auto-reply'],
  ['', 'I am on vacation until the end of the month.', 'auto-reply'],
  ['', 'Ada Vance is no longer with Northwind. Please contact someone else.', 'departure'],
  ['', 'I am no longer at the company as of last month.', 'departure'],
  ['Automatic reply: your note', 'Jordan Lee has left the company. Please use the team inbox.', 'departure'],
  ['', 'Thanks for reaching out. I am not the lead on this role, so I will pass it on.', 'human'],
  ['', 'Sorry for the slow reply, I was out of the office last week. Happy to chat Thursday.', 'human'],
  ['', "Let's connect. Are you free Tuesday?", 'human'],
  ['', '', 'human'],
  [undefined, 'Thanks for the thoughtful note. The team will review it.', 'human'],
  ['Accepted LinkedIn connection request', '', 'acceptance'],
];

for (const [subject, body, expected] of cases) {
  const actual = classifyInbound({ subject, body, direction: 'Received' });
  check(actual === expected, `${JSON.stringify(subject)} classifies as ${expected}`);
}

for (const value of [null, {}, undefined]) {
  check(classifyInbound(value) === 'human', `${String(value)} safely defaults to human`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
