#!/usr/bin/env node
import { _stripLeadingSalutation, _stripTrailingSignature } from '../dashboard-web/server/lib/anthropic.mjs';
import { reviseForCadence } from '../dashboard-web/server/lib/cadence-revise.mjs';
import { finishDraft } from '../dashboard-web/server/lib/finish-draft.mjs';
import {
  cleanEmailBody,
  cleanEmailSubject,
  stripDraftMeta,
} from '../dashboard-web/server/lib/text-hygiene.mjs';

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

const FIXTURE_RAW = `Hi Sarah,\n\nI submitted my application for the Data Engineering Lead role last month and wanted to connect directly.\n\nIn order to give you context, at my previous company I built a logistics platform that compressed order fulfillment from 5 days to 8 hours. It supported $320M in annual throughput across 3 warehouses.\n\nI believe my background in automating supply chains at scale aligns well with what your team is building.\n\nBest regards,\nJane Doe\njane@example.com\n555-0199`;

console.log('finish-draft.test.mjs');

let expectedBody = _stripLeadingSalutation(FIXTURE_RAW, 'Sarah');
expectedBody = _stripTrailingSignature(expectedBody);
expectedBody = stripDraftMeta(expectedBody);
expectedBody = cleanEmailBody(expectedBody);
expectedBody = (await reviseForCadence(expectedBody, { surface: 'email' })).text;
const expectedSubject = cleanEmailSubject('Data Engineering Lead application');

const characterized = await finishDraft({
  body: FIXTURE_RAW,
  subject: 'Data Engineering Lead application',
  surface: 'ta_email',
  cleaner: 'email',
  stripSalutationFor: 'Sarah',
  stripSignature: true,
});
check(characterized.body === expectedBody && characterized.subject === expectedSubject,
  'TA email output is byte-identical to the inline finishing chain');

const monotone = Array.from({ length: 8 }, (_, index) =>
  `Logged package ${index} against the printed manifest before the evening dispatch window closed.`).join('\n');
const priorFake = process.env.TJK_FAKE_LLM;
const priorFakeText = process.env.TJK_FAKE_LLM_TEXT;
process.env.TJK_FAKE_LLM = '1';
const cadenceRevision = [
  'Logged the package.',
  'Before dispatch, I checked item one against the printed manifest and resolved every mismatch before the evening window closed.',
  'The next label matched immediately.',
  'For item three, I compared the packing slip, warehouse record, and carrier manifest before clearing it for the scheduled truck.',
  'No escalation was needed.',
  'Item five required a second scan, but the printed manifest matched once I corrected the misplaced tracking label.',
  'Then I closed the completed batch and notified dispatch.',
  'The final package matched every recorded field, cleared the dock check, and left with the carrier before the window closed.',
].join('\n');
process.env.TJK_FAKE_LLM_TEXT = cadenceRevision;

const reviewed = await finishDraft({
  body: monotone,
  surface: 'ta_email',
  review: { score: 82 },
  reviewStatus: 'ok',
  cleaner: 'none',
  stripSignature: false,
});
check(reviewed.body === cadenceRevision && reviewed.review?.score === 82 && reviewed.reviewStatus === 'ok',
  'a present review no longer skips a needed cadence revision and still carries review status');

const varied = [
  'Done.',
  'I built the pipeline quickly.',
  'Teams adopted it across three regions without extra training.',
  'The release cut manual review while keeping every existing control in place.',
  'Managers used the saved time to coach analysts on harder judgment calls each week.',
].join('\n');
process.env.TJK_FAKE_LLM_TEXT = 'The model must not replace rhythm that is already sound.';
const rhythmOk = await reviseForCadence(varied, { surface: 'prose' });
check(rhythmOk.text === varied && rhythmOk.reason === 'rhythm-ok',
  'varied short-sentence text returns rhythm-ok without calling the model');

const variedTwentyEight = [
  'Done.',
  'I built the pipeline quickly.',
  'Teams adopted it across three regions without extra training.',
  'The release cut manual review while keeping every existing control in place.',
  'Managers then used the saved time to coach analysts on harder judgment calls, document edge cases, and improve the next release without adding another approval step or meeting.',
].join('\n');
process.env.TJK_FAKE_LLM_TEXT = 'The model must not replace a varied draft whose longest sentence has 28 words.';
const twentyEightWordResult = await reviseForCadence(variedTwentyEight, { surface: 'prose' });
check(twentyEightWordResult.text === variedTwentyEight && twentyEightWordResult.reason === 'rhythm-ok',
  'varied text whose longest sentence is 28 words returns rhythm-ok');

const fortyOneWords = Array.from({ length: 41 }, (_, index) => `word${index + 1}`).join(' ') + '.';
const longUnitText = [
  fortyOneWords,
  'A short second line.',
  'Another concise line follows.',
  'The final sentence closes it.',
].join('\n');
process.env.TJK_FAKE_LLM_TEXT = longUnitText;
const longUnitRevision = await reviseForCadence(longUnitText, { surface: 'prose' });
check(longUnitRevision.reason === 'ok',
  'a four-unit text with one 41-word sentence calls the cadence model');

const missingReview = await finishDraft({
  body: monotone,
  surface: 'ta_email',
  review: null,
  reviewStatus: 'missing:no-dimensions',
  cleaner: 'none',
  stripSignature: false,
  cadence: false,
});
check(missingReview.reviewStatus === 'missing:no-dimensions', 'a missing review status passes through unchanged');

const cadenceOff = await finishDraft({
  body: monotone,
  surface: 'ta_email',
  cleaner: 'none',
  stripSignature: false,
  cadence: false,
});
check(cadenceOff.body === monotone, 'cadence false skips cadence revision');

if (priorFake === undefined) delete process.env.TJK_FAKE_LLM;
else process.env.TJK_FAKE_LLM = priorFake;
if (priorFakeText === undefined) delete process.env.TJK_FAKE_LLM_TEXT;
else process.env.TJK_FAKE_LLM_TEXT = priorFakeText;

let unknownSurfaceThrew = false;
try {
  await finishDraft({ body: 'Draft', surface: 'not_registered' });
} catch {
  unknownSurfaceThrew = true;
}
check(unknownSurfaceThrew, 'an unknown surface throws as a wiring error');

const fitted = await finishDraft({
  body: `${'A'.repeat(180)}\n\n${'B'.repeat(180)}`,
  surface: 'connect_note_generic',
  cleaner: 'none',
  stripSignature: false,
  cadence: false,
  flatten: true,
  hardFit: 300,
});
check(!/[\r\n]/.test(fitted.body) && fitted.body.length === 300 && fitted.length === 300,
  'flatten and hardFit produce a single-line 300-character draft');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
