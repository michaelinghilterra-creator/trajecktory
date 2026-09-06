#!/usr/bin/env node
/**
 * outreach-rubric.test.mjs: the pure outreach rubric registry, prompt builders,
 * hardened review parser, deterministic scoring, and hard constraints in
 * lib/outreach-rubric.mjs.
 *
 * Run: node tests/outreach-rubric.test.mjs
 */
import {
  DIMENSIONS,
  RUBRIC_PROFILES,
  SURFACE_PROFILE,
  SURFACES,
  getProfile,
  buildPlainContract,
  buildRubricBlock,
  buildImprovePrompt,
  parseReviewed,
  parseReviewedFields,
  weightedScore,
  violatesHardConstraint,
} from '../lib/outreach-rubric.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('outreach-rubric.test.mjs');

for (const [profileId, profile] of Object.entries(RUBRIC_PROFILES)) {
  const sum = profile.dims.reduce((total, dimension) => total + dimension.weight, 0);
  check(Math.abs(sum - 1) <= 0.001, `${profileId} dimension weights sum to 1.0`);
  check(profile.dims.every((dimension) => DIMENSIONS[dimension.id]), `${profileId} references only registered dimensions`);
}

for (const [surfaceId, profileId] of Object.entries(SURFACE_PROFILE)) {
  check(Boolean(RUBRIC_PROFILES[profileId]), `${surfaceId} maps to registered profile ${profileId}`);
}

check(JSON.stringify(SURFACES) === JSON.stringify(Object.keys(SURFACE_PROFILE)), 'SURFACES matches the surface map keys');
check(Object.isFrozen(SURFACES), 'SURFACES is frozen');

let unknownProfile;
let unknownThrew = false;
try { unknownProfile = getProfile('nope'); } catch { unknownThrew = true; }
check(!unknownThrew && unknownProfile === null, 'unknown surfaces return null without throwing');
check(getProfile('li_followup').lengthNorm === '40-150 words', 'li_followup applies its longer length override');
check(getProfile('ta_dm').lengthNorm === '40-110 words', 'ta_dm keeps the base direct message length norm');

const emailBlock = buildRubricBlock('ta_email', {});
const critiqueIndex = emailBlock.indexOf('"critique"');
const dimensionsIndex = emailBlock.indexOf('"dimensions"');
const subjectIndex = emailBlock.indexOf('"subject"');
const bodyIndex = emailBlock.indexOf('"body"');
check(critiqueIndex < dimensionsIndex && dimensionsIndex < subjectIndex && subjectIndex < bodyIndex,
  'critique and dimensions precede subject and body so revision is conditioned on named defects');

const coverBlock = buildRubricBlock('cover_letter', {});
const coverCritiqueIndex = coverBlock.indexOf('"critique"');
const coverDimensionsIndex = coverBlock.indexOf('"dimensions"');
const coverSalutationIndex = coverBlock.indexOf('"salutation"');
check(coverCritiqueIndex < coverDimensionsIndex && coverDimensionsIndex < coverSalutationIndex,
  'cover letter critique and dimensions precede the salutation');

const connectBlock = buildRubricBlock('connect_note', {});
check(connectBlock.includes('300') && !connectBlock.includes('SUBJECT LINE'), 'connection note states the 300 character cap and omits the subject rubric');
check(emailBlock.includes('SUBJECT LINE'), 'email includes the subject rubric');

check(buildImprovePrompt('li_comment', {}) === '' && buildImprovePrompt('nope', {}) === '',
  'improve prompt is empty for rubric-off and unknown surfaces');
const improveEmail = buildImprovePrompt('ta_email', {
  subject: 'Original subject',
  body: 'Original body to improve.',
});
const improveCritiqueIndex = improveEmail.indexOf('"critique"');
const improveDimensionsIndex = improveEmail.indexOf('"dimensions"');
const improveSubjectIndex = improveEmail.indexOf('"subject"');
const improveBodyIndex = improveEmail.indexOf('"body"');
check(improveCritiqueIndex < improveDimensionsIndex
  && improveDimensionsIndex < improveSubjectIndex
  && improveSubjectIndex < improveBodyIndex,
'improve contract places critique and dimensions before subject and body');
check(improveEmail.includes('== MESSAGE TO IMPROVE ==')
  && improveEmail.includes('Original body to improve.'),
'improve prompt includes the message section and supplied body');
check(!improveEmail.includes('== COMPANY RESEARCH (verified, use for personalization) =='),
  'improve prompt omits the company research block when no research is supplied');
