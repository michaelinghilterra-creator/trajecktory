#!/usr/bin/env node
/**
 * contact-twin.test.mjs: one person filed twice must not re-queue as a stranger.
 *
 * A second application at the same employer used to add a fresh row for a
 * contact already on file (the company label differed by a suffix), and the
 * fresh row surfaced in the queue offering a second LinkedIn invite while the
 * first was still pending. Covers the shared matcher and the queue shadowing.
 * Invented people at .example companies only.
 *
 * Run: node tests/contact-twin.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

const tmp = makeSandbox('twin');
process.env.TJK_DATA_DIR = tmp;

const { companyCompatible, sameContact, findExistingContact } =
  await import('../lib/contact-match.mjs');
const { computeConnectQueue, computeEmailQueue } =
  await import('../dashboard-web/server/lib/followups.mjs');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('contact-twin.test.mjs');

console.log('\n1. Company labels');
check(companyCompatible('Quillon Labs', 'Quillon Labs Commerce'), 'a suffix variant is compatible');
check(companyCompatible('Brindle', 'Brindle (Harbor Group)'), 'a parenthetical variant is compatible');
check(companyCompatible('Brindle', 'Brindle.io'), 'a domain-style variant is compatible');
check(!companyCompatible('Quillon Labs', 'Vexor Systems'), 'unrelated companies are not');
check(!companyCompatible('', 'Quillon Labs'), 'an empty label never matches');
check(!companyCompatible('Qu', 'Quillon Labs'), 'a very short prefix does not match');

console.log('\n2. Same person');
const a = { id: 10, first: 'Tamsin', last: 'Orde', company: 'Quillon Labs', linkedin: 'https://www.linkedin.com/in/tamsin-orde-ex/', status: 'Sent' };
const twin = { id: 11, first: 'Tamsin', last: 'Orde', company: 'Quillon Labs Commerce', linkedin: 'https://www.linkedin.com/in/tamsin-orde-ex/', status: 'Not Contacted' };
check(sameContact(twin, a), 'same profile and a suffix-variant company is one person');
check(sameContact({ ...twin, company: 'Another Employer Entirely' }, a), 'the same profile is one person under any company');
check(sameContact({ ...twin, linkedin: '' }, a), 'same name at a compatible company matches with no profile');
check(!sameContact({ ...twin, linkedin: '', company: 'Vexor Systems' }, a), 'same name at an unrelated company with no profile is not a match');
check(!sameContact({ ...twin, first: 'Rowan', linkedin: 'https://www.linkedin.com/in/rowan-orde-ex' }, a), 'a different person at the same company is not a match');
check(findExistingContact(twin, [a, { ...a, id: 5, status: 'Archived' }]).id === 10, 'a live row beats an older archived one');
check(findExistingContact(twin, [{ ...a, id: 12 }, a]).id === 10, 'the oldest live id wins');
check(findExistingContact(twin, []) === null, 'no rows means no match');

console.log('\n3. Queue shadowing');
const row = o => ({
  email: '', verified: { state: 'unverified' }, title: 'Recruiter', notes: '', isPrincipal: false,
  status: 'Not Contacted', ...o,
});
const apps = [
  { company: 'Quillon Labs', status: 'Applied' },
  { company: 'Quillon Labs Commerce', status: 'Applied' },
];
const ids = q => q.map(r => r.id).sort((x, y) => x - y);
const queue = rows => computeConnectQueue({ taRows: rows, referralRows: [], influencers: [], apps });

// Older row already invited (status Sent): the fresh twin must not be offered.
check(ids(queue([row(a), row(twin)])).length === 0, 'a twin of a Sent contact is not queued');

// Invite pending only in the LinkedIn sidecar, older row still Not Contacted.
fs.writeFileSync(path.join(tmp, 'tt-linkedin.json'), JSON.stringify({ 10: { state: 'Invite Pending', updated: '2026-09-29' } }));
check(ids(queue([row({ ...a, status: 'Not Contacted' }), row(twin)])).length === 0, 'a twin of a pending invite is not queued');
fs.writeFileSync(path.join(tmp, 'tt-linkedin.json'), '{}');

// Two live, untouched rows of one person: only the older one is worked.
check(ids(queue([row({ ...a, status: 'Not Contacted' }), row(twin)])).join() === '10', 'of two untouched twins only the older is queued');

// An older ARCHIVED row never shadows: re-adding for a new application revives.
check(ids(queue([row({ ...a, status: 'Archived' }), row(twin)])).join() === '11', 'an archived older row does not hide the revived one');

// An unrelated contact at the same company is untouched.
const other = row({ id: 13, first: 'Rowan', last: 'Pell', company: 'Quillon Labs', linkedin: 'https://www.linkedin.com/in/rowan-pell-ex' });
check(ids(queue([row(a), row(twin), other])).join() === '13', 'a different person at the company still queues');

// The email queue honors the same rule.
const emailA = row({ ...a, linkedin: '', email: 'tamsin.orde@quillon.example', verified: { state: 'ok' } });
const emailTwin = row({ ...twin, linkedin: '', email: 'tamsin.orde@quillon.example', verified: { state: 'ok' } });
const emailQ = computeEmailQueue({ taRows: [emailA, emailTwin], referralRows: [], influencers: [], apps });
check(emailQ.length === 0, 'an email twin of a Sent contact is not queued (no shared profile: name and company)');


console.log('\n4. A started sequence on the twin (the merged follow-up list)');
const { computeContactFollowups } = await import('../dashboard-web/server/lib/followups.mjs');
const day = off => { const d = new Date(); d.setDate(d.getDate() + off); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ttLine = (id, company, status, url) =>
  `| ${id} | ${company} | Orde | Tamsin |  | Recruiter |  |  |  |  |  | ${url} | ${status} | ${day(-3)} |  |  |`;
const writeBook = lines => fs.writeFileSync(path.join(tmp, 'target-talent.md'), [
  '# Target Talent', '',
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...lines, ''].join('\n'), 'utf8');
const dueStep = { sequenceId: 'application-day-0-1-5-12', startedAt: day(-20), step: 0, nextStepDue: day(-3), paused: false, completedAt: null, firstChannel: 'linkedin' };
fs.writeFileSync(path.join(tmp, 'contact-sequences.json'), JSON.stringify({ 'ta:11': dueStep }));
const url = 'https://www.linkedin.com/in/tamsin-orde-ex/';
const merged = () => computeContactFollowups({ apps }).filter(r => r.source === 'ta').map(r => r.id);
writeBook([ttLine(10, 'Quillon Labs', 'Sent', url), ttLine(11, 'Quillon Labs Commerce', 'Not Contacted', url)]);
const { computeDueSequenceContacts } = await import('../dashboard-web/server/lib/followups.mjs');
const rawDue = () => computeDueSequenceContacts({ apps }).map(r => r.id);
check(!merged().includes(11), 'a due sequence on a twin of a Sent contact is not surfaced');
check(!rawDue().includes(11), 'the raw due-sequence list (nav badge, urgent queue) skips the twin too');
writeBook([ttLine(11, 'Quillon Labs Commerce', 'Not Contacted', url)]);
check(merged().includes(11), 'the same due sequence surfaces when there is no twin');
check(rawDue().includes(11), 'the raw due-sequence list surfaces it when there is no twin');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
