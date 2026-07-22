#!/usr/bin/env node
/**
 * backfill-tracker-urls.test.mjs — guards the one script that writes to every
 * row of the user's irreplaceable tracker at once.
 *
 * The failure mode here is silent: a shifted cell still produces a
 * syntactically valid row, so a broken backfill throws nothing and looks fine
 * until a column quietly holds the wrong thing months later. These tests assert
 * on the SHAPE of the whole file (line count, cell count, every carried field)
 * rather than on the url cell alone, because the url cell is the one part that
 * is supposed to change.
 *
 * Runs the real script inside a throwaway sandbox (it resolves every path
 * relative to its own location, so a copy inside the sandbox touches only
 * sandbox files).
 *
 * Report ids in the fixtures are deliberately ABOVE the live data/jd-counter.txt
 * ceiling: report numbers are primary keys, and a fixture reusing a real one
 * makes a test file look like a record of a real evaluation.
 *
 * Run: node tests/backfill-tracker-urls.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

// ── Sandbox ──────────────────────────────────────────────────────────────────
const sandbox = mkdtempSync(join(ROOT, 'backfill-test-'));
mkdirSync(join(sandbox, 'data'), { recursive: true });
mkdirSync(join(sandbox, 'reports'), { recursive: true });
mkdirSync(join(sandbox, 'batch/tracker-additions'), { recursive: true });
mkdirSync(join(sandbox, 'lib'), { recursive: true });
copyFileSync(join(ROOT, 'backfill-tracker-urls.mjs'), join(sandbox, 'backfill-tracker-urls.mjs'));
copyFileSync(join(ROOT, 'lib/tracker.mjs'), join(sandbox, 'lib/tracker.mjs'));
copyFileSync(join(ROOT, 'lib/identity.mjs'), join(sandbox, 'lib/identity.mjs'));

const APPS = join(sandbox, 'data/applications.md');

// v1 JSON frontmatter report
writeFileSync(join(sandbox, 'reports/9001-acme-2026-07-01.md'),
  '---\n{"schema":"trajecktory-report/v1","url":"https://jobs.example.com/acme/9001"}\n---\n\n# Acme\n');
// legacy **URL:** report
writeFileSync(join(sandbox, 'reports/9002-borealis-2026-07-01.md'),
  '# Borealis\n\n**Score:** 4.0/5\n**URL:** https://jobs.example.com/borealis/9002\n');
// placeholder instead of a link — must NOT be written into the url cell
writeFileSync(join(sandbox, 'reports/9003-cinder-2026-07-01.md'),
  '# Cinder\n\n**URL:** TBD\n');
// report exists but names no url at all
writeFileSync(join(sandbox, 'reports/9004-dunlin-2026-07-01.md'),
  '# Dunlin\n\nNo url anywhere in this file.\n');

const L = (n, co, role, notes, rpt) =>
  `| ${n} | 2026-07-01 | ${co} | ${role} | 4.0/5 | Evaluated | ❌ | — | [${n}](reports/${rpt}) | ${notes} |`;

const seed = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|',
  L(9001, 'Acme', 'Director, Glassblowing Standards', 'v1 frontmatter report', '9001-acme-2026-07-01.md'),
  L(9002, 'Borealis', 'Head of Herbarium Curation', 'legacy URL header', '9002-borealis-2026-07-01.md'),
  L(9003, 'Cinder', 'VP Lighthouse Maintenance', 'placeholder url', '9003-cinder-2026-07-01.md'),
  L(9004, 'Dunlin', 'Director, Topiary Logistics', 'report has no url', '9004-dunlin-2026-07-01.md'),
  L(9005, 'Eider', 'Manager, Bookbinding Workflow', 'report file is missing', '9005-eider-2026-07-01.md'),
  // Already backfilled — must be left exactly as-is (idempotency).
  `| 9006 | 2026-07-01 | Fulmar | Director, FP&A | 4.0/5 | Applied | ❌ | — | [9006](reports/9006-fulmar-2026-07-01.md) | already has url | https://jobs.example.com/fulmar/9006 |`,
  '',
].join('\n');
writeFileSync(APPS, seed);

// stdio is pinned to 'pipe' on all three streams so the script's own refusal
// messages are CAPTURED rather than inherited. Several cases below assert that
// it refuses, and a suite that prints ❌ on a passing run teaches the reader to
// scroll past the symbol that means something is actually wrong.
const run = (args = []) => {
  try {
    return { out: execFileSync('node', [join(sandbox, 'backfill-tracker-urls.mjs'), ...args], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }), code: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), code: e.status ?? 1 };
  }
};
const rowsOf = (text) => text.split('\n').filter(l => /^\|\s*\d/.test(l));

// Split a row the way parseTrackerLine does: drop the empty cells the outer
// pipes produce, so cells[0] is the row number and cells[10] is the url.
//
// Assertions below compare this cell EXACTLY rather than asking whether the row
// contains the url somewhere. A substring check would pass if the url landed in
// the notes cell, which is precisely the column-drift bug this suite exists to
// catch. (CodeQL also flags `.includes('https://…')` as incomplete URL
// sanitization, because that shape is normally a security check and a substring
// test is a poor one. It is not a security check here, but the exact-cell
// assertion is the stronger test regardless.)
const cells = (l) => l.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);

try {
  // ── 1. Dry run writes nothing ──────────────────────────────────────────────
  console.log('\n1. Dry run');
  const beforeText = readFileSync(APPS, 'utf-8');
  const dry = run();
  check(dry.code === 0, 'dry run exits 0');
  check(readFileSync(APPS, 'utf-8') === beforeText, 'dry run leaves the tracker byte-identical');
  check(/url to write\s*:\s*2/.test(dry.out), 'dry run counts 2 writable rows');
  check(/no usable url\s*:\s*3/.test(dry.out), 'dry run counts 3 rows with no usable url');

  // ── 2. Pending merge blocks --apply ────────────────────────────────────────
  console.log('\n2. Merge-in-flight guard');
  writeFileSync(join(sandbox, 'batch/tracker-additions/9100-pending.tsv'), 'x\n');
  const blocked = run(['--apply']);
  check(blocked.code === 1, '--apply refuses while an unmerged TSV is pending');
  check(readFileSync(APPS, 'utf-8') === beforeText, 'refusal leaves the tracker untouched');
  rmSync(join(sandbox, 'batch/tracker-additions/9100-pending.tsv'));

  // ── 3. Apply ───────────────────────────────────────────────────────────────
  console.log('\n3. Apply');
  const applied = run(['--apply']);
  check(applied.code === 0, '--apply exits 0');
  const after = readFileSync(APPS, 'utf-8');
  const beforeRows = rowsOf(beforeText), afterRows = rowsOf(after);
  check(afterRows.length === beforeRows.length, `row count unchanged (${beforeRows.length})`);
  check(after.split('\n').length === beforeText.split('\n').length, 'line count unchanged');

  const row = (n) => afterRows.find(l => l.startsWith(`| ${n} `));
  const urlCell = (n) => cells(row(n))[10];
  check(urlCell(9001) === 'https://jobs.example.com/acme/9001', 'v1 frontmatter url written into the url cell');
  check(urlCell(9002) === 'https://jobs.example.com/borealis/9002', 'legacy **URL:** url written into the url cell');

  // ── 4. Placeholders and gaps are left alone ────────────────────────────────
  console.log('\n4. Rows with no usable url');
  check(cells(row(9003)).length === 10, 'placeholder row gains no 11th cell at all');
  check(urlCell(9003) === undefined, 'placeholder "TBD" is NOT written into the url cell');
  check(row(9003) === beforeRows.find(l => l.startsWith('| 9003 ')), 'placeholder row is byte-identical');
  check(row(9004) === beforeRows.find(l => l.startsWith('| 9004 ')), 'no-url report row is byte-identical');
  check(row(9005) === beforeRows.find(l => l.startsWith('| 9005 ')), 'missing report row is byte-identical');

  // ── 5. Every carried cell survives ─────────────────────────────────────────
  console.log('\n5. Non-url cells');
  let carried = true;
  for (const b of beforeRows) {
    const n = cells(b)[0];
    const a = cells(row(n));
    const bc = cells(b);
    for (let i = 0; i < 10; i++) if (bc[i] !== a[i]) { carried = false; console.log(`     row ${n} cell ${i}: ${bc[i]} → ${a[i]}`); }
  }
  check(carried, 'all 10 original cells byte-identical on every row');

  // ── 6. Header upgrade ──────────────────────────────────────────────────────
  console.log('\n6. Header');
  check(after.includes('| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |'),
    'header upgraded to 11 columns');
  const sep = after.split('\n').find(l => /^\|[-\s|]+\|$/.test(l.trim()));
  check(sep.split('|').filter(Boolean).length === 11, 'separator upgraded to 11 columns');

  // ── 7. Idempotency ─────────────────────────────────────────────────────────
  console.log('\n7. Idempotency');
  const second = run(['--apply']);
  check(second.code === 0, 'second --apply exits 0');
  check(readFileSync(APPS, 'utf-8') === after, 'second --apply changes nothing');
  check(/url to write\s*:\s*0/.test(second.out), 'second run reports 0 to write');
  check(urlCell(9006) === 'https://jobs.example.com/fulmar/9006', 'pre-existing url preserved');

  // ── 8. Backup exists ───────────────────────────────────────────────────────
  console.log('\n8. Backup');
  const { readdirSync } = await import('fs');
  const baks = readdirSync(join(sandbox, 'data')).filter(f => f.includes('.bak-'));
  check(baks.length >= 1, 'a timestamped backup was written');
  check(!baks.includes('applications.md.bak'), 'the plain .bak filename is never used');
  check(baks.some(b => /\.bak-\d{4}-\d{2}-\d{2}-\d{6}-url-backfill$/.test(b)), 'backup is timestamped and labelled');
  check(readFileSync(join(sandbox, 'data', baks[0]), 'utf-8') === beforeText, 'backup holds the pre-backfill content');

  // ── 9. Schema guard fails closed ───────────────────────────────────────────
  console.log('\n9. Schema guard');
  const lib = readFileSync(join(sandbox, 'lib/tracker.mjs'), 'utf-8');
  writeFileSync(join(sandbox, 'lib/tracker.mjs'),
    lib.replace(", 'notes', 'url']", ", 'notes']"));
  const noUrlCol = run();
  check(noUrlCol.code === 1, 'refuses to run when the schema has no url column');
  writeFileSync(join(sandbox, 'lib/tracker.mjs'), lib);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\n${failed === 0 ? '🟢' : '🔴'} backfill-tracker-urls: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
