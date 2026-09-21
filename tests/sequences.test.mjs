#!/usr/bin/env node
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('sequences');
process.env.TJK_DATA_DIR = sandbox;

const {
  advanceSequence,
  completeSequence,
  expectedNextChannel,
  getSequence,
  getTemplate,
  pauseSequence,
  startSequence,
} = await import('../dashboard-web/server/lib/sequences.mjs');

const SEQUENCE_ID = 'application-day-0-1-5-12';
let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};

console.log('sequences.test.mjs');

const started = startSequence('ta', 900001, SEQUENCE_ID, '2030-01-01');
check(started.entry.step === 0 && started.entry.nextStepDue === '2030-01-01',
  'startSequence begins at step 0 with the day-0 touch due immediately');
check(expectedNextChannel(started.entry, started.template) === 'either',
  'a freshly started mixed-channel sequence accepts either day-0 channel');

const afterFirst = advanceSequence('ta', 900001, '2030-01-01', 'linkedin');
check(afterFirst.entry.step === 1 && expectedNextChannel(afterFirst.entry, afterFirst.template) === 'email',
  'after a LinkedIn day-0 touch the sequence expects email');
check(afterFirst.entry.firstChannel === 'linkedin',
  'a mixed sequence records LinkedIn as its first channel');
advanceSequence('ta', 900001, '2030-01-02');
advanceSequence('ta', 900001, '2030-01-06');
const afterFourth = advanceSequence('ta', 900001, '2030-01-13');
check(afterFourth.entry.completedAt === '2030-01-13' && afterFourth.entry.nextStepDue === null,
  'advancing through all four touches completes the sequence');

startSequence('ta', 900005, SEQUENCE_ID, '2030-01-01');
const afterEmailFirst = advanceSequence('ta', 900005, '2030-01-01', 'email');
check(afterEmailFirst.entry.step === 1
  && expectedNextChannel(afterEmailFirst.entry, afterEmailFirst.template) === 'linkedin',
  'after an email day-0 touch the sequence expects LinkedIn');
check(afterEmailFirst.entry.firstChannel === 'email',
  'a mixed sequence records email as its first channel');

startSequence('ta', 900006, SEQUENCE_ID, '2030-01-01');
const afterUnspecifiedFirst = advanceSequence('ta', 900006, '2030-01-01');
check(!Object.hasOwn(afterUnspecifiedFirst.entry, 'firstChannel')
  && expectedNextChannel(afterUnspecifiedFirst.entry, afterUnspecifiedFirst.template) === '',
  'a mixed sequence without a used channel leaves firstChannel absent and does not guess');

startSequence('ta', 900002, SEQUENCE_ID, '2030-02-01');
advanceSequence('ta', 900002, '2030-02-01');
const completedEarly = completeSequence('ta', 900002, '2030-02-03');
check(completedEarly?.step === 1 && completedEarly.completedAt === '2030-02-03'
  && completedEarly.nextStepDue === null,
  'completeSequence ends an active sequence immediately at its current step');
check(completeSequence('ta', 900002, '2030-02-04') === null,
  'completeSequence returns null for an already-completed sequence');
check(completeSequence('ta', 900003, '2030-02-04') === null,
  'completeSequence returns null when no sequence exists');

startSequence('ta', 900004, SEQUENCE_ID, '2030-03-01');
pauseSequence('ta', 900004, '2030-03-02');
const completedPaused = completeSequence('ta', 900004, '2030-03-03');
check(completedPaused?.paused === false && completedPaused.pausedAt === null
  && completedPaused.completedAt === '2030-03-03' && completedPaused.nextStepDue === null,
  'completing a paused sequence clears its paused state');
check(getSequence('ta', 900004)?.completedAt === '2030-03-03'
  && getSequence('ta', 900004)?.paused === false,
  'completed unpaused state is persisted');
check(getTemplate(SEQUENCE_ID)?.id === SEQUENCE_ID,
  'the tests use the real application cadence template');

console.log(`\nsequences: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
