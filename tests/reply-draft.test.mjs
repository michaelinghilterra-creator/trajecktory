#!/usr/bin/env node
/**
 * reply-draft.test.mjs — the shared "Reply" draft helpers (lib/reply-draft.mjs)
 * used by the TA and recruiter draft routes.
 */
import { lastReceived, collapseRe, buildReplyPrompt } from '../dashboard-web/server/lib/reply-draft.mjs';

let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) { console.log(`  ✅ ${msg}`); passed++; } else { console.log(`  ❌ ${msg}`); failed++; } };

console.log('\nlastReceived');
const thread = [
  { direction: 'Sent', timestamp: '2026-07-01 10:00', subject: 'Intro', body: 'a' },
  { direction: 'Received', timestamp: '2026-07-02 11:00', subject: 'RE: Intro', body: 'first reply' },
  { direction: 'Sent', timestamp: '2026-07-03 12:00', subject: 'RE: Intro', body: 'b' },
  { direction: 'Received', timestamp: '2026-07-04 13:00', subject: 'RE: Intro', body: 'latest reply' },
];
check(lastReceived(thread)?.body === 'latest reply', 'returns the MOST RECENT received message');
check(lastReceived([]) === null, 'returns null when the log is empty');
check(lastReceived([{ direction: 'Sent', subject: 's', body: 'b' }]) === null, 'returns null when there is no inbound message');

console.log('\ncollapseRe');
check(collapseRe('RE: RE: Sr. Director', 'RE: Sr. Director') === 'RE: Sr. Director', 'collapses stacked RE: RE: to one RE:');
check(collapseRe('Re: Re: X') === 'RE: X', 'collapses case-insensitively and normalizes to RE:');
check(collapseRe('RE: X') === 'RE: X', 'a single RE: is left unchanged');
check(collapseRe('Fresh subject') === 'Fresh subject', 'a subject with no reply prefix is left as-is (fresh subject allowed)');
check(collapseRe('', 'Their subject') === 'RE: Their subject', 'falls back to RE: <inbound> when the model returns no subject');
check(collapseRe('Fwd: Re: X') === 'RE: X', 'collapses mixed Fwd:/Re: runs');

console.log('\nbuildReplyPrompt');
const me = { fullName: 'Test User', firstName: 'Test' };
const prompt = buildReplyPrompt({
  me, cvMd: 'CV_MARKER', profileMd: 'PROFILE_MARKER', prior: thread,
  contactLabel: 'an executive recruiter at Acme', contactBlock: 'Firm: Acme', firstName: 'Dana',
});
check(/reply to THIS/i.test(prompt), 'prompt frames the task as replying to their last email');
check(prompt.includes('latest reply'), 'prompt embeds the most recent inbound email body');
check(prompt.includes('CV_MARKER') && prompt.includes('PROFILE_MARKER'), 'prompt includes the CV and profile for voice');
check(prompt.includes('Hi Dana,'), 'prompt tells the model the greeting is prefilled with the contact first name');
check(/RE:/.test(prompt), 'prompt asks for a RE: subject');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
