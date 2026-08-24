#!/usr/bin/env node
/**
 * stakeholder-gap.test.mjs pins the asymmetric same-day company guard.
 * All contacts and companies are invented .example fixtures.
 *
 * Run: node tests/stakeholder-gap.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { _companyOutreachFor } from '../dashboard-web/server/lib/followups.mjs';
import { canContact } from '../dashboard-web/server/lib/outreach-policy.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('stakeholder-gap.test.mjs');

const TODAY = '2026-08-24';
const TOMORROW = '2026-08-25';
const POLICY = {
  minDaysBetweenTouches: 0,
  maxTouchesPer30d: Number.POSITIVE_INFINITY,
  awaitingReplyHold: 0,
  coldOutreachCap: { linkedin: Number.POSITIVE_INFINITY, email: Number.POSITIVE_INFINITY },
  perCompanyPerDay: Number.POSITIVE_INFINITY,
  inmailReserveFloor: 0,
};
const decision = (overrides = {}) => canContact({
  timeline: [],
  channel: 'email',
  source: 'ta',
  company: 'Northwind.example',
  companyTouches: { count: 0, influentialSentToday: true },
  canInfluence: false,
  policy: POLICY,
  now: new Date(`${TODAY}T12:00:00Z`),
  ...overrides,
});
const hasGap = result => result.blocks.some(b => b.rule === 'sameDayStakeholderGap');

check(hasGap(decision()), 'a talent contact is held after a same-day decision-maker touch');
check(hasGap(decision({ source: 'agency' })), 'an agency contact is held after a same-day decision-maker touch');
check(!hasGap(decision({ canInfluence: true })), 'a hiring manager is not held after a same-day decision-maker touch');
check(!hasGap(decision({ companyTouches: { count: 0, influentialSentToday: false } })), 'nobody is held without a same-day decision-maker touch');
check(!hasGap(decision({ source: 'referral' })), 'a referral is exempt from the stakeholder gap');
check(!hasGap(decision({ company: '' })), 'a blank company is exempt from the stakeholder gap');
const heldAlone = decision();
check(heldAlone.nextEligible === TOMORROW, 'the stakeholder gap clears tomorrow');
const heldWithCap = decision({
  companyTouches: { count: 3, influentialSentToday: true },
  policy: { ...POLICY, perCompanyPerDay: 3 },
});
check(hasGap(heldWithCap) && heldWithCap.blocks.some(b => b.rule === 'perCompanyPerDay'), 'the stakeholder gap and daily cap can fire together');

const touch = (overrides = {}) => ({
  key: 'ta:2',
  name: 'Alex Morgan',
  date: TODAY,
  direction: 'Sent',
  channel: 'email',
  tier: 'hm',
  ...overrides,
});
const outreach = touches => _companyOutreachFor('ta:1', touches, TODAY);

check(outreach([touch()]).influentialSentToday, 'a same-day Sent touch to a different hiring manager sets the signal');
check(!outreach([touch({ tier: 'ta' })]).influentialSentToday, 'a same-day Sent touch to a different talent contact does not set the signal');
check(!outreach([touch({ key: 'ta:1' })]).influentialSentToday, "this contact's own same-day touch does not set the signal");
check(!outreach([touch({ direction: 'Received' })]).influentialSentToday, 'a same-day Received message from an influential contact does not set the signal');
check(!outreach([touch({ date: '2026-08-23' })]).influentialSentToday, 'a prior-day Sent touch to an influential contact does not set the signal');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
