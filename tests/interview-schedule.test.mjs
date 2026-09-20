// E-1 and E-2: the pure schedule and outcome rules. No files, no store.
import { buildScheduleFields, isOutcomeDue, scheduleNote, OUTCOME_DUE_AFTER_MS, CHANNELS, ORGANIZER_TYPES, OUTCOME_TYPES, RESULT_TYPES } from '../lib/interview-schedule.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

let f = buildScheduleFields({ date: '2030-03-08', time: '14:00' });
check(f.scheduled_for === '2030-03-08' && f.slot_end === '2030-03-08T15:00:00.000Z', 'a default hour interview ends 60 minutes after it starts');
f = buildScheduleFields({ date: '2030-03-08', time: '14:00', durationMinutes: 30 });
check(f.slot_end === '2030-03-08T14:30:00.000Z', 'an explicit duration is honored');
f = buildScheduleFields({ date: '2030-03-08', time: '23:45', durationMinutes: 30 });
check(f.slot_end === '2030-03-09T00:15:00.000Z', 'a slot that crosses midnight rolls over correctly');

for (const bad of [{}, { date: '2030-03-08' }, { date: '2030-03-08', time: '2:00' }, { date: '2030-03-08', time: '25:00' }, { date: 'not-a-date', time: '14:00' }, { date: '2030-03-08', time: '14:00', durationMinutes: 0 }, { date: '2030-03-08', time: '14:00', durationMinutes: -5 }]) {
  let threw = false;
  try { buildScheduleFields(bad); } catch { threw = true; }
  check(threw, `refuses ${JSON.stringify(bad)}`);
}

const slot = '2030-03-08T15:00:00.000Z';
check(isOutcomeDue({ slot_end: slot, now: new Date(slot).getTime() }) === false, 'not due the instant the slot ends');
check(isOutcomeDue({ slot_end: slot, now: new Date(slot).getTime() + OUTCOME_DUE_AFTER_MS - 1000 }) === false, 'not due one second short of 30 minutes');
check(isOutcomeDue({ slot_end: slot, now: new Date(slot).getTime() + OUTCOME_DUE_AFTER_MS }) === true, 'due exactly 30 minutes after the slot ends');
check(isOutcomeDue({ slot_end: slot, now: new Date(slot).getTime() + 24 * 3600 * 1000 }) === true, 'still due the next morning, having never been answered');
check(isOutcomeDue({ slot_end: 'not-a-date', now: Date.now() }) === false, 'an unreadable slot end is never due');
check(isOutcomeDue({}) === false, 'no input never throws and is not due');

check(scheduleNote({ organizerName: 'Example Personone', organizerType: 'recruiter_ta', channel: 'Phone' }) === 'organizer:Example Personone (recruiter/TA); channel:Phone', 'the note names the organizer, their kind and the channel');
check(scheduleNote({ organizerName: ' Example Personone ', organizerType: 'hiring_manager_panel', channel: 'Video' }) === 'organizer:Example Personone (hiring manager/panel); channel:Video', 'the organizer name is trimmed and the panel kind reads out in full');

check(CHANNELS.length === 3 && ORGANIZER_TYPES.length === 2 && OUTCOME_TYPES.length === 6 && RESULT_TYPES.length === 3, 'the vocabularies match the plan: 3 channels, 2 organizer kinds, 6 outcomes, 3 results');

console.log(`interview-schedule: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
