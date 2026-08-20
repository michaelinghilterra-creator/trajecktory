#!/usr/bin/env node
/**
 * email-queue.test.mjs — the email counterpart of the connect queue.
 *
 * computeEmailQueue surfaces contacts you CAN email (a sendable, verified
 * address) at companies you've applied to, and haven't emailed yet. It is the
 * inverse membership of the connect queue (which requires NO sendable email) and
 * shares the same applied-company gate. Working it logs verified EMAIL touches.
 *
 * Run: node tests/email-queue.test.mjs   (exit 0 = pass, 1 = fail)
 */
import { computeEmailQueue } from '../dashboard-web/server/lib/followups.mjs';

let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) { console.log(`  ✅ ${msg}`); passed++; } else { console.log(`  ❌ ${msg}`); failed++; } };

// Row shapes mirror parseTargetTalentMd: `email` is the clean
// address, `verified.state` drives the send gate.
const ta = (o) => ({ id: o.id, first: o.first, last: o.last, title: o.title, company: o.company,
  status: o.status, linkedin: o.linkedin || '', email: o.email || '',
  verified: { state: o.state || 'unverified', address: o.email || '' } });

console.log('email-queue.test.mjs');

const taRows = [
  ta({ id: 1, first: 'Ada', last: 'Vance', title: 'VP People', company: 'Northwind Robotics', email: 'ada.vance@northwind.example', state: 'ok', status: 'Not Contacted' }),          // IN
  ta({ id: 2, first: 'Ben', last: 'Marlowe', title: 'Recruiter',  company: 'Northwind Robotics', status: 'Not Contacted' }),                                                           // no email → connect lane, not here
  ta({ id: 3, first: 'Cy',  last: 'Rowe',  title: 'Head of TA', company: 'Nimbus Health',      email: 'cy.rowe@nimbus.example', state: 'ok', status: 'Not Contacted' }),               // Evaluated-only company → gated out
  ta({ id: 4, first: 'Di',  last: 'Frost', title: 'TA Lead',    company: 'Northwind Robotics', email: 'di.frost@northwind.example', state: 'ok', status: 'Sent' }),                     // already emailed → out
  ta({ id: 5, first: 'Eli', last: 'Park',  title: 'People Ops', company: 'Northwind Robotics', email: 'eli.park@northwind.example', state: 'risky', status: 'Archived' }),             // archived → out
  ta({ id: 6, first: 'Fay', last: 'Quinn', title: 'Sourcer',    company: 'Northwind Robotics', email: 'fay.quinn@northwind.example', state: 'bounced', status: 'Not Contacted' }),     // dead address → not sendable
];
// Gate is CURRENT status in OUTREACH_ELIGIBLE_STATUSES (live funnel + No Response),
// not the furthest rung ever reached. Nimbus (Evaluated) is pre-application → gated.
const apps = [
  { company: 'Northwind Robotics', status: 'Applied' },
  { company: 'Nimbus Health',      status: 'Evaluated' },   // not applied → gated
];

const q = computeEmailQueue({ taRows, apps });
const ids = q.map(r => `${r.source}:${r.id}`);

check(q.length === 1, `queue holds exactly the 1 emailable-at-applied contact (got ${q.length})`);
check(ids.includes('ta:1'), 'sendable TA contact at an applied company is queued');
check(!ids.includes('ta:2'), 'contact with NO email is NOT in the email queue (that is the connect lane)');
check(!ids.includes('ta:3'), 'sendable contact at an Evaluated-only company is NOT queued (gate)');
check(!ids.includes('ta:4'), 'already-emailed contact (status Sent) is NOT queued');
check(!ids.includes('ta:5'), 'archived contact is NOT queued');
check(!ids.includes('ta:6'), 'bounced address is NOT sendable, so NOT queued');

const ada = q.find(r => r.id === 1);
check(ada && ada.email === 'ada.vance@northwind.example', 'row carries the clean email address');
check(ada && ada.source === 'ta', 'row is source-tagged');

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
