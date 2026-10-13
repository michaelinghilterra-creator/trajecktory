#!/usr/bin/env node
import { buildApplicationMessages, mergeDisplayTimeline } from '../dashboard-web/server/lib/contact-timeline.mjs';
import { getPersonContext } from '../dashboard-web/server/lib/person-context.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) {
    console.log(`  PASS ${message}`);
    passed++;
  } else {
    console.log(`  FAIL ${message}`);
    failed++;
  }
}

console.log('person-app-messages.test.mjs');

const person = {
  refs: ['ta:7'],
  members: {
    ta: { id: 7, first: 'Pat', last: 'Example', company: 'Examplecorp', email: 'pat@example.test [v:ok:mv:2030-01-01]' },
  },
};
const apps = [
  { id: 41, company: 'Examplecorp Labs', role: 'Example Engineer' },
  { id: 42, company: 'Elsewhere Industries', role: 'Other Engineer' },
];

const followups = [
  { n: 1, appNum: 41, date: '2031-02-01', company: 'Examplecorp', role: 'Example Engineer', channel: 'LinkedIn DM', contact: 'Pat Example (Smith)', notes: 'Subject: Checking in\nMessage body' },
  { n: 2, appNum: 41, date: '2031-02-02', company: 'Examplecorp', role: 'Example Engineer', channel: 'Email', contact: 'Pat Example', notes: 'Cross-logged from Talent Acquisition #7' },
  { n: 3, appNum: 41, date: '2031-02-03', company: 'Examplecorp', role: 'Example Engineer', channel: 'Email', contact: 'Alex Example', notes: 'Different person' },
];
const followupMessages = buildApplicationMessages(person, { followups, apps });
check(followupMessages.length === 1 && followupMessages[0].store === 'app' && followupMessages[0].appNum === 41, 'matching follow-up appears with the application source');
check(!followupMessages.some(event => event.origin === 'followup:2'), 'cross-logged follow-up is excluded');
check(!followupMessages.some(event => event.origin === 'followup:3'), 'follow-up for another person is excluded');

const emailAndChannelMessages = buildApplicationMessages(person, {
  apps,
  followups: [
    { n: 4, appNum: 41, date: '2031-02-10', company: 'Examplecorp', role: 'Example Engineer', channel: 'Phone', contact: 'PAT@example.test', notes: 'Phone body' },
    { n: 5, appNum: 41, date: '2031-02-11', company: 'Examplecorp', role: 'Example Engineer', channel: 'Form', contact: 'pat@example.test', notes: 'Form body' },
    { n: 6, appNum: 41, date: '2031-02-12', company: 'Examplecorp', role: 'Example Engineer', channel: 'Other', contact: 'pat@example.test', notes: 'Other body' },
  ],
});
check(emailAndChannelMessages.length === 3, 'follow-up contact email matches the person email');
check(emailAndChannelMessages.every(event => event.kind === 'touch-sent') && emailAndChannelMessages.map(event => event.channel).join(',') === 'Phone,Form,Other', 'non-email follow-up channels and touch kind are preserved');

const appNotes = {
  41: [
    { timestamp: '2031-02-04T10:00:00Z', sender: 'Pat Example <PAT@example.test>', text: '### Reply logged (2031-02-04)\npat@example.test: Re: Example role [positive]\n\nReply body' },
    { timestamp: '2031-02-05T10:00:00Z', sender: 'other@example.test', text: '### Reply logged (2031-02-05)\nother@example.test: Other [neutral]\n\nOther body' },
    { timestamp: '2031-02-06T10:00:00Z', text: '### Debrief: Phone Screen\nNotes' },
    { timestamp: '2031-02-07T10:00:00Z', text: 'Free text note' },
    { timestamp: '2031-02-08T10:00:00Z', kind: 'message', contactRef: 'ta:7', direction: 'Sent', channel: 'Email', subject: 'Structured', body: 'Structured body', text: 'Fallback body' },
    { timestamp: '2031-02-09T10:00:00Z', kind: 'message', contactRef: 'ta:8', subject: 'Wrong contact', text: 'Wrong contact body' },
  ],
};
const noteMessages = buildApplicationMessages(person, { appNotes, apps });
const reply = noteMessages.find(event => event.origin === 'note:41:0');
check(reply?.direction === 'Received' && reply.subject === 'Re: Example role' && !noteMessages.some(event => event.origin === 'note:41:1'), 'only the reply from the verified-tag email is added');
check(!noteMessages.some(event => event.origin === 'note:41:2' || event.origin === 'note:41:3'), 'debrief and free text notes are excluded');
check(noteMessages.some(event => event.origin === 'note:41:4') && !noteMessages.some(event => event.origin === 'note:41:5'), 'structured message is added only for its referenced person');

