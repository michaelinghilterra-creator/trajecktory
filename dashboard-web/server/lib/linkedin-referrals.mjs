// linkedin-referrals.mjs — the LinkedIn connections "haystack" + the reconcile
// motion that promotes warm paths into the referral tracker.
//
// Two layers, deliberately separate:
//   - data/linkedin-connections.json  the raw ~7k export (gitignored). Refreshed
//     when the user uploads a new LinkedIn CSV. Never shown as a worklist.
//   - data/referrals.md               the curated list the user actually works.
//     reconcile() promotes MATCHES from the haystack into it.
//
// Reconcile is the same shape as the TA reconcile motion: a stored dataset
// re-scanned against the live pipeline so a JD sourced tomorrow surfaces the
// warm path you already have, at zero cost. Shared by the CLI
// (match-linkedin-referrals.mjs) and the dashboard routes so there is one engine.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../config.mjs';
import { ACTIVE_STATUSES } from './statuses.mjs';
import { parseApplicationsMd } from './applications.mjs';
import { parseReferralsMd, appendReferralRows } from './referrals.mjs';

export const LINKEDIN_STORE = path.join(ROOT_DIR, 'data', 'linkedin-connections.json');

const norm = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
// Titles that make a connection a plausible REFERRER (Stage 2): a senior or
// director-level operator in the user's function, who can refer or hear of
// openings. Deliberately excludes bare ICs.
const SENIOR = /\b(chief|c[a-z]o|svp|evp|vp|vice president|head of|founder|owner|partner)\b/i;
const DIRECTOR = /\bdirector\b/i;
// GTM/revenue function only. Deliberately NOT bare "operations" — that pulls in
// technical ops, customer ops, manufacturing ops, none of which refer into a
// RevOps role. Specific revenue/sales/business-ops terms stay.
const FUNC = /revenue oper|revops|rev ops|sales oper|salesops|business oper|gtm|go[- ]to[- ]market|revenue|enablement|sales strateg|business intelligence|\banalytics\b|deal desk/i;

// LinkedIn "Company" strings rarely match a tracker company byte-for-byte, so
// accept the full normalized name plus a form with a trailing generic word
// dropped (" Labs", " Inc", " Technologies"). NOT stripping "Security/Health/
// Systems" etc. on purpose: stripping "Security" would fold a company like
// "Acme Security" into "Acme", a different company entirely.
const stripGeneric = (c) => c.replace(/\s+(labs|inc|technologies|software|hq)\.?$/i, '');
function companyForms(company) {
  const forms = new Set([norm(company), norm(stripGeneric(company))]);
  return [...forms].filter((f) => f.length >= 4);
}

// ── active pipeline companies (the targets a warm path is worth having) ──────
export function activeCompanies() {
  const seen = new Map(); // display company -> {company, role}
  for (const r of parseApplicationsMd()) {
    if (!ACTIVE_STATUSES.includes(r.status)) continue;
    if (!r.company || seen.has(r.company)) continue;
    seen.set(r.company, { company: r.company, role: r.role || '' });
  }
  return [...seen.values()];
}

// form -> {company, role}, and the flat set of active forms (for stage tagging)
function activeFormIndex(active = activeCompanies()) {
  const map = new Map();
  const set = new Set();
  for (const a of active) for (const f of companyForms(a.company)) { map.set(f, a); set.add(f); }
  return { map, set };
}

// Stage of a referral ROW, derived live (never stored): a LinkedIn-sourced
// referral whose current company is an active target is Stage 1; any other
// LinkedIn-sourced referral is Stage 2; a manually-added referral is "other".
// Derivation (not a stored column) is what makes a Stage-2 contact auto-promote
// to Stage 1 the moment you source a JD at their company.
export function stageForRow(row, activeSet) {
  const isLinkedIn = /linkedin/i.test(row.how || '') || /linkedin\.com/i.test(row.notes || '');
  if (!isLinkedIn) return 'other';
  return activeSet.has(norm(row.where)) ? 'stage1' : 'stage2';
}
export function activeFormSet() { return activeFormIndex().set; }

// ── the haystack ────────────────────────────────────────────────────────────
export function parseConnectionsCsv(text) {
  const rows = []; let i = 0, field = '', row = [], inQ = false;
  const pushF = () => { row.push(field); field = ''; };
  const pushR = () => { pushF(); rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i];
    if (inQ) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
    else { if (ch === '"') inQ = true; else if (ch === ',') pushF(); else if (ch === '\n') pushR(); else if (ch === '\r') { /* skip */ } else field += ch; }
    i++;
  }
  if (field.length || row.length) pushR();
  const hi = rows.findIndex((r) => r[0] === 'First Name');
  if (hi === -1) return [];
  const h = rows[hi];
  const ix = (n) => h.indexOf(n);
  const [f, l, u, e, co, po, on] = ['First Name', 'Last Name', 'URL', 'Email Address', 'Company', 'Position', 'Connected On'].map(ix);
  return rows.slice(hi + 1)
    .filter((r) => (r[f] || r[l]))
    .map((r) => ({ first: r[f] || '', last: r[l] || '', url: r[u] || '', email: r[e] || '', company: r[co] || '', position: r[po] || '', on: r[on] || '' }));
}

