import { isCalendarDate, interviewDateFields, weekRange, countedInterviewRows } from '../lib/interview-dates.mjs';

let passes = 0;
let failures = 0;

function check(cond, msg) {
  if (cond) {
    console.log(`✓ ${msg}`);
    passes++;
  } else {
    console.log(`✗ ${msg}`);
    failures++;
  }
}

// isCalendarDate tests
check(isCalendarDate('2030-03-08') === true, 'isCalendarDate returns true for valid date 2030-03-08');
check(isCalendarDate('2030-02-30') === false, 'isCalendarDate returns false for invalid date 2030-02-30');
check(isCalendarDate('2030-13-01') === false, 'isCalendarDate returns false for invalid month 2030-13-01');
check(isCalendarDate('2030-3-8') === false, 'isCalendarDate returns false for non-padded date 2030-3-8');
check(isCalendarDate('') === false, 'isCalendarDate returns false for empty string');
check(isCalendarDate(null) === false, 'isCalendarDate returns false for null');
check(isCalendarDate(20300308) === false, 'isCalendarDate returns false for number');

// interviewDateFields tests
const result1 = interviewDateFields({ booked_on: '2030-03-01', scheduled_for: '2030-03-08' });
check(Object.keys(result1).length === 2, 'interviewDateFields returns object with exactly two keys when only booked_on and scheduled_for provided');
check(result1.booked_on === '2030-03-01', 'interviewDateFields includes booked_on');
check(result1.scheduled_for === '2030-03-08', 'interviewDateFields includes scheduled_for');
check(result1.held_on === undefined, 'interviewDateFields does not include held_on when not provided');

const result2 = interviewDateFields({ booked_on: '2030-03-01', scheduled_for: '2030-03-08', held_on: '2030-03-08', recorded_on: '2030-03-09' });
check(Object.keys(result2).length === 4, 'interviewDateFields returns object with four keys when all fields provided');

try {
  interviewDateFields({ held_on: '2030-02-30' });
  check(false, 'interviewDateFields throws TypeError for bad held_on');
} catch (e) {
  check(e.message === 'held_on', 'interviewDateFields TypeError message names held_on');
}

const result3 = interviewDateFields({ booked_on: '2030-03-01', scheduled_for: null, held_on: '2030-03-08', recorded_on: undefined });
check(Object.keys(result3).length === 2, 'interviewDateFields omits null and undefined fields');
check(result3.booked_on === '2030-03-01', 'interviewDateFields includes booked_on');
check(result3.held_on === '2030-03-08', 'interviewDateFields includes held_on');

// weekRange tests
const week1 = weekRange('2030-03-08');
check(week1.from === '2030-03-03', 'weekRange for 2030-03-08 gives from 2030-03-03');
check(week1.to === '2030-03-09', 'weekRange for 2030-03-08 gives to 2030-03-09');

const week2 = weekRange('2030-03-03');
check(week2.from === '2030-03-03', 'weekRange for Sunday 2030-03-03 gives from 2030-03-03');
check(week2.to === '2030-03-09', 'weekRange for Sunday 2030-03-03 gives to 2030-03-09');

const week3 = weekRange('2030-03-09');
check(week3.from === '2030-03-03', 'weekRange for Saturday 2030-03-09 gives from 2030-03-03');
check(week3.to === '2030-03-09', 'weekRange for Saturday 2030-03-09 gives to 2030-03-09');

const week4 = weekRange('2030-03-02');
check(week4.from === '2030-02-24', 'weekRange for 2030-03-02 gives from 2030-02-24');
check(week4.to === '2030-03-02', 'weekRange for 2030-03-02 gives to 2030-03-02');

try {
  weekRange('2030-02-30');
  check(false, 'weekRange throws TypeError for invalid date');
} catch (e) {
  check(e.message === '2030-02-30', 'weekRange TypeError message names invalid date');
}

// countedInterviewRows tests
const records1 = [
  { id: 900001, stage: 'Phone Screen', booked_on: '2030-03-01', scheduled_for: '2030-03-08' }
];

const result4 = countedInterviewRows(records1, { from: '2030-03-01', to: '2030-03-07', today: '2030-03-20' });
check(result4.rows.length === 0, 'countedInterviewRows with no held_on gives empty rows for week 2030-03-01');
check(result4.excluded.length === 1, 'countedInterviewRows with no held_on gives one excluded record for week 2030-03-01');
check(result4.excluded[0].id === 900001, 'countedInterviewRows excluded record has correct id');
check(result4.excluded[0].reason === 'not_held', 'countedInterviewRows excluded record has reason not_held');

const result5 = countedInterviewRows(records1, { from: '2030-03-08', to: '2030-03-09', today: '2030-03-20' });
check(result5.rows.length === 0, 'countedInterviewRows with no held_on gives empty rows for week 2030-03-08');
check(result5.excluded.length === 1, 'countedInterviewRows with no held_on gives one excluded record for week 2030-03-08');

const records2 = [
  { id: 900001, stage: 'Phone Screen', booked_on: '2030-03-01', scheduled_for: '2030-03-08', held_on: '2030-03-08' }
];

const result6 = countedInterviewRows(records2, { from: '2030-03-01', to: '2030-03-07', today: '2030-03-20' });
check(result6.rows.length === 0, 'countedInterviewRows with held_on 2030-03-08 gives empty rows for week 2030-03-01');
check(result6.excluded.length === 0, 'countedInterviewRows with held_on 2030-03-08 gives empty excluded for week 2030-03-01');

