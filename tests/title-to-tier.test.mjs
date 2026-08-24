#!/usr/bin/env node
/**
 * title-to-tier.test.mjs tests the pure, title-based influence proposal.
 * Every title is an invented fixture rather than a copy of user or scan data.
 *
 * Run: node tests/title-to-tier.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { INFLUENCE_TRACKS, classifyTitle } from '../lib/influence-tier.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('title-to-tier.test.mjs');

const cases = [
  ['VP Revenue Operations', 'revops', 'hm'],
  ['Vice President of Revenue Operations', 'revops', 'hm'],
  ['Revenue Operations Director', 'revops', 'hm'],
  ['Senior Director, Sales Operations', 'revops', 'hm'],
  ['Head of GTM Operations', 'revops', 'hm'],
  ['Chief Revenue Officer', 'revops', 'hm'],
  ['Chief Revenue Officer', 'salesdev', 'hm'],
  ['VP Business Intelligence', 'revops', 'hm'],

  ['Chief Executive Officer', 'revops', 'exec'],
  ['President', 'revops', 'exec'],
  ['Chief Operating Officer', 'revops', 'exec'],
  ['Chief Financial Officer', 'revops', 'exec'],
  ['EVP Corporate Strategy', 'revops', 'exec'],

  ['VP Demand Generation', 'revops', 'peer'],
  ['Director of Sales Enablement', 'revops', 'peer'],
  ['Head of Customer Success', 'revops', 'peer'],
  ['Manager, Revenue Operations', 'revops', 'peer'],
  ['VP Sales Development', 'revops', 'peer'],

  ['Talent Acquisition Partner', 'revops', 'ta'],
  ['Director of Recruiting', 'revops', 'ta'],
  ['Head of People', 'revops', 'ta'],
  ['VP Human Resources', 'revops', 'ta'],

  ['Executive Search Consultant', 'revops', 'agency'],
  ['Managing Director, Executive Search', 'revops', 'agency'],
  ['Staffing Partner', 'revops', 'agency'],

  ['Revenue Ops Analyst', 'revops', null],
  ['Sales Operations Associate', 'revops', null],
  ['Business Intelligence Specialist', 'revops', null],
  ['Sales Development Representative', 'revops', null],
  ['Marketing Coordinator', 'revops', null],

  ['VP Manufacturing', 'revops', null],
  ['Director of Facilities', 'revops', null],
  ['Head of Legal', 'revops', null],

  // "partner" is a function word inside a company, not a seniority word. Reading
  // it as C-level turned every partnerships role into a skip-level executive.
  ['Partner Manager', 'revops', null],
  ['Channel Partner Manager', 'revops', null],
  ['Business Development Partner', 'revops', null],
  // The two phrases where it does carry weight resolve by function group first.
  ['Talent Acquisition Partner', 'revops', 'ta'],
  ['Search Partner, Revenue Leadership', 'revops', 'agency'],

  ['VP Sales Development', 'salesdev', 'hm'],
  ['Director of Revenue Operations', 'revops', 'hm'],
  ['Director of Revenue Operations', 'salesdev', 'peer'],

  ['Directory Services Manager', 'revops', null],
  ['Chairperson', 'revops', null],

  ['Sales Operations Manager', 'revops', 'peer'],
  ['Sales Enablement Director', 'revops', 'peer'],
  ['Technical Recruiter, Revenue Teams', 'revops', 'ta'],
];

for (const [title, track, expected] of cases) {
  check(
    classifyTitle(title, { track }) === expected,
    `${JSON.stringify(title)} on ${track} classifies as ${String(expected)}`,
  );
}

for (const title of ['', null, undefined, 42]) {
  check(classifyTitle(title) === null, `${String(title)} returns null without throwing`);
}

check(
  classifyTitle('VP Revenue Operations', { track: 'unknown' }) === 'hm',
  'an unknown track falls back to revops',
);
check(Object.isFrozen(INFLUENCE_TRACKS), 'the exported track vocabulary is frozen');
check(
  INFLUENCE_TRACKS.join(',') === 'revops,salesdev',
  'the exported track vocabulary contains only supported tracks',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
