#!/usr/bin/env node
import { makeSandbox } from './helpers/sandbox.mjs';

process.env.TJK_DATA_DIR = makeSandbox('cadence-offsets');

const {
  advanceSequence, expectedNextChannel, getSequence, getTemplate, startSequence,
} = await import('../dashboard-web/server/lib/sequences.mjs');

const CADENCE = 'application-day-0-1-5-12';
let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};

console.log('cadence-offsets.test.mjs');

startSequence('ta', 910001, CADENCE, '2030-01-01');
let state = advanceSequence('ta', 910001, '2030-01-01', 'linkedin');
check(state.entry.anchorDate === '2030-01-01' && state.entry.nextStepDue === '2030-01-02',
  'day 0 records the send-date anchor and day 1 is due at D+1');
state = advanceSequence('ta', 910001, '2030-01-04', 'email');
check(state.entry.nextStepDue === '2030-01-06', 'a late day-1 send still leaves step 3 due at D+5');
state = advanceSequence('ta', 910001, '2030-01-10', 'email');
check(state.entry.nextStepDue === '2030-01-13', 'a late day-5 send still leaves step 4 due at D+12');

startSequence('ta', 910002, CADENCE, '2030-02-01');
state = advanceSequence('ta', 910002, '2030-02-04', 'email');
check(state.entry.anchorDate === '2030-02-04' && state.entry.nextStepDue === '2030-02-05',
  'a late first send anchors offsets on the actual send date');

startSequence('ta', 910003, 'cold-intro-principal', '2030-03-01');
state = advanceSequence('ta', 910003, '2030-03-04', 'email');
check(state.entry.nextStepDue === '2030-03-11' && !Object.hasOwn(state.entry, 'anchorDate'),
  'a legacy template keeps its relative D+7 behavior');
state = advanceSequence('ta', 910003, '2030-03-15', 'email');
check(state.entry.nextStepDue === '2030-03-29', 'a legacy later step stays relative to its previous send');

const emailOnly = { available: { email: true, linkedin: false } };
startSequence('ta', 910004, CADENCE, '2030-04-01');
state = advanceSequence('ta', 910004, '2030-04-01', 'email', emailOnly);
check(state.entry.step === 2 && state.entry.nextStepDue === '2030-04-06',
  'an email-only contact skips the unavailable day-1 touch and lands on day 5');
state = advanceSequence('ta', 910004, '2030-04-08', 'email', emailOnly);
check(state.entry.step === 3 && state.entry.nextStepDue === '2030-04-13',
  'the email-only final touch stays anchored at day 12 after a late day-5 send');
state = advanceSequence('ta', 910004, '2030-04-14', 'email', emailOnly);
check(state.done && state.entry.completedAt === '2030-04-14',
  'the email-only sequence completes after the day-12 touch');

const linkedinOnly = { available: { email: false, linkedin: true } };
startSequence('ta', 910005, CADENCE, '2030-05-01');
state = advanceSequence('ta', 910005, '2030-05-01', 'linkedin', linkedinOnly);
check(state.entry.step === 1 && state.entry.nextStepDue === '2030-05-02'
  && state.entry.completedAt === null && expectedNextChannel(state.entry, state.template) === 'email',
  'a LinkedIn-only contact parks on the unavailable immediate step');

const both = { available: { email: true, linkedin: true } };
startSequence('ta', 910006, CADENCE, '2030-06-01');
state = advanceSequence('ta', 910006, '2030-06-01', 'linkedin', both);
check(state.entry.step === 1 && state.entry.nextStepDue === '2030-06-02',
  'a both-channel contact lands on the day-1 other-channel touch');

startSequence('ta', 910007, CADENCE, '2030-07-01');
state = advanceSequence('ta', 910007, '2030-07-01', 'email');
check(state.entry.step === 1 && expectedNextChannel(state.entry, getTemplate(CADENCE)) === 'linkedin',
  'omitting available preserves the prior immediate-next-step behavior');
check(getSequence('ta', 910005)?.completedAt === null,
  'parking does not complete or otherwise mutate the LinkedIn-only sequence');

console.log(`\ncadence-offsets: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
