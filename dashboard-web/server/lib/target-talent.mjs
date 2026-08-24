import fs from 'fs';
import path from 'path';
import { TARGET_TALENT_MD, TT_CORR_DIR } from '../config.mjs';
import { parseApplicationsMd } from './applications.mjs';
import { TALENT_STATUS_LABELS, OUTREACH_ELIGIBLE_STATUSES } from './statuses.mjs';
import { parseVerifyTag } from '../../../lib/email-verify.mjs';
import { resolveInfluenceTier, setInfluenceTier } from '../../../lib/influence-tier.mjs';
import { parseProvenance } from '../../../lib/stakeholder-additions.mjs';
import { readLinkedInMap } from './tt-linkedin.mjs';
import { parseCorrespondence, formatCorrespondence } from './correspondence-format.mjs';

// A quarter is long enough that a leadership change is likely, and short enough
// that a re-check is still cheap. Missing provenance is deliberately not stale:
// that covers hand-entered and older rows, and a flag that fires everywhere is
// the same as no flag because it trains the user to ignore it.
const PROVENANCE_STALE_DAYS = 90;

function localDateParts(date = new Date()) {
  return [date.getFullYear(), date.getMonth(), date.getDate()];
}

function provenanceAgeDays(date) {
  const [year, month, day] = String(date).split('-').map(Number);
  if (!year || !month || !day) return null;
  const [todayYear, todayMonth, todayDay] = localDateParts();
  return Math.floor((Date.UTC(todayYear, todayMonth, todayDay) - Date.UTC(year, month - 1, day)) / 86400000);
}

// Derived from templates/states.yml (talent_states) rather than hardcoded here.
// The previous local array is the exact drift the recruiter side already fixed:
// a status added to states.yml (Bounced, Blocked) would otherwise be missing from
// this list, so the UI would not offer it and a ladder metric would skip it — the
// same way Bounced silently rendered as "Not Contacted" for a month.
const TT_STATUSES = TALENT_STATUS_LABELS;

function parseTargetTalentMd() {
  if (!fs.existsSync(TARGET_TALENT_MD)) return [];
  const text = fs.readFileSync(TARGET_TALENT_MD, 'utf8');
  // LinkedIn connection state lives in a sidecar keyed by id. Read it once here
  // and attach per-row, so every consumer (list, single, by-company) sees the
  // same `linkedinStatus` without each re-reading the file.
  const liMap = readLinkedInMap();
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
    const { tier: influenceTier, source: influenceTierSource } = resolveInfluenceTier({
      notes: parts[15],
      title: parts[6],
    });
    const provenance = parseProvenance(parts[15]);
    const provenanceAge = provenance.date ? provenanceAgeDays(provenance.date) : null;
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
      // How much this person can move the hiring decision: hiring manager, skip-
      // level exec, functional peer, internal TA, or agency recruiter. Read from
      // a [tier:x] tag in the notes so every consumer shares one answer instead
      // of grepping the cell themselves. See lib/influence-tier.mjs.
      influenceTier,
      influenceTierSource,
      provenance,
      provenanceStale: provenanceAge !== null && provenanceAge > PROVENANCE_STALE_DAYS,
      // The hiring principal, i.e. the VP/Director/Head of the target function the
      // user would report to, NOT the TA gatekeeper. Now derived from the tier
      // rather than re-matching [principal], so the two can never disagree. An
      // untagged hiring-manager title now counts as a principal too, but that is
      // inferred from the title rather than confirmed by an explicit tag.
      isPrincipal: influenceTier === 'hm',
      verified,  // { state, source, date, score, address, hadTag }
      // LinkedIn connection axis, separate from `status` (the outreach pipeline).
      // Default 'Not Connected' when the sidecar has no entry for this id.
      linkedinStatus: (liMap[String(id)]?.state) || 'Not Connected',
      raw: line,
    });
  }
  return rows;
}

function readTTCorrespondence(id) {
  const f = path.join(TT_CORR_DIR, `${id}.md`);
  if (!fs.existsSync(f)) return [];
  return parseCorrespondence(fs.readFileSync(f, 'utf8'));
}

