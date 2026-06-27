import express from 'express';
import fs from 'fs';
import { parseApplicationsMd } from '../lib/applications.mjs';
import { parseTargetTalentMd, appendTTRows, updateTTLine } from '../lib/target-talent.mjs';
import { anthropic } from '../lib/anthropic.mjs';
import { TARGET_TALENT_MD } from '../config.mjs';

export const router = express.Router();

// ── Talent Acquisition Reconcile Flow ────────────────────────────────────────
// Three-step reconciliation triggered from the TA tab:
//   1) Preview — find what would change (no writes)
//   2) Discover — Claude + WebSearch for missing contacts at active companies
//   3) Apply — write archive flips and/or new contact rows
//
// ACTIVE app statuses (keep TA contacts engaged):
//   Evaluated, Applied, Responded, Interview, Offer
// CLOSED app statuses (archive related TA contacts when ALL related apps closed):
//   Rejected, Discarded, SKIP

const TT_ACTIVE_APP_STATUSES = ['Evaluated','Applied','Responded','Interview','Offer'];
const TT_CLOSED_APP_STATUSES = ['Rejected','Discarded','SKIP','No Response'];

function _normCompany(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// GET /api/tt-reconcile/preview
// Returns:
//   {
//     toArchive: [{ id, first, last, company, title, reason, relatedApps:[{id,status,role}] }],
//     companiesNeedingContacts: [{ company, exampleRole, appCount, mostRecentApp }]
//   }
router.get('/api/tt-reconcile/preview', (req, res) => {
  try {
    const apps = parseApplicationsMd();
    const ttRows = parseTargetTalentMd().filter(r => r.status !== 'Archived');

    // Group apps by normalized company name
    const appsByCompany = new Map();
    for (const a of apps) {
      const k = _normCompany(a.company);
      if (!k) continue;
      if (!appsByCompany.has(k)) appsByCompany.set(k, []);
      appsByCompany.get(k).push(a);
    }

    // For each TA contact, look at their company's apps. If ANY app at that
    // company is still active, keep the contact. If ALL apps are closed, archive.
    const toArchive = [];
    for (const c of ttRows) {
      const k = _normCompany(c.company);
      const companyApps = appsByCompany.get(k) || [];
      if (companyApps.length === 0) continue; // no apps logged for this company — leave alone
      const hasActive = companyApps.some(a => TT_ACTIVE_APP_STATUSES.includes(a.status));
      if (hasActive) continue;
      // All apps at this company are closed — archive
      toArchive.push({
        id: c.id,
        first: c.first,
        last: c.last,
        company: c.company,
        title: c.title,
        reason: `${companyApps.length} application${companyApps.length === 1 ? '' : 's'} closed (${companyApps.map(a => a.status).slice(0, 3).join(', ')})`,
        relatedApps: companyApps.map(a => ({ id: a.id, status: a.status, role: a.role, date: a.date })),
      });
    }

    // Find ACTIVE companies (≥1 active app) with ZERO TA contacts
    const ttCompaniesNorm = new Set(ttRows.map(c => _normCompany(c.company)));
    const companiesNeedingContacts = [];
    for (const [k, companyApps] of appsByCompany.entries()) {
      if (ttCompaniesNorm.has(k)) continue; // already has contacts
      const active = companyApps.filter(a => TT_ACTIVE_APP_STATUSES.includes(a.status));
      if (active.length === 0) continue; // company has no active apps — skip
      // Use the most recent active app as the "example role" to anchor the search
      const mostRecent = active.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
      companiesNeedingContacts.push({
        company: mostRecent.company,
        exampleRole: mostRecent.role,
        appCount: active.length,
        mostRecentApp: { id: mostRecent.id, role: mostRecent.role, status: mostRecent.status, date: mostRecent.date },
      });
    }
    // Sort by recency of most recent app
    companiesNeedingContacts.sort((a, b) => (b.mostRecentApp.date || '').localeCompare(a.mostRecentApp.date || ''));

    res.json({ toArchive, companiesNeedingContacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tt-reconcile/archive
// body: { ids: [taContactId, ...] }
// Sets status='Archived' on each. Preserves notes + correspondence.
// IMPORTANT: does NOT touch the lastTouch column. Archiving isn't outreach —
// stamping today's date would falsely make every archived contact look
// recently-contacted.
router.post('/api/tt-reconcile/archive', (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids[] required' });
    }
    let archived = 0;
    for (const id of ids) {
      const ok = updateTTLine(parseInt(id, 10), { status: 'Archived' });
      if (ok) archived++;
    }
    res.json({ ok: true, archived });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tt-reconcile/discover
// body: { companies: [{ company, exampleRole }] }
// Uses Claude to search the web for current Talent Acquisition / People-team
// employees at each company. Returns suggestions (NOT written to disk yet).
//
// Response:
//   { results: [{ company, suggestions: [{ first, last, title, city, state,
//                                          linkedin, confidence, notes }] }] }
router.post('/api/tt-reconcile/discover', async (req, res) => {
  try {
    const { companies } = req.body || {};
    if (!Array.isArray(companies) || companies.length === 0) {
      return res.status(400).json({ error: 'companies[] required' });
    }
    if (companies.length > 15) {
      return res.status(400).json({ error: 'Max 15 companies per call (rate-limit protection).' });
    }

    // Process all companies in parallel — sequential was ~5-15s × N which
    // got painful past 5 companies. With parallel + Anthropic's hosted
    // web_search tool, total wall time ≈ slowest single search.
    const discoverOne = async (c) => {
      const companyName = c.company;
      const exampleRole = c.exampleRole || '';
      if (!companyName) return null;

      const prompt = `Find 2-3 Internal Talent Acquisition / People / Recruiting employees CURRENTLY employed at ${companyName} who would be relevant for a candidate targeting business/GTM/RevOps/Operations roles (specifically: ${exampleRole}).

INSTRUCTIONS:
1. USE THE web_search TOOL to search for current TA employees at ${companyName}. Try queries like:
   - site:linkedin.com/in "${companyName}" "talent acquisition"
   - site:linkedin.com/in "${companyName}" "recruiter"
   - "${companyName}" "head of talent" OR "head of recruiting"
   - "${companyName}" careers team
2. Prioritize people whose LinkedIn profile shows ${companyName} as their CURRENT employer.
3. Prefer: Heads/Directors/Sr. Managers of Talent Acquisition · Recruiters with business/commercial focus (not engineering) · People & Talent leads.
4. Verify each person's current employer before including them — recent job changes are common.

Output ONLY a JSON array (your final response after searching), no prose, no markdown:
[
  { "first": "First", "last": "Last", "title": "Senior Talent Acquisition Partner", "city": "New York", "state": "NY", "linkedin": "https://www.linkedin.com/in/example/", "confidence": "high|medium|low", "notes": "One line on where you found them + how recent the source." }
]

Confidence rules:
- high   = LinkedIn profile shows ${companyName} as current employer (or equivalent recent source)
- medium = found on a third-party source (ZoomInfo, RocketReach, company press release) but not directly verified on LinkedIn
- low    = inferred / weak evidence

If the search returns no reliable matches, return an empty array []. Never fabricate names.`;

      try {
        console.log(`[discover] start: ${companyName}`);
        // Haiku 4.5 chosen over Sonnet 4.6 for the discover task: the hosted
        // web_search tool pulls full page snippets into input context, which
        // makes a single call blow past entry-tier Sonnet rate limits (30K
        // input-tokens-per-minute on this org). Haiku has its own rate-limit
        // pool, much higher headroom, and is plenty capable of "find 2-3 TA
        // people at company X" with structured JSON output.
        // 90-second hard cap per company — a stalled web_search must NOT hang
        // the whole batch. Promise.race rejects, the catch below logs + returns
        // an empty suggestion list, and the rest of the batch keeps going.
        const apiCall = anthropic.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 3000,
          tools: [{
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: 2,  // reduced from 4 — each search pulls a lot of input tokens
            // Haiku 4.5 doesn't support programmatic tool calling; the API
            // requires `allowed_callers: ['direct']` on web_search for this
            // model. Without it the request 400s with an invalid_request_error.
            allowed_callers: ['direct'],
          }],
          messages: [{ role: 'user', content: prompt }],
        });
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`discover timeout after 90s for ${companyName}`)), 90000)
        );
        const msg = await Promise.race([apiCall, timeout]);
        console.log(`[discover] done:  ${companyName}`);
        // Response can contain multiple content blocks: text, server_tool_use,
        // web_search_tool_result. Concatenate all text blocks then extract JSON.
        const fullText = (msg.content || [])
          .filter(b => b.type === 'text')
          .map(b => b.text || '')
          .join('\n');
        const jsonMatch = fullText.match(/\[[\s\S]*\]/);
        const suggestions = jsonMatch ? (() => { try { return JSON.parse(jsonMatch[0]); } catch { return []; } })() : [];
        return { company: companyName, exampleRole, suggestions };
      } catch (e) {
        console.log(`[discover] ERROR: ${companyName} — ${e.message}`);
        return { company: companyName, exampleRole, suggestions: [], error: e.message };
      }
    };

    // Cap in-flight discoverOne calls. Each call uses Anthropic's hosted
    // web_search tool (~4 search rounds, web content pulled into context),
    // which is heavy on input tokens per minute. Entry-tier org limits are
    // 30K ITPM for claude-sonnet-4-6 — running 15 in parallel blows past
    // that and the SDK silently waits for backpressure to clear instead of
    // returning a 429, so every call appears to hang until our 90s timeout.
    const CONCURRENCY = 3;
    const results = [];
    for (let i = 0; i < companies.length; i += CONCURRENCY) {
      const slice = companies.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(slice.map(discoverOne));
      for (const r of chunkResults) if (r) results.push(r);
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tt-reconcile/bulk-add
// body: { contacts: [{ company, first, last, title, linkedin?, city?, state?, notes? }] }
// Writes confirmed contacts to data/target-talent.md.
router.post('/api/tt-reconcile/bulk-add', (req, res) => {
  try {
    const { contacts } = req.body || {};
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'contacts[] required' });
    }
    // Dedup by (normalized company + last + first) against existing rows
    const existing = parseTargetTalentMd();
    const existingKeys = new Set(existing.map(r => `${_normCompany(r.company)}|${(r.last || '').toLowerCase()}|${(r.first || '').toLowerCase()}`));
    const toWrite = contacts.filter(c => {
      const k = `${_normCompany(c.company)}|${(c.last || '').toLowerCase()}|${(c.first || '').toLowerCase()}`;
      return !existingKeys.has(k);
    });
    const written = appendTTRows(toWrite);
    res.json({ ok: true, requested: contacts.length, written: written.length, skipped: contacts.length - written.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bulk CSV import ───────────────────────────────────────────────────────────
// The "Excel floor" for non-power users: hand-enter TA/recruiter contacts in a
// spreadsheet, save as CSV, upload. Dependency-free parse, map by header name,
// dedup vs existing, then reuse appendTTRows. Required columns: company, first,
// last, title. Optional: linkedin, city, state, notes.
function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}
function parseCsvContacts(csv) {
  const lines = csv.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]).map(h => h.toLowerCase());
  const ci = { company: header.indexOf('company'), first: header.indexOf('first'), last: header.indexOf('last'), title: header.indexOf('title'), linkedin: header.indexOf('linkedin'), city: header.indexOf('city'), state: header.indexOf('state'), notes: header.indexOf('notes') };
  if (ci.company < 0 || ci.first < 0 || ci.last < 0 || ci.title < 0) throw new Error('CSV must have columns: company, first, last, title.');
  const get = (v, i) => (i >= 0 && i < v.length ? v[i] : '');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const v = parseCsvLine(lines[i]);
    const c = { company: get(v, ci.company), first: get(v, ci.first), last: get(v, ci.last), title: get(v, ci.title), linkedin: get(v, ci.linkedin), city: get(v, ci.city), state: get(v, ci.state), notes: get(v, ci.notes) };
    if (c.company && c.first && c.last && c.title) rows.push(c);
  }
  return rows;
}
const TT_HEADER = '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes |\n|---|---------|------|-------|--------|-------|------|-------|-----|-------|-------|----------|--------|------------|-------|\n';

// POST /api/tt-reconcile/bulk-import  { csv }
router.post('/api/tt-reconcile/bulk-import', (req, res) => {
  try {
    const csv = String(req.body?.csv || '');
    if (!csv.trim()) return res.status(400).json({ error: 'A "csv" body is required.' });
    let rows;
    try { rows = parseCsvContacts(csv); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (!rows.length) return res.status(400).json({ error: 'No valid rows found (need a header row plus rows with company, first, last, title).' });
    if (!fs.existsSync(TARGET_TALENT_MD)) fs.writeFileSync(TARGET_TALENT_MD, TT_HEADER, 'utf8');
    const existing = parseTargetTalentMd();
    const existingKeys = new Set(existing.map(r => `${_normCompany(r.company)}|${(r.last || '').toLowerCase()}|${(r.first || '').toLowerCase()}`));
    const toWrite = rows.filter(c => !existingKeys.has(`${_normCompany(c.company)}|${(c.last || '').toLowerCase()}|${(c.first || '').toLowerCase()}`));
    const written = appendTTRows(toWrite);
    res.json({ ok: true, parsed: rows.length, imported: written.length, duplicates: rows.length - written.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tt-reconcile/template — downloadable CSV template with the right headers
router.get('/api/tt-reconcile/template', (req, res) => {
  const csv = 'company,first,last,title,linkedin,city,state,notes\n'
    + 'Acme Corp,Sarah,Johnson,Senior Talent Acquisition Partner,https://www.linkedin.com/in/example,San Francisco,CA,Found via LinkedIn\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="contacts-template.csv"');
  res.send(csv);
});

// Synthesize a readable HTML summary from v1 JSON data when no markdown body exists.
// Used as Full Report fallback for JSON-only reports (batch/scan evaluations).

