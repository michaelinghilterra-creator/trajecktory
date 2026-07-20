import fs from 'fs';
import path from 'path';
import { RECRUITERS_MD, RECRUITER_CORR_DIR } from '../config.mjs';
import { RECRUITER_STATUS_LABELS, RECRUITER_CONTACTED } from './statuses.mjs';

// Derived from templates/states.yml (recruiter_states) rather than hardcoded
// here. The previous local array is how `Bounced` came to be live in the data
// and absent from every ladder for a month.
const RECRUITER_STATUSES = RECRUITER_STATUS_LABELS;

function parseRecruitersMd() {
  if (!fs.existsSync(RECRUITERS_MD)) return [];
  const text = fs.readFileSync(RECRUITERS_MD, 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const parts = line.split('|').map(p => p.trim());
    // LinkedIn + Website are later-added trailing columns; rows written before
    // them have empty parts[15]/[16], so they read as '' — backward-compatible.
    if (parts.length < 15) continue; // 14 fields + 2 sentinel empties
    const id = parseInt(parts[1], 10);
    if (isNaN(id)) continue;
    rows.push({
      id,
      firm: parts[2],
      last: parts[3],
      first: parts[4],
      salute: parts[5],
      title: parts[6],
      city: parts[7],
      state: parts[8],
      zip: parts[9],
      phone: parts[10],
      // Same defensive strip as parseTargetTalentMd — drop trailing
      // `[pattern-med]` / `[bounced …]` annotations from the Email column.
      email: parts[11].replace(/\s*\[[^\]]*\]\s*/g, '').trim(),
      status: parts[12],
      lastTouch: parts[13],
      notes: parts[14],
      linkedin: (parts[15] || '').trim(),
      website: (parts[16] || '').trim(),
      raw: line,
    });
  }
  return rows;
}

function readRecruiterCorrespondence(id) {
  const f = path.join(RECRUITER_CORR_DIR, `${id}.md`);
  if (!fs.existsSync(f)) return [];
  const text = fs.readFileSync(f, 'utf8');
  const messages = [];
  // Format per message: ## YYYY-MM-DD HH:MM | <direction> | <subject>\n<body>
  const re = /^## (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?) \| (Sent|Received|Draft) \| (.+?)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    messages.push({
      timestamp: m[1],
      direction: m[2],
      subject: m[3].trim(),
      body: m[4].trim(),
    });
  }
  return messages;
}

function writeRecruiterCorrespondence(id, messages) {
  fs.mkdirSync(RECRUITER_CORR_DIR, { recursive: true });
  const out = messages.map(m =>
    `## ${m.timestamp} | ${m.direction} | ${m.subject}\n\n${m.body}\n`
  ).join('\n');
  fs.writeFileSync(path.join(RECRUITER_CORR_DIR, `${id}.md`), out);
}

function updateRecruiterLine(id, updates) {
  const text = fs.readFileSync(RECRUITERS_MD, 'utf8');
  const lines = text.split('\n');
  let touched = false;
  const newLines = lines.map(line => {
    if (!line.startsWith('| ')) return line;
    const parts = line.split('|');
    if (parts.length < 16) return line;
    const lineId = parseInt(parts[1].trim(), 10);
    if (lineId !== id) return line;
    // parts: ['', id, firm, last, first, salute, title, city, state, zip, phone,
    //         email, status, last_touch, notes, (linkedin), (website), '']
    const cell = v => ` ${(v || '').toString().replace(/[|\r\n]+/g, ' ')} `;
    if (updates.status     !== undefined) parts[12] = ` ${updates.status} `;
    if (updates.lastTouch  !== undefined) parts[13] = ` ${updates.lastTouch} `;
    if (updates.notes      !== undefined) parts[14] = cell(updates.notes);
    if (updates.phone      !== undefined) parts[10] = cell(updates.phone);
    if (updates.linkedin !== undefined || updates.website !== undefined) {
      // Older rows lack the LinkedIn + Website cells; pad with empties before the
      // trailing '' so columns line up, then set whichever was provided.
      while (parts.length < 18) parts.splice(parts.length - 1, 0, '  ');
      if (updates.linkedin !== undefined) parts[15] = cell(updates.linkedin);
      if (updates.website  !== undefined) parts[16] = cell(updates.website);
    }
    touched = true;
    return parts.join('|');
  });
  if (touched) fs.writeFileSync(RECRUITERS_MD, newLines.join('\n'));
  return touched;
}

const REC_HEADER = '# Recruiters\n\n| # | Firm | Last | First | Salute | Title | City | State | Zip | Phone | Email | Status | Last Touch | Notes | LinkedIn | Website |\n|---|------|------|-------|--------|-------|------|-------|-----|-------|-------|--------|------------|-------|----------|---------|\n';

// Append one or more recruiter rows to recruiters.md. Mirrors appendTTRows.
// Accepts rows with `firm` (or `company`, mapped from the shared CSV template).
// Auto-assigns the next sequential id; creates the file with a header if missing.
function appendRecruiterRows(rows) {
  if (!rows || !rows.length) return [];
  if (!fs.existsSync(RECRUITERS_MD)) fs.writeFileSync(RECRUITERS_MD, REC_HEADER, 'utf8');
  const text = fs.readFileSync(RECRUITERS_MD, 'utf8');
  const existing = parseRecruitersMd();
  let nextId = existing.length ? Math.max(...existing.map(r => r.id)) + 1 : 1;
  const esc = s => (s || '').toString().replace(/[|\r\n]+/g, ' ').trim();
  const newRows = [];
  for (const r of rows) {
    const id = nextId++;
    const firm = r.firm || r.company || '';
    const row = `| ${id} | ${esc(firm)} | ${esc(r.last)} | ${esc(r.first)} | ${esc(r.salute)} | ${esc(r.title)} | ${esc(r.city)} | ${esc(r.state)} | ${esc(r.zip)} | ${esc(r.phone)} | ${esc(r.email)} | Not Contacted |  | ${esc(r.notes)} | ${esc(r.linkedin)} | ${esc(r.website)} |`;
    newRows.push({ id, row });
  }
  const out = text.replace(/\s*$/, '') + '\n' + newRows.map(r => r.row).join('\n') + '\n';
  fs.writeFileSync(RECRUITERS_MD, out, 'utf8');
  return newRows.map(r => ({ id: r.id }));
}

// GET /api/recruiters — list all (search/filter handled client-side)

export { parseRecruitersMd, readRecruiterCorrespondence, writeRecruiterCorrespondence, updateRecruiterLine, appendRecruiterRows, REC_HEADER, RECRUITER_STATUSES, RECRUITER_CONTACTED };

