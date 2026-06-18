/**
 * lib/tracker.mjs — the single canonical parser for data/applications.md.
 *
 * The audit found this tracker parsed by 5+ hand-rolled implementations that
 * disagreed on the column layout. The root scripts split on '|' WITHOUT
 * dropping the empty cells the outer pipes produce, so on the current
 * 10-column schema they read the Resume cell as the report link and the
 * report link as notes (e.g. analyze-patterns could never open report files,
 * so every archetype fell back to "Unknown"). This module is the one correct
 * parser; every reader imports it.
 *
 * Current schema (10 col): # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes
 * Legacy schema  (9 col):  # | Date | Company | Role | Score | Status | PDF | Report | Notes
 */

export const TRACKER_COLUMNS = ['num', 'date', 'company', 'role', 'score', 'status', 'pdf', 'resume', 'report', 'notes'];

// Parse one applications.md table row into a raw-field object, or null if the
// line is not a data row (header, separator, blank, or malformed). Mirrors the
// dashboard parser's cell handling: drop the empty cells created by the leading
// and trailing pipes so cells[0] is the row number.
export function parseTrackerLine(line) {
  if (typeof line !== 'string' || !line.startsWith('|')) return null;
  const cells = line.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
  if (cells.length < 9) return null;
  const num = parseInt(cells[0], 10);
  if (Number.isNaN(num)) return null; // header / separator / non-data row

  // 10-col rows carry a Resume cell between PDF and Report; 9-col (legacy) do not.
  const hasResume = cells.length >= 10;
  const resume = hasResume ? (cells[7] && cells[7] !== '—' ? cells[7] : null) : null;
  const reportCell = (hasResume ? cells[8] : cells[7]) || '';
  const notes = (hasResume ? cells[9] : cells[8]) || '';

  // Report cell is usually a markdown link: [691](reports/691-...md). Expose the
  // raw cell (what the rewrite/dedup scripts and analyze-patterns expect) and a
  // stripped path convenience.
  const reportMatch = reportCell.match(/\[.*?\]\((.*?)\)/);
  const reportPath = reportMatch ? reportMatch[1] : (reportCell || null);

  return {
    num,
    date: cells[1],
    company: cells[2],
    role: cells[3],
    score: cells[4],   // raw cell, e.g. "4.2/5"
    status: cells[5],  // raw cell, e.g. "Applied"
    pdf: cells[6],     // raw cell, e.g. "✅"
    resume,            // raw Resume cell, or null (and null on legacy 9-col)
    report: reportCell, // raw Report cell (markdown link as written)
    reportPath,        // stripped path, e.g. "reports/691-...md", or null
    notes,
    columns: hasResume ? 10 : 9,
    cellCount: cells.length, // actual inner-cell count, so callers can flag extra pipes
    raw: line,
  };
}

// Parse the full applications.md text into an array of row objects.
export function parseTracker(text) {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    const row = parseTrackerLine(line);
    if (row) rows.push(row);
  }
  return rows;
}
