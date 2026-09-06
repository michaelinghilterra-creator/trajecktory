#!/usr/bin/env node
import {
  checkUnsourcedNumbers,
  gradeIndependently,
  parseAndFinishDraft,
} from '../dashboard-web/server/lib/draft-grader.mjs';

let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

const FIXTURE_CV = 'Cycle time 14 days to 3 hours; 98.2% yield across 4 production lines. $2.3M annual savings.';
const FIXTURE_PROOF_POINTS = [
  { name: 'Sprocket Automation', heroMetric: 'Cycle time 14 days to 3 hours; 98.2% yield across 4 production lines' },
  { name: 'Standardization', heroMetric: 'Unified 6 plants onto single BOM system; $2.3M annual savings' },
];

console.log('draft-grader.test.mjs');

const valid = parseAndFinishDraft(JSON.stringify({
  critique: {
    weakest_dimension: 'clarity',
    fixes: ['Replace the opening with the specific result.'],
  },
  dimensions: [
    { id: 'evidence', score: 8, explanation: 'The result is grounded.' },
    { id: 'clarity', score: 7, explanation: 'The request is clear.' },
  ],
  subject: 'A precise subject',
  body: 'A concise and fully grounded message.',
}), 'ta_email', FIXTURE_CV);
check(valid.subject === 'A precise subject' && valid.body.includes('fully grounded') && valid.review?.score > 0,
  'valid rubric JSON returns the draft and review');

const malformed = parseAndFinishDraft(JSON.stringify({
  critique: { weakest_dimension: 'clarity' },
  dimensions: [{ id: 'not_a_dimension', score: 8 }],
  subject: 'Keep this draft',
  body: 'The draft remains available.',
}), 'ta_email', FIXTURE_CV);
check(malformed.body === 'The draft remains available.' && malformed.review === null,
  'malformed critique returns the draft without a review');

check(parseAndFinishDraft('', 'ta_email', FIXTURE_CV).error === 'unparseable'
  && parseAndFinishDraft(null, 'ta_email', FIXTURE_CV).error === 'unparseable',
  'empty and null model responses return an error');

const draftOnly = parseAndFinishDraft('{"subject":"test","body":"hello"}', 'ta_email', FIXTURE_CV);
check(draftOnly.subject === 'test' && draftOnly.body === 'hello' && draftOnly.review === null,
  'draft only JSON returns the draft without a review');

const sourcedDollars = checkUnsourcedNumbers('Saved $2.3M annually.', '', FIXTURE_PROOF_POINTS);
check(sourcedDollars.clean && sourcedDollars.flagged.length === 0,
  'a sourced dollar figure is clean');

const inventedDollars = checkUnsourcedNumbers('Managed $1.2B in savings.', FIXTURE_CV, FIXTURE_PROOF_POINTS);
check(!inventedDollars.clean && JSON.stringify(inventedDollars.flagged) === JSON.stringify(['$1.2B']),
  'an unsourced dollar figure is flagged');

check(checkUnsourcedNumbers('The change shipped last week.', '', []).clean,
  'last week does not produce a false positive');

check(checkUnsourcedNumbers('The program ran for 3 years.', '', []).clean,
  'a small number followed by a time unit does not produce a false positive');

check(checkUnsourcedNumbers('The work was completed in 2024.', '', []).clean,
  'a calendar year does not produce a false positive');

check(checkUnsourcedNumbers('Yield reached 98.2%.', '', FIXTURE_PROOF_POINTS).clean,
  'a sourced percentage is clean');

const inventedPercent = checkUnsourcedNumbers('Yield reached 47%.', FIXTURE_CV, FIXTURE_PROOF_POINTS);
check(!inventedPercent.clean && JSON.stringify(inventedPercent.flagged) === JSON.stringify(['47%']),
  'an unsourced percentage is flagged');

const priorFake = process.env.TJK_FAKE_LLM;
const priorFakeText = process.env.TJK_FAKE_LLM_TEXT;
process.env.TJK_FAKE_LLM = '1';
delete process.env.TJK_FAKE_LLM_TEXT;
const independent = await gradeIndependently('A draft to review.', 'ta_email', {});
if (priorFake === undefined) delete process.env.TJK_FAKE_LLM;
else process.env.TJK_FAKE_LLM = priorFake;
if (priorFakeText === undefined) delete process.env.TJK_FAKE_LLM_TEXT;
else process.env.TJK_FAKE_LLM_TEXT = priorFakeText;
check(independent === null, 'the fake model stub does not parse as a rubric review');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
