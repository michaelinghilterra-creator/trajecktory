// E-7: the weekly review builders. Invented fixtures only.
import { weekOf, recentWeeks, interviewItems, newerMessages, unmatchedReplies, buildWeeklyReview } from '../lib/weekly-review.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
const throws = (fn) => { try { fn(); return false; } catch (error) { return error instanceof TypeError; } };

const msg = (id, sentOn, subject, direction = 'from_employer') => ({ message_id: id, sent_on: sentOn, direction, subject, body: '' });
const rejection = (id, sentOn) => msg(id, sentOn, 'we will not be moving forward with your application');
const humanReply = (id, sentOn) => msg(id, sentOn, 'thanks for your time, let us know a good time to talk');
const receipt = (id, sentOn) => msg(id, sentOn, 'Confirmation: we received your application');

// Weeks. 2030-03-10 is a Sunday.
check(JSON.stringify(weekOf('2030-03-10')) === '{"from":"2030-03-10","to":"2030-03-16"}', 'a Sunday starts its own week');
check(JSON.stringify(weekOf('2030-03-16')) === '{"from":"2030-03-10","to":"2030-03-16"}', 'a Saturday ends the week that began on Sunday');
check(JSON.stringify(weekOf('2030-03-13')) === '{"from":"2030-03-10","to":"2030-03-16"}', 'a Wednesday belongs to that Sunday to Saturday week');
check(JSON.stringify(weekOf('2030-03-09')) === '{"from":"2030-03-03","to":"2030-03-09"}', 'a Saturday belongs to the week before the next Sunday');
check(JSON.stringify(weekOf('2030-01-01')) === '{"from":"2029-12-30","to":"2030-01-05"}', 'a week can cross a year boundary');
check(throws(() => weekOf('2030-02-30')), 'weekOf rejects an impossible date');
check(throws(() => weekOf('soon')), 'weekOf rejects text');

const four = recentWeeks('2030-03-13', 4);
check(four.length === 4 && four[3].from === '2030-03-10' && four[0].from === '2030-02-17', 'recentWeeks ends with the current week and runs oldest first');
check(four.every((w, i) => i === 0 || w.from === new Date(Date.parse(four[i - 1].from) + 7 * 86400000).toISOString().slice(0, 10)), 'the weeks are consecutive');
check(throws(() => recentWeeks('2030-03-13', 0)), 'recentWeeks rejects a zero count');

// Interview lines.
const lines = interviewItems([
  { appId: 900001, stage: 'Phone Screen', date: '2030-03-05', evidence_ok: false },
  { appId: 900002, stage: '1st Interview', date: '2030-03-06', evidence_ok: true },
  { appId: 900003, stage: 'Phone Screen', date: '2030-03-20', evidence_ok: false },
  { appId: 900004, stage: 'Phone Screen', date: 'not a date', evidence_ok: false },
  { appId: 900005, stage: 'Phone Screen', date: '2030-03-12' },
], '2030-03-13');
check(lines.unconfirmed.map((i) => i.application_id).join() === '900001,900005', 'a line with no evidence, or no flag at all, is unconfirmed');
check(lines.scheduled.map((i) => i.application_id).join() === '900003', 'a line dated after today is scheduled, not unconfirmed');
check(!lines.unconfirmed.concat(lines.scheduled).some((i) => i.application_id === 900002 || i.application_id === 900004), 'a line with evidence, and a line with a bad date, are left out');
check(interviewItems(undefined, '2030-03-13').unconfirmed.length === 0, 'no interview lines is not an error');
check(interviewItems([{ appId: 900006, stage: 'Phone Screen', date: '2030-03-13', evidence_ok: false }], '2030-03-13').unconfirmed.length === 1, 'a line dated today is not scheduled');

