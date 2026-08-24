#!/usr/bin/env node
/**
 * stakeholder-sequences.test.mjs pins the outreach template contract and the
 * pure stakeholder-to-sequence suggestion. Every contact is invented.
 *
 * Run: node tests/stakeholder-sequences.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { suggestSequenceId } from '../dashboard-web/server/lib/sequences.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const library = JSON.parse(fs.readFileSync(join(ROOT, 'templates', 'outreach-sequences.json'), 'utf8'));
const sequences = library.sequences;
const sequenceIds = new Set(sequences.map(sequence => sequence.id));

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('stakeholder-sequences.test.mjs');

check(sequenceIds.size === sequences.length, 'every sequence id is unique');
check(
  sequences.every(sequence => ['label', 'scenario', 'channel'].every(
    field => typeof sequence[field] === 'string' && sequence[field].trim() !== '',
  )),
  'every sequence has a non-empty label, scenario and channel',
);
check(
  sequences.every(sequence => ['email', 'linkedin'].includes(sequence.channel)),
  'every sequence channel is email or linkedin',
);

for (const sequence of sequences) {
  check(Array.isArray(sequence.touches) && sequence.touches.length > 0,
    `${sequence.id} has a non-empty touches array`);
  check(
    sequence.touches.every((touch, index) => touch.step === index + 1),
    `${sequence.id} touch steps start at 1 and increase by 1`,
  );
  check(
    sequence.touches.every(touch => typeof touch.tone === 'string' && touch.tone.trim() !== ''),
    `${sequence.id} has a non-empty tone for every touch`,
  );
  check(
    sequence.touches.every(touch => typeof touch.dayOffset === 'number' && touch.dayOffset >= 0),
    `${sequence.id} day offsets are non-negative numbers`,
  );
  check(
    sequence.touches.every((touch, index) => index === 0
      || touch.dayOffset >= sequence.touches[index - 1].dayOffset),
    `${sequence.id} day offsets never decrease`,
  );
  if (sequence.id.startsWith('cold-intro-')) {
    check(sequence.touches[0].dayOffset === 0, `${sequence.id} starts at day offset 0`);
  }
}

const requiredIds = [
  'cold-intro-cro',
  'cold-intro-cfo',
  'cold-intro-vp-sales',
  'cold-intro-demandgen',
];
for (const id of requiredIds) check(sequenceIds.has(id), `${id} is present`);

check(
  sequences.every(sequence => sequence.touches.every(
    touch => !/\d\s*%|[$€£¥]\s*\d|\d\s*[$€£¥]/.test(touch.tone),
  )),
  'tone strings contain no hardcoded percentage or currency claims',
);

const cases = [
  [{ tier: 'exec', title: 'Chief Financial Officer' }, 'email', 'cold-intro-cfo'],
  [{ tier: 'exec', title: 'Chief Revenue Officer' }, 'email', 'cold-intro-cro'],
  [{ tier: 'hm', title: 'VP of Sales' }, 'email', 'cold-intro-vp-sales'],
  [{ tier: 'peer', title: 'Demand Generation Lead' }, 'email', 'cold-intro-demandgen'],
  [{ tier: 'ta', title: 'Talent Acquisition Partner' }, 'email', 'cold-intro-ta'],
  [{ tier: 'agency', title: 'Executive Search Consultant' }, 'email', 'cold-intro-ta'],
  [{ tier: 'hm', title: 'Director of Revenue Operations' }, 'email', 'cold-intro-principal'],
  [{ tier: 'exec', title: 'Chief Operating Officer' }, 'linkedin', 'linkedin-connect-principal'],
  [{ tier: 'ta', title: 'Recruiter' }, 'linkedin', 'linkedin-connect-ta'],
  [{ title: 'VP of Sales' }, 'email', null],
];

for (const [contact, channel, expectedId] of cases) {
  const actual = suggestSequenceId(contact, { channel });
  check(
    actual === expectedId,
    `${JSON.stringify(contact)} on ${channel} routes to ${String(expectedId)}`,
  );
  check(actual === null || sequenceIds.has(actual), `${String(actual)} exists in the template library`);
}

for (const contact of [null, {}]) {
  let result;
  let threw = false;
  try { result = suggestSequenceId(contact); }
  catch { threw = true; }
  check(!threw && result === null, `${JSON.stringify(contact)} returns null without throwing`);
}

const returnCoverageCases = [
  [{ tier: 'ta', title: 'Recruiter' }, 'email'],
  [{ tier: 'hm', title: 'Operations Director' }, 'email'],
  [{ tier: 'hm', title: 'VP Sales' }, 'email'],
  [{ tier: 'peer', title: 'Marketing Director' }, 'email'],
  [{ tier: 'exec', title: 'CFO' }, 'email'],
  [{ tier: 'exec', title: 'CRO' }, 'email'],
  [{ tier: 'ta', title: 'Recruiter' }, 'linkedin'],
  [{ tier: 'hm', title: 'Operations Director' }, 'linkedin'],
];
const possibleIds = new Set(returnCoverageCases.map(([contact, channel]) =>
  suggestSequenceId(contact, { channel })));
check(
  [...possibleIds].every(id => sequenceIds.has(id)),
  'every sequence id the suggestion function can return exists in the library',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
