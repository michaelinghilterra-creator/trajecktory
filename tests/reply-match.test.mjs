import { matchReply, matchReplies } from '../lib/reply-match.mjs';

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('✅ ' + msg); }
  else { failed++; console.log('❌ ' + msg); }
}
function throwsType(fn, text) {
  try { fn(); } catch (e) { return e instanceof TypeError && e.message.includes(text); }
  return false;
}

const apps = [
  { id: 900001, company: 'Zorblax Widgetry', role: 'Example Flange Engineer', apply_date: '2030-03-01', thread_ids: ['t-900001'] },
  { id: 900002, company: 'Zorblax Widgetry', role: 'Example Widget Planner', apply_date: '2030-03-10', thread_ids: [] },
  { id: 900003, company: 'Quennox Ratchet Works', role: 'Example Ratchet Analyst', apply_date: '2030-03-05', thread_ids: [] },
  { id: 900004, company: 'Quennox Ratchet Works', role: 'Example Ratchet Analyst', apply_date: null, thread_ids: [] },
  { id: 900005, company: 'Vantrix Sprocketry', role: 'Example Sprocket Designer', apply_date: '2030-03-20', thread_ids: [] },
];
const msg = (over) => ({ message_id: 'm-900001', message_date: '2030-03-15', company: 'Zorblax Widgetry', subject: '', body: '', thread_id: '', ...over });

// role names one of two same-employer applications
let r = matchReply(msg({ subject: 'Update on your Example Flange Engineer application' }), apps);
check(r.status === 'matched' && r.application_id === 900001 && r.method === 'role' && r.flags.length === 0, 'role in subject picks that application');
r = matchReply(msg({ subject: 'Update on your application', body: 'About the Example Widget Planner role: we will not proceed.' }), apps);
check(r.status === 'matched' && r.application_id === 900002 && r.method === 'role', 'role in body picks that application');
r = matchReply(msg({ subject: 'EXAMPLE FLANGE ENGINEER, next steps' }), apps);
check(r.status === 'matched' && r.application_id === 900001, 'role match ignores case and punctuation');

// a message naming neither role goes to unmatched with ranked suggestions
r = matchReply(msg({ subject: 'Thank you for applying', body: 'We received your application.' }), apps);
check(r.status === 'unmatched' && r.reason === 'no_role_signal', 'no role signal with two applications is unmatched');
check(JSON.stringify(r.suggestions) === JSON.stringify([900002, 900001]), 'suggestions list both, most recent eligible apply date first');
r = matchReply(msg({ message_date: '2030-03-05', subject: 'Hello' }), apps);
check(JSON.stringify(r.suggestions) === JSON.stringify([900001, 900002]), 'an application whose apply date is after the message ranks below an eligible one');

// role text ranks suggestions ahead of dates when a role is named twice
const twoAtOne = [
  { id: 900011, company: 'Zorblax Widgetry', role: 'Example Flange Engineer', apply_date: '2030-03-01', thread_ids: [] },
  { id: 900012, company: 'Zorblax Widgetry', role: 'Example Flange Engineer', apply_date: '2030-03-12', thread_ids: [] },
];
r = matchReply(msg({ subject: 'Example Flange Engineer' }), twoAtOne);
check(r.status === 'unmatched' && r.reason === 'ambiguous_role' && r.suggestions.join() === '900012,900011', 'two same-role applications both in the window are ambiguous, never decided by recency');
r = matchReply(msg({ subject: 'Example Flange Engineer', message_date: '2030-03-05' }), twoAtOne);
check(r.status === 'matched' && r.application_id === 900011 && r.method === 'role_and_window' && r.flags.length === 0, 'window picks the one application applied on or before the message');

// sole application at an employer needs company only
r = matchReply(msg({ company: 'Vantrix Sprocketry', message_date: '2030-03-25', subject: 'Hello' }), apps);
check(r.status === 'matched' && r.application_id === 900005 && r.method === 'sole_application', 'one application at the employer matches on company');

// flags
r = matchReply(msg({ company: 'Vantrix Sprocketry', message_date: '2030-03-19', subject: 'Hello' }), apps);
check(r.status === 'matched' && r.flags.join() === 'before_apply_date', 'a message dated before the apply date is flagged');
const noDate = [{ id: 900021, company: 'Vantrix Sprocketry', role: 'Example Sprocket Designer', apply_date: '', thread_ids: [] }];
r = matchReply(msg({ company: 'Vantrix Sprocketry' }), noDate);
check(r.status === 'matched' && r.flags.join() === 'no_apply_date', 'an application with no apply date is flagged');
r = matchReply(msg({ subject: 'Example Flange Engineer', message_date: '2030-02-20' }), apps);
check(r.status === 'matched' && r.application_id === 900001 && r.flags.join() === 'before_apply_date', 'a unique role match before its apply date is matched and flagged');

