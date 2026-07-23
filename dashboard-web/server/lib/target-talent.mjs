import fs from 'fs';
import path from 'path';
import { TARGET_TALENT_MD, TT_CORR_DIR } from '../config.mjs';
import { parseApplicationsMd } from './applications.mjs';
import { TALENT_STATUS_LABELS } from './statuses.mjs';
import { parseVerifyTag } from '../../../lib/email-verify.mjs';

// Derived from templates/states.yml (talent_states) rather than hardcoded here.
// The previous local array is the exact drift the recruiter side already fixed:
// a status added to states.yml (Bounced, Blocked) would otherwise be missing from
// this list, so the UI would not offer it and a ladder metric would skip it — the
// same way Bounced silently rendered as "Not Contacted" for a month.
const TT_STATUSES = TALENT_STATUS_LABELS;

function parseTargetTalentMd() {
  if (!fs.existsSync(TARGET_TALENT_MD)) return [];
  const text = fs.readFileSync(TARGET_TALENT_MD, 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const parts = line.split('|').map(p => p.trim());
    // Layout: ['', id, company, last, first, salute, title, city, state, zip, phone, email, linkedin, status, lastTouch, notes, (website), '']
    // Website is a later-added trailing column; rows written before it have an
    // empty parts[16] (the trailing cell), so it reads as '' — backward-compatible.
    if (parts.length < 17) continue;
    const id = parseInt(parts[1], 10);
    if (isNaN(id)) continue;
    // Read the inline `[v:state:source:date:score]` verification tag AND the
    // clean address from the Email cell in one pass. `verified.address` strips
    // every bracket tag (`[pattern-med]`, legacy `[bounced …]`, the new `[v:…]`)
    // exactly as the old inline replace did, so `email` is byte-identical to
    // before; `verified` is purely additive. The send gate (isSendable) reads
    // `verified.state`, so a message can never go to an unverified/dead address.
    const verified = parseVerifyTag(parts[11]);
    rows.push({
      id,
      company:   parts[2],
      last:      parts[3],
      first:     parts[4],
      salute:    parts[5],
      title:     parts[6],
      city:      parts[7],
      state:     parts[8],
      zip:       parts[9],
      phone:     parts[10],
      email:     verified.address,
      linkedin:  parts[12],
      status:    parts[13],
      lastTouch: parts[14],
      notes:     parts[15],
      website:   (parts[16] || '').trim(),
      verified,  // { state, source, date, score, address, hadTag }
      raw: line,
    });
  }
  return rows;
}

function readTTCorrespondence(id) {
  const f = path.join(TT_CORR_DIR, `${id}.md`);
  if (!fs.existsSync(f)) return [];
  const text = fs.readFileSync(f, 'utf8');
  const messages = [];
  const re = /^## (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?) \| (Sent|Received|Draft) \| (.+?)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    messages.push({
      timestamp: m[1],
      direction: m[2],
      subject:   m[3].trim(),
      body:      m[4].trim(),
    });
  }
  return messages;
}

function writeTTCorrespondence(id, messages) {
  fs.mkdirSync(TT_CORR_DIR, { recursive: true });
  const out = messages.map(m =>
    `## ${m.timestamp} | ${m.direction} | ${m.subject}\n\n${m.body}\n`
  ).join('\n');
  fs.writeFileSync(path.join(TT_CORR_DIR, `${id}.md`), out);
}

function updateTTLine(id, updates) {
  const text = fs.readFileSync(TARGET_TALENT_MD, 'utf8');
  const lines = text.split('\n');
  let touched = false;
  const newLines = lines.map(line => {
    if (!line.startsWith('| ')) return line;
    const parts = line.split('|');
    if (parts.length < 17) return line;
    const lineId = parseInt(parts[1].trim(), 10);
    if (lineId !== id) return line;
    const cell = v => ` ${(v || '').toString().replace(/[|\r\n]+/g, ' ')} `;
    if (updates.status     !== undefined) parts[13] = ` ${updates.status} `;
    if (updates.lastTouch  !== undefined) parts[14] = ` ${updates.lastTouch} `;
    if (updates.notes      !== undefined) parts[15] = cell(updates.notes);
    if (updates.phone      !== undefined) parts[10] = cell(updates.phone);
    // Email cell may carry an inline [v:...] verification tag; cell() keeps it intact
    // (no pipe/newline in a tag). Used by the reconcile find-emails endpoint.
    if (updates.email      !== undefined) parts[11] = cell(updates.email);
    if (updates.website    !== undefined) {
      // Older rows have no Website cell; insert one before the trailing '' so the
      // row stays well-formed. Newer rows (length >= 18) just overwrite parts[16].
      if (parts.length >= 18) parts[16] = cell(updates.website);
      else parts.splice(parts.length - 1, 0, cell(updates.website));
    }
    touched = true;
    return parts.join('|');
  });
  if (touched) fs.writeFileSync(TARGET_TALENT_MD, newLines.join('\n'));
  return touched;
}

