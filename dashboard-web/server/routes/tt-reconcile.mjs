import express from 'express';
import fs from 'fs';
import { parseApplicationsMd } from '../lib/applications.mjs';
import { parseTargetTalentMd, appendTTRows, updateTTLine } from '../lib/target-talent.mjs';
import { generateText, draftModel } from '../lib/anthropic.mjs';
import { normCompany, reconcilePreview } from '../lib/tt-reconcile-core.mjs';
import { TARGET_TALENT_MD } from '../config.mjs';
import { parseCsvContacts, CONTACTS_TEMPLATE_CSV } from '../lib/csv.mjs';
import { loadEnvKey } from '../../../verify-contacts.mjs';
import { findAndVerify } from '../../../find-contacts.mjs';
import { setVerifyTag } from '../../../lib/email-verify.mjs';

export const router = express.Router();

// ── Talent Acquisition Reconcile Flow ────────────────────────────────────────
// Three-step reconciliation triggered from the TA tab:
//   1) Preview — find what would change (no writes)
//   2) Discover — Claude + WebSearch for missing contacts at active companies
//   3) Apply — write archive flips and/or new contact rows
//
// ACTIVE app statuses (keep TA contacts engaged):
//   Evaluated, Applied, Responded, interview rounds, Offer (from states.yml funnel)
// CLOSED app statuses (archive related TA contacts when ALL related apps closed):
//   Rejected, Discarded, SKIP, No Response

// The archive decision + companies-needing-contacts live in
// lib/tt-reconcile-core.mjs (reconcilePreview), shared with the reconcile-ta.mjs
// CLI so the two can never drift. normCompany is imported from there too.

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
    res.json(reconcilePreview(apps, ttRows));
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

// POST /api/tt-reconcile/find-emails
// body: { ids?: [taId] }  (default: every active, non-Archived TA contact that has
// no address). Runs the find-then-verify pipeline — Hunter Email Finder into
// MillionVerifier — and writes ONLY a verified address. This is the API-feed
// replacement for the old first.last@company guess: it turns the PEOPLE that
// discover found on the web into deliverable ADDRESSES. A found address that does
// not verify is never written (the contact goes to the LinkedIn fallback instead).
router.post('/api/tt-reconcile/find-emails', async (req, res) => {
  try {
    const hkey = loadEnvKey('HUNTER_API_KEY');
    const mkey = loadEnvKey('MILLIONVERIFIER_API_KEY');
    if (!hkey || !mkey) {
      return res.status(400).json({ error: 'HUNTER_API_KEY and MILLIONVERIFIER_API_KEY must both be set in dashboard-web/.env to find + verify emails.' });
    }
    const { ids } = req.body || {};
    const idSet = Array.isArray(ids) && ids.length ? new Set(ids.map(Number)) : null;
    const rows = parseTargetTalentMd().filter(r =>
      r.status !== 'Archived' && !(r.email || '').trim() && r.first && r.last && r.company &&
      (!idSet || idSet.has(r.id)));
    const results = [];
    for (const r of rows) {
      try {
        const f = await findAndVerify(r.company, r.first, r.last, hkey, mkey);
        if (f.found && f.verify) {
          updateTTLine(r.id, { email: setVerifyTag(f.email, f.verify) });
          results.push({ id: r.id, name: `${r.first} ${r.last}`.trim(), company: r.company, email: f.email, state: f.verify.state });
        } else {
          results.push({ id: r.id, name: `${r.first} ${r.last}`.trim(), company: r.company, email: null, state: f.found ? 'unverifiable' : 'not_found' });
        }
      } catch (e) {
        results.push({ id: r.id, name: `${r.first} ${r.last}`.trim(), company: r.company, email: null, state: 'error', error: e.message });
      }
    }
    res.json({ ok: true, checked: rows.length, written: results.filter(x => x.email).length, results });
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
        // Hybrid: web search via the API key (hosted web_search tool) when a key
        // is set, else via the Claude plan's WebSearch tool. generateText returns
        // the concatenated text; we extract the JSON array from it.
        const apiCall = generateText(prompt, {
          model: draftModel(),
          maxTokens: 3000,
          tools: [{
            type: 'web_search_20260209',
            name: 'web_search',
            max_uses: 2,
            allowed_callers: ['direct'],
          }],
        });
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`discover timeout after 90s for ${companyName}`)), 90000)
        );
        const fullText = await Promise.race([apiCall, timeout]);
        console.log(`[discover] done:  ${companyName}`);
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
router.post('/api/tt-reconcile/bulk-add', async (req, res) => {
  try {
    const { contacts } = req.body || {};
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'contacts[] required' });
    }
    // Dedup by (normalized company + last + first) against existing rows
    const existing = parseTargetTalentMd();
    const existingKeys = new Set(existing.map(r => `${normCompany(r.company)}|${(r.last || '').toLowerCase()}|${(r.first || '').toLowerCase()}`));
    const toWrite = contacts.filter(c => {
      const k = `${normCompany(c.company)}|${(c.last || '').toLowerCase()}|${(c.first || '').toLowerCase()}`;
      return !existingKeys.has(k);
    });
    const written = appendTTRows(toWrite);   // [{id}], in the same order as toWrite

    // Find + verify an email for each newly-added contact via the API feeds
    // (Hunter Email Finder into MillionVerifier), and write ONLY a verified
    // address. This replaces the old first.last@company guess: a reconcile add now
    // yields a deliverable address or none (the contact goes to LinkedIn instead).
    let emailsFound = 0;
    const hkey = loadEnvKey('HUNTER_API_KEY');
    const mkey = loadEnvKey('MILLIONVERIFIER_API_KEY');
    if (hkey && mkey) {
      for (let i = 0; i < written.length; i++) {
        const c = toWrite[i];
        if ((c.email || '').trim() || !c.first || !c.last || !c.company) continue;
        try {
          const f = await findAndVerify(c.company, c.first, c.last, hkey, mkey);
          if (f.found && f.verify) { updateTTLine(written[i].id, { email: setVerifyTag(f.email, f.verify) }); emailsFound++; }
        } catch { /* leave without an address; the LinkedIn fallback covers it */ }
      }
    }
    res.json({ ok: true, requested: contacts.length, written: written.length, skipped: contacts.length - written.length, emailsFound, verifierKeys: !!(hkey && mkey) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bulk CSV import ───────────────────────────────────────────────────────────
// Dependency-free parse, map by header name, dedup vs existing, then reuse
// appendTTRows. The parser + template are shared with Recruiters (lib/csv.mjs).
const TT_HEADER = '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---------|------|-------|--------|-------|------|-------|-----|-------|-------|----------|--------|------------|-------|---------|\n';

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
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="contacts-template.csv"');
  res.send(CONTACTS_TEMPLATE_CSV);
});

// Synthesize a readable HTML summary from v1 JSON data when no markdown body exists.
// Used as Full Report fallback for JSON-only reports (batch/scan evaluations).

