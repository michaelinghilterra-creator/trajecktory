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
  buildImprovePrompt,
  buildIndependentGradePrompt,
  buildRubricBlock,
  buildWritingGuide,
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

const writingGuide = buildWritingGuide('ta_email', {
  cvExcerpt: 'CV: reduced cycle time from 14 days to 3 hours.',
  companyResearch: 'Northwind Data serves 12,000 organizations.',
  proofPoints: FIXTURE_PROOF_POINTS,
});
check(writingGuide.includes('== HOW TO WRITE IT ==')
  && writingGuide.includes('Length norm: 90-140 words in the body.')
  && writingGuide.includes('== CV EXCERPT ==')
  && writingGuide.includes('Northwind Data serves 12,000 organizations.')
  && writingGuide.includes('== OUTPUT CONTRACT ==')
  && !writingGuide.includes('"critique"')
  && !writingGuide.includes('"dimensions"'),
'the writing guide includes instructions, grounding, and the plain contract without review keys');

const expectedWritingBullets = [
  '- The first sentence says plainly why you are writing to this person. If a role you applied for is named in the instructions above, name it.',
  '- Use one proof point, the one that best fits this reader, with any figure copied exactly from the CV excerpt or the verifiable claims. Never invent, round, or combine numbers.',
  '- Use at most one company-specific detail, taken only from the company research, as a short supporting clause. No praise or flattery.',
  '- End with exactly one ask, stated directly in plain words. Do not start the closing sentence with "If". Do not ask for a call, chat, meeting, or an amount of their time. Do not ask to be redirected to an unnamed person.',
  '- No sentence longer than 25 words. Mix short and longer sentences. Keep paragraphs short.',
  '- Banned openers: "I hope this finds you well", "just following up", "just checking in", "touching base", "circling back", "reaching out", "I wanted to reach out", "I am writing to express my interest".',
  '- Banned words: delve, leverage, robust, seamless, spearhead, foster, elevate, unlock, tapestry, pivotal, testament, synergy, game-changer, passionate, results-driven, dynamic, proven track record.',
  '- No em dashes and no double hyphens.',
];
const connectWritingGuide = buildWritingGuide('connect_note_generic');
check(!connectWritingGuide.includes(expectedWritingBullets[1])
  && connectWritingGuide.includes(expectedWritingBullets[2])
  && connectWritingGuide.includes(expectedWritingBullets[3])
  && expectedWritingBullets.every((bullet) => writingGuide.includes(bullet)),
'connection notes omit the proof-point bullet while TA email includes every writing bullet');

