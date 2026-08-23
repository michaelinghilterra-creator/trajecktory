#!/usr/bin/env node
import { linkedinKey, contactRef } from '../dashboard-web/server/lib/contact-identity.mjs';

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
};

console.log('contact-identity.test.mjs');

console.log('\n1. Missing values');
for (const value of ['', null, undefined]) {
  check(linkedinKey(value) === '', `empty key for ${String(value)}`);
}

console.log('\n2. Sentinel values');
for (const value of ['n/a', '-', 'none']) {
  check(linkedinKey(value) === '', `empty key for ${value}`);
}

console.log('\n3. Non-profile identities');
check(linkedinKey('https://www.linkedin.com/company/acme-ex') === '', 'company URL is empty');
check(linkedinKey('jane@example.com') === '', 'email is empty');

console.log('\n4. Equivalent profile spellings');
const variants = [
  'https://www.linkedin.com/in/jane-doe-ex',
  'http://www.linkedin.com/in/jane-doe-ex/',
  'https://in.linkedin.com/in/jane-doe-ex',
  'linkedin.com/in/jane-doe-ex',
  'https://www.linkedin.com/in/jane-doe-ex?utm_source=x',
  'https://www.linkedin.com/in/Jane-Doe-EX',
  'https://www.linkedin.com/in/jane-doe-ex (personal)',
];
for (const value of variants) {
  check(linkedinKey(value) === 'jane-doe-ex', `${value} has the literal key jane-doe-ex`);
}

console.log('\n5. Encoded and literal Unicode');
const encoded = linkedinKey('https://www.linkedin.com/in/jos%C3%A9-ex');
const literal = linkedinKey('https://www.linkedin.com/in/josé-ex');
check(encoded === 'josé-ex', 'encoded profile has the literal key josé-ex');
check(literal === 'josé-ex', 'literal profile has the literal key josé-ex');
check(encoded === literal, 'encoded and literal profiles agree');

console.log('\n6. Distinct profiles');
check(
  linkedinKey('https://www.linkedin.com/in/jane-doe-ex') !==
    linkedinKey('https://www.linkedin.com/in/john-doe-ex'),
  'different people do not collide',
);

console.log('\n7. Bounded input');
const longKey = linkedinKey('https://www.linkedin.com/in/' + 'a'.repeat(5000));
check(longKey.length === 1972, 'long input key is bounded to 1972 characters');

console.log('\n8. Stable contact references');
check(contactRef('ta', 42) === 'ta:42', 'TA reference is ta:42');
check(contactRef('referral', 7) === 'referral:7', 'referral reference is referral:7');
check(contactRef('ta', null) === '', 'null id is empty');
check(contactRef('', 1) === '', 'missing source is empty');
// Route params arrive as strings, so a numeric string must normalize rather
// than silently return '' at the call sites most likely to pass one.
check(contactRef('ta', '42') === 'ta:42', 'numeric string id normalizes');
check(contactRef('ta', 'abc') === '', 'non-numeric string id is empty');
check(contactRef('ta', 4.5) === '', 'fractional id is empty');
check(contactRef('ta', '') === '', 'empty string id is empty');

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
