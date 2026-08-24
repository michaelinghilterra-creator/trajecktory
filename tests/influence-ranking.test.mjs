#!/usr/bin/env node
/**
 * influence-ranking.test.mjs pins influence ordering and the InMail reserve.
 * All contacts and companies are invented .example fixtures.
 *
 * Run: node tests/influence-ranking.test.mjs   (exit 0 = pass, 1 = fail)
 */

import os from 'os';
import path from 'path';

// Point all optional book and correspondence lookups at an absent temp path so
// this fixture can exercise queue shaping without reading the user's data.
process.env.TJK_DATA_DIR = path.join(os.tmpdir(), `tjk-influence-ranking-${process.pid}`);

const { _followupRank, computeFollowupQueue } = await import('../dashboard-web/server/lib/followups.mjs');
const { canContact } = await import('../dashboard-web/server/lib/outreach-policy.mjs');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('influence-ranking.test.mjs');

const rankRow = (overrides = {}) => ({
  source: 'ta',
  influenceTier: 'ta',
  channel: 'email',
  status: 'Not Contacted',
  companyOutreach: {},
  ...overrides,
});

const referralRank = _followupRank(rankRow({ source: 'referral', influenceTier: 'ta' }));
check(_followupRank(rankRow({ influenceTier: 'hm' })) > referralRank, 'a hiring manager outranks an otherwise identical warm referral');
check(_followupRank(rankRow({ influenceTier: 'peer' })) < referralRank, 'a warm referral outranks an otherwise identical cold peer');
check(_followupRank(rankRow({ influenceTier: 'ta' })) === _followupRank(rankRow({ influenceTier: 'agency' })), 'TA and agency tiers score identically when all else matches');
check(_followupRank(rankRow({ influenceTier: 'unknown' })) === _followupRank(rankRow({ influenceTier: 'ta' })), 'an unknown tier adds no influence bonus');

const legacy = {
  id: 1,
  first: 'Alex',
  last: 'Morgan',
  title: 'Hiring Lead',
  company: 'Northwind.example',
  email: 'alex.morgan@northwind.example',
  verified: { state: 'ok' },
  linkedin: '',
  status: 'Not Contacted',
  notes: '',
  isPrincipal: true,
};
const legacyQueue = computeFollowupQueue({
  taRows: [legacy],
  referralRows: [],
  influencers: [],
  apps: [{ company: 'Northwind.example', status: 'Applied' }],
  pins: [],
});
check(legacyQueue[0]?.influenceTier === 'hm' && legacyQueue[0]?.rank === _followupRank(rankRow({ influenceTier: 'hm' })), 'a legacy principal without a tier resolves and scores as hm');

const reservePolicy = {
  minDaysBetweenTouches: 0,
  maxTouchesPer30d: Number.POSITIVE_INFINITY,
  awaitingReplyHold: 0,
  coldOutreachCap: { linkedin: Number.POSITIVE_INFINITY, email: Number.POSITIVE_INFINITY },
  perCompanyPerDay: Number.POSITIVE_INFINITY,
  inmailReserveFloor: 3,
};
const inmailDecision = (inmail, channel = 'linkedin') => canContact({
  timeline: [],
  channel,
  source: 'ta',
  company: 'Northwind.example',
  inmail: { alreadyInvited: true, freeDm: false, exhausted: false, canInfluence: false, ...inmail },
  policy: reservePolicy,
  now: new Date('2026-08-24T12:00:00Z'),
});

check(inmailDecision({ remaining: 4 }).allowed, 'a low-influence LinkedIn row is allowed above the reserve floor');
check(inmailDecision({ remaining: 3 }).blocks.some(b => b.rule === 'inmailReserve'), 'a low-influence LinkedIn row is reserved at the floor');
check(inmailDecision({ remaining: 3, canInfluence: true }).allowed, 'a decision-maker is allowed at the reserve floor');
const exhausted = inmailDecision({ remaining: 0, exhausted: true });
check(exhausted.blocks.length === 1 && exhausted.blocks[0].rule === 'inmailBudget', 'an exhausted allowance fires only the hard InMail budget block');
check(inmailDecision({ remaining: 0, exhausted: true }, 'email').allowed, 'email is untouched by both InMail rules');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
