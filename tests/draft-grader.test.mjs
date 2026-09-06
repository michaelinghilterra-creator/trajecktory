#!/usr/bin/env node
import {
  checkTemplatedAsk,
  checkUnsourcedNumbers,
  generateWithRubric,
  gradeIndependently,
  parseAndFinishDraft,
} from '../dashboard-web/server/lib/draft-grader.mjs';
import {
  RUBRIC_PROFILES,
  reviewFailureReason,
} from '../lib/outreach-rubric.mjs';

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
check(valid.subject === 'A precise subject' && valid.body.includes('fully grounded') && valid.review?.score > 0 && valid.reviewStatus === 'ok',
  'valid rubric JSON returns the draft and review');

const malformed = parseAndFinishDraft(JSON.stringify({
  critique: { weakest_dimension: 'clarity' },
  dimensions: [{ id: 'not_a_dimension', score: 8 }],
  subject: 'Keep this draft',
  body: 'The draft remains available.',
}), 'ta_email', FIXTURE_CV);
check(malformed.body === 'The draft remains available.' && malformed.review === null && malformed.reviewStatus === 'missing:bad-dimension-ids',
  'malformed critique returns the draft without a review');

check(parseAndFinishDraft('', 'ta_email', FIXTURE_CV).error === 'unparseable'
  && parseAndFinishDraft(null, 'ta_email', FIXTURE_CV).error === 'unparseable',
  'empty and null model responses return an error');

const draftOnly = parseAndFinishDraft('{"subject":"test","body":"hello"}', 'ta_email', FIXTURE_CV);
check(draftOnly.subject === 'test' && draftOnly.body === 'hello' && draftOnly.review === null && draftOnly.reviewStatus === 'missing:no-dimensions',
  'draft only JSON returns the draft without a review');

check(reviewFailureReason('not json', 'ta_email') === 'no-json', 'review failure identifies missing JSON');
check(reviewFailureReason('{"subject":"test"}', 'ta_email') === 'no-body', 'review failure identifies a missing body');
check(reviewFailureReason('{"body":"hello"}', 'ta_email') === 'no-dimensions', 'review failure identifies missing dimensions');
check(reviewFailureReason(JSON.stringify({
  body: 'hello',
  dimensions: [{ id: 'not_a_dimension', score: 7 }],
  critique: { fixes: ['Fix it.'] },
}), 'ta_email') === 'bad-dimension-ids', 'review failure identifies invalid dimension ids');
check(reviewFailureReason(JSON.stringify({
  body: 'hello',
  dimensions: [{ id: 'clarity', score: 7 }],
  critique: { fixes: [] },
}), 'ta_email') === 'no-fixes', 'review failure identifies missing fixes');

const emailWeights = RUBRIC_PROFILES.outreach_email.dims.map((dimension) => dimension.weight);
for (const dimension of RUBRIC_PROFILES.outreach_email.dims) dimension.weight = Number.NaN;
const noWeightReason = reviewFailureReason(JSON.stringify({
  body: 'hello',
  dimensions: [{ id: 'clarity', score: 7 }],
  critique: { fixes: ['Open with the result.'] },
}), 'ta_email');
RUBRIC_PROFILES.outreach_email.dims.forEach((dimension, index) => { dimension.weight = emailWeights[index]; });
check(noWeightReason === 'no-weight', 'review failure identifies an unscorable weight set');

const priorDisabled = process.env.TJK_RUBRIC_DISABLED;
process.env.TJK_RUBRIC_DISABLED = '1';
const disabledReason = reviewFailureReason('{"body":"hello"}', 'ta_email');
if (priorDisabled === undefined) delete process.env.TJK_RUBRIC_DISABLED;
else process.env.TJK_RUBRIC_DISABLED = priorDisabled;
check(disabledReason === 'rubric-off', 'review failure identifies a disabled rubric');

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

const companyFigureWithoutResearch = checkUnsourcedNumbers(
  'Precisely serves 12,000 organizations.',
  FIXTURE_CV,
  FIXTURE_PROOF_POINTS,
);
check(!companyFigureWithoutResearch.clean
  && JSON.stringify(companyFigureWithoutResearch.flagged) === JSON.stringify(['12,000']),
  'a company figure absent from candidate sources remains unsourced');
const companyFigureWithResearch = checkUnsourcedNumbers(
  'Precisely serves 12,000 organizations.',
  FIXTURE_CV,
  FIXTURE_PROOF_POINTS,
  'Precisely is a data integrity leader serving 12,000 organizations.',
);
check(companyFigureWithResearch.clean && companyFigureWithResearch.flagged.length === 0,
  'a company figure present only in research is sourced when research is supplied');

const templatedClosings = [
  "would welcome a pointer to whoever owns this search if you're not the right contact",
  "would welcome a pointer to whoever's running the search for this combined org",
  "I'd welcome a pointer to whoever owns this role if that's not you",
];
for (const closing of templatedClosings) {
  const result = checkTemplatedAsk(closing);
  check(!result.clean && typeof result.matched === 'string' && closing.includes(result.matched),
    `templated closing is detected: ${closing}`);
}

check(checkTemplatedAsk("I'd welcome an introduction to Dana, who owns the search.").clean,
  'a redirect naming a real person is clean');
