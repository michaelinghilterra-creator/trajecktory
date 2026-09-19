/**
 * Tests for interview-records module.
 */

import { assessInterviewRecord, summarizeInterviews } from '../lib/interview-records.mjs';

const today = '2030-03-20';
const slot_end = '2030-03-08T19:00:00.000Z';

let passes = 0;
let failures = 0;

function check(cond, msg) {
  if (cond) {
    console.log(`✓ ${msg}`);
    passes += 1;
  } else {
    console.log(`✗ ${msg}`);
    failures += 1;
  }
}

// Test 1: Phone Screen with no evidence
{
  const record = {
    id: 900001,
    stage: 'Phone Screen',
    scheduled_for: '2030-03-08',
    held_on: '2030-03-08',
    slot_end,
    evidence: []
  };
  const result = assessInterviewRecord(record, { today });
  check(result.state === 'unconfirmed', 'record with no evidence should be unconfirmed');
  check(JSON.stringify(result.reasons) === JSON.stringify(['no_evidence']), 'reasons should be [no_evidence]');
  check(result.held_on === undefined, 'held_on should be absent when unconfirmed');

  const summary = summarizeInterviews([record], { today });
  check(summary.counted.length === 0, 'counted length should be 0');
  check(summary.unconfirmed.length === 1, 'unconfirmed length should be 1');
}

// Test 2: Phone Screen with qualifying evidence
{
  const record = {
    id: 900002,
    stage: 'Phone Screen',
    scheduled_for: '2030-03-08',
    held_on: '2030-03-08',
    slot_end,
    evidence: [
      { kind: 'owner_message', at: '2030-03-08T20:15:00.000Z', refers_to_conversation: true }
    ]
  };
  const result = assessInterviewRecord(record, { today });
  check(result.state === 'counted', 'record with qualifying evidence should be counted');
  check(result.held_on === '2030-03-08', 'held_on should be 2030-03-08');
  check(result.reasons.length === 0, 'reasons should be empty');

  const summary = summarizeInterviews([record], { today });
  check(summary.counted.length === 1, 'counted length should be 1');
  check(summary.counted[0].held_on === '2030-03-08', 'counted held_on should be 2030-03-08');
  check(summary.unconfirmed.length === 0, 'unconfirmed length should be 0');
}

// Test 3: Evidence with only calendar_event and debrief
{
  const record = {
    id: 900003,
    stage: 'Phone Screen',
    scheduled_for: '2030-03-08',
    held_on: '2030-03-08',
    slot_end,
    evidence: [
      { kind: 'calendar_event', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true },
      { kind: 'debrief', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true }
    ]
  };
  const result = assessInterviewRecord(record, { today });
  check(result.state === 'unconfirmed', 'record with non-evidence kinds should be unconfirmed');
  check(result.reasons.includes('not_evidence_kind'), 'reasons should include not_evidence_kind');

  const summary = summarizeInterviews([record], { today });
  check(summary.counted.length === 0, 'counted length should be 0');
  check(summary.unconfirmed.length === 1, 'unconfirmed length should be 1');
}

// Test 4: held_on in the future
{
  const record = {
    id: 900004,
    stage: 'Phone Screen',
    scheduled_for: '2030-03-08',
    held_on: '2030-03-25',
    slot_end,
    evidence: [
      { kind: 'owner_message', at: '2030-03-08T20:15:00.000Z', refers_to_conversation: true }
    ]
  };
  const result = assessInterviewRecord(record, { today });
  check(result.state === 'unconfirmed', 'future held_on should be unconfirmed');
  check(JSON.stringify(result.reasons) === JSON.stringify(['future_held_on']), 'reasons should be [future_held_on]');

  const summary = summarizeInterviews([record], { today });
  check(summary.counted.length === 0, 'counted length should be 0');
  check(summary.unconfirmed.length === 1, 'unconfirmed length should be 1');
}

// Test 5: scheduled_for in the future
{
  const record = {
    id: 900005,
    stage: 'Phone Screen',
    scheduled_for: '2030-03-25',
    held_on: undefined,
    slot_end,
    evidence: []
  };
  const result = assessInterviewRecord(record, { today });
  check(result.state === 'scheduled', 'future scheduled_for should be scheduled');
  check(result.reasons.length === 0, 'reasons should be empty');

  const summary = summarizeInterviews([record], { today });
  check(summary.scheduled.length === 1, 'scheduled length should be 1');
}