// Append one or more new TA contact rows to target-talent.md. Used by the
// Reconcile / Discover-add flow when Claude finds new contacts via WebSearch.
// `rows` = [{ company, last, first, salute?, title, city?, state?, zip?,
//             phone?, email?, linkedin?, notes? }]
// Auto-assigns next sequential id starting from max+1 in the existing file.
function appendTTRows(rows) {
  if (!rows || !rows.length) return [];
  if (!fs.existsSync(TARGET_TALENT_MD)) return [];
  const text = fs.readFileSync(TARGET_TALENT_MD, 'utf8');
  const lines = text.split('\n');
  // Determine next id
  const existing = parseTargetTalentMd();
  let nextId = existing.length ? Math.max(...existing.map(r => r.id)) + 1 : 1;
  const esc = s => (s || '').toString().replace(/[|\r\n]+/g, ' ').trim();
  const newRows = [];
  for (const r of rows) {
    const id = nextId++;
    // Reconcile-style inserts often supply a synthesized firstname.lastname@company
    // email that was never verified. If the email looks fabricated and the notes
    // don't already carry a verification flag, prepend a visible warning so the
    // drawer surfaces "confirm before sending" instead of looking authoritative.
    let notes = r.notes || '';
    const emailGiven = (r.email || '').trim();
    const alreadyFlagged = /⚠|unverified|bounced|verified|pattern-med|pattern-low/i.test(notes);
    if (emailGiven && !r.emailVerified && !alreadyFlagged) {
      notes = '⚠ Email unverified (auto-synthesized, confirm before sending). ' + notes;
    }
    const row = `| ${id} | ${esc(r.company)} | ${esc(r.last)} | ${esc(r.first)} | ${esc(r.salute)} | ${esc(r.title)} | ${esc(r.city)} | ${esc(r.state)} | ${esc(r.zip)} | ${esc(r.phone)} | ${esc(r.email)} | ${esc(r.linkedin)} | Not Contacted |  | ${esc(notes)} | ${esc(r.website)} |`;
    newRows.push({ id, row, ...r });
  }
  // Append before any trailing blank line
  let out = text.replace(/\s*$/, '') + '\n' + newRows.map(r => r.row).join('\n') + '\n';
  fs.writeFileSync(TARGET_TALENT_MD, out, 'utf8');
  return newRows.map(r => ({ id: r.id }));
}

// Cross-link: find applications.md rows where Company matches this TT contact's
// Target Company (case-insensitive, trimmed). Returns lightweight refs.
// Match company names across the two CRMs (applications.md vs target-talent.md).
// Exact normalized match is preferred; if it returns nothing, fall back to a
// token-subset match so "Acme" ↔ "Acme Labs" and "Northwind" ↔ "Northwind Inc."
// link correctly. Common corporate suffixes are treated as ignorable noise.
const _COMPANY_STOPWORDS = new Set([
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'llc', 'ltd',
  'limited', 'plc', 'gmbh', 'sa', 'ag', 'the', 'and', 'group', 'holdings',
  'labs', 'lab', 'studio', 'studios',
]);
function _companyTokens(s) {
  return (s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t && !_COMPANY_STOPWORDS.has(t));
}
// Shared company matcher across the two CRMs (applications.md <-> target-talent.md).
// Normalized-exact match preferred; token-subset fallback so corporate suffixes
// (Inc./LLC/Labs/...) don't break linkage — "Acme" <-> "Acme Inc.", "Northwind" <->
// "Northwind Labs". Used by BOTH findRelatedApps() (TA drawer) and the
// /by-company endpoint (Follow-Ups drawer) so the two always agree on what
// counts as the same company. Previously the endpoint did exact-only matching,
// so a suffix mismatch silently hid related contacts/apps.
function matchByCompany(items, companyName, getName) {
  if (!companyName) return [];
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(companyName);
  if (!target) return [];
  const exact = items.filter(it => norm(getName(it)) === target);
  if (exact.length > 0) return exact;
  // Token-subset fallback: every non-stopword token of the shorter name must
  // appear in the longer one. Requires >=1 token to avoid empty-set matches.
  const queryTokens = _companyTokens(companyName);
  if (queryTokens.length === 0) return [];
  return items.filter(it => {
    const itTokens = _companyTokens(getName(it));
    if (itTokens.length === 0) return false;
    const [shorter, longer] = queryTokens.length <= itTokens.length
      ? [queryTokens, new Set(itTokens)]
      : [itTokens, new Set(queryTokens)];
    return shorter.every(t => longer.has(t));
  });
}

function findRelatedApps(companyName) {
  try {
    return matchByCompany(parseApplicationsMd(), companyName, a => a.company).map(a => ({
      id: a.id,
      company: a.company,
      role: a.role,
      score: a.scoreRaw,
      status: a.status,
      date: a.date,
      report: a.report,
    }));
  } catch { return []; }
}

// GET /api/target-talent — list all

export { parseTargetTalentMd, readTTCorrespondence, writeTTCorrespondence, updateTTLine, appendTTRows, matchByCompany, findRelatedApps, TT_STATUSES };

