#!/usr/bin/env node
/**
 * audit-orphan-reports.test.mjs — guards the classifier that decides whether a
 * report with no tracker row is a real loss or a deliberate archive.
 *
 * Both directions matter and they fail differently. A false NEGATIVE hides a lost
 * evaluation, which is the thing the audit exists to surface. A false POSITIVE
 * reports hundreds of deliberately archived rows as losses, and a report that
 * cries wolf is one nobody reads, which hides the real losses just as
 * effectively. So every bucket is asserted, not just the lost one.
 *
 * Report ids are above the live data/jd-counter.txt ceiling on purpose: report
 * numbers are primary keys, and a fixture reusing a real one makes a test file
 * read like a record of a real evaluation.
 *
 * Run: node tests/audit-orphan-reports.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, statSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { auditOrphanReports } from '../audit-orphan-reports.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

const sb = mkdtempSync(join(ROOT, 'orphan-audit-test-'));
try {
  mkdirSync(join(sb, 'reports'), { recursive: true });
  mkdirSync(join(sb, 'data'), { recursive: true });
  mkdirSync(join(sb, 'batch/tracker-additions/merged'), { recursive: true });

  const rpt = (n, co, role, url) => writeFileSync(
    join(sb, 'reports', `${n}-${co.toLowerCase()}-2026-07-01.md`),
    `---\n{"schema":"trajecktory-report/v1","id":${n},"company":"${co}","role":"${role}","date":"2026-07-01","url":"${url}"}\n---\n\n# ${co}\n`,
  );
  const row = (n, co, role, url) =>
    `| ${n} | 2026-07-01 | ${co} | ${role} | 4.0/5 | Evaluated | ❌ | — | [${n}](reports/${n}-${co.toLowerCase()}-2026-07-01.md) | Note | ${url} |`;

  // 9301 — on the tracker. Not an orphan.
  rpt(9301, 'Acme', 'Director, RevOps', 'https://jobs.example.com/acme/1');
  // 9302 — deliberately archived. Not a loss.
  rpt(9302, 'Borealis', 'Head of Analytics', 'https://jobs.example.com/borealis/2');
  // 9303 — no row, but its URL matches the live row 9301's posting: a second
  // report for the same job. Duplicated, not lost.
  rpt(9303, 'Acme', 'Director, RevOps', 'https://jobs.example.com/acme/1');
  // 9304 — no row, not archived, distinct URL, TSV survives. A RECOVERABLE loss.
  rpt(9304, 'Cinder', 'VP Strategy', 'https://jobs.example.com/cinder/4');
  writeFileSync(join(sb, 'batch/tracker-additions/merged/9304-cinder.tsv'),
    ['9304', '2026-07-01', 'Cinder', 'VP Strategy', 'Evaluated', '4.0/5', '❌', 'x', 'y'].join('\t') + '\n');
  // 9305 — same, but no TSV. A loss that cannot be replayed.
  rpt(9305, 'Dunlin', 'Director, BI', 'https://jobs.example.com/dunlin/5');
  // 9306 — its number is shared by TWO TSVs from different companies. The one
  // that sorts first is the WRONG one, so a first-match-wins lookup fails here.
  rpt(9306, 'Eider', 'Head of RevOps', 'https://jobs.example.com/eider/6');
  writeFileSync(join(sb, 'batch/tracker-additions/merged/9306-albatross.tsv'),
    ['9306', '2026-07-01', 'Albatross', 'Different Job', 'Evaluated', '3.0/5', '❌', 'x', 'y'].join('\t') + '\n');
  writeFileSync(join(sb, 'batch/tracker-additions/merged/9306-eider.tsv'),
    ['9306', '2026-07-01', 'Eider', 'Head of RevOps', 'Evaluated', '3.5/5', '❌', 'x', 'y'].join('\t') + '\n');
  // 9307 — a TSV carries its number but belongs to someone else entirely. There
  // is no correct file to offer, so none may be offered.
  rpt(9307, 'Fulmar', 'Director, Ops', 'https://jobs.example.com/fulmar/7');
  writeFileSync(join(sb, 'batch/tracker-additions/merged/9307-grebe.tsv'),
    ['9307', '2026-07-01', 'Grebe', 'Unrelated Role', 'Evaluated', '3.0/5', '❌', 'x', 'y'].join('\t') + '\n');
  // A non-numbered file in reports/ must be ignored entirely, not counted.
  writeFileSync(join(sb, 'reports', 'README.md'), '# not an evaluation\n');

  writeFileSync(join(sb, 'data/applications.md'), [
    '# Applications Tracker',
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
    '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
    row(9301, 'Acme', 'Director, RevOps', 'https://jobs.example.com/acme/1'),
    '',
  ].join('\n'));

  writeFileSync(join(sb, 'data/applications-archive-2026-06-01.md'), [
    '# Applications Archive',
    '',
    row(9302, 'Borealis', 'Head of Analytics', 'https://jobs.example.com/borealis/2'),
    '',
  ].join('\n'));

  // Snapshot every file's size+mtime so the read-only claim can be ASSERTED
  // rather than asserted-by-comment. This script's whole safety story is that it
  // never writes, and a comment saying so is not a guarantee.
  const snapshot = () => {
    const out = {};
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else { const s = statSync(p); out[p] = `${s.size}:${s.mtimeMs}`; }
      }
    };
    walk(sb);
    return JSON.stringify(out);
  };
  const before = snapshot();

  const r = auditOrphanReports(sb);
  const lostNums = r.lost.map(l => l.num).sort();

  console.log('\n1. Bucketing');
  check(r.counts.reports === 7, `only numbered reports counted, README ignored: got ${r.counts.reports}`);
  check(r.counts.onTracker === 1, `report with a live row is not an orphan: got ${r.counts.onTracker}`);
  check(r.counts.archived === 1, `deliberately archived report is not a loss: got ${r.counts.archived}`);
  check(r.counts.duplicateOfLive === 1, `second report for a live posting is not a loss: got ${r.counts.duplicateOfLive}`);

  console.log('\n2. Real losses');
  check(r.counts.lost === 4, `exactly the distinct postings with no row: got ${r.counts.lost}`);
  check(JSON.stringify(lostNums) === JSON.stringify([9304, 9305, 9306, 9307]), `the right ones: got ${JSON.stringify(lostNums)}`);
  check(!lostNums.includes(9302), 'an archived report is NEVER reported as lost');
  check(!lostNums.includes(9303), 'a duplicate of a live posting is NEVER reported as lost');

  console.log('\n3. Recoverability');
  check(r.counts.recoverable === 2, `only losses with a confidently-matched TSV: got ${r.counts.recoverable}`);
  check(r.lost.find(l => l.num === 9304).tsv === '9304-cinder.tsv', 'names the TSV that can be replayed');
  check(r.lost.find(l => l.num === 9305).tsv === null, 'a loss with no TSV is marked unreplayable');

  console.log('\n4. Reused report numbers do not mis-route a restore');
  // Report numbers were computed as "max + 1" before the persistent counter, so
  // one number can belong to two different companies. Matching a working file on
  // the number alone would tell the user an evaluation is recoverable and then
  // hand them a DIFFERENT company's file to restore, corrupting the tracker with
  // a row for a job they never evaluated. Worse than reporting it unrecoverable.
  const shared = r.lost.find(l => l.num === 9306);
  check(shared && shared.tsv === '9306-eider.tsv',
    `picks the TSV whose company matches the report, not the first by name: got ${shared && shared.tsv}`);
  const foreign = r.lost.find(l => l.num === 9307);
  check(foreign && foreign.tsv === null,
    `a TSV that belongs to another company is NOT offered as the recovery source: got ${foreign && foreign.tsv}`);
  check(foreign && foreign.tsvAmbiguous === true,
    'the unmatched case is flagged for manual review rather than silently called unrecoverable');

  console.log('\n5. Metadata for adjudication');
  const c = r.lost.find(l => l.num === 9304);
  check(c.company === 'Cinder' && c.role === 'VP Strategy',
    'company and role are surfaced so the user can decide without opening files');
  check(c.url === 'https://jobs.example.com/cinder/4', 'the posting URL is surfaced');

  console.log('\n6. Read-only');
  check(snapshot() === before, 'not one byte on disk changed');

  console.log('\n7. Degrades quietly');
  const bare = mkdtempSync(join(ROOT, 'orphan-audit-empty-'));
  try {
    const e = auditOrphanReports(bare);
    check(e.counts.reports === 0 && e.lost.length === 0, 'no reports dir and no tracker returns empty, does not throw');
  } finally { rmSync(bare, { recursive: true, force: true }); }
} finally {
  rmSync(sb, { recursive: true, force: true });
}

console.log(`\n${failed === 0 ? '🟢' : '🔴'} audit-orphan-reports: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