// Captured from the pre-extraction builders. A deliberately tiny temporary
// profile keeps the fixtures readable while covering every context section,
// both length constraints, and all three public builders byte for byte.
const capturedRubricBody = `Length norm: 10 words.
Hard cap: 12 chars.
Required body paragraphs: exactly 2.

== RUBRIC ==

1. RELEVANCE TO RECIPIENT [relevance] (weight: 100%)
Does the message speak to this person's actual role, seniority, and relationship to the opening?
A talent partner screening a req and a VP who owns the team need different first sentences.
1-3:  Generic. Could be addressed to anyone at any company in any function.
4-5:  Gets the function right but ignores seniority, or the reverse.
6-7:  Appropriate for the role but says nothing only this recipient would care about.
8-9:  Clearly written for this person's seat, and references the opening or team correctly.
10:   The recipient would think this person understands what my week actually looks like.

== RECIPIENT AND OPENING ==
Recipient's title: Chief People Officer
Recipient's influence on the hire: senior executive, not the recruiter
Role the sender applied for: VP Revenue Operations (applied 2026-01-01)

== CV EXCERPT ==
CV fact.

== VERIFIABLE CLAIMS ==
- Proof: Saved 42 hours
Any metric, headcount, dollar amount, scope figure or date in the message that does not appear in this block, the company research, or the CV excerpt above is an INVENTED CLAIM. Score Evidence Grounding at 3 or below and name the invented figure verbatim in the fixes.

== COMPANY RESEARCH (verified, use for personalization) ==
Acme serves 7,500 teams.

== DIFFERENTIATORS ==
- Systems

== TONE NOTE ==
Direct.
The style requirements above override any conflicting instruction in this tone note.`;
const capturedGenerationContract = `== OUTPUT CONTRACT ==
Return exactly one JSON object. The key order shown below is required.
{"critique": {"weakest_dimension": "<dimension id>", "fixes": ["<fix>", "<fix>", "<fix>"]}, "score": <integer 1-100>, "dimensions": [{"id": "<dimension id>", "score": <1-10>, "explanation": "<one sentence quoting exact words from your draft>"}], "body": "<...>"}
Use the exact id string from each rubric heading (the value in brackets, e.g. [relevance]) as the dimension id in the JSON.
Every explanation must quote exact words from the draft.
Every fix must be a concrete rewrite instruction that names the replacement, not advice.
Score harshly. Reserve 8 or above for a message that would actually get a reply.
The body must reflect the fixes, not merely be followed by them.`;
const capturedRubric = [
  'Draft the message, critique that draft against the rubric below, then write the final version.',
  capturedRubricBody,
  capturedGenerationContract,
].join('\n\n');
const capturedGrade = [
  'Grade a message written by someone else against the rubric below.',
  capturedRubricBody,
  '== MESSAGE TO GRADE ==\nDraft body.',
  `== OUTPUT CONTRACT ==
Return exactly one JSON object in the required key order shown below.
{"score": <integer 1-100>, "dimensions": [{"id": "<dimension id>", "score": <1-10>, "explanation": "<one sentence quoting exact words from the message>"}], "top_fixes": ["<fix>", "<fix>", "<fix>"]}
Every explanation must quote exact words from the message.
Every top fix must be a concrete rewrite instruction that names the replacement, not advice.
Score harshly. Reserve 8 or above for a message that would actually get a reply.`,
].join('\n\n');
const capturedImprove = [
  'Rewrite the message below, applying ONLY the fixes listed. Keep every sentence no fix targets verbatim or nearly verbatim. Keep the greeting, sign-off, named people, metrics, the role named, and sentence order wherever no fix applies.',
  'Never remove a company-specific fact that appears in the company research. If a fix needs a fact that is not in the sources below, skip that fix. Never add placeholders or blanks such as ___, [role], or req #. Keep the closing ask a direct question; never introduce the words point me, pointer, whoever, or the right person.',
  '== FIXES TO APPLY ==\n- Replace "Draft" with "Specific draft".',
  `Length norm: 10 words.
Hard cap: 12 chars.
Required body paragraphs: exactly 2.`,
  `== HOW TO WRITE IT ==
${expectedWritingBullets[0]}
${expectedWritingBullets[4]}
${expectedWritingBullets[5]}
${expectedWritingBullets[6]}
${expectedWritingBullets[7]}`,
  capturedRubricBody.slice(capturedRubricBody.indexOf('== RECIPIENT AND OPENING ==')),
  '== MESSAGE TO IMPROVE ==\nDraft body.',
  `== OUTPUT CONTRACT ==
Return exactly one JSON object.
{"body": "<...>"}`,
].join('\n\n');
const savedShortPublic = { ...RUBRIC_PROFILES.short_public, dims: [...RUBRIC_PROFILES.short_public.dims] };
Object.assign(RUBRIC_PROFILES.short_public, {
  rubric: true,
  dims: [{ id: 'relevance', weight: 1 }],
  lengthNorm: '10 words',
  hardCap: 12,
  hardCapUnit: 'chars',
  paragraphs: 2,
});
const capturedOpts = {
  cvExcerpt: 'CV fact.',
  proofPoints: [{ name: 'Proof', heroMetric: 'Saved 42 hours' }],
  companyResearch: 'Acme serves 7,500 teams.',
  superpowers: ['Systems'],
  toneNote: 'Direct.',
  recipientRole: 'Chief People Officer',
  recipientTier: 'exec',
  appliedRole: 'VP Revenue Operations',
  appliedDate: '2026-01-01',
  subject: 'Ignored',
  body: 'Draft body.',
  fixes: ['Replace "Draft" with "Specific draft".'],
};
check(buildRubricBlock('li_comment', capturedOpts) === capturedRubric,
  'buildRubricBlock matches the updated recipient-context byte fixture');
check(buildIndependentGradePrompt('li_comment', capturedOpts) === capturedGrade,
  'buildIndependentGradePrompt matches the updated recipient-context byte fixture');
