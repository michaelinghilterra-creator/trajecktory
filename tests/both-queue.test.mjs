#!/usr/bin/env node
/**
 * both-queue.test.mjs — unit tests for the HIGH-VALUE (both-channel) bucket and
 * the three-way mutual exclusion across the connect / email / both queues.
 *
 * The rule: a contact is classified by which channels you actually hold —
 *   LinkedIn only        → connect queue
 *   verified email only  → email queue
 *   BOTH                 → both queue (the high-value multithread)
 * and the three buckets are mutually exclusive, so a both-channel contact appears
 * ONLY in the both queue, never also in connect or email.
 *
 * All fixtures are invented contacts at .example domains — no real personal data.
 *
 * Run: node tests/both-queue.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { computeConnectQueue, computeEmailQueue, computeBothQueue } from '../dashboard-web/server/lib/followups.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('both-queue.test.mjs');

const ta = (o) => ({
  id: o.id, first: o.first, last: o.last, title: o.title, company: o.company,
  email: o.email || '', verified: { state: o.state || 'unverified', address: o.email || '' },
  linkedin: o.linkedin || '', status: o.status, notes: o.notes || '',
});
const rec = (o) => ({
  id: o.id, first: o.first, last: o.last, title: o.title, firm: o.firm,
  email: o.email || '', verified: { state: o.state || 'unverified', address: o.email || '' },
  linkedin: o.linkedin || '', status: o.status, notes: o.notes || '',
});

const taRows = [
  // BOTH channels (verified email + LinkedIn), applied, active → HIGH VALUE
  ta({ id: 501, first: 'Ivy', last: 'Delgado', title: 'VP RevOps', company: 'Brightwave Labs',
       email: 'ivy.delgado@brightwave.example', state: 'ok',
       linkedin: 'linkedin.com/in/ivy-delgado-ex', status: 'Not Contacted' }),
  // LinkedIn ONLY (no email), applied → connect queue, NOT both
  ta({ id: 502, first: 'Otis', last: 'Frame', title: 'Head of TA', company: 'Cobalt Systems',
       linkedin: 'linkedin.com/in/otis-frame-ex', status: 'Not Contacted' }),
  // Email ONLY (verified, no LinkedIn), applied → email queue, NOT both
  ta({ id: 503, first: 'Priya', last: 'Nayar', title: 'Recruiter', company: 'Aster Grid',
       email: 'priya.nayar@aster.example', state: 'ok', status: 'Not Contacted' }),
  // BOTH channels but REPLIED → paused, excluded from the both queue
  ta({ id: 504, first: 'Wes', last: 'Holloway', title: 'Director RevOps', company: 'Meridian AI',
       email: 'wes.holloway@meridian.example', state: 'ok',
       linkedin: 'linkedin.com/in/wes-holloway-ex', status: 'Replied' }),
  // BOTH channels but company only EVALUATED (not applied) → gate excludes it
  ta({ id: 505, first: 'Lena', last: 'Poe', title: 'VP People', company: 'Nimbus Health',
       email: 'lena.poe@nimbus.example', state: 'ok',
       linkedin: 'linkedin.com/in/lena-poe-ex', status: 'Not Contacted' }),
];

const recruiterRows = [
  // BOTH channels recruiter, applied (company from `firm`) → HIGH VALUE
  rec({ id: 601, first: 'Cyrus', last: 'Vance', title: 'Partner', firm: 'Halcyon Partners',
        email: 'cyrus@halcyon.example', state: 'ok',
        linkedin: 'linkedin.com/in/cyrus-vance-ex', status: 'Not Contacted' }),
];

const apps = [
  { company: 'Brightwave Labs', status: 'Applied' },
  { company: 'Cobalt Systems',  status: 'Applied' },
  { company: 'Aster Grid',      status: 'Applied' },
  { company: 'Meridian AI',     status: 'Applied' },
  { company: 'Halcyon Partners', status: 'Applied' },
  { company: 'Nimbus Health',   status: 'Evaluated' }, // 505 gated out (pre-application)
];

const both = computeBothQueue({ taRows, recruiterRows, apps });
const connect = computeConnectQueue({ taRows, recruiterRows, apps });
const email = computeEmailQueue({ taRows, recruiterRows, apps });
const bothIds = both.map(r => `${r.source}:${r.id}`);
const connectIds = connect.map(r => `${r.source}:${r.id}`);
const emailIds = email.map(r => `${r.source}:${r.id}`);

console.log('\n── high-value (both) bucket membership ─────────────────────────────');
check(bothIds.includes('ta:501'), 'both-channel TA contact at an applied company is in the both queue');
check(bothIds.includes('recruiter:601'), 'both-channel recruiter at an applied company is in the both queue');
check(!bothIds.includes('ta:502'), 'LinkedIn-only contact is NOT in the both queue');
check(!bothIds.includes('ta:503'), 'email-only contact is NOT in the both queue');
check(!bothIds.includes('ta:504'), 'both-channel contact who REPLIED is paused out of the both queue');
check(!bothIds.includes('ta:505'), 'both-channel contact at an Evaluated-only company is gated out');

console.log('\n── three-way mutual exclusion ──────────────────────────────────────');
check(!connectIds.includes('ta:501'), 'high-value contact does NOT also appear in the connect queue');
check(!emailIds.includes('ta:501'), 'high-value contact does NOT also appear in the email queue');
check(!connectIds.includes('recruiter:601'), 'high-value recruiter does NOT appear in the connect queue');
check(!emailIds.includes('recruiter:601'), 'high-value recruiter does NOT appear in the email queue');
check(connectIds.includes('ta:502'), 'LinkedIn-only contact is in the connect queue');
check(!emailIds.includes('ta:502'), 'LinkedIn-only contact is NOT in the email queue');
check(emailIds.includes('ta:503'), 'email-only contact is in the email queue');
check(!connectIds.includes('ta:503'), 'email-only contact is NOT in the connect queue');

console.log('\n── per-channel done flags ──────────────────────────────────────────');
const ivy = both.find(r => r.id === 501);
check(ivy && 'linkedinDone' in ivy && 'emailDone' in ivy, 'both-queue rows carry linkedinDone / emailDone');
check(ivy && ivy.linkedinDone === false && ivy.emailDone === false,
  'a freshly-surfaced contact has neither channel done yet');
check(ivy && ivy.hasEmail === true && (ivy.linkedin || '').length > 0,
  'high-value row carries both a sendable email and a LinkedIn handle');

console.log('\n── empty input is safe ─────────────────────────────────────────────');
check(computeBothQueue({ taRows: [], recruiterRows: [], apps: [] }).length === 0, 'empty rows → empty both queue');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