const improveWithResearch = buildImprovePrompt('ta_email', {
  subject: 'Original subject',
  body: 'Generic praise to improve.',
  companyResearch: 'Northwind Data serves 12,000 organizations, including 95 of the Fortune 100.',
});
const researchCritiqueIndex = improveWithResearch.indexOf('"critique"');
const researchDimensionsIndex = improveWithResearch.indexOf('"dimensions"');
const researchSubjectIndex = improveWithResearch.indexOf('"subject"');
const researchBodyIndex = improveWithResearch.indexOf('"body"');
check(improveWithResearch.includes('== COMPANY RESEARCH (verified, use for personalization) ==')
  && improveWithResearch.includes('Northwind Data serves 12,000 organizations'),
  'improve prompt renders supplied company research');
check(researchCritiqueIndex < researchDimensionsIndex
  && researchDimensionsIndex < researchSubjectIndex
  && researchSubjectIndex < researchBodyIndex,
  'research keeps critique and dimensions ahead of subject and body');
check(improveWithResearch.includes('DELETE the generic sentence rather than inventing a fact or keeping the vague version.'),
  'improve prompt requires deletion when research cannot support personalization');
const oversizedResearch = 'R'.repeat(1300);
const cappedResearchPrompt = buildImprovePrompt('ta_email', { body: 'Draft.', companyResearch: oversizedResearch });
check(cappedResearchPrompt.includes('R'.repeat(1200)) && !cappedResearchPrompt.includes('R'.repeat(1201)),
  'company research is capped at 1200 characters');
const improveDm = buildImprovePrompt('ta_dm', { subject: 'Ignored subject', body: 'Direct message.' });
check(!improveDm.includes('Subject: Ignored subject'), 'improve prompt omits the subject line when the profile has no subject dimension');

const plainEmailContract = buildPlainContract('ta_email');
const plainDmContract = buildPlainContract('ta_dm');
check(plainEmailContract.includes('"subject"') && plainEmailContract.includes('"body"'), 'plain contract derives a subject for email surfaces');
check(!plainDmContract.includes('"subject"') && plainDmContract.includes('"body"'), 'plain contract omits the subject for direct-message surfaces');

const proofBlock = buildRubricBlock('ta_email', { proofPoints: [{ name: 'X', heroMetric: 'Y' }] });
check(proofBlock.includes('VERIFIABLE CLAIMS') && proofBlock.includes('X') && proofBlock.includes('Y'), 'proof points render the claims header, name, and hero metric');
const noProofBlock = buildRubricBlock('ta_email', { proofPoints: [] });
check(!noProofBlock.includes('== VERIFIABLE CLAIMS =='), 'an empty proof list omits the entire claims block header');

const toneBlock = buildRubricBlock('ta_email', { toneNote: 'Ask for a 15-min call.' });
check(toneBlock.includes('Ask for a 15-min call.')
  && toneBlock.includes('The style requirements above override any conflicting instruction in this tone note.'),
'tone notes are included with the style precedence sentence');
check(/caps this dimension at\s+3/.test(emailBlock), 'ask strength includes the hard cap for requests for time');

for (const raw of ['', null, undefined, 42, '{', 'I cannot help with that.', '{"body": ""}', '{"subject":"s"}']) {
  let result;
  let threw = false;
  try { result = parseReviewed(raw, 'ta_email'); } catch { threw = true; }
  check(!threw && result === null, `invalid review ${JSON.stringify(raw)} returns null without throwing`);
}

const fenced = parseReviewed('```json\n{"body":"Fence body"}\n```', 'ta_dm');
check(fenced?.body === 'Fence body', 'a fenced JSON payload parses');

const surrounded = parseReviewed('Before the object.\n{"body":"Surrounded body"}\nAfter the object.', 'ta_dm');
check(surrounded?.body === 'Surrounded body', 'prose before and after the object is ignored');

const braceBody = parseReviewed('prefix {"body":"Keep this } brace."} suffix {"body":"later"}', 'ta_dm');
check(braceBody?.body === 'Keep this } brace.', 'balanced extraction ignores a closing brace inside a string');

for (const surfaceId of ['ta_email', 'ta_dm', 'reply_email', 'app_followup', 'connect_note_generic']) {
  const actual = JSON.stringify(parseReviewed('{"subject":"Exact subject","body":"Exact body"}', surfaceId));
  const expected = getProfile(surfaceId).dims.some((dimension) => dimension.id === 'subject')
    ? '{"subject":"Exact subject","body":"Exact body","review":null}'
    : '{"body":"Exact body","review":null}';
  check(actual === expected, `${surfaceId} plain draft parsing remains byte identical`);
}

