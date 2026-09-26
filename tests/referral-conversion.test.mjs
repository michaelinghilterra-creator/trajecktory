import { referralConversion } from '../dashboard-web/server/lib/insights.mjs';
import { FUNNEL_ORDER, REFERRAL_STATES } from '../dashboard-web/server/lib/statuses.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const referralStatus = id => REFERRAL_STATES.find(state => state.id === id)?.label;
for (const id of ['applied_referral', 'intro_made']) {
  check(Boolean(referralStatus(id)), `referral state ${id} exists`);
}

const result = referralConversion(
  [
    { id: 900001, status: referralStatus('applied_referral') },
    { id: 900002, status: referralStatus('applied_referral') },
    { id: 900003, status: referralStatus('applied_referral') },
    { id: 900004, status: referralStatus('intro_made') },
  ],
  [
    { id: 900011, status: 'Applied', source: 'Referral' },
    { id: 900012, status: 'Phone Screen', source: 'Agent Scan' },
    { id: 900013, status: FUNNEL_ORDER[0], source: 'Referral' },
    { id: 900014, status: 'Closed', source: 'Referral' },
    { id: 900015, status: 'Passed', reached: 'Phone Screen', source: 'Referral' },
  ],
);

check(result.available === true, 'referral conversion is available when the referral book has rows');
check(result.referredApplications === 2, 'the numerator is submitted tracker rows sourced by referral');
check(result.introductions === 1, 'introductions still come from the referral book');
check(result.denominator === 3 && result.percentage === 66.7, 'the denominator is all submitted applications');
check(result.percentage <= 100, 'referral conversion cannot exceed 100 percent');

const withoutBook = referralConversion([], [{ id: 900021, status: 'Applied', source: 'Referral' }]);
check(withoutBook.available === true && withoutBook.referredApplications === 1
  && withoutBook.denominator === 1 && withoutBook.percentage === 100,
  'submitted tracker rows make conversion available when the referral book is empty');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