check(buildImprovePrompt('li_comment', capturedOpts) === capturedImprove,
  'buildImprovePrompt matches the updated recipient-context byte fixture');
Object.assign(RUBRIC_PROFILES.short_public, savedShortPublic);

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
  'Northwind Data serves 12,000 organizations.',
  FIXTURE_CV,
  FIXTURE_PROOF_POINTS,
);
check(!companyFigureWithoutResearch.clean
  && JSON.stringify(companyFigureWithoutResearch.flagged) === JSON.stringify(['12,000']),
  'a company figure absent from candidate sources remains unsourced');
const companyFigureWithResearch = checkUnsourcedNumbers(
  'Northwind Data serves 12,000 organizations.',
  FIXTURE_CV,
  FIXTURE_PROOF_POINTS,
  'Northwind Data is a data integrity leader serving 12,000 organizations.',
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

const longClosingStart = performance.now();
checkTemplatedAsk('a' + ' '.repeat(100000) + '!x');
const longClosingElapsed = performance.now() - longClosingStart;
check(longClosingElapsed < 500,
  `a long adversarial closing completes in under 500 ms (${longClosingElapsed.toFixed(1)} ms)`);

const repeatedClosingStart = performance.now();
checkTemplatedAsk('a' + (' '.repeat(20000) + '!x').repeat(5));
const repeatedClosingElapsed = performance.now() - repeatedClosingStart;
check(repeatedClosingElapsed < 500,
  `a repeated adversarial closing completes in under 500 ms (${repeatedClosingElapsed.toFixed(1)} ms)`);

check(checkTemplatedAsk('Whoever owns the data can help. The rebuild cut errors. I can send a short writeup.').clean,
  'a templated phrase in the first of three sentences is outside the closing');
check(!checkTemplatedAsk('The rebuild cut errors. I can send a short writeup. Whoever owns the data can help.').clean,
  'a templated phrase in the last of three sentences is flagged');
check(!checkTemplatedAsk('Whoever uses v3.5 can help. I can send a short writeup.').clean,
  'a decimal or version number does not split a sentence');

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
  subject: 'Northwind Data integrity',
  body: 'Northwind Data serves 12,000 organizations.',
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
  'Northwind Data serves 12,000 organizations.',
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
  rubricOpts: { companyResearch: 'Northwind Data serves 12,000 organizations.' },
});
const generatedWithResearchEvidence = generatedWithResearch.review?.dimensions
  .find((dimension) => dimension.id === 'evidence')?.score;
check(generatedWithResearchEvidence === 8 && !generatedWithResearch.review?.unsourcedWarning,
  'generateWithRubric forwards company research to the evidence check');
const writeOnly = await generateWithRubric('Draft a concise note.', 'ta_email', {
  cvMd: FIXTURE_CV,
  maxTokens: 321,
  mode: 'write',
});
check(writeOnly.subject === 'Northwind Data integrity'
  && writeOnly.body === 'Northwind Data serves 12,000 organizations.'
  && writeOnly.review === null
  && writeOnly.reviewStatus === 'pending',
'write mode returns the parsed draft with a pending review');
process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({
  dimensions: [
    { id: 'evidence', score: 9, explanation: 'The figure appears specific.' },
    { id: 'ask_strength', score: 9, explanation: 'The close asks for a redirect.' },
  ],
  top_fixes: ['Keep the proof and close specific.'],
});
const independentlyCapped = await gradeIndependently(
  "I delivered $9,999 in savings.\n\nI'd welcome a pointer to whoever owns this role.",
  'ta_email',
  { cvExcerpt: FIXTURE_CV, proofPoints: FIXTURE_PROOF_POINTS, companyResearch: '' },
);
const independentEvidence = independentlyCapped?.dimensions.find((dimension) => dimension.id === 'evidence')?.score;
const independentAsk = independentlyCapped?.dimensions.find((dimension) => dimension.id === 'ask_strength')?.score;
check(independentEvidence <= 3
  && independentAsk <= 3
  && independentlyCapped?.unsourcedWarning
  && independentlyCapped?.templatedAskWarning,
'independent grading applies the unsourced-number and templated-ask caps');
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