// Test 6: scheduled_for equal to today
{
  const record = {
    id: 900006,
    stage: 'Phone Screen',
    scheduled_for: '2030-03-20',
    held_on: undefined,
    slot_end,
    evidence: []
  };
  const result = assessInterviewRecord(record, { today });
  check(result.state === 'scheduled', 'scheduled_for equal to today should be scheduled');
  check(result.reasons.length === 0, 'reasons should be empty');
}

// Test 7: scheduled_for in the past
{
  const record = {
    id: 900007,
    stage: 'Phone Screen',
    scheduled_for: '2030-03-10',
    held_on: undefined,
    slot_end,
    evidence: []
  };
  const result = assessInterviewRecord(record, { today });
  check(result.state === 'unconfirmed', 'past scheduled_for should be unconfirmed');
  check(JSON.stringify(result.reasons) === JSON.stringify(['slot_passed_unconfirmed']), 'reasons should be [slot_passed_unconfirmed]');
}

// Test 8: no dates
{
  const record = {
    id: 900008,
    stage: 'Phone Screen',
    scheduled_for: undefined,
    held_on: undefined,
    slot_end,
    evidence: []
  };
  const result = assessInterviewRecord(record, { today });
  check(result.state === 'unconfirmed', 'no dates should be unconfirmed');
  check(JSON.stringify(result.reasons) === JSON.stringify(['no_dates']), 'reasons should be [no_dates]');
}

// Test 9: bad slot_end
{
  const record = {
    id: 900009,
    stage: 'Phone Screen',
    scheduled_for: '2030-03-08',
    held_on: '2030-03-08',
    slot_end: 'not a date',
    evidence: []
  };
  const result = assessInterviewRecord(record, { today });
  check(result.state === 'unconfirmed', 'bad slot_end should be unconfirmed');
  check(JSON.stringify(result.reasons) === JSON.stringify(['bad_slot_end']), 'reasons should be [bad_slot_end]');
}

// Test 10: summarizeInterviews over four mixed records
{
  const records = [
    {
      id: 900010,
      stage: 'Phone Screen',
      scheduled_for: '2030-03-08',
      held_on: '2030-03-08',
      slot_end,
      evidence: [
        { kind: 'owner_message', at: '2030-03-08T20:15:00.000Z', refers_to_conversation: true }
      ]
    },
    {
      id: 900011,
      stage: 'Phone Screen',
      scheduled_for: '2030-03-25',
      held_on: undefined,
      slot_end,
      evidence: []
    },
    {
      id: 900012,
      stage: 'Phone Screen',
      scheduled_for: '2030-03-08',
      held_on: '2030-03-25',
      slot_end,
      evidence: []
    },
    {
      id: 900013,
      stage: 'Phone Screen',
      scheduled_for: undefined,
      held_on: undefined,
      slot_end,
      evidence: []
    }
  ];

  const summary = summarizeInterviews(records, { today });

  check(summary.counted.length === 1, 'counted length should be 1');
  check(summary.counted[0].id === 900010, 'counted[0].id should be 900010');

  check(summary.scheduled.length === 1, 'scheduled length should be 1');
  check(summary.scheduled[0].id === 900011, 'scheduled[0].id should be 900011');

  check(summary.unconfirmed.length === 2, 'unconfirmed length should be 2');
  check(summary.unconfirmed[0].id === 900012, 'unconfirmed[0].id should be 900012');
  check(summary.unconfirmed[1].id === 900013, 'unconfirmed[1].id should be 900013');
}

const distinct = assessInterviewRecord({
  id: 900001, stage: 'Phone Screen', scheduled_for: '2030-03-08', held_on: '2030-03-08', slot_end,
  evidence: [
    { kind: 'debrief', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true },
    { kind: 'feedback_survey', at: '2030-03-08T20:00:00.000Z', refers_to_conversation: true },
    { kind: 'owner_message', at: '2030-03-08T18:00:00.000Z', refers_to_conversation: true }
  ]
}, { today });
check(distinct.state === 'unconfirmed', 'assessInterviewRecord with only non-qualifying evidence is unconfirmed');
check(JSON.stringify(distinct.reasons) === JSON.stringify(['not_evidence_kind', 'before_or_at_slot_end']), 'assessInterviewRecord lists each rejection reason once');

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}
