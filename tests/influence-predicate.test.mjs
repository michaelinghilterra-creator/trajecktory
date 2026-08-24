#!/usr/bin/env node
/**
 * influence-predicate.test.mjs pins the OLD versus NEW classification side by
 * side, so a future change to either axis is visible rather than silent.
 *
 * Run: node tests/influence-predicate.test.mjs   (exit 0 = pass, 1 = fail)
 */

import {
  influenceRank,
  canInfluenceHire,
  isHighValueContact,
  contactChannelBucket,
} from '../dashboard-web/server/lib/followups.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('influence-predicate.test.mjs');

const ta = (o = {}) => ({
  id: o.id,
  first: o.first || 'Alex',
  last: o.last || 'Morgan',
  title: o.title || 'Talent Partner',
  company: o.company || 'Northwind.example',
  email: o.email || '',
  verified: { state: o.state || 'unverified' },
  linkedin: o.linkedin || '',
  status: o.status || 'Not Contacted',
  notes: o.notes || '',
  influenceTier: o.influenceTier,
});

const ranks = { hm: 4, exec: 3, peer: 2, ta: 1, agency: 0 };
for (const [tier, rank] of Object.entries(ranks)) {
  check(influenceRank(ta({ influenceTier: tier })) === rank, `${tier} has documented rank ${rank}`);
}

check(influenceRank(ta({})) === ranks.ta, 'missing tier falls back to the ta rank');
for (const tier of ['cro', null, 42]) {
  check(influenceRank(ta({ influenceTier: tier })) === ranks.ta, `${String(tier)} falls back to the ta rank`);
}

for (const row of [{}, undefined]) {
  let threw = false;
  try { influenceRank(row); } catch { threw = true; }
  check(!threw, `influenceRank(${String(row)}) does not throw`);
}

const classifications = [
  ['hm', true],
  ['exec', true],
  ['peer', true],
  ['ta', false],
  ['agency', false],
  [undefined, false],
];
for (const [tier, expected] of classifications) {
  const row = ta({ influenceTier: tier });
  check(canInfluenceHire(row) === expected, `${String(tier)} influence classification is ${expected}`);
  check(isHighValueContact(row) === canInfluenceHire(row), `${String(tier)} alias matches canInfluenceHire`);
}

const unreachableHm = ta({ influenceTier: 'hm' });
check(isHighValueContact(unreachableHm), 'hm with neither channel is high value');

const reachableTa = ta({
  influenceTier: 'ta',
  email: 'alex.morgan@northwind.example',
  state: 'ok',
  linkedin: 'linkedin.example/in/alex-morgan',
});
check(!isHighValueContact(reachableTa), 'ta with both channels is not high value');

const peerSameChannels = { ...reachableTa, influenceTier: 'peer' };
check(
  contactChannelBucket(reachableTa).bucket === contactChannelBucket(peerSameChannels).bucket,
  'reachability bucket is blind to influence tier',
);

const oldIsHighValue = row => contactChannelBucket(row).bucket === 3;
check(
  oldIsHighValue(reachableTa) !== isHighValueContact(reachableTa),
  'old and new classifications disagree for a ta contact with both channels',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
