#!/usr/bin/env node
/**
 * tracker.test.mjs — unit tests for lib/tracker.mjs, the single canonical
 * applications.md parser. Pins the column layout that the old hand-rolled root
 * parsers got wrong (reading the Resume cell as the report link on 10-col rows).
 *
 * Run: node tests/tracker.test.mjs   (exit 0 = pass, 1 = fail)
 */

import {
  parseTrackerLine, parseTracker, TRACKER_COLUMNS, formatTrackerLine, sanitizeTrackerCell,
} from '../lib/tracker.mjs';

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
check(r.url === null, '10-col legacy row has null url');

// ── 11 cells: three distinct outcomes ─────────────────────────────────────────
// Adding the URL column made 11 cells legitimate, so "11 == corruption" is no
// longer true. What separates a real row from a stray pipe is whether that last
// cell is URL-shaped — legacy rows predate sanitizeTrackerCell, so an old note
// containing '|' still lands here and must NOT be read as a URL.

// 1. 11 cells, last is URL-shaped → the current schema.
const withUrl = '| 9004 | 2020-01-02 | Delta | Director, RevOps | 4.1/5 | Evaluated | ❌ | — | [9004](reports/9004-delta.md) | solid fit | https://jobs.example.com/delta/abc123 |';
const r11 = parseTrackerLine(withUrl);
check(r11.url === 'https://jobs.example.com/delta/abc123', '11-col row exposes the url');
check(r11.notes === 'solid fit', 'notes stays at index 9 when a url column is present');
check(r11.columns === 11, 'detected 11 columns');
check(r11.reportPath === 'reports/9004-delta.md', 'report still correct alongside a url');

// 2. 11 cells, last NOT URL-shaped → stray pipe, url must stay null.
const extraPipe = '| 9003 | 2020-01-01 | Gamma | Lead | 4.0/5 | Applied | ✅ | — | [9003](reports/9003-gamma.md) | a | b |';
const rp = parseTrackerLine(extraPipe);
check(rp.cellCount === 11, 'extra pipe raises cellCount to 11');
check(rp.url === null, 'a non-URL 11th cell is NOT read as a url');
check(rp.columns === 10, 'stray-pipe row is still reported as 10-column');

// 3. 12 cells → corruption regardless.
const twelve = '| 9005 | 2020-01-03 | Eps | Lead | 4.0/5 | Applied | ✅ | — | [9005](reports/9005-eps.md) | a | b | c |';
check(parseTrackerLine(twelve).cellCount === 12, '12 cells still flagged via cellCount');

// A '|' inside a URL is neutralized rather than restructuring the row.
const pipedUrlRow = formatTrackerLine({ num: 9006, date: '2020-01-04', company: 'Zeta', role: 'Dir', score: '3.0/5', status: 'Evaluated', pdf: '❌', resume: null, report: '[9006](reports/9006-zeta.md)', notes: 'n', url: 'https://x.com/a|b' });
check(parseTrackerLine(pipedUrlRow).cellCount === 11, 'a pipe inside a url does not add a cell');

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
// url is appended LAST so every positional reader that slices by index keeps working.
check(TRACKER_COLUMNS[9] === 'notes' && TRACKER_COLUMNS[10] === 'url', 'notes stays at 9, url is appended at 10');

// ── formatTrackerLine — the write side ─────────────────────────────────────────
// Rows used to be written with hand-rolled template literals, so any '|' inside a
// field became a column delimiter. Row #1125 hit this in the field: notes ending
// "…remote | [self-sourced]" had the tag stripped, and the orphaned pipe left an
// 11-cell row that the dashboard parsed with a truncated Notes column.
const roundTrip = {
  num: 800, date: '2026-07-20', company: 'Acme', role: 'Director, RevOps',
  score: '4.1/5', status: 'Evaluated', pdf: '❌', resume: '—',
  report: '[800](reports/800-acme-2026-07-20.md)', notes: 'clean note',
};
const formatted = formatTrackerLine(roundTrip);
const reparsed = parseTrackerLine(formatted);
check(reparsed !== null, 'formatTrackerLine output parses back');
check(reparsed.cellCount === 11, 'formatted row has exactly 11 cells');
check(reparsed.num === 800 && reparsed.company === 'Acme' && reparsed.notes === 'clean note',
  'round-trip preserves fields');
check(reparsed.report === '[800](reports/800-acme-2026-07-20.md)', 'round-trip preserves the report link');
check(reparsed.url === null, 'omitted url writes the "—" placeholder and reads back as null');

// Full round-trip WITH a url.
const rtUrl = parseTrackerLine(formatTrackerLine({ ...roundTrip, url: 'https://jobs.example.com/acme/xyz' }));
check(rtUrl.url === 'https://jobs.example.com/acme/xyz', 'round-trip preserves the url');
check(rtUrl.notes === 'clean note', 'url round-trip leaves notes intact');

// The regression: a pipe anywhere in a field must not create a cell.
const piped = parseTrackerLine(formatTrackerLine({
  ...roundTrip, notes: 'IC role, $100K–$120K remote | [self-sourced]',
}));
check(piped.cellCount === 11, 'pipe in notes does NOT add a cell (stripped-source-tag regression)');
check(!piped.notes.includes('|'), 'pipe in notes is neutralized');
check(piped.notes.includes('[self-sourced]') && piped.notes.includes('remote'),
  'note text survives sanitizing, only the delimiter changes');

// A pipe in any other free-text field is the same hazard.
const pipedRole = parseTrackerLine(formatTrackerLine({ ...roundTrip, role: 'Director | RevOps' }));
check(pipedRole.cellCount === 11, 'pipe in role does NOT add a cell');
check(pipedRole.notes === 'clean note', 'fields after a piped role do not shift');

// Newlines and tabs split or re-delimit the row just as badly as a pipe.
const multiline = parseTrackerLine(formatTrackerLine({ ...roundTrip, notes: 'line one\nline two\ttabbed' }));
check(multiline !== null && multiline.cellCount === 11, 'newline/tab in notes does not break the row');
check(!/[\r\n\t]/.test(multiline.notes), 'newlines and tabs collapse to spaces');

check(parseTrackerLine(formatTrackerLine({ ...roundTrip, resume: '' })).resume === null,
  'empty resume writes the "—" placeholder and reads back as null');
// Assert the notes cell itself, not the end of the line: url is written last, so
// a trailing-cell check would silently be testing the url placeholder instead.
check(parseTrackerLine(formatTrackerLine({ ...roundTrip, notes: undefined })).notes === '',
  'undefined field writes an empty cell rather than "undefined"');

check(sanitizeTrackerCell('a | b') === 'a / b', 'sanitizeTrackerCell swaps the delimiter');
check(sanitizeTrackerCell(null) === '', 'sanitizeTrackerCell handles null');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
