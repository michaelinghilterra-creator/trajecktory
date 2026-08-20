// Shared, dependency-free CSV parsing for the TA Outreach bulk importer.
// One header-mapped parser and one downloadable template, used by
// /api/tt-reconcile/*. The "Excel floor" for
// non-power users: hand-enter contacts in a spreadsheet, save as CSV, upload.

export function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

// Map a contacts CSV by header name. Required: company, first, last, title.
// Optional: phone, linkedin, website, city, state, notes. Returns row objects
// keyed by those names (the Recruiters importer maps `company` -> firm at write
// time, since the same template serves both CRMs).
export function parseCsvContacts(csv) {
  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map(h => h.toLowerCase());
  const ci = { company: header.indexOf('company'), first: header.indexOf('first'), last: header.indexOf('last'), title: header.indexOf('title'), phone: header.indexOf('phone'), linkedin: header.indexOf('linkedin'), website: header.indexOf('website'), city: header.indexOf('city'), state: header.indexOf('state'), notes: header.indexOf('notes') };
  if (ci.company < 0 || ci.first < 0 || ci.last < 0 || ci.title < 0) throw new Error('CSV must have columns: company, first, last, title.');
  const get = (v, i) => (i >= 0 && i < v.length ? v[i] : '');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const v = parseCsvLine(lines[i]);
    const c = { company: get(v, ci.company), first: get(v, ci.first), last: get(v, ci.last), title: get(v, ci.title), phone: get(v, ci.phone), linkedin: get(v, ci.linkedin), website: get(v, ci.website), city: get(v, ci.city), state: get(v, ci.state), notes: get(v, ci.notes) };
    if (c.company && c.first && c.last && c.title) rows.push(c);
  }
  return rows;
}

// Serialize rows to an RFC-4180 CSV string. `rows` is an array of arrays (each
// inner array is one line's cells). A cell is quoted only when it contains a
// comma, double-quote, CR or LF, with inner quotes doubled — the same escape the
// client uses in src/pipeline.jsx exportCSV(). This is the first server-side CSV
// WRITER; everything above only READS CSV. Lines are joined with CRLF so the file
// opens cleanly in Excel/Sheets, which is where a TWC claimant will open it.
export function toCsv(rows) {
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    // CSV formula-injection guard (CWE-1236): a cell a spreadsheet would evaluate
    // as a formula (leading = + - @ TAB CR) gets a leading apostrophe so Excel and
    // Sheets treat it as text, not executable content.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (rows || []).map(row => (row || []).map(esc).join(',')).join('\r\n');
}

// Applications you tracked somewhere else before trajecktory. Columns match the
// tracker's own, so a filled-in copy maps across without interpretation.
//
// Deliberately NOT a direct write into data/applications.md. Rows there are only
// ever produced by formatTrackerLine and merged by merge-tracker.mjs, because a
// hand-rolled row is still a syntactically valid row: nothing throws, nothing
// fails a test, and the damage surfaces later as a column quietly holding the
// wrong thing. That has happened twice. An importer must go through the same
// merge path as everything else.
export const APPLICATIONS_TEMPLATE_CSV =
  'date,company,role,status,score,url,notes\n'
  + '2026-05-14,Acme Corp,Director of Operations,Applied,4.2,https://example.com/jobs/123,Referred by a former colleague\n'
  + '2026-05-28,Globex,Senior Business Analyst,Rejected,3.6,https://example.com/jobs/456,No response after two follow-ups\n';

export const CONTACTS_TEMPLATE_CSV =
  'company,first,last,title,phone,linkedin,website,city,state,notes\n'
  + 'Acme Corp,Sarah,Johnson,Senior Talent Acquisition Partner,415-555-0182,https://www.linkedin.com/in/example,https://acme.com,San Francisco,CA,Found via LinkedIn\n';
