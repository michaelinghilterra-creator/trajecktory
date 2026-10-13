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
  refs: ['ta:900001'],
  members: {
    ta: { id: 900001, first: 'Example', last: 'Personone', company: 'Zorblax Widgetry', email: 'personone@example.test [v:ok:mv:2030-01-01]' },
  },
};
const apps = [
  { id: 900003, company: 'Zorblax Widgetry Labs', role: 'Widget Operations Lead' },
  { id: 900004, company: 'Quennox Ratchet Works', role: 'Ratchet Operations Lead' },
];

const followups = [
  { n: 1, appNum: 900003, date: '2031-02-01', company: 'Zorblax Widgetry', role: 'Widget Operations Lead', channel: 'LinkedIn DM', contact: 'Example Personone (Smith)', notes: 'Subject: Checking in\nMessage body' },
  { n: 2, appNum: 900003, date: '2031-02-02', company: 'Zorblax Widgetry', role: 'Widget Operations Lead', channel: 'Email', contact: 'Example Personone', notes: 'Cross-logged from Talent Acquisition #900001' },
  { n: 3, appNum: 900003, date: '2031-02-03', company: 'Zorblax Widgetry', role: 'Widget Operations Lead', channel: 'Email', contact: 'Example Persontwo', notes: 'Different person' },
];
const followupMessages = buildApplicationMessages(person, { followups, apps });
check(followupMessages.length === 1 && followupMessages[0].store === 'app' && followupMessages[0].appNum === 900003, 'matching follow-up appears with the application source');
check(!followupMessages.some(event => event.origin === 'followup:2'), 'cross-logged follow-up is excluded');
check(!followupMessages.some(event => event.origin === 'followup:3'), 'follow-up for another person is excluded');

const emailAndChannelMessages = buildApplicationMessages(person, {
  apps,
  followups: [
    { n: 4, appNum: 900003, date: '2031-02-10', company: 'Zorblax Widgetry', role: 'Widget Operations Lead', channel: 'Phone', contact: 'PERSONONE@example.test', notes: 'Phone body' },
    { n: 5, appNum: 900003, date: '2031-02-11', company: 'Zorblax Widgetry', role: 'Widget Operations Lead', channel: 'Form', contact: 'personone@example.test', notes: 'Form body' },
    { n: 6, appNum: 900003, date: '2031-02-12', company: 'Zorblax Widgetry', role: 'Widget Operations Lead', channel: 'Other', contact: 'personone@example.test', notes: 'Other body' },
  ],
});
check(emailAndChannelMessages.length === 3, 'follow-up contact email matches the person email');
check(emailAndChannelMessages.every(event => event.kind === 'touch-sent') && emailAndChannelMessages.map(event => event.channel).join(',') === 'Phone,Form,Other', 'non-email follow-up channels and touch kind are preserved');

const appNotes = {
  900003: [
    { timestamp: '2031-02-04T10:00:00Z', sender: 'Example Personone <PERSONONE@example.test>', text: '### Reply logged (2031-02-04)\npersonone@example.test: Re: Widget role [positive]\n\nReply body' },
    { timestamp: '2031-02-05T10:00:00Z', sender: 'persontwo@example.test', text: '### Reply logged (2031-02-05)\npersontwo@example.test: Other [neutral]\n\nOther body' },
    { timestamp: '2031-02-06T10:00:00Z', text: '### Debrief: Phone Screen\nNotes' },
    { timestamp: '2031-02-07T10:00:00Z', text: 'Free text note' },
    { timestamp: '2031-02-08T10:00:00Z', kind: 'message', contactRef: 'ta:900001', direction: 'Sent', channel: 'Email', subject: 'Structured', body: 'Structured body', text: 'Fallback body' },
    { timestamp: '2031-02-09T10:00:00Z', kind: 'message', contactRef: 'ta:900002', subject: 'Wrong contact', text: 'Wrong contact body' },
  ],
};
const noteMessages = buildApplicationMessages(person, { appNotes, apps });
const reply = noteMessages.find(event => event.origin === 'note:900003:0');
check(reply?.direction === 'Received' && reply.subject === 'Re: Widget role' && !noteMessages.some(event => event.origin === 'note:900003:1'), 'only the reply from the verified-tag email is added');
check(!noteMessages.some(event => event.origin === 'note:900003:2' || event.origin === 'note:900003:3'), 'debrief and free text notes are excluded');
check(noteMessages.some(event => event.origin === 'note:900003:4') && !noteMessages.some(event => event.origin === 'note:900003:5'), 'structured message is added only for its referenced person');

const correspondence = [{ at: '2032-03-01 09:00', kind: 'email-sent', direction: 'Sent', channel: 'Email', subject: ' Checking  in ', body: 'Original body', store: 'ta', ref: 'ta:900001' }];
const duplicate = [{ at: '2032-03-01 15:00', kind: 'email-sent', direction: 'Sent', channel: 'LinkedIn', subject: 'checking in', body: 'Different body', store: 'app', ref: 'app:900003', appNum: 900003, origin: 'followup:9' }];
check(mergeDisplayTimeline(correspondence, duplicate).length === 1, 'same-day direction and normalized subject duplicate is dropped');

