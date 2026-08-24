#!/usr/bin/env node

// This suite protects agreement between the timeline and follow-up queue paths.
// A future source of touch history must be added to both paths or to neither.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('touch-history-consistency');
process.env.TJK_DATA_DIR = sandbox;

const { writeTTCorrespondence } = await import('../dashboard-web/server/lib/target-talent.mjs');
const { writeReferralCorrespondence } = await import('../dashboard-web/server/lib/referrals.mjs');
const { computeFollowupQueue } = await import('../dashboard-web/server/lib/followups.mjs');
const { buildTimeline } = await import('../dashboard-web/server/lib/contact-timeline.mjs');

const loggedMessages = {
  'ta:101': [{ timestamp: '2026-08-10 09:00', direction: 'Sent', channel: 'LinkedIn', subject: 'LinkedIn connection request', body: 'Hello from a talent fixture.' }],
  'referral:201': [{ timestamp: '2026-08-11 10:00', direction: 'Sent', channel: 'LinkedIn', subject: 'LinkedIn message', body: 'Hello from a referral fixture.' }],
};
writeTTCorrespondence(101, loggedMessages['ta:101']);
writeReferralCorrespondence(201, loggedMessages['referral:201']);

const taRows = [
  { id: 101, first: 'Talent', last: 'Logged', company: 'talent-logged.example', title: 'Recruiter', status: 'Not Contacted', linkedin: 'https://linkedin.example/in/talent-logged', email: '', verified: { state: 'unverified' }, lastTouch: '' },
  { id: 102, first: 'Talent', last: 'Stamped', company: 'talent-stamped.example', title: 'Recruiter', status: 'Not Contacted', linkedin: 'https://linkedin.example/in/talent-stamped', email: '', verified: { state: 'unverified' }, lastTouch: '2026-08-12' },
  { id: 103, first: 'Talent', last: 'Empty', company: 'talent-empty.example', title: 'Recruiter', status: 'Not Contacted', linkedin: 'https://linkedin.example/in/talent-empty', email: '', verified: { state: 'unverified' }, lastTouch: '' },
];
const referralRows = [
  { id: 201, name: 'Referral Logged', where: 'referral-logged.example', target: 'Operator', status: 'Not Asked', linkedin: 'https://linkedin.example/in/referral-logged', email: '', verified: { state: 'unverified' }, lastTouch: '' },
  { id: 202, name: 'Referral Stamped', where: 'referral-stamped.example', target: 'Operator', status: 'Not Asked', linkedin: 'https://linkedin.example/in/referral-stamped', email: '', verified: { state: 'unverified' }, lastTouch: '2026-08-13' },
  { id: 203, name: 'Referral Empty', where: 'referral-empty.example', target: 'Operator', status: 'Not Asked', linkedin: 'https://linkedin.example/in/referral-empty', email: '', verified: { state: 'unverified' }, lastTouch: '' },
];
const apps = [...taRows.map(row => row.company), ...referralRows.map(row => row.where)]
  .map(company => ({ company, status: 'Applied' }));
const queue = computeFollowupQueue({ taRows, referralRows, influencers: [], apps, pins: {} });
assert.equal(queue.length, 6, 'every fixture contact reaches the queue');

const rowsByRef = new Map([
  ...taRows.map(row => [`ta:${row.id}`, row]),
  ...referralRows.map(row => [`referral:${row.id}`, row]),
]);
const timelineOpts = { correspondence: loggedMessages, linkedinMap: {}, engagementLog: [] };

for (const contact of queue) {
  const ref = `${contact.source}:${contact.id}`;
  const person = { members: { [contact.source]: rowsByRef.get(ref) } };
  const hasOutbound = buildTimeline(person, timelineOpts).some(event => event.direction === 'Sent');
  if (hasOutbound) {
    assert.notEqual(contact.companyOutreach.selfLastTouch, null, `${ref} has one last-touch answer in both paths`);
  }
}

const byRef = ref => queue.find(row => `${row.source}:${row.id}` === ref);
assert.equal(byRef('referral:201').companyOutreach.selfLastTouch.date, '2026-08-11');
assert.equal(byRef('ta:101').companyOutreach.selfLastTouch.date, '2026-08-10');

for (const [ref, date] of [['referral:202', '2026-08-13'], ['ta:102', '2026-08-12']]) {
  assert.deepEqual(byRef(ref).companyOutreach.selfLastTouch, {
    date, direction: 'Sent', channel: null, fromRowStamp: true,
  });
}
for (const ref of ['referral:203', 'ta:103']) {
  assert.equal(byRef(ref).companyOutreach.selfLastTouch, null);
}

const connectSource = fs.readFileSync(path.join(process.cwd(), 'dashboard-web', 'src', 'connect.jsx'), 'utf8');
const start = connectSource.indexOf('function selfTouchLine(');
const brace = connectSource.indexOf('{', start);
let depth = 0;
let end = -1;
for (let i = brace; i < connectSource.length; i++) {
  if (connectSource[i] === '{') depth++;
  if (connectSource[i] === '}') {
    depth -= 1;
    if (depth === 0) { end = i + 1; break; }
  }
}
assert.ok(start >= 0 && end > start, 'the card touch wording helper exists');
const context = { chLabel: channel => channel, relDaysAgo: date => date };
vm.createContext(context);
vm.runInContext(`${connectSource.slice(start, end)}\nthis.selfTouchLine = selfTouchLine;`, context);
const noHistory = 'This contact: no prior correspondence yet';
for (const contact of queue) {
  const self = contact.companyOutreach.selfLastTouch;
  assert.equal(
    context.selfTouchLine(self) === noHistory,
    self === null,
    `${contact.source}:${contact.id} renders no history only when both sources are empty`,
  );
}

console.log('touch history consistency tests passed');
