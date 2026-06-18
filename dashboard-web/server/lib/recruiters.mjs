import fs from 'fs';
import path from 'path';
import { RECRUITERS_MD, RECRUITER_CORR_DIR } from '../config.mjs';

const RECRUITER_STATUSES = [
  'Not Contacted',
  'Drafted',
  'Sent',
  'Replied',
  'Meeting Scheduled',
  'Connected',
  'Dormant',
];

function parseRecruitersMd() {
  if (!fs.existsSync(RECRUITERS_MD)) return [];
  const text = fs.readFileSync(RECRUITERS_MD, 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const parts = line.split('|').map(p => p.trim());
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
    // parts: ['', id, firm, last, first, salute, title, city, state, zip, phone, email, status, last_touch, notes, '']
    if (updates.status     !== undefined) parts[12] = ` ${updates.status} `;
    if (updates.lastTouch  !== undefined) parts[13] = ` ${updates.lastTouch} `;
    if (updates.notes      !== undefined) parts[14] = ` ${updates.notes.replace(/\|/g, '\\|').replace(/\n/g, ' ')} `;
    touched = true;
    return parts.join('|');
  });
  if (touched) fs.writeFileSync(RECRUITERS_MD, newLines.join('\n'));
  return touched;
}

// GET /api/recruiters — list all (search/filter handled client-side)

export { parseRecruitersMd, readRecruiterCorrespondence, writeRecruiterCorrespondence, updateRecruiterLine, RECRUITER_STATUSES };

