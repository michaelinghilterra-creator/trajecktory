import fs from 'fs';
import path from 'path';
import { REFERRALS_MD, REFERRAL_CORR_DIR } from '../config.mjs';
import { REFERRAL_STATUS_LABELS } from './statuses.mjs';
import { parseVerifyTag, setVerifyTag } from '../../../lib/email-verify.mjs';

// ── Referral tracker ──────────────────────────────────────────────────────────
// Backs the "Referrals" page. A referral is a person in the user's OWN network
// who can introduce them or flag an application internally — the highest-yield,
// entirely-warm channel. Lighter than the Recruiters CRM (no per-contact
// correspondence log, no cold-email drafting) because the motion here is a
// personal note the user writes and sends themselves.
//
// Storage: data/referrals.md — one markdown table, gitignored personal data.
//
// Row layout (pipes create the leading/trailing empty cells):
//   | # | Name | How you know them | Where they are now | Target | Status | Last Touch | Notes | LinkedIn | Email |
//   parts:  0''  1id   2name          3how                  4where               5target 6status 7lastTouch 8notes 9linkedin 10email 11''
//
// LinkedIn + Email are TRAILING columns, appended after Notes on purpose: a row
// written before they existed simply has no cells 9/10, so parts[9]/parts[10]
// read as '' — backward-compatible by construction, the same posture
// target-talent.md took when it grew a Website column. The Email cell carries the
// shared inline `[v:...]` verification tag (lib/email-verify.mjs), so a referral's
// address gets the same Hunter/MillionVerifier deliverability state as a TA or
// recruiter contact, and `parseVerifyTag` strips it back to a clean address.

// Derived from templates/states.yml (referral_states) so the ladder is defined
// in exactly one place, the same lesson the recruiter ladder learned.
const REFERRAL_STATUSES = REFERRAL_STATUS_LABELS;

export const REFERRAL_HEADER =
  '# Referral tracker\n\n' +
  '| # | Name | How you know them | Where they are now | Target company/role | Status | Last Touch | Notes | LinkedIn | Email |\n' +
  '|---|------|-------------------|--------------------|---------------------|--------|------------|-------|----------|-------|\n';

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
    // Email cell may carry an inline [v:...] verification tag; parse it out so the
    // address stays clean and the drawer can show the deliverability badge. Rows
    // written before the column exist read parts[10] as undefined → 'unverified'.
    const verified = parseVerifyTag(parts[10] || '');
    rows.push({
      id,
      name: parts[2],
      how: parts[3],
      where: parts[4],
      target: parts[5],
      status: parts[6] || 'Not Asked',
      lastTouch: parts[7],
      notes: parts[8],
      linkedin: (parts[9] || '').trim(),
      email: verified.address,
      verified,  // { state, source, date, score, address, hadTag }
      raw: line,
    });
  }
  return rows;
}

const esc = s => (s || '').toString().replace(/[|\r\n]+/g, ' ').trim();

// The Email cell for a row spec: accept either a ready-made cell (already tag-
// bearing) or an address plus an optional verify object to stamp. Empty → ''.
function emailCell(r) {
  const addr = (r.email || '').toString().trim();
  if (!addr) return '';
  return r.emailVerify ? setVerifyTag(addr, r.emailVerify) : addr;
}

// Append one or more referral rows. Auto-assigns the next sequential id; creates
// the file with a header if missing. Mirrors the target-talent row appender.
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
    const row = `| ${id} | ${esc(r.name)} | ${esc(r.how)} | ${esc(r.where)} | ${esc(r.target)} | ${status} | ${esc(r.lastTouch)} | ${esc(r.notes)} | ${esc(r.linkedin)} | ${esc(emailCell(r))} |`;
    newRows.push({ id, row });
  }
  const out = text.replace(/\s*$/, '') + '\n' + newRows.map(r => r.row).join('\n') + '\n';
  fs.writeFileSync(REFERRALS_MD, out, 'utf8');
  return newRows.map(r => ({ id: r.id }));
}

// Update one row's mutable cells in place. Returns true if a row was touched.
// `email` is written as-is (the caller passes a full cell, tag included, e.g. via
// setVerifyTag); `linkedin` is a bare URL.
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
    // parts: ['', id, name, how, where, target, status, lastTouch, notes, (linkedin), (email), '']
    if (updates.name      !== undefined) parts[2] = cell(updates.name);
    if (updates.how       !== undefined) parts[3] = cell(updates.how);
    if (updates.where     !== undefined) parts[4] = cell(updates.where);
    if (updates.target    !== undefined) parts[5] = cell(updates.target);
    if (updates.status    !== undefined) parts[6] = ` ${updates.status} `;
    if (updates.lastTouch !== undefined) parts[7] = ` ${updates.lastTouch} `;
    if (updates.notes     !== undefined) parts[8] = cell(updates.notes);
    if (updates.linkedin !== undefined || updates.email !== undefined) {
      // Older rows lack the LinkedIn + Email cells; pad with empties before the
      // trailing '' so columns line up, then set whichever was provided.
      while (parts.length < 12) parts.splice(parts.length - 1, 0, '  ');
      if (updates.linkedin !== undefined) parts[9]  = cell(updates.linkedin);
      if (updates.email    !== undefined) parts[10] = cell(updates.email);
    }
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

// ── Referral correspondence (own store, for referrals with no TA/recruiter twin) ─
// Same on-disk format and message shape as the TA/recruiter correspondence stores,
// so the drawer renders all three identically. A LINKED referral never writes here:
// the route redirects its correspondence to the twin's dir so the message is shared.
function readReferralCorrespondence(id) {
  const f = path.join(REFERRAL_CORR_DIR, `${id}.md`);
  if (!fs.existsSync(f)) return [];
  const text = fs.readFileSync(f, 'utf8');
  const messages = [];
  // Optional channel token (Email|LinkedIn) sits between direction and subject.
  // Absent on legacy rows, which read back as Email — the header stays valid and
  // no cell shifts. A subject like "LinkedIn connection request" is safe: the
  // optional group requires "LinkedIn | " (trailing pipe), which a subject lacks.
  const re = /^## (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?) \| (Sent|Received|Draft) \| (?:(Email|LinkedIn) \| )?(.+?)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    messages.push({ timestamp: m[1], direction: m[2], channel: m[3] || 'Email', subject: m[4].trim(), body: m[5].trim() });
  }
  return messages;
}

function writeReferralCorrespondence(id, messages) {
  fs.mkdirSync(REFERRAL_CORR_DIR, { recursive: true });
  const out = messages.map(m => {
    const ch = m.channel && m.channel !== 'Email' ? `${m.channel} | ` : '';
    return `## ${m.timestamp} | ${m.direction} | ${ch}${m.subject}\n\n${m.body}\n`;
  }).join('\n');
  fs.writeFileSync(path.join(REFERRAL_CORR_DIR, `${id}.md`), out);
}

export { parseReferralsMd, appendReferralRows, updateReferralLine, deleteReferralLine, REFERRAL_STATUSES, readReferralCorrespondence, writeReferralCorrespondence };
