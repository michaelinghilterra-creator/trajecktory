import assert from 'node:assert/strict';
import { referralConversion } from '../dashboard-web/server/lib/insights.mjs';
import { CLOSED_STATUSES, FUNNEL_ORDER, OUTREACH_ELIGIBLE_STATUSES, REFERRAL_STATES } from '../dashboard-web/server/lib/statuses.mjs';

const referralStatus = id => REFERRAL_STATES.find(state => state.id === id).label;

// Pin the two state ids the metric depends on. insights.mjs looks them up with
// `?.label`, so renaming one in templates/states.yml would return undefined, match
// no row, and leave the metric reading a confident zero for ever. Without this the
// only thing catching that rename is the missing `?.` above, which someone would
// reasonably "tidy up" and never know what they removed.
for (const id of ['applied_referral', 'intro_made']) {
  const hit = REFERRAL_STATES.find(state => state.id === id);
  if (!hit || !hit.label) {
    console.log(`  FAIL referral state "${id}" no longer exists; referralConversion() will silently read 0`);
    process.exit(1);
  }
}
const live = OUTREACH_ELIGIBLE_STATUSES[0];

const result = referralConversion(
  [
    { id: 7101, status: referralStatus('applied_referral') },
    { id: 7102, status: referralStatus('applied_referral') },
    { id: 7103, status: referralStatus('intro_made') },
    { id: 7104, status: referralStatus('asked') },
  ],
  [
    { id: 7111, status: live },
    { id: 7112, status: live },
    { id: 7113, status: FUNNEL_ORDER[0] },
    { id: 7114, status: CLOSED_STATUSES[0] },
  ],
);

assert.deepEqual(result, {
  available: true,
  referredApplications: 2,
  introductions: 1,
  denominator: 2,
  percentage: 100,
});

assert.deepEqual(referralConversion([], [{ id: 7121, status: live }]), {
  available: false,
  referredApplications: 0,
  introductions: 0,
  denominator: 1,
  percentage: 0,
});

console.log('referral conversion tests passed');
