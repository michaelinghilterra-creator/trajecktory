#!/usr/bin/env node
/**
 * unthreaded-apps.test.mjs pins the separate unmapped and talent-only queues,
 * plus the additive reconcile decision for companies missing a principal.
 *
 * Run: node tests/unthreaded-apps.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { computeContactlessApps, computeUnthreadedApps } from '../dashboard-web/server/lib/followups.mjs';
import { reconcilePreview } from '../dashboard-web/server/lib/tt-reconcile-core.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('unthreaded-apps.test.mjs');

const app = (id, company, date, status = 'Applied') => ({ id, company, role: `Role ${id}`, date, status, score: 4.5 });
const contact = (id, company, influenceTier, status = 'Not Contacted') => ({
  id, company, first: 'Alex', last: 'Morgan', title: 'Contact', status, influenceTier, notes: `[tier:${influenceTier}]`,
});

const apps = [
  app(1, 'Talent Only.example', '2026-08-20'),
  app(2, 'Hiring Manager.example', '2026-08-19'),
  app(3, 'Executive.example', '2026-08-18'),
  app(4, 'Peer.example', '2026-08-17'),
  app(5, 'Nobody.example', '2026-08-16'),
  app(6, 'Archived Principal.example', '2026-08-21'),
  app(7, 'Dead.example', '2026-08-22', 'Rejected'),
  app(8, 'New Talent.example', '2026-08-23'),
];
const taRows = [
  contact('t1', 'Talent Only.example', 'ta'),
  contact('t2', 'Talent Only.example', 'agency'),
  contact('h1', 'Hiring Manager.example', 'hm'),
  contact('e1', 'Executive.example', 'exec'),
  contact('p1', 'Peer.example', 'peer'),
  contact('a1', 'Archived Principal.example', 'hm', 'Archived'),
  contact('a2', 'Archived Principal.example', 'ta'),
  contact('d1', 'Dead.example', 'ta'),
  contact('n1', 'New Talent.example', 'ta'),
];

const contactless = computeContactlessApps({ apps, taRows });
const unthreaded = computeUnthreadedApps({ apps, taRows });
const contactlessIds = contactless.map(row => row.id);
const unthreadedIds = unthreaded.map(row => row.id);

check(unthreadedIds.includes(1), 'talent-only company appears in the unthreaded queue');
check(!contactlessIds.includes(1), 'talent-only company is not contactless');
check(!unthreadedIds.includes(2) && !contactlessIds.includes(2), 'hiring-manager company appears in neither queue');
check(!unthreadedIds.includes(3) && !contactlessIds.includes(3), 'executive company appears in neither queue');
check(!unthreadedIds.includes(4) && !contactlessIds.includes(4), 'peer company appears in neither queue');
check(contactlessIds.includes(5) && !unthreadedIds.includes(5), 'company with no contacts is contactless only');
check(unthreadedIds.includes(6), 'archived influential contact does not count as coverage');
check(!unthreadedIds.includes(7) && !contactlessIds.includes(7), 'dead application appears in neither queue');
const talentOnly = unthreaded.find(row => row.id === 1);
check(talentOnly?.contactCount === 2 && talentOnly?.topTier === 'ta', 'contact count and top tier describe existing coverage');
check(JSON.stringify(unthreadedIds) === JSON.stringify([8, 6, 1]), 'unthreaded rows are sorted newest applied first');

const reconcileApps = [
  app(11, 'Talent Reconcile.example', '2026-08-20'),
  app(12, 'Manager Reconcile.example', '2026-08-19'),
  app(13, 'Missing Reconcile.example', '2026-08-18'),
  app(14, 'Closed Reconcile.example', '2026-08-17', 'Rejected'),
];
const reconcileRows = [
  contact('rt', 'Talent Reconcile.example', 'ta'),
  contact('rh', 'Manager Reconcile.example', 'hm'),
  contact('rc', 'Closed Reconcile.example', 'ta'),
];
const preview = reconcilePreview(reconcileApps, reconcileRows);
check(preview.companiesNeedingPrincipal.map(row => row.company).includes('Talent Reconcile.example'), 'reconcile includes talent-only live company');
check(!preview.companiesNeedingPrincipal.map(row => row.company).includes('Manager Reconcile.example'), 'reconcile excludes company with hiring manager');
check(!preview.companiesNeedingPrincipal.map(row => row.company).includes('Missing Reconcile.example'), 'reconcile excludes company with no contacts');
check(JSON.stringify(preview.toArchive) === JSON.stringify([{
  id: 'rc', first: 'Alex', last: 'Morgan', company: 'Closed Reconcile.example', title: 'Contact',
  reason: '1 application closed (Rejected)',
  relatedApps: [{ id: 14, status: 'Rejected', role: 'Role 14', date: '2026-08-17' }],
}]), 'existing toArchive result is unchanged');
check(JSON.stringify(preview.companiesNeedingContacts) === JSON.stringify([{
  company: 'Missing Reconcile.example', exampleRole: 'Role 13', appCount: 1,
  mostRecentApp: { id: 13, role: 'Role 13', status: 'Applied', date: '2026-08-18' },
}]), 'existing companiesNeedingContacts result is unchanged');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
