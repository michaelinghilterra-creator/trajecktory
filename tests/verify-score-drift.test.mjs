#!/usr/bin/env node
/**
 * verify-score-drift.test.mjs — pins the scoring drift guard.
 *
 * findScoreDrift compares a DERIVED report's headline to the tracker Score cell
 * and flags any mismatch, while leaving legacy reports (no scoreSource:derived)
 * alone. Pure: rows + a loadReport fn are injected, no files touched.
 *
 * Fixture report ids are 9001+, deliberately ABOVE the data/jd-counter.txt ceiling
 * (currently 1142) so a fixture id can never collide with a real report primary key.
 *
 * Run: node tests/verify-score-drift.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { findScoreDrift } from '../verify-score-drift.mjs';
import { parseTracker } from '../lib/tracker.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('verify-score-drift.test.mjs');

// v1 report frontmatter (needs the schema key for hasV1Frontmatter to recognize it).
const v1 = (obj) => `---\n${JSON.stringify({ schema: 'trajecktory-report/v1', ...obj })}\n---\n# body\n`;
const reports = {
  'reports/9001-match.md':   v1({ id: 9001, score: 4.2, scoreSource: 'derived' }),          // derived, matches tracker
  'reports/9002-drift.md':   v1({ id: 9002, score: 3.5, scoreSource: 'derived' }),          // derived, DRIFTS from tracker 4.0
  'reports/9003-legacy.md':  v1({ id: 9003, score: 3.0 }),                                   // legacy (no scoreSource) — skipped even though tracker says 2.5
  'reports/9004-noscore.md': v1({ id: 9004, scoreSource: 'derived' }),                       // derived but no numeric score — flagged
};
const loadReport = (p) => reports[p] ?? null;

// Invented rows (greek/fictional companies, ids above the counter ceiling).
const tracker = [
  '# Applications Tracker',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
  '| 9001 | 2024-01-01 | Kestrel | Staff Eng | 4.2/5 | Evaluated | ❌ | — | [9001](reports/9001-match.md) | . | — |',
  '| 9002 | 2024-01-02 | Northwind | Staff Eng | 4.0/5 | Evaluated | ❌ | — | [9002](reports/9002-drift.md) | . | — |',
  '| 9003 | 2024-01-03 | Bexad | Staff Eng | 2.5/5 | Evaluated | ❌ | — | [9003](reports/9003-legacy.md) | . | — |',
  '| 9004 | 2024-01-04 | Meridian | Staff Eng | 4.0/5 | Evaluated | ❌ | — | [9004](reports/9004-noscore.md) | . | — |',
  '| 9005 | 2024-01-05 | Cobalt | Staff Eng | 3.3/5 | Evaluated | ❌ | — | — | . | — |', // no report — skipped
].join('\n');

const rows = parseTracker(tracker);
const { checked, drift } = findScoreDrift(rows, loadReport);
const byNum = new Map(drift.map(d => [d.num, d]));

check(checked === 3, `checks only the 3 derived reports (got ${checked}) — legacy + no-report rows skipped`);
check(drift.length === 2, `flags exactly 2 drifts (got ${drift.length})`);
check(!byNum.has(9001), '#9001 matches (4.2 == 4.2) → not flagged');
check(byNum.get(9002)?.reason === 'mismatch', '#9002 tracker 4.0 vs report 3.5 → mismatch flagged');
check(!byNum.has(9003), '#9003 is legacy (no scoreSource) → skipped even though 2.5 != 3.0');
check(byNum.has(9004) && /no numeric score/.test(byNum.get(9004).reason), '#9004 derived-but-no-score → flagged');

// A clean tracker (only the matching row) produces zero drift and exits-0 semantics.
const cleanRows = parseTracker([
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
  '| 9001 | 2024-01-01 | Kestrel | Staff Eng | 4.2/5 | Evaluated | ❌ | — | [9001](reports/9001-match.md) | . | — |',
].join('\n'));
const clean = findScoreDrift(cleanRows, loadReport);
check(clean.checked === 1 && clean.drift.length === 0, 'an all-in-sync tracker reports 1 checked, 0 drift');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
