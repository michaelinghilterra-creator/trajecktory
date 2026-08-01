#!/usr/bin/env node
/**
 * tt-reconcile.test.mjs — unit tests for reconcilePreview, the ONE archive
 * decision shared by the dashboard route and reconcile-ta.mjs. Fabricated apps +
 * TA rows only (invented companies). Pins: archive when a company's apps are all
 * closed, keep when any is active, leave alone when the company has no apps, and
 * normalized company matching.
 *
 * Run: node tests/tt-reconcile.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { reconcilePreview, normCompany } from '../dashboard-web/server/lib/tt-reconcile-core.mjs';

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };

console.log('tt-reconcile.test.mjs');

const apps = [
  { id: 1, company: 'Acme Labs', status: 'Rejected', role: 'RevOps Dir', date: '2026-01-01' },
  { id: 2, company: 'Acme Labs', status: 'Discarded', role: 'RevOps Dir', date: '2026-01-02' },
  { id: 3, company: 'Northwind', status: 'Applied', role: 'Analytics Dir', date: '2026-02-01' },
  { id: 4, company: 'Crestline', status: 'Rejected', role: 'Ops Lead', date: '2026-01-05' },
  { id: 5, company: 'Brightwave', status: '1st Interview', role: 'RevOps Mgr', date: '2026-03-01' },
  { id: 6, company: 'Ghostly', status: 'No Response', role: 'RevOps Dir', date: '2026-02-10' },
  { id: 7, company: 'Vanished', status: 'No Response', role: 'RevOps Lead', date: '2026-02-11' },
];
const ttRows = [
  { id: 10, first: 'A', last: 'One', company: 'Acme Labs', title: 'TA', status: 'Not Contacted' },
  { id: 11, first: 'B', last: 'Two', company: 'Northwind', title: 'TA', status: 'Sent' },
  { id: 12, first: 'C', last: 'Three', company: 'Zenith', title: 'TA', status: 'Not Contacted' },
  { id: 13, first: 'D', last: 'Four', company: 'acme labs', title: 'TA', status: 'Dormant' },
  { id: 14, first: 'E', last: 'Five', company: 'Ghostly', title: 'TA', status: 'Not Contacted' },
];

const { toArchive, companiesNeedingContacts } = reconcilePreview(apps, ttRows);
const archiveIds = toArchive.map(c => c.id).sort((a, b) => a - b);

check(archiveIds.includes(10), 'archive #10: company (Acme) apps all closed');
check(archiveIds.includes(13), 'archive #13: normalized "acme labs" matches "Acme Labs", all closed');
check(!archiveIds.includes(11), 'keep #11: Northwind has an active app (Applied)');
check(!archiveIds.includes(12), 'leave #12 alone: Zenith has no logged apps');
check(!archiveIds.includes(14), 'keep #14: Ghostly is No Response (ghosted, not dead) — chase-worthy, never archived');
check(archiveIds.length === 2, 'exactly two archived');
check(/2 applications closed/.test(toArchive.find(c => c.id === 10).reason), 'reason names the closed count + statuses');

const needCos = companiesNeedingContacts.map(c => c.company);
check(needCos.includes('Brightwave'), 'Brightwave (active app, no TA contact) is flagged as needing contacts');
check(needCos.includes('Vanished'), 'Vanished (No Response, no TA contact) is flagged as needing contacts — ghosted companies are chase targets');
check(!needCos.includes('Ghostly'), 'Ghostly not flagged — No Response but already has a TA contact');
check(!needCos.includes('Northwind'), 'Northwind not flagged — it already has a TA contact');
check(!needCos.includes('Crestline'), 'Crestline not flagged — its app is closed (not active)');
check(!needCos.includes('Acme Labs'), 'Acme not flagged — closed + already has contacts');

check(normCompany('ADT, Inc.') === 'adt', 'normCompany strips punctuation, legal suffix, lowercases');
check(normCompany('') === '', 'normCompany handles empty');
// Suffix + " — City" variants must normalize to the same key so a contact at
// "Stripe, Inc." reconciles against applications logged under "Stripe".
check(normCompany('Stripe') === normCompany('Stripe, Inc.'), 'normCompany matches legal-suffix variant');
check(normCompany('Grow Therapy') === normCompany('Grow Therapy — New York'), 'normCompany drops " — City" suffix');
// Distinct companies must stay distinct, and a suffix token inside a word is kept.
check(normCompany('Stripe') !== normCompany('Square'), 'normCompany keeps distinct companies distinct');
check(normCompany('Costco') === 'costco', 'normCompany does not strip a suffix inside a word');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