// Newer messages.
const apps = [
  { id: 900001, company: 'Zorblax Widgetry', role: 'Example Cog Lead', status: 'No Response' },
  { id: 900002, company: 'Quennox Ratchet Works', role: 'Example Gear Manager', status: 'Applied' },
  { id: 900003, company: 'Zorblax Widgetry', role: 'Example Pulley Director', status: 'Rejected' },
];
const replies = new Map([
  ['900001', [rejection('n1', '2030-03-11')]],
  ['900002', [receipt('n2', '2030-03-09')]],
  ['900003', [rejection('n3', '2030-03-05')]],
]);
const lastStatus = new Map([['900001', '2030-03-04'], ['900003', '2030-03-05']]);
let newer = newerMessages(apps, replies, lastStatus);
check(newer.length === 1 && newer[0].application_id === 900001 && newer[0].kind === 'rejection' && newer[0].dated_on === '2030-03-11', 'a rejection newer than the last status change is listed');
check(!newer.some((i) => i.application_id === 900003), 'a message on the same day as the status change is not newer');
check(!newer.some((i) => i.application_id === 900002), 'a receipt is not an employer message');
newer = newerMessages(apps, new Map([['900002', [humanReply('n4', '2030-03-12')]]]), new Map());
check(newer.length === 1 && newer[0].kind === 'human_reply', 'a human reply on an application with no status history is listed');
newer = newerMessages(apps, new Map([['900001', [humanReply('n5', '2030-03-06'), rejection('n6', '2030-03-12'), humanReply('n7', '2030-03-08')]]]), new Map());
check(newer.length === 1 && newer[0].message_id === 'n6', 'only the newest employer message of an application is listed');
check(newerMessages(apps, new Map(), new Map()).length === 0, 'no messages, nothing listed');

// Unmatched replies. Two applications at one employer.
const twoAtOne = [
  { id: 900001, company: 'Zorblax Widgetry', role: 'Example Flange Engineer', status: 'Applied' },
  { id: 900003, company: 'Zorblax Widgetry', role: 'Example Widget Planner', status: 'Applied' },
  { id: 900002, company: 'Quennox Ratchet Works', role: 'Example Gear Manager', status: 'Applied' },
];
const applyDates = { 900001: '2030-03-01', 900003: '2030-03-01', 900002: '2030-03-01' };
const filed = new Map([
  ['900001', [msg('u1', '2030-03-10', 'Update on your application. About the Example Widget Planner role: we will not proceed')]],
  ['900003', [msg('u2', '2030-03-11', 'Update on your application')]],
  ['900002', [msg('u3', '2030-03-11', 'Update on your application')]],
]);
const un = unmatchedReplies(twoAtOne, filed, applyDates);
const byMessage = Object.fromEntries(un.map((i) => [i.message_id, i]));
check(byMessage.u1 && byMessage.u1.problem === 'filed_on_another_application' && byMessage.u1.belongs_to === 900003, 'a reply naming another role at the employer is reported as filed on the wrong application');
check(byMessage.u2 && byMessage.u2.problem === 'no_role_signal', 'a reply that names no role at an employer with two applications is unmatched');
check(!byMessage.u3, 'a reply at an employer with one application is placed and not reported');
const right = unmatchedReplies(twoAtOne, new Map([['900003', [msg('u4', '2030-03-11', 'Update on your application. About the Example Widget Planner role: we will not proceed')]]]), applyDates);
check(right.length === 0, 'a reply that names its own role is not reported');