r = matchReply(msg({ company: 'Vantrix Sprocketry', message_date: '2030-03-20', subject: 'Hello' }), apps);
check(r.status === 'matched' && r.flags.length === 0, 'a message dated the same day as the apply date is not flagged');
const sameDay = [
  { id: 900051, company: 'Zorblax Widgetry', role: 'Example Flange Engineer', apply_date: '2030-03-15', thread_ids: [] },
  { id: 900052, company: 'Zorblax Widgetry', role: 'Example Flange Engineer', apply_date: '2030-03-16', thread_ids: [] },
];
r = matchReply(msg({ subject: 'Example Flange Engineer' }), sameDay);
check(r.status === 'matched' && r.application_id === 900051 && r.method === 'role_and_window', 'an application applied on the message day is inside the window');

// thread continuity beats an absent role signal
r = matchReply(msg({ thread_id: 't-900001', subject: 'Re: hello' }), apps);
check(r.status === 'matched' && r.application_id === 900001 && r.method === 'thread', 'a known thread attaches to its application');
const sharedThread = [
  { id: 900031, company: 'Zorblax Widgetry', role: 'Example Flange Engineer', apply_date: '2030-03-01', thread_ids: ['t-shared'] },
  { id: 900032, company: 'Zorblax Widgetry', role: 'Example Widget Planner', apply_date: '2030-03-02', thread_ids: ['t-shared'] },
];
r = matchReply(msg({ thread_id: 't-shared', subject: 'Example Widget Planner' }), sharedThread);
check(r.status === 'unmatched' && r.reason === 'ambiguous_thread' && r.suggestions[0] === 900032, 'a thread on two applications is unmatched, role ranks first');
r = matchReply(msg({ thread_id: 't-unknown', subject: 'Example Widget Planner' }), apps);
check(r.status === 'matched' && r.application_id === 900002 && r.method === 'role', 'an unknown thread falls through to the role');

// company must match exactly after normalising; a prefix is not a match
r = matchReply(msg({ company: 'Zorblax Widgetry Labs', subject: 'Example Flange Engineer' }), apps);
check(r.status === 'unmatched' && r.reason === 'no_company_match' && r.suggestions.length === 0, 'a company that only shares a prefix is unmatched');
r = matchReply(msg({ company: 'zorblax-widgetry', subject: 'Example Flange Engineer' }), apps);
check(r.status === 'matched' && r.application_id === 900001, 'case and punctuation in the company do not matter');
check(matchReply(msg({ company: '' }), apps).reason === 'no_company_match', 'an empty company is unmatched');
check(matchReply(msg({ company: '!!!' }), apps).reason === 'no_company_match', 'a company that normalises to nothing is unmatched');

// two same-employer, same-role, both dated: ambiguous
const dup = [
  { id: 900041, company: 'Quennox Ratchet Works', role: 'Example Ratchet Analyst', apply_date: '2030-03-01', thread_ids: [] },
  { id: 900042, company: 'Quennox Ratchet Works', role: 'Example Ratchet Analyst', apply_date: '2030-03-02', thread_ids: [] },
];
r = matchReply(msg({ company: 'Quennox Ratchet Works', subject: 'Example Ratchet Analyst' }), dup);
check(r.status === 'unmatched' && r.reason === 'ambiguous_role' && r.suggestions.join() === '900042,900041', 'two role matches both in the window are ambiguous, newest first');

// duplicates: one message id attaches once
const attached = new Map([['m-900001', 900002]]);
r = matchReply(msg({ subject: 'Example Flange Engineer' }), apps, { attached });
check(r.status === 'duplicate' && r.application_id === 900002, 'a message id already attached is a duplicate');
const batch = matchReplies([
  msg({ message_id: 'm-a', subject: 'Example Flange Engineer' }),
  msg({ message_id: 'm-a', subject: 'Example Widget Planner' }),
  msg({ message_id: 'm-b', subject: 'Hello' }),
  msg({ message_id: 'm-c', company: 'Unknown Gizmos' }),
], apps);
check(batch.matched.length === 1 && batch.matched[0].application_id === 900001, 'batch: first use of an id matches');
check(batch.duplicates.length === 1 && batch.duplicates[0].message_id === 'm-a' && batch.duplicates[0].application_id === 900001, 'batch: a repeat of the id is a duplicate of the first attachment');
check(batch.unmatched.length === 2 && batch.unmatched[0].reason === 'no_role_signal' && batch.unmatched[1].reason === 'no_company_match', 'batch: unmatched keeps its reasons in order');
const before = new Map();
matchReplies([msg({ subject: 'Example Flange Engineer' })], apps, { attached: before });
check(before.size === 0, 'batch does not modify the attached map it was given');

// input checks
check(throwsType(() => matchReply(msg({ message_id: '' }), apps), 'message_id'), 'empty message_id throws');
check(throwsType(() => matchReply(msg({ message_id: 5 }), apps), 'message_id'), 'non-string message_id throws');
check(throwsType(() => matchReply(msg({ message_date: '2030-02-30' }), apps), 'message_date'), 'an impossible date throws');
check(throwsType(() => matchReply(msg({ message_date: '03/15/2030' }), apps), 'message_date'), 'a non ISO date throws');
check(matchReply(msg({ subject: 'x' }), []).reason === 'no_company_match', 'no applications is unmatched');
check(matchReply(msg({ subject: undefined, body: undefined }), apps).status === 'unmatched', 'missing subject and body do not throw');

console.log(`reply-match: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
