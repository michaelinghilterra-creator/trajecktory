#!/usr/bin/env node
/*
 * listSessions() used to iterate FOLDERS on disk and join tracker rows onto
 * them. A company therefore only appeared once something had already been
 * written for it, so moving a role to Phone Screen produced nothing at all: no
 * row, no empty state, no explanation. That reads as the Interview tab being
 * broken rather than as prep not having been generated yet, and a tester hit it
 * on their first interview (2026-07-21).
 *
 * The failure is invisible in the obvious direction — every company that HAS
 * prep still shows up perfectly — so it needs a test that asserts on the
 * company that has none.
 *
 * Runs against temp dirs via TJK_DATA_DIR and TJK_INTERVIEW_PREP_DIR. Both
 * overrides exist so tests never touch the real job search: data/ and
 * interview-prep/ are gitignored end to end, so a test that wrote there would
 * have no way back.
 *
 * Run: node tests/interview-sessions.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-interview-'));
const dataDir = path.join(sandbox, 'data');
const prepDir = path.join(sandbox, 'interview-prep');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(prepDir, { recursive: true });

process.env.TJK_DATA_DIR = dataDir;
process.env.TJK_INTERVIEW_PREP_DIR = prepDir;

// Two companies at an interview stage. Only one has a prep folder.
// A third sits at Applied, which must NOT appear: it has not reached an
// interview, so surfacing it would just be noise.
fs.writeFileSync(path.join(dataDir, 'applications.md'), [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|',
  '| 901 | 2026-07-01 | Northwind Freight | Operations Analyst | 4.1/5 | 1st Interview | ✅ | — | — | — |',
  '| 902 | 2026-07-02 | Kestrel Mutual | Systems Analyst | 4.0/5 | Phone Screen | ✅ | — | — | — |',
  '| 903 | 2026-07-03 | Alder Logistics | Program Manager | 3.9/5 | Applied | ✅ | — | — | — |',
  '',
].join('\n'));

// Northwind has prep on disk; Kestrel deliberately does not.
const nw = path.join(prepDir, 'Northwind Freight');
fs.mkdirSync(nw, { recursive: true });
fs.writeFileSync(path.join(nw, 'northwind-freight-round-1-screen.md'), '# Screen prep\n\nNotes.\n');

let passed = 0, failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
};

const { listSessions } = await import('../dashboard-web/server/lib/interview.mjs');
const { INTERVIEW_PREP_DIR } = await import('../dashboard-web/server/config.mjs');

console.log('\n🧪 interview sessions\n');

console.log('1. The sandbox is actually in use');
check(INTERVIEW_PREP_DIR === prepDir, 'TJK_INTERVIEW_PREP_DIR redirects INTERVIEW_PREP_DIR');

const { active, archive } = listSessions();
const byCompany = (list, name) => list.find(s => s.company === name);

console.log('\n2. A company with prep still appears exactly as before');
const northwind = byCompany(active, 'Northwind Freight');
check(!!northwind, 'company with a prep folder is listed as active');
check(northwind?.rounds.length === 1, 'its round file is picked up');
check(!northwind?.needsPrep, 'it is not flagged as needing prep');

console.log('\n3. A company at an interview stage with NO prep folder still appears');
// This is the regression. Before the fix this was undefined at any status.
const kestrel = byCompany(active, 'Kestrel Mutual');
check(!!kestrel, 'company with no prep folder is still listed');
check(kestrel?.needsPrep === true, 'it is flagged so the UI can offer to generate prep');
check(kestrel?.rounds.length === 0, 'it has no rounds');
check(kestrel?.status === 'Phone Screen', 'it carries its tracker status');
check(kestrel?.appId === 902, 'it carries its tracker id, so the UI can link back');
check(kestrel?.prepDir === null, 'it has no prepDir, because nothing was created on disk');

console.log('\n4. Rows that have NOT reached an interview stay out');
check(!byCompany(active, 'Alder Logistics'), 'an Applied row is not surfaced');
check(!byCompany(archive, 'Alder Logistics'), 'and it is not in archive either');

console.log('\n5. No duplicates');
const names = active.map(s => s.company);
check(new Set(names).size === names.length, 'a company with a folder is not also added as needing prep');

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
