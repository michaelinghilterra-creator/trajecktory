#!/usr/bin/env node

import {
  buildKey,
  findStabilityDraft,
  normalizeResponse,
  parseArgs,
  renderSheet,
  scorePicks,
  seededShuffle,
  validateCases,
} from '../scripts/outreach-ab.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
}

console.log('outreach-ab.test.mjs');

const arms = ['old', 'main', 'new', 'candidate'];
const first = seededShuffle(arms, 42);
check(JSON.stringify(first) === JSON.stringify(seededShuffle(arms, 42)), 'the same seed produces the same order');
check(JSON.stringify(first) !== JSON.stringify(seededShuffle(arms, 43)), 'different seeds can produce different orders');
check(JSON.stringify(arms) === JSON.stringify(['old', 'main', 'new', 'candidate']), 'shuffle does not mutate its input');

const sheetCases = [{
  label: 'case-neutral', kind: 'ta_email', source: 'ta', id: 987654321, appId: 123456789,
  drafts: [
    { arm: 'secret-old-arm', status: 'ok', subject: 'A quiet subject', body: 'First blind draft.', grade: { score: 91 }, ms: 555 },
    { arm: 'secret-new-arm', status: 'ok', subject: '', body: 'Second blind draft.', grade: { score: 84 }, ms: 777 },
  ],
}];
const sheetKey = buildKey(sheetCases, ['secret-old-arm', 'secret-new-arm'], 7);
const sheet = renderSheet(sheetCases, sheetKey);
check(!sheet.includes('secret-old-arm') && !sheet.includes('secret-new-arm'), 'sheet contains no arm names');
check(!sheet.includes('91') && !sheet.includes('84') && !sheet.toLowerCase().includes('score'), 'sheet contains no scores');
check(!sheet.includes('987654321') && !sheet.includes('123456789'), 'sheet contains no case ids');
check(sheet.includes('Subject: A quiet subject') && sheet.includes('First blind draft.') && sheet.includes('Second blind draft.'), 'sheet contains only the draft content needed for rating');

const scoringRaw = {
  cases: [
    { label: 'alpha', drafts: [{ arm: 'old', grade: { score: 60 } }, { arm: 'new', grade: { score: 90 } }] },
    { label: 'beta', drafts: [{ arm: 'old', grade: { score: 80 } }, { arm: 'new', grade: { score: 70 } }] },
    { label: 'gamma', drafts: [{ arm: 'old', grade: { score: 75 } }, { arm: 'new', grade: { score: 75 } }] },
  ],
};
const scoringKey = { alpha: ['old', 'new'], beta: ['new', 'old'], gamma: ['new', 'old'] };
const scored = scorePicks({ alpha: 2, beta: 1, gamma: 1 }, scoringKey, scoringRaw);
check(scored.wins.new === 3 && scored.wins.old === 0, 'key maps version numbers back to the correct arms');
check(scored.agreement === 2 && scored.compared === 3, 'pick scoring counts grader agreement, including a highest-score tie');

const eligibilityRaw = {
  cases: [
    { label: 'solo', drafts: [{ arm: 'new', grade: { score: 99 } }] },
    { label: 'one-grade', drafts: [{ arm: 'old', grade: { score: 70 } }, { arm: 'new', grade: { status: 'failed' } }] },
  ],
};
const eligibility = scorePicks({ solo: 1, 'one-grade': 2 }, { solo: ['new'], 'one-grade': ['old', 'new'] }, eligibilityRaw);
check(eligibility.wins.new === 1 && eligibility.skipped.some((item) => item.label === 'solo'), 'pick scoring skips wins for cases with fewer than two versions and reports them');
check(eligibility.compared === 0 && eligibility.agreementSkipped.some((item) => item.label === 'one-grade'), 'grader agreement requires at least two valid grade scores');

const oldShape = normalizeResponse({ response: 'Old body', review: { score: 71 }, surfaceId: 'li_followup' }, { arm: 'old', label: 'one', kind: 'li_followup', ms: 10 });
check(oldShape.status === 'ok' && oldShape.body === 'Old body' && oldShape.rawReview.score === 71, 'normalization handles response + review shape');
const newShape = normalizeResponse({ draft: { subject: 'Subject', body: 'New body' }, surfaceId: 'ta_email' }, { arm: 'new', label: 'two', kind: 'ta_email', ms: 11 });
check(newShape.status === 'ok' && newShape.subject === 'Subject' && newShape.body === 'New body', 'normalization handles nested draft shape');
const blocked = normalizeResponse({ blocked: true, blocks: ['cold-cap'], nextEligible: 'later' }, { arm: 'new', label: 'three', kind: 'connect_note' });
check(blocked.status === 'blocked' && blocked.body === '' && blocked.blocks[0] === 'cold-cap', 'normalization handles blocked responses');

const parsed = parseArgs(['--cases', 'cases.json', '--arm', 'new=http://127.0.0.1:4103,token', '--grader', 'http://localhost:4103,grade-token', '--stability', '3', '--seed', '42']);
check(parsed.arms[0].name === 'new' && parsed.stability === 3 && parsed.stabilityArm === 'new' && parsed.seed === 42, 'argument parser defaults stability-arm to new');
const customStability = parseArgs(['--cases', 'cases.json', '--arm', 'old=http://127.0.0.1:4101,token', '--grader', 'http://localhost:4103,grade-token', '--stability', '3', '--stability-arm', 'old']);
check(customStability.stabilityArm === 'old', 'argument parser accepts a configured custom stability arm');
check(findStabilityDraft([{ arm: 'new', status: 'ok' }, { arm: 'old', status: 'ok' }], customStability.stabilityArm)?.arm === 'old', 'stability grading selects the configured arm instead of hard-coding new');
let missingStabilityArm = '';
try { parseArgs(['--cases', 'cases.json', '--arm', 'old=http://127.0.0.1:4101,token', '--grader', 'http://localhost:4103,grade-token', '--stability', '2']); }
catch (error) { missingStabilityArm = error.message; }
check(missingStabilityArm.includes('--stability-arm "new"') && missingStabilityArm.includes('--arm names'), 'repeated stability rejects an arm that was not configured');
let rejected = false;
try { parseArgs(['--cases', 'cases.json', '--arm', 'bad=http://example.com:4103,token', '--grader', 'http://127.0.0.1:4103,token']); }
catch { rejected = true; }
check(rejected, '--arm rejects a non-loopback host');

let invalidSource = '';
try { validateCases([{ label: 'bad-source', kind: 'connect_note', source: 'other', id: 1, appId: null }]); }
catch (error) { invalidSource = error.message; }
check(invalidSource.includes('source must be "ta" or "referral"'), 'case validation rejects an invalid contact source');
let invalidReferralSource = '';
try { validateCases([{ label: 'bad-referral', kind: 'referral_email', source: 'ta', id: 2, appId: null }]); }
catch (error) { invalidReferralSource = error.message; }
check(invalidReferralSource.includes('source must be "referral"'), 'referral draft kinds require referral source');
let duplicateLabel = '';
try {
  validateCases([
    { label: 'duplicate', kind: 'connect_note', source: 'ta', id: 3, appId: null },
    { label: 'duplicate', kind: 'connect_note', source: 'ta', id: 4, appId: null },
  ]);
} catch (error) { duplicateLabel = error.message; }
check(duplicateLabel === 'Duplicate case label: duplicate', 'duplicate case labels fail with a clear error before requests');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
