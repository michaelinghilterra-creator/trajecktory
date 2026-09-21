#!/usr/bin/env node
/**
 * contact-channel-bucket.test.mjs - unit tests for the per-contact outreach
 * channel classifier retained independently of sequence due-date surfacing.
 */

import { contactChannelBucket } from '../dashboard-web/server/lib/followups.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

console.log('contact-channel-bucket.test.mjs');

const contact = (email, state, linkedin) => ({
  email: email || '',
  verified: { state: state || 'unverified', address: email || '' },
  linkedin: linkedin || '',
});

const emailOnly = contact('a@acme.example', 'ok', '');
const linkedInOnly = contact('', 'unverified', 'linkedin.com/in/someone');
const both = contact('b@acme.example', 'ok', 'linkedin.com/in/someone');
const neither = contact('', 'unverified', '');
const unverifiedEmailWithLinkedIn = contact('c@acme.example', 'unverified', 'linkedin.com/in/someone');

check(contactChannelBucket(emailOnly).bucket === 2, 'verified email + no LinkedIn -> bucket 2');
check(contactChannelBucket(linkedInOnly).bucket === 1, 'no email + LinkedIn -> bucket 1');
check(contactChannelBucket(both).bucket === 3, 'verified email + LinkedIn -> bucket 3');
check(contactChannelBucket(neither).bucket === 0, 'no channels -> bucket 0');
check(contactChannelBucket(unverifiedEmailWithLinkedIn).bucket === 1,
  'unverified email + LinkedIn -> bucket 1');
check(contactChannelBucket(both).hasEmail === true, 'bucket 3 has email');
check(contactChannelBucket(both).hasLinkedIn === true, 'bucket 3 has LinkedIn');
check(contactChannelBucket(linkedInOnly).hasEmail === false, 'LinkedIn-only has no email');

console.log(`\ncontact channel bucket: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