// The whole review.
const review = buildWeeklyReview({
  today: '2030-03-13',
  weekCount: 2,
  applications: apps,
  repliesByApp: replies,
  lastStatusDate: lastStatus,
  applyDates,
  interviews: [
    { appId: 900001, stage: 'Phone Screen', date: '2030-03-05', evidence_ok: false },
    { appId: 900003, stage: 'Phone Screen', date: '2030-03-14', evidence_ok: false },
    { appId: 900002, stage: '1st Interview', date: '2030-03-12', evidence_ok: true },
  ],
});
check(review.weeks.length === 2 && review.weeks[0].from === '2030-03-03' && review.weeks[1].from === '2030-03-10', 'the review covers the two most recent weeks');
check(review.weeks[0].unconfirmed_interviews.length === 1 && review.weeks[1].unconfirmed_interviews.length === 0, 'the unconfirmed line lands in its own week');
check(review.weeks[1].scheduled.length === 1 && review.weeks[1].scheduled[0].application_id === 900003, 'the scheduled line lands in the current week');
check(review.weeks[1].newer_messages.length === 1 && review.weeks[1].newer_messages[0].application_id === 900001, 'the newer message lands in the week it was sent');
check(review.weeks[0].unmatched_replies.length === 1 && review.weeks[1].unmatched_replies.length === 1, 'each rejection that names no role at an employer with two applications is unmatched in its own week');
check(review.weeks[0].needs_review === 2 && review.weeks[1].needs_review === 3, 'each week counts its own items');
check(review.needs_review === 5, 'the total is the sum of the weeks');
check(buildWeeklyReview({ today: '2030-03-13' }).needs_review === 0, 'an empty review needs nothing');
check(throws(() => buildWeeklyReview({ today: '2030-13-01' })), 'the review rejects a bad today');
check(recentWeeks('2030-03-13', 1).length === 1 && recentWeeks('2030-03-13', 1)[0].from === '2030-03-10', 'recentWeeks accepts a count of one');
const edges = buildWeeklyReview({ today: '2030-03-13', weekCount: 1, interviews: [
  { appId: 1, stage: 'Phone Screen', date: '2030-03-10', evidence_ok: false },
  { appId: 2, stage: 'Phone Screen', date: '2030-03-12', evidence_ok: false },
  { appId: 3, stage: 'Phone Screen', date: '2030-03-09', evidence_ok: false },
] });
check(edges.weeks[0].unconfirmed_interviews.map((i) => i.application_id).join() === '1,2', 'the first day of a week counts and the day before it does not');
const lastDay = buildWeeklyReview({ today: '2030-03-16', weekCount: 1, interviews: [
  { appId: 4, stage: 'Phone Screen', date: '2030-03-16', evidence_ok: false },
  { appId: 5, stage: 'Phone Screen', date: '2030-03-17', evidence_ok: false },
] });
check(lastDay.weeks[0].unconfirmed_interviews.map((i) => i.application_id).join() === '4', 'the last day of a week counts and the day after it does not');
// This used to also assert `scheduled.length === 0`, which was asserting the bug:
// today is a Saturday, so an interview arranged for the NEXT day fell outside the
// week window and was dropped. A scheduled line is always dated after today, so
// week-filtering could only ever discard it, and how much it discarded depended on
// which weekday the review ran. Scheduled lines now attach to the current week.
check(lastDay.weeks[0].scheduled.map((i) => i.application_id).join() === '5', 'an interview arranged for tomorrow is scheduled, not dropped for falling outside the week');
const farOut = buildWeeklyReview({ today: '2030-03-16', weekCount: 1, interviews: [
  { appId: 6, stage: 'Phone Screen', date: '2030-04-30', evidence_ok: false },
] });
check(farOut.weeks[0].scheduled.map((i) => i.application_id).join() === '6', 'an interview arranged six weeks out still appears, rather than vanishing past the current Saturday');
check(buildWeeklyReview({ today: '2030-03-13', interviews: [{ appId: 1, stage: 'Phone Screen', date: '2030-01-01', evidence_ok: false }] }).needs_review === 0, 'an item outside the shown weeks is not counted');

// A line recorded in the event store can say directly which bucket it is in (needed for a held date entered
// ahead of the day itself, which is still in the future but is not merely "scheduled").
let bucketLines = interviewItems([{ appId: 1, stage: 'Phone Screen', date: '2030-03-20', bucket: 'unconfirmed' }], '2030-03-13');
check(bucketLines.unconfirmed.length === 1 && bucketLines.scheduled.length === 0, 'an explicit unconfirmed bucket wins even though the date is in the future');
bucketLines = interviewItems([{ appId: 2, stage: 'Phone Screen', date: '2030-03-10', bucket: 'scheduled' }], '2030-03-13');
check(bucketLines.scheduled.length === 1 && bucketLines.unconfirmed.length === 0, 'an explicit scheduled bucket wins even though the date is in the past');
bucketLines = interviewItems([{ appId: 3, stage: 'Phone Screen', date: '2030-03-10', evidence_ok: true, bucket: 'counted' }], '2030-03-13');
check(bucketLines.unconfirmed.length === 0 && bucketLines.scheduled.length === 0, 'a bucket value neither scheduled nor unconfirmed drops the line (counted, nothing to review)');

console.log(`weekly-review: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