export function saveConnections(connections, source = 'upload') {
  const payload = { importedAt: new Date().toISOString(), source, count: connections.length, connections };
  fs.mkdirSync(path.dirname(LINKEDIN_STORE), { recursive: true });
  fs.writeFileSync(LINKEDIN_STORE, JSON.stringify(payload), 'utf8');
  return payload;
}
export function loadConnections() {
  try { return JSON.parse(fs.readFileSync(LINKEDIN_STORE, 'utf8')); }
  catch { return { importedAt: null, source: null, count: 0, connections: [] }; }
}
export function linkedinStatus() {
  const s = loadConnections();
  return { count: s.count || (s.connections || []).length, importedAt: s.importedAt || null, source: s.source || null };
}

// ── the match ───────────────────────────────────────────────────────────────
// Returns { stage1, stage2 } lists of connections not already in the referral
// tracker. stage1 = inside an active company; stage2 = senior/director referrer
// elsewhere.
export function matchConnections({ connections, active = activeCompanies(), existing = existingReferralKeys() }) {
  const { map } = activeFormIndex(active);
  const seenInBatch = new Set();
  const dupe = (c) => {
    const nm = norm(`${c.first} ${c.last}`);
    const url = (c.url && c.url.trim()) ? c.url.trim().toLowerCase() : null;
    // A LinkedIn URL is the reliable identity. When the connection has one, dedup
    // on URL ONLY — matching on name would drop a distinct person who happens to
    // share a name with an existing referral (a real warm path silently lost).
    // Fall back to name matching only when there is no URL to key on. (Tradeoff:
    // re-importing a urless existing referral that now carries a URL can create
    // one visible duplicate row, which is far cheaper than dropping a warm path.)
    if (url) {
      if (existing.urls.has(url) || seenInBatch.has(url)) return true;
      seenInBatch.add(url); return false;
    }
    if (existing.names.has(nm) || seenInBatch.has(nm)) return true;
    seenInBatch.add(nm); return false;
  };
  const stage1 = [], stage2 = [];
  for (const c of connections) {
    const hit = map.get(norm(c.company));
    if (hit) { if (!dupe(c)) stage1.push({ ...c, target: hit }); continue; }
    const senior = (SENIOR.test(c.position) || DIRECTOR.test(c.position)) && FUNC.test(c.position);
    if (senior && !dupe(c)) stage2.push(c);
  }
  return { stage1, stage2 };
}

function existingReferralKeys() {
  const names = new Set(), urls = new Set();
  for (const r of parseReferralsMd()) {
    names.add(norm(r.name));
    const m = (r.notes || '').match(/https?:\/\/[^\s|]+/i);
    if (m) urls.add(m[0].trim().toLowerCase());
  }
  return { names, urls };
}

// ── the reconcile motion ────────────────────────────────────────────────────
// Promote NEW matches from the haystack into referrals.md. Stage 1 (paths into
// active targets) always; Stage 2 (senior referrer pool) only when seedPool is
// set — the recurring reconcile after a scan should not re-flood the worklist
// with the whole pool, but the initial import should seed it once.
export function reconcile({ seedPool = false } = {}) {
  const store = loadConnections();
  const connections = store.connections || [];
  const active = activeCompanies();
  const { stage1, stage2 } = matchConnections({ connections, active });
  const toRow = (c, target) => ({
    name: `${c.first} ${c.last}`.trim(),
    how: '1st-degree LinkedIn connection',
    where: c.company,
    target: target ? `${target.company} — ${target.role}` : '',
    status: 'Not Asked',
    lastTouch: '',
    notes: `${c.position || ''}${c.position ? ' · ' : ''}${c.url}${c.on ? ` · connected ${c.on}` : ''}`.trim(),
  });
  const rows = stage1.map((c) => toRow(c, c.target));
  if (seedPool) rows.push(...stage2.map((c) => toRow(c, null)));
  if (rows.length) appendReferralRows(rows);
  return {
    connections: connections.length,
    activeCompanies: active.length,
    stage1Added: stage1.length,
    stage2Added: seedPool ? stage2.length : 0,
    stage2Available: stage2.length,
  };
}