function writeTTCorrespondence(id, messages) {
  fs.mkdirSync(TT_CORR_DIR, { recursive: true });
  fs.writeFileSync(path.join(TT_CORR_DIR, `${id}.md`), formatCorrespondence(messages));
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
    if (updates.influenceTier !== undefined) {
      parts[15] = cell(setInfluenceTier(parts[15].trim(), updates.influenceTier));
    }
    if (updates.phone      !== undefined) parts[10] = cell(updates.phone);
    // Email cell may carry an inline [v:...] verification tag; cell() keeps it intact
    // (no pipe/newline in a tag). Used by the reconcile find-emails endpoint. When
    // the user edits the address by hand, they pass a plain email with no tag, so it
    // correctly reverts to unverified until re-checked.
    if (updates.email      !== undefined) parts[11] = cell(updates.email);
    // Identity fields — editable from the contact drawer so the user can fix data
    // in place. Column layout mirrors parseTargetTalentMd's index map.
    if (updates.company    !== undefined) parts[2]  = cell(updates.company);
    if (updates.last       !== undefined) parts[3]  = cell(updates.last);
    if (updates.first      !== undefined) parts[4]  = cell(updates.first);
    if (updates.salute     !== undefined) parts[5]  = cell(updates.salute);
    if (updates.title      !== undefined) parts[6]  = cell(updates.title);
    if (updates.city       !== undefined) parts[7]  = cell(updates.city);
    if (updates.state      !== undefined) parts[8]  = cell(updates.state);
    if (updates.zip        !== undefined) parts[9]  = cell(updates.zip);
    if (updates.linkedin   !== undefined) parts[12] = cell(updates.linkedin);
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

// Which application ids a Sent TA touch should cross-log a follow-up onto.
//
// If the caller named applications explicitly, those win verbatim — the user made
// a deliberate choice. Otherwise (the AUTO path) a Sent touch services every LIVE
// application at that company, resolved by company match and gated to
// OUTREACH_ELIGIBLE_STATUSES (applied through offer, plus a ghosted No Response).
// The gate is the point: without it a company where you have only an *evaluated*
// (not-yet-applied) row, or a closed/rejected one, would get a follow-up that
// claims outreach on an application you never sent — the inverse of the drift this
// fixes. Pure and side-effect-free so it is unit-testable without the route.
function crossLogAppNums(apps, company, explicit = []) {
  const ids = new Set(
    (Array.isArray(explicit) ? explicit : [explicit])
      .map(n => parseInt(n, 10))
      .filter(Number.isFinite),
  );
  if (ids.size > 0) return [...ids];
  for (const app of matchByCompany(apps, company, a => a.company)) {
    if (OUTREACH_ELIGIBLE_STATUSES.includes(app.status)) ids.add(app.id);
  }
  return [...ids];
}

// ── "NEW since last reconcile" baseline ──────────────────────────────────────
// Contacts are numbered by a monotonic max+1 id and reconcile is the only add
// path, so "added after the last reconcile started" == "id greater than the max
// id that existed when that reconcile opened". We persist that watermark in a
// sidecar next to the contact file. The reconcile preview (its opening step)
// stamps the current max; the queues badge any contact whose id exceeds it. The
// next reconcile re-stamps a higher watermark, so the previous batch stops being
// "new" automatically — no per-contact date column needed.
function _newStatePath() { return path.join(path.dirname(TARGET_TALENT_MD), 'tt-new-state.json'); }

function maxTTId() {
  const rows = parseTargetTalentMd();
  return rows.length ? Math.max(...rows.map(r => r.id)) : 0;
}

function getNewBaselineId() {
  try {
    const j = JSON.parse(fs.readFileSync(_newStatePath(), 'utf8'));
    return Number.isFinite(j.baselineId) ? j.baselineId : null;
  } catch { return null; }
}

function setNewBaselineId(id) {
  try { fs.writeFileSync(_newStatePath(), JSON.stringify({ baselineId: id }), 'utf8'); } catch { /* best-effort: a missing badge is not worth failing reconcile over */ }
}

// GET /api/target-talent — list all

export { parseTargetTalentMd, readTTCorrespondence, writeTTCorrespondence, updateTTLine, appendTTRows, matchByCompany, findRelatedApps, crossLogAppNums, TT_STATUSES, maxTTId, getNewBaselineId, setNewBaselineId };
