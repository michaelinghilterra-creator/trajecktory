#!/usr/bin/env node
/**
 * tracker.test.mjs — unit tests for lib/tracker.mjs, the single canonical
 * applications.md parser. Pins the column layout that the old hand-rolled root
 * parsers got wrong (reading the Resume cell as the report link on 10-col rows).
 *
 * Run: node tests/tracker.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { parseTrackerLine, parseTracker, TRACKER_COLUMNS } from '../lib/tracker.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('tracker.test.mjs');

// ── 10-column (current) row ────────────────────────────────────────────────────
const tenCol = '| 691 | 2026-06-01 | Acme | Staff Engineer | 4.2/5 | Applied | ✅ | — | [691](reports/691-acme-2026-06-01.md) | strong fit |';
const r = parseTrackerLine(tenCol);
check(r !== null, '10-col row parses');
check(r.num === 691, 'num is 691');
check(r.date === '2026-06-01', 'date');
check(r.company === 'Acme', 'company');
check(r.role === 'Staff Engineer', 'role');
check(r.score === '4.2/5', 'score is raw cell');
check(r.status === 'Applied', 'status');
check(r.pdf === '✅', 'pdf raw cell');
check(r.resume === null, 'resume "—" normalizes to null');
// The bug the old parsers had: they read report from the Resume cell.
check(r.report === '[691](reports/691-acme-2026-06-01.md)', 'report is the LINK cell, not the Resume cell');
check(r.reportPath === 'reports/691-acme-2026-06-01.md', 'reportPath is stripped from the link');
check(r.notes === 'strong fit', 'notes is the last cell, not the report link');
check(r.columns === 10, 'detected 10 columns');
check(r.cellCount === 10, 'cellCount reflects actual inner cells');

// An extra pipe in a field shows up as a higher cellCount (callers warn on it).
const extraPipe = '| 693 | 2026-06-03 | Gamma | Lead | 4.0/5 | Applied | ✅ | — | [693](reports/693-gamma.md) | a | b |';
check(parseTrackerLine(extraPipe).cellCount === 11, 'extra pipe raises cellCount to 11');

// A populated Resume cell is preserved.
const withResume = '| 692 | 2026-06-02 | Beta | PM | 3.0/5 | Evaluated | ❌ | Beta_resume.docx | [692](reports/692-beta.md) | note |';
const r2 = parseTrackerLine(withResume);
check(r2.resume === 'Beta_resume.docx', 'non-dash resume cell preserved');
check(r2.reportPath === 'reports/692-beta.md', 'report still correct with a real resume cell');

// ── 9-column (legacy) row ──────────────────────────────────────────────────────
const nineCol = '| 100 | 2026-01-01 | Old | Eng | 3.5/5 | Rejected | ✅ | [100](reports/100-old.md) | legacy |';
const r3 = parseTrackerLine(nineCol);
check(r3 !== null, '9-col legacy row parses');
check(r3.columns === 9, 'detected 9 columns');
check(r3.resume === null, 'legacy row has null resume');
check(r3.reportPath === 'reports/100-old.md', 'legacy report column read correctly');
check(r3.notes === 'legacy', 'legacy notes read correctly');

// ── Non-data rows ───────────────────────────────────────────────────────────────
check(parseTrackerLine('| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes |') === null,
  'header row is not a data row');
check(parseTrackerLine('|---|------|---------|------|-------|--------|-----|--------|--------|-------|') === null,
  'separator row is not a data row');
check(parseTrackerLine('not a table line') === null, 'non-pipe line is null');
check(parseTrackerLine('') === null, 'empty string is null');
check(parseTrackerLine(null) === null, 'null input is null');

// ── parseTracker over full text ─────────────────────────────────────────────────
const doc = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|',
  tenCol,
  withResume,
].join('\n');
const rows = parseTracker(doc);
check(rows.length === 2, 'parseTracker returns only the 2 data rows');
check(rows[0].num === 691 && rows[1].num === 692, 'rows in order');
check(TRACKER_COLUMNS[8] === 'report' && TRACKER_COLUMNS[7] === 'resume', 'TRACKER_COLUMNS has resume at 7, report at 8');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