const correspondence = [{ at: '2032-03-01 09:00', kind: 'email-sent', direction: 'Sent', channel: 'Email', subject: ' Checking  in ', body: 'Original body', store: 'ta', ref: 'ta:7' }];
const duplicate = [{ at: '2032-03-01 15:00', kind: 'email-sent', direction: 'Sent', channel: 'LinkedIn', subject: 'checking in', body: 'Different body', store: 'app', ref: 'app:41', appNum: 41, origin: 'followup:9' }];
check(mergeDisplayTimeline(correspondence, duplicate).length === 1, 'same-day direction and normalized subject duplicate is dropped');

const receivedCorrespondence = [{ at: '2032-03-10 09:00', kind: 'reply-received', direction: 'Received', channel: 'Email', subject: ' Re: Example role ', body: 'Timeline reply', store: 'ta', ref: 'ta:7' }];
const delayedReply = [{ at: '2032-03-17 15:00', kind: 'reply-received', direction: 'Received', channel: 'Email', subject: 're: example  role', body: 'Logged later', store: 'app', ref: 'app:41', appNum: 41, origin: 'note:41:8' }];
const earlyReply = [{ ...delayedReply[0], at: '2032-03-03 15:00' }];
const tooLateReply = [{ ...delayedReply[0], at: '2032-03-18 15:00' }];
const emptySubjectReply = [{ ...delayedReply[0], subject: '', at: '2032-03-11 15:00' }];
check(mergeDisplayTimeline(receivedCorrespondence, delayedReply).length === 1 && mergeDisplayTimeline(receivedCorrespondence, earlyReply).length === 1, 'received subject duplicate within seven days either side is dropped');
check(mergeDisplayTimeline(receivedCorrespondence, tooLateReply).length === 2 && mergeDisplayTimeline([{ ...receivedCorrespondence[0], subject: '' }], emptySubjectReply).length === 2, 'received subject dedupe requires a non-empty subject within seven days');

{
  const email = String(person.members.ta.email || '').split(/\s+/)[0].toLowerCase();
  const [local, domain] = email.split('@');
  const aliasNotes = { 41: [
    { timestamp: '2032-05-01 10:00', text: '### Reply logged (2032-05-01)\nx: Alias subject [positive]\n\nAlias body', sender: `${local}@recruiting.${domain}` },
    { timestamp: '2032-05-02 10:00', text: '### Reply logged (2032-05-02)\nx: Other local [positive]\n\nOther body', sender: `someone.else@recruiting.${domain}` },
    { timestamp: '2032-05-03 10:00', text: '### Reply logged (2032-05-03)\nx: Lookalike [positive]\n\nLookalike body', sender: `${local}@not${domain}` },
  ] };
  const aliasEvents = buildApplicationMessages(person, { appNotes: aliasNotes, apps });
  check(aliasEvents.length === 1 && aliasEvents[0].subject === 'Alias subject', 'a reply from the same mailbox on a company subdomain matches, other senders do not');
}