const result7 = countedInterviewRows(records2, { from: '2030-03-08', to: '2030-03-09', today: '2030-03-20' });
check(result7.rows.length === 1, 'countedInterviewRows with held_on 2030-03-08 gives one row for week 2030-03-08');
check(result7.rows[0].id === 900001, 'countedInterviewRows row has correct id');
check(result7.rows[0].stage === 'Phone Screen', 'countedInterviewRows row has correct stage');
check(result7.rows[0].date === '2030-03-08', 'countedInterviewRows row has correct date');
check(result7.excluded.length === 0, 'countedInterviewRows with held_on 2030-03-08 gives empty excluded for week 2030-03-08');

const records3 = [
  { id: 900001, stage: 'Phone Screen', booked_on: '2030-03-01', scheduled_for: '2030-03-08', held_on: '2030-03-25' }
];

const result8 = countedInterviewRows(records3, { from: '2030-03-08', to: '2030-03-09', today: '2030-03-20' });
check(result8.rows.length === 0, 'countedInterviewRows with future held_on gives empty rows');
check(result8.excluded.length === 1, 'countedInterviewRows with future held_on gives one excluded');
check(result8.excluded[0].id === 900001, 'countedInterviewRows future excluded has correct id');
check(result8.excluded[0].reason === 'future_date', 'countedInterviewRows future excluded has reason future_date');

const records4 = [
  { id: 900002, stage: 'Phone Screen', booked_on: '2030-03-01', scheduled_for: '2030-03-08', held_on: '2030-03-08' },
  { id: 900001, stage: 'Phone Screen', booked_on: '2030-03-01', scheduled_for: '2030-03-08', held_on: '2030-03-08' }
];

const result9 = countedInterviewRows(records4, { from: '2030-03-08', to: '2030-03-09', today: '2030-03-20' });
check(result9.rows.length === 2, 'countedInterviewRows with two records on same date gives two rows');
check(result9.rows[0].id === 900001, 'countedInterviewRows rows sort by id ascending');
check(result9.rows[1].id === 900002, 'countedInterviewRows rows sort by id ascending');

const records4b = [
  { id: 900001, stage: 'Phone Screen', held_on: '2030-03-09' },
  { id: 900002, stage: 'Phone Screen', held_on: '2030-03-04' },
  { id: 900003, stage: 'Phone Screen', held_on: '2030-03-06' }
];
const result9b = countedInterviewRows(records4b, { from: '2030-03-03', to: '2030-03-09', today: '2030-03-20' });
check(result9b.rows.map((r) => r.id).join(',') === '900002,900003,900001', 'countedInterviewRows rows sort by date ascending across different dates');

const records5 = [
  { id: 900001, stage: 'Phone Screen', booked_on: '2030-03-01', scheduled_for: '2030-03-08', held_on: '2030-02-30' }
];

const result10 = countedInterviewRows(records5, { from: '2030-03-01', to: '2030-03-07', today: '2030-03-20' });
check(result10.rows.length === 0, 'countedInterviewRows with bad held_on gives empty rows');
check(result10.excluded.length === 1, 'countedInterviewRows with bad held_on gives one excluded');
check(result10.excluded[0].id === 900001, 'countedInterviewRows bad held_on excluded has correct id');
check(result10.excluded[0].reason === 'bad_held_on', 'countedInterviewRows bad held_on excluded has reason bad_held_on');

check(isCalendarDate('2030-12-01') === true, 'isCalendarDate accepts month 12');
check(isCalendarDate('2030-01-01') === true, 'isCalendarDate accepts month 1');

check(isCalendarDate('2030-01-15') === true, 'isCalendarDate accepts day in month 1');

check(isCalendarDate('2030-00-01') === false, 'isCalendarDate rejects month 0');
check(isCalendarDate('2030-13-01') === false, 'isCalendarDate rejects month 13');

check(isCalendarDate('2030-03-31') === true, 'isCalendarDate accepts day 31 in March');
check(isCalendarDate('2030-03-32') === false, 'isCalendarDate rejects day 32 in March');

check(isCalendarDate('2030-03-01') === true, 'isCalendarDate accepts day 1 in March');

check(isCalendarDate(null) === false, 'isCalendarDate returns false for null');
check(isCalendarDate(20300308) === false, 'isCalendarDate returns false for number');

// Use window that includes today's date
const recordsToday = [
  { id: 900001, stage: 'Phone Screen', booked_on: '2030-03-01', scheduled_for: '2030-03-08', held_on: '2030-03-20' }
];
const resultToday = countedInterviewRows(recordsToday, { from: '2030-03-15', to: '2030-03-20', today: '2030-03-20' });
check(resultToday.rows.length === 1, 'countedInterviewRows with held_on equal to today includes the row');
check(resultToday.excluded.length === 0, 'countedInterviewRows with held_on equal to today has no excluded');

const recordsInWindow = [
  { id: 900001, stage: 'Phone Screen', booked_on: '2030-03-01', scheduled_for: '2030-03-08', held_on: '2030-03-05' }
];
const resultInWindow = countedInterviewRows(recordsInWindow, { from: '2030-03-01', to: '2030-03-07', today: '2030-03-20' });
check(resultInWindow.rows.length === 1, 'countedInterviewRows with held_on in window gives a row');
check(resultInWindow.excluded.length === 0, 'countedInterviewRows with held_on in window has no excluded');

const recordsOutWindow = [
  { id: 900001, stage: 'Phone Screen', booked_on: '2030-03-01', scheduled_for: '2030-03-08', held_on: '2030-01-15' }
];
const resultOutWindow = countedInterviewRows(recordsOutWindow, { from: '2030-03-01', to: '2030-03-07', today: '2030-03-20' });
check(resultOutWindow.rows.length === 0, 'countedInterviewRows with held_on outside window gives empty rows');
check(resultOutWindow.excluded.length === 0, 'countedInterviewRows with held_on outside window gives zero excluded (record skipped)');

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}
