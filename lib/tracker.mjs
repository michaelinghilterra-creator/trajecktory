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
 * Current schema (11 col): # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL
 * Legacy schema  (10 col): # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes
 * Legacy schema  (9 col):  # | Date | Company | Role | Score | Status | PDF | Report | Notes
 *
 * WHY THE URL COLUMN EXISTS:
 * Without it the tracker could not answer "have I already decided on this
 * posting?" — `grep -c http data/applications.md` returned 0. Every dedup check
 * built on that question was dead code pointed at an empty set, including a
 * shipped agent instruction to "SKIP any URL that already appears in
 * applications.md" that could never once fire. The URL lived only inside each
 * report file, and reports get pruned while the tracker never is, so the memory
 * evaporated. See lib/identity.mjs.
 *
 * URL is appended LAST so every existing positional index stays valid: notes
 * remains index 9 for the scripts that slice by position.
 */

export const TRACKER_COLUMNS = ['num', 'date', 'company', 'role', 'score', 'status', 'pdf', 'resume', 'report', 'notes', 'url'];

// The table header, owned here for the same reason the column list is: it was
// duplicated as a literal in merge-tracker (fresh-install path), AGENTS.md and
// six test fixtures, so adding the url column left every one of them describing
// a 10-column table while formatTrackerLine emitted 11. A markdown renderer
// shows only as many cells as the header declares, so a stale header does not
// look broken — it silently HIDES the last column from the human reading the
// file. Import these rather than retyping the pipes.
export const TRACKER_HEADER = '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |';
export const TRACKER_SEPARATOR = '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|';

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

  // An 11th cell is only a URL when it LOOKS like one. Legacy rows predate
  // sanitizeTrackerCell, so a stray '|' typed into an old note also yields 11
  // cells — reading that as a URL would invent data. Anything non-URL-shaped in
  // that slot leaves url null and is reported through cellCount instead, which
  // is how callers still flag it as a malformed row.
  const urlCell = cells.length >= 11 ? (cells[10] || '') : '';
  const url = /^https?:\/\//.test(urlCell) ? urlCell : null;

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
    url,               // posting URL, or null (null on every legacy row)
    columns: url ? 11 : (hasResume ? 10 : 9),
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

// Neutralize characters that would silently restructure the row. Cell values are
// free text — notes especially — and a raw '|' inside one becomes a column
// delimiter: the row gains a cell, every field after it shifts, and the tail is
// dropped on the next parse. Newlines and tabs break the row the same way (a
// newline splits it into two lines, neither of which is a valid row).
//
// Real case: an eval agent wrote notes as "…remote | [self-sourced]", the source
// tag was later stripped, and the orphaned '|' turned that row into 11 cells.
export function sanitizeTrackerCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '/')          // delimiter → separator that reads the same
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Serialize one row — the inverse of parseTrackerLine, and the only place rows
// should be written. Sanitizing here (rather than at each call site) is what
// guarantees the output parses back as exactly 11 cells. Empty Resume and URL
// cells are written as the '—' placeholder the file uses, which parseTrackerLine
// reads back as null, so parse(format(row)) round-trips.
export function formatTrackerLine(fields) {
  const cells = TRACKER_COLUMNS.map((key) => {
    const cell = sanitizeTrackerCell(fields[key]);
    if ((key === 'resume' || key === 'url') && !cell) return '—';
    return cell;
  });
  return `| ${cells.join(' | ')} |`;
}