const crossLoggedFollowups = [
  { at: '2032-04-01 15:00', kind: 'email-sent', direction: 'Sent', channel: 'Email', subject: 'Application subject', body: 'Application body', store: 'app', ref: 'app:41', appNum: 41, origin: 'followup:11' },
  { at: '2032-04-02 15:00', kind: 'touch-sent', direction: 'Sent', channel: 'Phone', subject: 'Another subject', body: 'Another body', store: 'app', ref: 'app:41', appNum: 41, origin: 'followup:12' },
  { at: '2032-04-09 15:00', kind: 'touch-sent', direction: 'Sent', channel: 'Phone', subject: 'Later subject', body: 'Later body', store: 'app', ref: 'app:41', appNum: 41, origin: 'followup:13' },
];
const crossLoggedTimeline = [
  { at: '2032-04-01 09:00', kind: 'email-sent', direction: 'Sent', channel: 'Email', subject: 'TA subject', body: 'TA body', store: 'ta', ref: 'ta:7' },
  { at: '2032-04-02 09:00', kind: 'email-sent', direction: 'Sent', channel: 'Email', subject: 'Logged from App #41', body: 'Cross-logged from App #41', store: 'ta', ref: 'ta:7' },
];
check(mergeDisplayTimeline(crossLoggedTimeline, crossLoggedFollowups).length === 3, 'cross-logged follow-ups dedupe by same-day channel or same-day application marker');
check(mergeDisplayTimeline(crossLoggedTimeline, crossLoggedFollowups).some(event => event.origin === 'followup:13'), 'an application marker on another day does not hide a later follow-up');
check(mergeDisplayTimeline([{ ...crossLoggedTimeline[1], body: 'Cross-logged from App #410' }], [{ ...crossLoggedFollowups[1], channel: 'Phone' }]).length === 2, 'application marker matches the whole number only');

const contextInputs = {
  ta: [person.members.ta],
  referrals: [],
  influencers: [],
  pins: {},
  timelineOpts: {
    correspondence: { 'ta:7': [{ timestamp: '2033-04-01', direction: 'Sent', channel: 'Email', subject: 'Existing', body: 'Existing body' }] },
    linkedinMap: {},
    engagementLog: [],
  },
  apps,
};
const withoutApps = getPersonContext('ta', 7, { ...contextInputs, followups: [], appNotes: {} });
const withApps = getPersonContext('ta', 7, {
  ...contextInputs,
  followups: [{ n: 10, appNum: 41, date: '2033-04-02', company: 'Examplecorp', role: 'Example Engineer', channel: 'Email', contact: 'Pat Example', notes: 'New application message' }],
  appNotes: {},
});
check(JSON.stringify(withApps.timeline) === JSON.stringify(withoutApps.timeline) && JSON.stringify(withApps.lastTouch) === JSON.stringify(withoutApps.lastTouch) && withApps.displayTimeline.length === withoutApps.displayTimeline.length + 1, 'person context changes only the display timeline');

const readCounts = { followups: 0, appNotes: 0, apps: 0 };
const lazyContext = getPersonContext('ta', 7, {
  ...contextInputs,
  apps: undefined,
  readFollowups: () => { readCounts.followups++; return []; },
  readAppNotes: () => { readCounts.appNotes++; return {}; },
  readApps: () => { readCounts.apps++; return apps; },
});
const enforcementOnly = [lazyContext.timeline, lazyContext.lastTouch];
check(enforcementOnly.length === 2 && Object.values(readCounts).every(count => count === 0), 'timeline and lastTouch do not read application message sources');
const firstDisplay = lazyContext.displayTimeline;
const secondDisplay = lazyContext.displayTimeline;
check(firstDisplay === secondDisplay && Object.values(readCounts).every(count => count === 1) && Object.keys(lazyContext).includes('displayTimeline'), 'display timeline is memoized and enumerable');

const incompatible = buildApplicationMessages(person, {
  appNotes: { 42: [{ timestamp: '2034-05-01', kind: 'message', contactRef: 'ta:7', subject: 'Wrong company', text: 'No match' }] },
  apps,
});
check(incompatible.length === 0, 'incompatible application company contributes no messages');

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
