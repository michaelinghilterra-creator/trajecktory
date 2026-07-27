import fs from 'fs';
import { REFERRALS_MD } from '../config.mjs';
import { REFERRAL_STATUS_LABELS } from './statuses.mjs';

// ── Referral tracker ──────────────────────────────────────────────────────────
// Backs the "Referrals" page. A referral is a person in the user's OWN network
// who can introduce them or flag an application internally — the highest-yield,
// entirely-warm channel. This is deliberately lighter than the Recruiters CRM:
// no per-contact correspondence log and no cold-email drafting, because the
// motion here is a personal note the user writes and sends themselves. The
// reconnect + ask templates live in the UI (referrals.jsx), the same way the
// other outreach tabs surface their guidance.
//
// Storage: data/referrals.md — one markdown table, gitignored personal data.
//
// Row layout (pipes create the leading/trailing empty cells):
//   | # | Name | How you know them | Where they are now | Target | Status | Last Touch | Notes |
//   parts:  0''  1id   2name          3how                  4where               5target 6status 7lastTouch 8notes 9''

// Derived from templates/states.yml (referral_states) so the ladder is defined
// in exactly one place, the same lesson the recruiter ladder learned.
const REFERRAL_STATUSES = REFERRAL_STATUS_LABELS;

export const REFERRAL_HEADER =
  '# Referral tracker\n\n' +
  '| # | Name | How you know them | Where they are now | Target company/role | Status | Last Touch | Notes |\n' +
  '|---|------|-------------------|--------------------|---------------------|--------|------------|-------|\n';

function parseReferralsMd() {
  if (!fs.existsSync(REFERRALS_MD)) return [];
  const text = fs.readFileSync(REFERRALS_MD, 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const parts = line.split('|').map(p => p.trim());
    if (parts.length < 9) continue; // 8 fields + leading sentinel
    const id = parseInt(parts[1], 10);
    if (isNaN(id)) continue; // header / separator rows
    rows.push({
      id,
      name: parts[2],
      how: parts[3],
      where: parts[4],
      target: parts[5],
      status: parts[6] || 'Not Asked',
      lastTouch: parts[7],
      notes: parts[8],
      raw: line,
    });
  }
  return rows;
}

const esc = s => (s || '').toString().replace(/[|\r\n]+/g, ' ').trim();

// Append one or more referral rows. Auto-assigns the next sequential id; creates
// the file with a header if missing. Mirrors appendRecruiterRows.
function appendReferralRows(rows) {
  if (!rows || !rows.length) return [];
  if (!fs.existsSync(REFERRALS_MD)) fs.writeFileSync(REFERRALS_MD, REFERRAL_HEADER, 'utf8');
  const text = fs.readFileSync(REFERRALS_MD, 'utf8');
  const existing = parseReferralsMd();
  let nextId = existing.length ? Math.max(...existing.map(r => r.id)) + 1 : 1;
  const newRows = [];
  for (const r of rows) {
    const id = nextId++;
    const status = REFERRAL_STATUSES.includes(r.status) ? r.status : 'Not Asked';
    const row = `| ${id} | ${esc(r.name)} | ${esc(r.how)} | ${esc(r.where)} | ${esc(r.target)} | ${status} | ${esc(r.lastTouch)} | ${esc(r.notes)} |`;
    newRows.push({ id, row });
  }
  const out = text.replace(/\s*$/, '') + '\n' + newRows.map(r => r.row).join('\n') + '\n';
  fs.writeFileSync(REFERRALS_MD, out, 'utf8');
  return newRows.map(r => ({ id: r.id }));
}

// Update one row's mutable cells in place. Returns true if a row was touched.
function updateReferralLine(id, updates) {
  if (!fs.existsSync(REFERRALS_MD)) return false;
  const text = fs.readFileSync(REFERRALS_MD, 'utf8');
  const lines = text.split('\n');
  let touched = false;
  const cell = v => ` ${esc(v)} `;
  const newLines = lines.map(line => {
    if (!line.startsWith('| ')) return line;
    const parts = line.split('|');
    if (parts.length < 10) return line;
    const lineId = parseInt(parts[1].trim(), 10);
    if (lineId !== id) return line;
    // parts: ['', id, name, how, where, target, status, lastTouch, notes, '']
    if (updates.name      !== undefined) parts[2] = cell(updates.name);
    if (updates.how       !== undefined) parts[3] = cell(updates.how);
    if (updates.where     !== undefined) parts[4] = cell(updates.where);
    if (updates.target    !== undefined) parts[5] = cell(updates.target);
    if (updates.status    !== undefined) parts[6] = ` ${updates.status} `;
    if (updates.lastTouch !== undefined) parts[7] = ` ${updates.lastTouch} `;
    if (updates.notes     !== undefined) parts[8] = cell(updates.notes);
    touched = true;
    return parts.join('|');
  });
  if (touched) fs.writeFileSync(REFERRALS_MD, newLines.join('\n'));
  return touched;
}

// Remove one row by id. Returns true if a row was removed.
function deleteReferralLine(id) {
  if (!fs.existsSync(REFERRALS_MD)) return false;
  const text = fs.readFileSync(REFERRALS_MD, 'utf8');
  const lines = text.split('\n');
  let removed = false;
  const kept = lines.filter(line => {
    if (!line.startsWith('| ')) return true;
    const lineId = parseInt(line.split('|')[1]?.trim(), 10);
    if (lineId === id) { removed = true; return false; }
    return true;
  });
  if (removed) fs.writeFileSync(REFERRALS_MD, kept.join('\n'));
  return removed;
}

export { parseReferralsMd, appendReferralRows, updateReferralLine, deleteReferralLine, REFERRAL_STATUSES };