check(checkTemplatedAsk("I'd like to send you a short writeup of that reporting rebuild.").clean,
  'a specific non redirect ask is clean');
check(checkTemplatedAsk("I can point you to whoever owns the data. The rebuild cut errors. I'd like to send you a short writeup.").clean,
  'a mid body redirect with a clean closing is not flagged');

const templatedAskRaw = JSON.stringify({
  critique: { weakest_dimension: 'clarity', fixes: ['Make the next step specific.'] },
  dimensions: [
    { id: 'relevance', score: 8, explanation: 'The message is relevant.' },
    { id: 'ask_strength', score: 9, explanation: 'The ask is concise.' },
  ],
  subject: 'Reporting rebuild',
  body: `The reporting rebuild is relevant here.\n\n${templatedClosings[2]}`,
});
const templatedAskDraft = parseAndFinishDraft(templatedAskRaw, 'ta_email', FIXTURE_CV);
const cappedAskStrength = templatedAskDraft.review?.dimensions
  .find((dimension) => dimension.id === 'ask_strength')?.score;
check(cappedAskStrength === 3
  && templatedAskDraft.review?.score < 84
  && templatedAskDraft.review?.templatedAskWarning
  && templatedAskDraft.review?.topFixes.some((fix) => fix.includes('"a pointer"')),
  'generation caps a templated ask, lowers the score, and appends a quoted fix');

const coverLetterRaw = JSON.stringify({
  critique: { weakest_dimension: 'clarity', fixes: ['Keep the close specific.'] },
  dimensions: [
    { id: 'evidence', score: 8, explanation: 'The evidence is grounded.' },
    { id: 'clarity', score: 8, explanation: 'The letter is clear.' },
  ],
  body: templatedClosings[0],
});
const coverLetterDraft = parseAndFinishDraft(coverLetterRaw, 'cover_letter', FIXTURE_CV);
check(coverLetterDraft.review?.dimensions.every((dimension) => dimension.score === 8)
  && !coverLetterDraft.review?.templatedAskWarning
  && !coverLetterDraft.review?.topFixes.some((fix) => fix.includes('specific next step')),
  'cover letter review is unaffected because its profile has no ask strength dimension');

const companyReviewRaw = JSON.stringify({
  critique: { weakest_dimension: 'evidence', fixes: ['Keep the company figure grounded.'] },
  dimensions: [
    { id: 'evidence', score: 8, explanation: 'The company figure is grounded.' },
    { id: 'personalization', score: 8, explanation: 'The company fact is specific.' },
  ],
  subject: 'Precisely data integrity',
  body: 'Precisely serves 12,000 organizations.',
});
const parsedWithoutResearch = parseAndFinishDraft(companyReviewRaw, 'ta_email', FIXTURE_CV);
const parsedWithoutResearchEvidence = parsedWithoutResearch.review?.dimensions
  .find((dimension) => dimension.id === 'evidence')?.score;
check(parsedWithoutResearchEvidence === 3 && parsedWithoutResearch.review?.unsourcedWarning,
  'generation parsing flags a company figure when research is absent');
const parsedWithResearch = parseAndFinishDraft(
  companyReviewRaw,
  'ta_email',
  FIXTURE_CV,
  'Precisely serves 12,000 organizations.',
);
const parsedWithResearchEvidence = parsedWithResearch.review?.dimensions
  .find((dimension) => dimension.id === 'evidence')?.score;
check(parsedWithResearchEvidence === 8 && !parsedWithResearch.review?.unsourcedWarning,
  'generation parsing accepts a company figure found only in research');

const priorFake = process.env.TJK_FAKE_LLM;
const priorFakeText = process.env.TJK_FAKE_LLM_TEXT;
process.env.TJK_FAKE_LLM = '1';
process.env.TJK_FAKE_LLM_TEXT = companyReviewRaw;
const generatedWithResearch = await generateWithRubric('Draft a concise note.', 'ta_email', {
  cvMd: FIXTURE_CV,
  rubricOpts: { companyResearch: 'Precisely serves 12,000 organizations.' },
});
const generatedWithResearchEvidence = generatedWithResearch.review?.dimensions
  .find((dimension) => dimension.id === 'evidence')?.score;
check(generatedWithResearchEvidence === 8 && !generatedWithResearch.review?.unsourcedWarning,
  'generateWithRubric forwards company research to the evidence check');
process.env.TJK_FAKE_LLM_TEXT = 'partial "critique": {"weakest_dimension":"clarity","dimensions": [';
const rejectedFallback = await generateWithRubric('Draft a concise note.', 'ta_dm', { plainTextFallback: true });
check(rejectedFallback.error === 'unparseable', 'plain text fallback rejects rubric JSON fragments');
delete process.env.TJK_FAKE_LLM_TEXT;
const independent = await gradeIndependently('A draft to review.', 'ta_email', {});
if (priorFake === undefined) delete process.env.TJK_FAKE_LLM;
else process.env.TJK_FAKE_LLM = priorFake;
if (priorFakeText === undefined) delete process.env.TJK_FAKE_LLM_TEXT;
else process.env.TJK_FAKE_LLM_TEXT = priorFakeText;
check(independent === null, 'the fake model stub does not parse as a rubric review');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