const receivedCorrespondence = [{ at: '2032-03-10 09:00', kind: 'reply-received', direction: 'Received', channel: 'Email', subject: ' Re: Widget role ', body: 'Timeline reply', store: 'ta', ref: 'ta:900001' }];
const delayedReply = [{ at: '2032-03-17 15:00', kind: 'reply-received', direction: 'Received', channel: 'Email', subject: 're: widget  role', body: 'Logged later', store: 'app', ref: 'app:900003', appNum: 900003, origin: 'note:900003:8' }];
const earlyReply = [{ ...delayedReply[0], at: '2032-03-03 15:00' }];
const tooLateReply = [{ ...delayedReply[0], at: '2032-03-18 15:00' }];
const emptySubjectReply = [{ ...delayedReply[0], subject: '', at: '2032-03-11 15:00' }];
check(mergeDisplayTimeline(receivedCorrespondence, delayedReply).length === 1 && mergeDisplayTimeline(receivedCorrespondence, earlyReply).length === 1, 'received subject duplicate within seven days either side is dropped');
check(mergeDisplayTimeline(receivedCorrespondence, tooLateReply).length === 2 && mergeDisplayTimeline([{ ...receivedCorrespondence[0], subject: '' }], emptySubjectReply).length === 2, 'received subject dedupe requires a non-empty subject within seven days');

{
  const email = String(person.members.ta.email || '').split(/\s+/)[0].toLowerCase();
  const [local, domain] = email.split('@');
  const aliasNotes = { 900003: [
    { timestamp: '2032-05-01 10:00', text: '### Reply logged (2032-05-01)\nx: Alias subject [positive]\n\nAlias body', sender: `${local}@recruiting.${domain}` },
    { timestamp: '2032-05-02 10:00', text: '### Reply logged (2032-05-02)\nx: Other local [positive]\n\nOther body', sender: `persontwo@recruiting.${domain}` },
    { timestamp: '2032-05-03 10:00', text: '### Reply logged (2032-05-03)\nx: Lookalike [positive]\n\nLookalike body', sender: `${local}@not${domain}` },
  ] };
  const aliasEvents = buildApplicationMessages(person, { appNotes: aliasNotes, apps });
  check(aliasEvents.length === 1 && aliasEvents[0].subject === 'Alias subject', 'a reply from the same mailbox on a company subdomain matches, other senders do not');
}

const crossLoggedFollowups = [
  { at: '2032-04-01 15:00', kind: 'email-sent', direction: 'Sent', channel: 'Email', subject: 'Application subject', body: 'Application body', store: 'app', ref: 'app:900003', appNum: 900003, origin: 'followup:11' },
  { at: '2032-04-02 15:00', kind: 'touch-sent', direction: 'Sent', channel: 'Phone', subject: 'Another subject', body: 'Another body', store: 'app', ref: 'app:900003', appNum: 900003, origin: 'followup:12' },
  { at: '2032-04-09 15:00', kind: 'touch-sent', direction: 'Sent', channel: 'Phone', subject: 'Later subject', body: 'Later body', store: 'app', ref: 'app:900003', appNum: 900003, origin: 'followup:13' },
];
const crossLoggedTimeline = [
  { at: '2032-04-01 09:00', kind: 'email-sent', direction: 'Sent', channel: 'Email', subject: 'TA subject', body: 'TA body', store: 'ta', ref: 'ta:900001' },
  { at: '2032-04-02 09:00', kind: 'email-sent', direction: 'Sent', channel: 'Email', subject: 'Logged from App #900003', body: 'Cross-logged from App #900003', store: 'ta', ref: 'ta:900001' },
];
check(mergeDisplayTimeline(crossLoggedTimeline, crossLoggedFollowups).length === 3, 'cross-logged follow-ups dedupe by same-day channel or same-day application marker');
check(mergeDisplayTimeline(crossLoggedTimeline, crossLoggedFollowups).some(event => event.origin === 'followup:13'), 'an application marker on another day does not hide a later follow-up');
check(mergeDisplayTimeline([{ ...crossLoggedTimeline[1], body: 'Cross-logged from App #9000030' }], [{ ...crossLoggedFollowups[1], channel: 'Phone' }]).length === 2, 'application marker matches the whole number only');

const contextInputs = {
  ta: [person.members.ta],
  referrals: [],
  influencers: [],
  pins: {},
  timelineOpts: {
    correspondence: { 'ta:900001': [{ timestamp: '2033-04-01', direction: 'Sent', channel: 'Email', subject: 'Existing', body: 'Existing body' }] },
    linkedinMap: {},
    engagementLog: [],
  },
  apps,
};
const withoutApps = getPersonContext('ta', 900001, { ...contextInputs, followups: [], appNotes: {} });
const withApps = getPersonContext('ta', 900001, {
  ...contextInputs,
  followups: [{ n: 10, appNum: 900003, date: '2033-04-02', company: 'Zorblax Widgetry', role: 'Widget Operations Lead', channel: 'Email', contact: 'Example Personone', notes: 'New application message' }],
  appNotes: {},
});
check(JSON.stringify(withApps.timeline) === JSON.stringify(withoutApps.timeline) && JSON.stringify(withApps.lastTouch) === JSON.stringify(withoutApps.lastTouch) && withApps.displayTimeline.length === withoutApps.displayTimeline.length + 1, 'person context changes only the display timeline');

const readCounts = { followups: 0, appNotes: 0, apps: 0 };
const lazyContext = getPersonContext('ta', 900001, {
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
  appNotes: { 900004: [{ timestamp: '2034-05-01', kind: 'message', contactRef: 'ta:900001', subject: 'Wrong company', text: 'No match' }] },
  apps,
});
check(incompatible.length === 0, 'incompatible application company contributes no messages');

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
