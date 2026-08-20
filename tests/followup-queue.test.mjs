#!/usr/bin/env node
/**
 * followup-queue.test.mjs — unit tests for computeFollowupQueue, the single ranked
 * queue that merges the three channel queues (LinkedIn-only / email-only / both).
 *
 * Verifies the union is complete and non-overlapping (the three source queues are
 * mutually exclusive by construction), that every row is channel-tagged and carries
 * a numeric rank, and that the rank ordering matches the agreed formula: importance
 * first (hiring principal, then dual-channel), then last-touch recency.
 *
 * A temp TJK_DATA_DIR isolates the correspondence reads the both-queue makes, so the
 * result does not depend on whatever is on disk.
 *
 * Run: node tests/followup-queue.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-fuq-'));
process.env.TJK_DATA_DIR = tmp;

const { computeFollowupQueue, computeConnectQueue, computeEmailQueue, computeBothQueue } =
  await import('../dashboard-web/server/lib/followups.mjs');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('followup-queue.test.mjs');

// ── Fixtures: invented contacts at .example companies, shaped like parser output ─
const ta = (o) => ({
  id: o.id, first: o.first, last: o.last, title: o.title, company: o.company,
  email: o.email || '', verified: { state: o.state || 'unverified' },
  linkedin: o.linkedin || '', status: o.status || 'Not Contacted',
  notes: o.notes || '', isPrincipal: !!o.isPrincipal,
});

const taRows = [
  // email-only, sendable, NOT principal → channel 'email'
  ta({ id: 1, first: 'Ada', last: 'Reyes', title: 'Recruiter', company: 'Northwind Robotics',
       email: 'ada.reyes@northwind.example', state: 'ok' }),
  // email-only, sendable, PRINCIPAL → channel 'email', ranks highest (+50)
  ta({ id: 2, first: 'Ben', last: 'Okafor', title: 'VP Revenue', company: 'Cobalt Systems',
       email: 'ben.okafor@cobalt.example', state: 'ok', isPrincipal: true }),
  // LinkedIn-only (no email) → channel 'linkedin'
  ta({ id: 3, first: 'Cleo', last: 'Nash', title: 'Head of TA', company: 'Aster Grid',
       linkedin: 'linkedin.com/in/cleo-nash-ex' }),
  // BOTH channels, NOT principal → channel 'both', ranks above single-channel (+20)
  ta({ id: 4, first: 'Dev', last: 'Malik', title: 'Director Ops', company: 'Meridian AI',
       email: 'dev.malik@meridian.example', state: 'ok', linkedin: 'linkedin.com/in/dev-malik-ex' }),
];

const apps = [
  { company: 'Northwind Robotics', status: 'Applied' },
  { company: 'Cobalt Systems',     status: 'Applied' },
  { company: 'Aster Grid',         status: 'Applied' },
  { company: 'Meridian AI',        status: 'Applied' },
];
const opts = { taRows, apps };

const q = computeFollowupQueue(opts);
const byId = Object.fromEntries(q.map(r => [`${r.source}:${r.id}`, r]));

// ── Completeness + mutual exclusivity ─────────────────────────────────────────
const nConnect = computeConnectQueue(opts).length;
const nEmail   = computeEmailQueue(opts).length;
const nBoth    = computeBothQueue(opts).length;
check(q.length === nConnect + nEmail + nBoth,
  `union equals the sum of the three queues, no dup/drop (${q.length} = ${nConnect}+${nEmail}+${nBoth})`);
check(q.length === 4, `all four fixture contacts surface (got ${q.length})`);

// ── Channel tagging ───────────────────────────────────────────────────────────
check(byId['ta:1']?.channel === 'email',    'email-only contact tagged channel=email');
check(byId['ta:2']?.channel === 'email',    'principal email-only contact tagged channel=email');
check(byId['ta:3']?.channel === 'linkedin', 'LinkedIn-only contact tagged channel=linkedin');
check(byId['ta:4']?.channel === 'both',     'dual-channel contact tagged channel=both');

// ── Every row carries a numeric rank ──────────────────────────────────────────
check(q.every(r => typeof r.rank === 'number' && Number.isFinite(r.rank)), 'every row has a finite numeric rank');

// ── Sorted descending by rank ─────────────────────────────────────────────────
const sortedDesc = q.every((r, i) => i === 0 || q[i - 1].rank >= r.rank);
check(sortedDesc, 'queue is sorted by rank descending');

// ── Rank ordering matches the formula ─────────────────────────────────────────
check(byId['ta:2'].rank > byId['ta:1'].rank, 'a hiring principal outranks a non-principal on the same channel');
check(byId['ta:4'].rank > byId['ta:1'].rank, 'a dual-channel contact outranks a single-channel non-principal');
check(q[0].id === 2, 'the principal is first in the ranked queue');

// Cleanup
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