const coverFields = {
  salutation: 'Dear Hiring Team,',
  p1: 'Opening paragraph.',
  p2: 'Evidence paragraph.',
  p3: 'Closing paragraph.',
  closing: 'Sincerely,',
};
const reviewedCover = parseReviewedFields(JSON.stringify({
  critique: { weakest_dimension: 'evidence', fixes: ['Replace the general result with the sourced metric.'] },
  dimensions: [{ id: 'evidence', score: 8, explanation: '"Evidence paragraph" uses sourced proof.' }],
  ...coverFields,
}), 'cover_letter');
check(JSON.stringify(reviewedCover?.fields) === JSON.stringify(coverFields) && reviewedCover?.review?.score === 80,
  'parseReviewedFields returns all five cover letter fields and a review');
const partialCover = { ...coverFields };
delete partialCover.p2;
check(parseReviewedFields(JSON.stringify(partialCover), 'cover_letter') === null,
  'parseReviewedFields rejects a cover letter with a missing field');

const malformedReview = parseReviewed(JSON.stringify({
  body: 'The draft survives.',
  dimensions: [{ id: 'relevance', score: 8 }],
  critique: { fixes: [] },
}), 'ta_dm');
check(malformedReview?.body === 'The draft survives.' && malformedReview.review === null, 'a valid body survives a malformed critique');

const clamped = parseReviewed(JSON.stringify({
  body: 'Scores are clamped.',
  dimensions: [
    { id: 'relevance', score: 15, explanation: '"Scores" is direct.' },
    { id: 'personalization', score: 0, explanation: '"clamped" is generic.' },
  ],
  critique: { weakest_dimension: 'personalization', fixes: ['Replace generic copy with the product name.'] },
}), 'ta_dm');
check(clamped?.review?.dimensions.find((dimension) => dimension.id === 'relevance')?.score === 10, 'a dimension score of 15 is clamped to 10');
check(clamped?.review?.dimensions.find((dimension) => dimension.id === 'personalization')?.score === 1, 'a dimension score of 0 is clamped to 1');

const recomputed = parseReviewed(JSON.stringify({
  body: 'Use the visible dimension scores.',
  score: 95,
  dimensions: [
    { id: 'relevance', score: 10, explanation: '"visible" states the point.' },
    { id: 'personalization', score: 5, explanation: '"dimension" is not company specific.' },
  ],
  critique: { weakest_dimension: 'personalization', fixes: ['Replace "dimension" with the named product.'] },
}), 'ta_email');
const recomputedExpected = Math.round((((10 * 0.18) + (5 * 0.18)) / (0.18 + 0.18)) * 10);
check(recomputed?.review?.score === recomputedExpected && recomputed.review.score !== 95, 'the returned score is recomputed from dimensions, not copied from the model');

const handComputed = Math.round((((10 * 0.20) + (5 * 0.18)) / (0.20 + 0.18)) * 10);
check(weightedScore([
  { id: 'evidence', score: 10 },
  { id: 'relevance', score: 5 },
], RUBRIC_PROFILES.app_followup) === handComputed, 'weightedScore matches a hand computed weighted and renormalized example');

const allEightsExceptOne = RUBRIC_PROFILES.outreach_email.dims
  .slice(0, -1)
  .map((dimension) => ({ id: dimension.id, score: 8 }));
check(weightedScore(allEightsExceptOne, RUBRIC_PROFILES.outreach_email) === 80, 'a missing profile dimension renormalizes and keeps uniform eights at 80');

const overCap = violatesHardConstraint('x'.repeat(301), getProfile('connect_note_generic'));
check(overCap?.kind === 'chars' && overCap.actual === 301 && overCap.limit === 300, '301 characters violates the connection note character cap');
check(violatesHardConstraint('x'.repeat(299), getProfile('connect_note_generic')) === null, '299 characters stays within the connection note character cap');
const wrongParagraphs = violatesHardConstraint('First paragraph.\n\nSecond paragraph.', getProfile('cover_letter'));
check(wrongParagraphs?.kind === 'paragraphs' && wrongParagraphs.actual === 2 && wrongParagraphs.limit === 3, 'two cover letter paragraphs violate the required count of three');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
