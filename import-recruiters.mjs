#!/usr/bin/env node
// Imports Matched_Keywords_Recruiter_Search_Firm_Contacts.csv into
// data/recruiters.md — a markdown table (same pattern as applications.md).
//
// Usage:
//   node import-recruiters.mjs <path-to-csv>
//   node import-recruiters.mjs <path-to-csv> --append   # add to existing, dedup by email
//
// Output columns:
//   id | firm | last | first | salute | title | city | state | zip | phone | email | status | last_touch | notes

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'data/recruiters.md');
const CORR_DIR = path.join(__dirname, 'data/recruiter-correspondence');

const args = process.argv.slice(2);
const csvPath = args[0];
const append = args.includes('--append');
if (!csvPath || !fs.existsSync(csvPath)) {
  console.error('Usage: node import-recruiters.mjs <path-to-csv> [--append]');
  process.exit(1);
}

// Minimal CSV parser that handles quoted fields with commas
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuote = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { inQuote = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuote = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\n' || ch === '\r') {
      if (field || row.length) { row.push(field); rows.push(row); row = []; field = ''; }
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++; continue;
    }
    field += ch; i++;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function escapeMd(s) {
  return (s || '').replace(/[|\r\n]+/g, ' ').trim();
}

const raw = fs.readFileSync(csvPath, 'utf8');
const rows = parseCSV(raw);
const header = rows[0].map(h => h.toLowerCase().trim());
const col = name => header.indexOf(name);
const lastIdx = col('last');
const firstIdx = col('first');

const data = rows.slice(1).filter(r => {
  if (r.length < 5 || !r[0]) return false;
  const firm = r[0].trim();
  // Skip CSV footer junk
  if (/^\(c\)|^©|^www\.|records\.\s*$|copyright/i.test(firm)) return false;
  // Skip rows with no person name (footer continuation)
  const lastName = (r[lastIdx] || '').trim();
  const firstName = (r[firstIdx] || '').trim();
  if (!lastName && !firstName) return false;
  return true;
});
const idx = {
  company: col('company'),
  salute: col('salute'),
  last: col('last'),
  first: col('first'),
  title: col('title'),
  address: col('address'),
  city: col('city'),
  state: col('state'),
  zip: col('zipcode'),
  country: col('country'),
  phone: col('telephone'),
  email: col('email'),
};

// Load existing for append/dedup
let existingEmails = new Set();
let nextId = 1;
const existingLines = [];
if (append && fs.existsSync(OUT)) {
  for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
    if (!line.startsWith('| ')) continue;
    const parts = line.split('|').map(p => p.trim());
    if (parts.length < 12) continue;
    const id = parseInt(parts[1], 10);
    if (isNaN(id)) continue;
    nextId = Math.max(nextId, id + 1);
    existingLines.push(line);
    const email = parts[11];
    if (email) existingEmails.add(email.toLowerCase());
  }
}

const newLines = [];
let added = 0, skipped = 0;
for (const r of data) {
  const email = (r[idx.email] || '').trim().toLowerCase();
  if (email && existingEmails.has(email)) { skipped++; continue; }
  if (email) existingEmails.add(email);
  const id = nextId++;
  const cells = [
    String(id),
    escapeMd(r[idx.company]),
    escapeMd(r[idx.last]),
    escapeMd(r[idx.first]),
    escapeMd(r[idx.salute]),
    escapeMd(r[idx.title]),
    escapeMd(r[idx.city]),
    escapeMd(r[idx.state]),
    escapeMd(r[idx.zip]),
    escapeMd(r[idx.phone]),
    escapeMd(r[idx.email]),
    'Not Contacted',     // status
    '',                  // last_touch (ISO date when set)
    '',                  // notes
  ];
  newLines.push('| ' + cells.join(' | ') + ' |');
  added++;
}

const header_md = '| # | Firm | Last | First | Salute | Title | City | State | Zip | Phone | Email | Status | Last Touch | Notes |';
const sep_md    = '|---|------|------|-------|--------|-------|------|-------|-----|-------|-------|--------|------------|-------|';

const out = [
  '# Recruiters Tracker',
  '',
  'Executive recruiters and search firms sourced via Claude CoWork keyword matching.',
  'Edit via the Recruiters page in the live dashboard.',
  '',
  header_md,
  sep_md,
  ...(append ? existingLines : []),
  ...newLines,
  '',
].join('\n');

fs.mkdirSync(CORR_DIR, { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`✅ Wrote ${OUT}`);
console.log(`   ${added} added, ${skipped} skipped (dup email)`);
console.log(`   Total tracker rows: ${(append ? existingLines.length : 0) + added}`);
console.log(`   Correspondence dir: ${CORR_DIR}`);
