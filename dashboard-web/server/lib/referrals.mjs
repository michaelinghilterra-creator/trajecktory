import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, REFERRALS_MD, REFERRAL_CORR_DIR } from '../config.mjs';
import { REFERRAL_STATUS_LABELS } from './statuses.mjs';
import { parseVerifyTag, setVerifyTag } from '../../../lib/email-verify.mjs';
import { parseCorrespondence, formatCorrespondence } from './correspondence-format.mjs';
import { linkedinKey } from './contact-identity.mjs';
import { appendEventsWithEffects, findTableRowsByKey, renderLegacyFile, tableRows } from '../../../lib/legacy-files.mjs';
import { localToday, logWritesEnabled, withLogRead, withLogWrite } from '../../../lib/log-writes.mjs';

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

export function parseReferralsText(text) {
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

function parseReferralsMd() {
  if (!fs.existsSync(REFERRALS_MD)) return [];
  return parseReferralsText(fs.readFileSync(REFERRALS_MD, 'utf8'));
}

// Referral imports keep the contact's current job title as the first Notes
// segment, before the connection metadata: "Talent Recruiter · connected ...".
// A legacy row may contain only the connection metadata, which is not a title.
function referralTitle(notes) {
  const firstSegment = String(notes || '').split(' · ')[0].trim();
  if (!firstSegment || /^connected\b/i.test(firstSegment)) return '';
  return firstSegment;
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
  if (logWritesEnabled(DATA_DIR)) {
    if (!fs.existsSync(REFERRALS_MD)) fs.writeFileSync(REFERRALS_MD, REFERRAL_HEADER, 'utf8');
    return withLogWrite(DATA_DIR, store => {
      const ids = tableRows(store, 'referrals.md')
        .map(({ raw }) => contactRowId(raw)).filter(id => id !== null);
      let nextId = ids.length ? Math.max(...ids) + 1 : 1;
      let previousRowId = null;
      const events = rows.map(r => {
        const id = nextId++;
        const status = REFERRAL_STATUSES.includes(r.status) ? r.status : 'Not Asked';
        const raw = `| ${id} | ${esc(r.name)} | ${esc(r.how)} | ${esc(r.where)} | ${esc(r.target)} | ${status} | ${esc(r.lastTouch)} | ${esc(r.notes)} | ${esc(r.linkedin)} | ${esc(emailCell(r))} |`;
        const rowId = `referrals.md#n-${randomUUID()}`;
        const anchor = previousRowId ? { at: 'after', row_id: previousRowId } : { at: 'table_end' };
        previousRowId = rowId;
        return {
          type: 'person_added', occurred_on: localToday(), source: 'dashboard', definitions_version: 'v1',
          payload: {
            file: 'referrals.md', id, ref: `referral:${id}`, raw,
            legacy_effects: [{ file: 'referrals.md', op: 'row_upsert', row_id: rowId, raw, anchor }],
          },
        };
      });
      appendEventsWithEffects(store, events);
      return events.map(event => ({ id: event.payload.id }));
    });
  }
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
  if (logWritesEnabled(DATA_DIR)) {
    return withLogWrite(DATA_DIR, store => {
      const matches = findTableRowsByKey(store, 'referrals.md', contactRowId, id);
      if (!matches.length) return false;
      const changed = matches.map(match => ({ ...match, next: updateReferralRaw(match.raw, updates) }))
        .filter(match => match.next !== match.raw);
      if (!changed.length) return true;
      appendEventsWithEffects(store, [{
        type: 'person_updated', occurred_on: localToday(), source: 'dashboard', definitions_version: 'v1',
        payload: {
          file: 'referrals.md', id, ref: `referral:${id}`,
          fields: Object.keys(updates).filter(field => updates[field] !== undefined),
          legacy_effects: changed.map(({ row_id, next }) => ({
            file: 'referrals.md', op: 'row_upsert', row_id, raw: next,
          })),
        },
      }]);
      return true;
    });
  }
  if (!fs.existsSync(REFERRALS_MD)) return false;
  const text = fs.readFileSync(REFERRALS_MD, 'utf8');
  const lines = text.split('\n');
  let touched = false;
  const newLines = lines.map(line => {
    if (!line.startsWith('| ')) return line;
    const parts = line.split('|');
    if (parts.length < 10) return line;
    const lineId = parseInt(parts[1].trim(), 10);
    if (lineId !== id) return line;
    touched = true;
    return updateReferralRaw(line, updates);
  });
  if (touched) fs.writeFileSync(REFERRALS_MD, newLines.join('\n'));
  return touched;
}

// Remove one row by id. Returns true if a row was removed.
function deleteReferralLine(id) {
  if (logWritesEnabled(DATA_DIR)) {
    return withLogWrite(DATA_DIR, store => {
      const matches = findTableRowsByKey(store, 'referrals.md', contactRowId, id);
      if (!matches.length) return false;
      appendEventsWithEffects(store, [{
        type: 'legacy_record', occurred_on: localToday(), source: 'dashboard', definitions_version: 'v1',
        payload: {
          reason: 'contact_row_removed', file: 'referrals.md', id, ref: `referral:${id}`,
          legacy_effects: matches.map(({ row_id }) => ({
            file: 'referrals.md', op: 'row_delete', row_id,
          })),
        },
      }]);
      return true;
    });
  }
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

function contactRowId(raw) {
  if (!raw.startsWith('| ')) return null;
  const id = parseInt(raw.split('|')[1]?.trim(), 10);
  return Number.isNaN(id) ? null : id;
}

function updateReferralRaw(line, updates) {
  if (!line.startsWith('| ')) return line;
  const parts = line.split('|');
  if (parts.length < 10) return line;
  const cell = v => ` ${esc(v)} `;
  if (updates.name      !== undefined) parts[2] = cell(updates.name);
  if (updates.how       !== undefined) parts[3] = cell(updates.how);
  if (updates.where     !== undefined) parts[4] = cell(updates.where);
  if (updates.target    !== undefined) parts[5] = cell(updates.target);
  if (updates.status    !== undefined) parts[6] = ` ${updates.status} `;
  if (updates.lastTouch !== undefined) parts[7] = ` ${updates.lastTouch} `;
  if (updates.notes     !== undefined) parts[8] = cell(updates.notes);
  if (updates.linkedin !== undefined || updates.email !== undefined) {
    while (parts.length < 12) parts.splice(parts.length - 1, 0, '  ');
    if (updates.linkedin !== undefined) parts[9] = cell(updates.linkedin);
    if (updates.email    !== undefined) parts[10] = cell(updates.email);
  }
  return parts.join('|');
}

// ── Referral correspondence (own store, for referrals with no TA/recruiter twin) ─
// Same on-disk format and message shape as the TA/recruiter correspondence stores,
// so the drawer renders all three identically. A LINKED referral never writes here:
// the route redirects its correspondence to the twin's dir so the message is shared.
function readReferralCorrespondence(id) {
  if (logWritesEnabled(DATA_DIR)) {
    return withLogRead(DATA_DIR, store => {
      const text = renderLegacyFile(store, `referral-correspondence/${id}.md`);
      return text === null ? [] : parseCorrespondence(text);
    });
  }
  const f = path.join(REFERRAL_CORR_DIR, `${id}.md`);
  if (!fs.existsSync(f)) return [];
  return parseCorrespondence(fs.readFileSync(f, 'utf8'));
}

function writeReferralCorrespondence(id, messages) {
  if (logWritesEnabled(DATA_DIR)) {
    return withLogWrite(DATA_DIR, store => {
      const raw = formatCorrespondence(messages);
      appendEventsWithEffects(store, [{
        type: 'legacy_record', occurred_on: localToday(), source: 'dashboard', definitions_version: 'v1',
        payload: {
          reason: 'correspondence_written', dir: 'referral-correspondence', file: `${id}.md`, entries: messages.length,
          legacy_effects: [{ file: `referral-correspondence/${id}.md`, op: 'file_replace', raw }],
        },
      }]);
      return undefined;
    });
  }
  fs.mkdirSync(REFERRAL_CORR_DIR, { recursive: true });
  fs.writeFileSync(path.join(REFERRAL_CORR_DIR, `${id}.md`), formatCorrespondence(messages));
}

// Resolve a referral to its TA-outreach TWIN: the same human tracked in the TA
// book. A linked referral shares (and logs to) the twin's correspondence, so the
// referral card and the TA card are one timeline. Match precedence, strongest
// first: an explicit "from TA Outreach #<id>" backref in notes, then an exact
// LinkedIn-slug match, then name (+ company when both are present). Returns
// { source:'ta', contact } or null for a pure-LinkedIn referral with no twin.
//
// Shared source of truth: routes/referrals.mjs (the drawer read/write) and
// lib/google.mjs (logging a synced Gmail reply to the card) both call this, so a
// reply is written to the SAME store the drawer reads. When they disagreed, a
// referral's reply was logged to the twin while the card read the referral's own
// file, and the reply was invisible on the card that prompted it.
const _normName = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function resolveReferralLink(refRow, taRows = []) {
  const taRef = (refRow.notes || '').match(/TA Outreach #(\d+)/i);
  if (taRef) { const c = taRows.find(r => r.id === parseInt(taRef[1], 10)); if (c) return { source: 'ta', contact: c }; }
  const s = linkedinKey(refRow.linkedin);
  if (s) { const ta = taRows.find(r => linkedinKey(r.linkedin) === s); if (ta) return { source: 'ta', contact: ta }; }
  const nn = _normName(refRow.name), nc = _normName(refRow.where);
  if (nn && nn.length >= 4) {
    const ta = taRows.find(r => _normName(`${r.first} ${r.last}`) === nn && (!nc || _normName(r.company) === nc));
    if (ta) return { source: 'ta', contact: ta };
  }
  return null;
}

export { parseReferralsMd, referralTitle, appendReferralRows, updateReferralLine, deleteReferralLine, REFERRAL_STATUSES, readReferralCorrespondence, writeReferralCorrespondence };
