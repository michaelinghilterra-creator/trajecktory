#!/usr/bin/env node
// import-target-talent.mjs — import internal TA contacts into data/target-talent.md
//
// Usage:
//   node import-target-talent.mjs <path/to/file.csv>
//   node import-target-talent.mjs <path/to/file.tsv>
//
// For Excel files (.xlsx), export to CSV first (Excel → File → Save As → CSV UTF-8).
// We deliberately don't depend on an Excel parser here to keep zero deps.
//
// Header matching is case-insensitive and tolerant of common variants.
// Required source columns: Company (or "Target Company"), Last, First, Title, Email
// Optional: Salute, City, State, Zip, Phone, LinkedIn, Notes
//
// Output schema in data/target-talent.md:
//   | # | Target Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes |

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET_MD = path.resolve(__dirname, 'data/target-talent.md');

const HEADER_LINES = [
  '# Target Talent Acquisition',
  '',
  'Internal Hiring / Talent Acquisition contacts at Target Companies. Schema below — `import-target-talent.mjs` writes rows here from an Excel/CSV drop.',
  '',
  'Each row links to a Target Company. The drawer cross-references `applications.md` entries where Company matches Target Company.',
  '',
  '| # | Target Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes |',
  '|---|----------------|------|-------|--------|-------|------|-------|-----|-------|-------|----------|--------|------------|-------|',
];

// ── Column-name aliases (lowercased, stripped) ────────────────────────────────
const COL_ALIASES = {
  company:  ['company', 'target company', 'employer', 'organization', 'org', 'firm'],
  last:     ['last', 'last name', 'lastname', 'surname', 'family name'],
  first:    ['first', 'first name', 'firstname', 'given name'],
  salute:   ['salute', 'salutation', 'prefix', 'mr/ms', 'title prefix'],
  title:    ['title', 'job title', 'position', 'role'],
  city:     ['city', 'town'],
  state:    ['state', 'state/province', 'region', 'province'],
  zip:      ['zip', 'zipcode', 'zip code', 'postal', 'postal code'],
  phone:    ['phone', 'phone number', 'mobile', 'tel', 'telephone', 'cell'],
  email:    ['email', 'e-mail', 'email address', 'work email'],
  linkedin: ['linkedin', 'linkedin url', 'linkedin profile', 'li', 'li url'],
  notes:    ['notes', 'note', 'comments', 'remarks'],
};

function normHeader(s) {
  return (s || '').toLowerCase().trim().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
}

function buildHeaderMap(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const n = normHeader(h);
    for (const [field, aliases] of Object.entries(COL_ALIASES)) {
      if (aliases.includes(n)) { map[field] = i; break; }
    }
  });
  return map;
}

// ── Tiny CSV parser (handles quoted cells with commas + embedded newlines) ────
function parseCSV(text, delim = ',') {
  const rows = [];
  let cur = [];
  let cell = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQuote = false;
      else cell += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === delim) { cur.push(cell); cell = ''; }
      else if (c === '\n') { cur.push(cell); rows.push(cur); cur = []; cell = ''; }
      else if (c === '\r') { /* skip */ }
      else cell += c;
    }
  }
  if (cell.length || cur.length) { cur.push(cell); rows.push(cur); }
  return rows.filter(r => r.some(c => c && c.trim()));
}

function escapeMdCell(s) {
  return (s || '').toString().replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node import-target-talent.mjs <path/to/file.csv|tsv>');
    process.exit(1);
  }
  const filePath = path.resolve(arg);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  const text = fs.readFileSync(filePath, 'utf8');
  const delim = filePath.toLowerCase().endsWith('.tsv') ? '\t' : ',';
  const rows = parseCSV(text, delim);
  if (rows.length < 2) {
    console.error('No data rows found.');
    process.exit(1);
  }

  const headers = rows[0];
  const headerMap = buildHeaderMap(headers);

  // Validate required columns
  const required = ['company', 'last', 'first', 'title', 'email'];
  const missing = required.filter(f => headerMap[f] == null);
  if (missing.length) {
    console.error(`Missing required columns: ${missing.join(', ')}`);
    console.error(`Detected headers: ${headers.join(' | ')}`);
    console.error(`Header map: ${JSON.stringify(headerMap, null, 2)}`);
    process.exit(1);
  }

  console.log(`📥 Header map detected:`);
  for (const [k, v] of Object.entries(headerMap)) {
    console.log(`   ${k.padEnd(10)} → column ${v} ("${headers[v]}")`);
  }

  // Determine next id (parse existing target-talent.md if present)
  let nextId = 1;
  if (fs.existsSync(TARGET_MD)) {
    const existing = fs.readFileSync(TARGET_MD, 'utf8');
    let maxId = 0;
    for (const line of existing.split('\n')) {
      if (!line.startsWith('| ')) continue;
      const parts = line.split('|').map(p => p.trim());
      const id = parseInt(parts[1], 10);
      if (!isNaN(id) && id > maxId) maxId = id;
    }
    nextId = maxId + 1;
  }

  const dataRows = rows.slice(1);
  const get = (row, field) => {
    const idx = headerMap[field];
    return idx == null ? '' : (row[idx] || '').trim();
  };

  const newRows = [];
  let skipped = 0;
  for (const r of dataRows) {
    const company = get(r, 'company');
    const last    = get(r, 'last');
    const first   = get(r, 'first');
    const email   = get(r, 'email');
    if (!company || !last || !first || !email) { skipped++; continue; }

    const row = [
      '',  // leading pipe
      String(nextId++),
      escapeMdCell(company),
      escapeMdCell(last),
      escapeMdCell(first),
      escapeMdCell(get(r, 'salute')),
      escapeMdCell(get(r, 'title')),
      escapeMdCell(get(r, 'city')),
      escapeMdCell(get(r, 'state')),
      escapeMdCell(get(r, 'zip')),
      escapeMdCell(get(r, 'phone')),
      escapeMdCell(email),
      escapeMdCell(get(r, 'linkedin')),
      'Not Contacted',
      '',
      escapeMdCell(get(r, 'notes')),
      '',  // trailing pipe
    ];
    newRows.push(row.join(' | ').replace(/^\s\|/, '|').replace(/\|\s$/, '|'));
  }

  // Build output (preserve any existing rows, append new ones)
  let out;
  if (fs.existsSync(TARGET_MD)) {
    const existing = fs.readFileSync(TARGET_MD, 'utf8').split('\n');
    // Keep everything up to and including the separator row, then append new rows
    const sepIdx = existing.findIndex(l => /^\|-{2,}/.test(l) || /^\|---/.test(l));
    if (sepIdx >= 0) {
      const head = existing.slice(0, sepIdx + 1);
      const existingDataRows = existing.slice(sepIdx + 1).filter(l => l.startsWith('| '));
      out = [...head, ...existingDataRows, ...newRows].join('\n') + '\n';
    } else {
      out = [...HEADER_LINES, ...newRows].join('\n') + '\n';
    }
  } else {
    out = [...HEADER_LINES, ...newRows].join('\n') + '\n';
  }

  fs.writeFileSync(TARGET_MD, out, 'utf8');
  console.log(`\n✅ Imported ${newRows.length} contacts → ${path.relative(__dirname, TARGET_MD)}`);
  if (skipped) console.log(`⏭️  Skipped ${skipped} rows (missing required field: company/last/first/email)`);
  const companyCount = new Set(newRows.map(r => r.split('|')[2].trim())).size;
  console.log(`📊 ${companyCount} unique target companies`);
}

main();
