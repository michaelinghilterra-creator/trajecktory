// Shared, dependency-free CSV parsing for the TA Outreach + Recruiters bulk
// importers. One header-mapped parser and one downloadable template, used by
// both /api/tt-reconcile/* and /api/recruiters/*. The "Excel floor" for
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

export const CONTACTS_TEMPLATE_CSV =
  'company,first,last,title,phone,linkedin,website,city,state,notes\n'
  + 'Acme Corp,Sarah,Johnson,Senior Talent Acquisition Partner,415-555-0182,https://www.linkedin.com/in/example,https://acme.com,San Francisco,CA,Found via LinkedIn\n';
