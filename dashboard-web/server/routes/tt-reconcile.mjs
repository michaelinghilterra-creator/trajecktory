import express from 'express';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import { parseApplicationsMd } from '../lib/applications.mjs';
import { parseTargetTalentMd, appendTTRows, updateTTLine, maxTTId, setNewBaselineId } from '../lib/target-talent.mjs';
import { discoverTalentAtCompany, discoverPrincipalAtCompany } from '../lib/contact-discovery.mjs';
import { normCompany, reconcilePreview } from '../lib/tt-reconcile-core.mjs';
import { TARGET_TALENT_MD } from '../config.mjs';
import { parseCsvContacts, CONTACTS_TEMPLATE_CSV } from '../lib/csv.mjs';
import { loadEnvKey } from '../../../verify-contacts.mjs';
import { findAndVerify, hunterSearchesLeft, millionVerifierCreditsLeft, planFindBudget, DEFAULT_FIND_LIMIT } from '../../../find-contacts.mjs';
import { hunterDomainSearch, planDomainBudget } from '../../../lib/hunter-domain.mjs';
import { setVerifyTag } from '../../../lib/email-verify.mjs';
import { mergeStakeholderAdditions, validateStakeholder, knownDomainKey } from '../../../lib/stakeholder-additions.mjs';
import { readReconcileDismissed, addReconcileDismissed } from '../lib/sidecars.mjs';

export const router = express.Router();

function localDate(date = new Date()) {
  // Provenance follows the user's local calendar. UTC is already the next day
  // during part of the US evening, which would stamp a contact with tomorrow.
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function bareHostname(website) {
  const value = String(website || '').trim();
  if (!value) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.hostname.toLowerCase().replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

// ── Talent Acquisition Reconcile Flow ────────────────────────────────────────
// Three-step reconciliation triggered from the TA tab:
//   1) Preview — find what would change (no writes)
//   2) Discover — Claude + WebSearch for missing contacts at active companies
//   3) Apply — write archive flips and/or new contact rows
//
// KEEP app statuses (keep TA contacts engaged):
//   Evaluated, Applied, Responded, interview rounds, Offer (the funnel), PLUS
//   No Response — a ghosted app is still worth chasing via a TA contact, and the
//   connect/email queues already treat it as applied, so reconcile agrees.
// DEAD app statuses (archive related TA contacts when ALL related apps are dead):
//   Rejected, Discarded, SKIP, Closed

// The archive decision + companies-needing-contacts live in
// lib/tt-reconcile-core.mjs (reconcilePreview), shared with the reconcile-ta.mjs
// CLI so the two can never drift. normCompany is imported from there too.

const MAX_DISCOVER_COMPANIES = 15;
const DISCOVER_CONCURRENCY = 3;
const DISCOVER_COMPANY_TIMEOUT_MS = 90_000;
const DISCOVER_REQUEST_OVERHEAD_MS = 30_000;
// These are the only routes here that hold a request open for minutes, so their
// timeout is an explicit route decision instead of weakening the server default.
// 15 companies / concurrency 3 = 5 rounds; 5 * 90 seconds = 450 seconds, plus
// 30 seconds for request and response overhead. The proper long-term shape is
// the agent route pattern: return a jobId immediately and let the client poll.
const DISCOVER_REQUEST_TIMEOUT_MS =
  Math.ceil(MAX_DISCOVER_COMPANIES / DISCOVER_CONCURRENCY) * DISCOVER_COMPANY_TIMEOUT_MS
  + DISCOVER_REQUEST_OVERHEAD_MS;

// Discovery jobs intentionally live only in memory. A dashboard restart may
// lose an in-flight record, but results are available to apply as each company
// lands, so a long run does not strand all of its useful work until the end.
const discoverJobs = new Map();

function dismissKey({ company, first, last }) {
  return `${normCompany(company)}|${(last || '').toLowerCase().trim()}|${(first || '').toLowerCase().trim()}`;
}

async function runDiscoverJob(job, tasks, generate) {
  const dismissed = readReconcileDismissed();
  let next = 0;
  const active = new Map();
  const settled = new Set();
  const refreshCurrent = () => { job.current = [...active.values()]; };
  const worker = async () => {
    while (next < tasks.length) {
      const taskIndex = next++;
      const task = tasks[taskIndex];
      active.set(taskIndex, task.company);
      refreshCurrent();
      try {
        // Request data never spreads into options, or future options would become externally settable.
        const result = task.search === 'principal'
          ? await discoverPrincipalAtCompany({ company: task.company, exampleRole: task.exampleRole, generate })
          : await discoverTalentAtCompany({ company: task.company, exampleRole: task.exampleRole, generate });
        if (result.error) {
          job.errors.push({ company: task.company, error: result.error });
          continue;
        }
        job.results.push({
          company: task.company,
          search: task.search,
          suggestions: (result.suggestions || []).filter(suggestion => !dismissed.has(dismissKey({ company: task.company, ...suggestion }))),
          rejected: [],
          duplicates: 0,
        });
      } catch (err) {
        job.errors.push({ company: task.company, error: err.message });
      } finally {
        settled.add(taskIndex);
        active.delete(taskIndex);
        refreshCurrent();
        job.done += 1;
      }
    }
  };

  // There is no batch here because no HTTP request waits for completion. The
  // three workers exist only to respect the upstream rate limit.
  try {
    await Promise.all(Array.from({ length: Math.min(DISCOVER_CONCURRENCY, tasks.length) }, () => worker()));
  } catch (err) {
    // Company failures are handled inside each worker. This fallback accounts
    // for every untouched task if the worker machinery itself ever fails.
    tasks.forEach((task, index) => {
      if (settled.has(index)) return;
      job.errors.push({ company: task.company, error: err.message });
      job.done += 1;
    });
  }
  job.current = [];
  job.status = 'done';
  job.finishedAt = Date.now();
}

router.post('/api/tt-reconcile/dismiss', (req, res) => {
  try {
    const suggestions = req.body?.suggestions;
    if (!Array.isArray(suggestions)) return res.status(400).json({ error: 'suggestions[] required' });
    const keys = suggestions.map(dismissKey);
    addReconcileDismissed(keys);
    res.json({ dismissed: keys.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function verifyEmailsInBackground(written, toWrite, hkey, mkey) {
  let budget = await hunterSearchesLeft(hkey);
  if (budget == null) budget = Infinity;
  for (let i = 0; i < written.length; i++) {
    const c = toWrite[i];
    if ((c.email || '').trim() || !c.first || !c.last || !c.company) continue;
    if (budget <= 0) break;
    try {
      const found = await findAndVerify(c.company, c.first, c.last, hkey, mkey);
      budget -= 1;
      if (found.found && found.verify) updateTTLine(written[i].id, { email: setVerifyTag(found.email, found.verify) });
    } catch { /* leave without an address; the LinkedIn fallback covers it */ }
  }
}

// GET /api/tt-reconcile/discover-run
// Reattaches the wizard to the most recently started running discovery.
router.get('/api/tt-reconcile/discover-run', (req, res) => {
  const running = [...discoverJobs.values()]
    .filter(job => job.status === 'running')
    .sort((a, b) => b.startedAt - a.startedAt)[0] || null;
  res.json(running);
});

// GET /api/tt-reconcile/discover-run/:jobId
router.get('/api/tt-reconcile/discover-run/:jobId', (req, res) => {
  const job = discoverJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Discovery job not found.' });
  res.json(job);
});

// POST /api/tt-reconcile/discover-run
// Starts the whole reconcile discovery and returns before model work finishes.
router.post('/api/tt-reconcile/discover-run', (req, res) => {
  const running = [...discoverJobs.values()].find(job => job.status === 'running');
  if (running) return res.status(409).json({ error: 'A discovery run is already running.', jobId: running.jobId });
  try {
    const { talent = [], principal = [] } = req.body || {};
    if (!Array.isArray(talent) || !Array.isArray(principal)) {
      return res.status(400).json({ error: 'talent[] and principal[] are required.' });
    }
    const tasks = [
      ...talent.filter(item => item?.company).map(item => ({ ...item, search: 'talent' })),
      ...principal.filter(item => item?.company).map(item => ({ ...item, search: 'principal' })),
    ];
    if (tasks.length === 0) return res.status(400).json({ error: 'At least one company is required.' });

    const jobId = randomUUID();
    const job = {
      jobId,
      status: 'running',
      total: tasks.length,
      done: 0,
      current: [],
      results: [],
      errors: [],
      startedAt: Date.now(),
      finishedAt: null,
    };
    discoverJobs.set(jobId, job);
    try {
      void runDiscoverJob(job, tasks, req.app.locals.generate);
    } catch (err) {
      job.status = 'error';
      job.errors.push({ company: '', error: err.message });
      job.finishedAt = Date.now();
    }
    res.json({ jobId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tt-reconcile/preview
// Returns:
//   {
//     toArchive: [{ id, first, last, company, title, reason, relatedApps:[{id,status,role}] }],
//     companiesNeedingContacts: [{ company, exampleRole, appCount, mostRecentApp }],
//     companiesNeedingPrincipal: [{ company, exampleRole, appCount, mostRecentApp }]
//   }
router.get('/api/tt-reconcile/preview', (req, res) => {
  try {
    // Preview is read-only: it must NOT stamp the "NEW since last reconcile"
    // watermark, or opening it just to look would strip the NEW badges off the
    // previous batch's un-worked contacts. The watermark is now snapshotted in
    // /bulk-add, right before contacts are actually written (see there).
    const apps = parseApplicationsMd();
    const ttRows = parseTargetTalentMd().filter(r => r.status !== 'Archived');
    const mode = req.query.mode === 'talent' || req.query.mode === 'principal'
      ? req.query.mode : undefined;
    res.json(reconcilePreview(apps, ttRows, { mode }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tt-reconcile/credit-balances
// Live Hunter (email-finder search credits) and MillionVerifier (verification
// credits) balances so the user knows when to top up before a reconcile drains
// them. Each is { configured, left }: configured=false means no key set;
// left=null means the key is set but the balance could not be read right now.
router.get('/api/tt-reconcile/credit-balances', async (req, res) => {
  try {
    const hkey = loadEnvKey('HUNTER_API_KEY');
    const mkey = loadEnvKey('MILLIONVERIFIER_API_KEY');
    const [hunter, mv] = await Promise.all([
      hkey ? hunterSearchesLeft(hkey) : Promise.resolve(null),
      mkey ? millionVerifierCreditsLeft(mkey) : Promise.resolve(null),
    ]);
    res.json({
      hunter: { configured: !!hkey, left: hunter },
      millionVerifier: { configured: !!mkey, left: mv },
      domainSearchCost: { creditsPerCompany: 1, note: 'One search credit per company, whatever the number of people it returns.' },
    });
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
    const { ids, limit } = req.body || {};
    const idSet = Array.isArray(ids) && ids.length ? new Set(ids.map(Number)) : null;
    const rows = parseTargetTalentMd().filter(r =>
      r.status !== 'Archived' && !(r.email || '').trim() && r.first && r.last && r.company &&
      (!idSet || idSet.has(r.id)));

    // Budget guardrail: each contact = one Hunter search credit (found or not),
    // free tier 50/month. A no-ids click used to run EVERY addressless contact
    // and could drain the tier in one go. Cap to the smaller of remaining
    // credits and a per-run size: honor an explicit id selection or a body
    // `limit`, else the small default. See find-contacts.planFindBudget.
    const creditsLeft = await hunterSearchesLeft(hkey);
    const wanted = idSet ? rows.length : (Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_FIND_LIMIT);
    const cap = planFindBudget({ needed: rows.length, limit: wanted, creditsLeft });
    const toRun = rows.slice(0, cap);

    const results = [];
    for (const r of toRun) {
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
    res.json({
      ok: true, checked: toRun.length, written: results.filter(x => x.email).length,
      needing: rows.length, skippedForBudget: rows.length - toRun.length,
      creditsBefore: creditsLeft, creditsSpent: toRun.length, results,
    });
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
  req.setTimeout(DISCOVER_REQUEST_TIMEOUT_MS);
  try {
    const { companies } = req.body || {};
    if (!Array.isArray(companies) || companies.length === 0) {
      return res.status(400).json({ error: 'companies[] required' });
    }
    if (companies.length > MAX_DISCOVER_COMPANIES) {
      return res.status(400).json({ error: `Max ${MAX_DISCOVER_COMPANIES} companies per call (rate-limit protection).` });
    }

    // Cap in-flight discoverOne calls. Each call uses Anthropic's hosted
    // web_search tool (~4 search rounds, web content pulled into context),
    // which is heavy on input tokens per minute. Entry-tier org limits are
    // 30K ITPM for claude-sonnet-4-6 — running 15 in parallel blows past
    // that and the SDK silently waits for backpressure to clear instead of
    // returning a 429, so every call appears to hang until our 90s timeout.
    const results = [];
    for (let i = 0; i < companies.length; i += DISCOVER_CONCURRENCY) {
      const slice = companies.slice(i, i + DISCOVER_CONCURRENCY);
      const chunkResults = await Promise.all(slice.map(c => {
        if (!c.company) return null;
        return discoverTalentAtCompany({ company: c.company, exampleRole: c.exampleRole, generate: req.app.locals.generate });
      }));
      for (const r of chunkResults) if (r) results.push(r);
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tt-reconcile/discover-principal
// body: { companies: [{ company, exampleRole }] }
// Like /discover but targets HIRING PRINCIPALS — the VP/Director/Head of the
// target function the user would report to — NOT the TA/recruiting gatekeeper.
// Returns suggestions with the same shape as /discover so the same bulk-add UI
// can accept them. A [principal] tag is added to each suggestion's notes field
// so the contact is stamped on write.
//
// Response: { results: [{ company, suggestions: [{first,last,title,city,state,
//                          linkedin,confidence,notes}] }] }
router.post('/api/tt-reconcile/discover-principal', async (req, res) => {
  req.setTimeout(DISCOVER_REQUEST_TIMEOUT_MS);
  try {
    const { companies } = req.body || {};
    if (!Array.isArray(companies) || companies.length === 0) {
      return res.status(400).json({ error: 'companies[] required' });
    }
    if (companies.length > MAX_DISCOVER_COMPANIES) {
      return res.status(400).json({ error: `Max ${MAX_DISCOVER_COMPANIES} companies per call.` });
    }

    const results = [];
    for (let i = 0; i < companies.length; i += DISCOVER_CONCURRENCY) {
      const slice = companies.slice(i, i + DISCOVER_CONCURRENCY);
      const chunkResults = await Promise.all(slice.map(c => {
        if (!c.company) return null;
        return discoverPrincipalAtCompany({ company: c.company, exampleRole: c.exampleRole, generate: req.app.locals.generate });
      }));
      for (const r of chunkResults) if (r) results.push(r);
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tt-reconcile/discover-hunter
// body: { companies: [{ company, domain? }], limit? }
// Uses Hunter Domain Search to propose people from a structured directory. It
// never writes. The separate bulk-add route remains the only write boundary.
router.post('/api/tt-reconcile/discover-hunter', async (req, res) => {
  try {
    const { companies, limit } = req.body || {};
    if (!Array.isArray(companies) || companies.length === 0) {
      return res.status(400).json({ error: 'companies[] required' });
    }
    if (companies.length > 15) {
      return res.status(400).json({ error: 'Max 15 companies per call.' });
    }

    const hkey = loadEnvKey('HUNTER_API_KEY');
    if (!hkey) {
      return res.status(400).json({ error: 'HUNTER_API_KEY must be set in dashboard-web/.env to search company directories.' });
    }

    const existingRows = parseTargetTalentMd();
    const existingDomains = new Map();
    for (const row of existingRows) {
      const domain = bareHostname(row.website);
      const companyKey = normCompany(row.company);
      if (companyKey && domain && !existingDomains.has(companyKey)) existingDomains.set(companyKey, domain);
    }

    const unresolved = [];
    const resolved = [];
    for (const entry of companies) {
      const company = String(entry?.company || '').trim();
      const suppliedDomain = String(entry?.domain || '').trim();
      const domain = suppliedDomain
        ? bareHostname(suppliedDomain)
        : existingDomains.get(normCompany(company));
      if (!domain) unresolved.push(company);
      else resolved.push({ company, domain });
    }

    const creditsBefore = await hunterSearchesLeft(hkey);
    const cap = planDomainBudget({ needed: resolved.length, limit, creditsLeft: creditsBefore });
    const toSearch = resolved.slice(0, cap);
    const skippedBudget = resolved.slice(cap).map(entry => entry.company);
    const today = localDate();

    const discoverOne = async ({ company, domain }) => {
      try {
        const found = await hunterDomainSearch(domain, hkey);
        const candidates = found.candidates.map(candidate => ({
          first: candidate.first,
          last: candidate.last,
          company,
          title: candidate.title,
          linkedin: candidate.linkedin,
          email: candidate.email,
          sourceCount: candidate.sourceCount,
          source: 'hunter',
        }));
        // Key with the gate's own normalizer, not normCompany: they differ on legal
        // suffixes, and a mismatched key would drop the domain check silently.
        const knownDomains = { [knownDomainKey(company)]: domain };
        const merged = mergeStakeholderAdditions(candidates, {
          today,
          existingRows,
          knownDomains,
        });
        return {
          company,
          domain,
          suggestions: merged.people,
          rejected: merged.rejected,
          duplicates: merged.duplicates,
        };
      } catch (error) {
        return { company, domain, suggestions: [], rejected: [], duplicates: 0, error: String(error?.message || error) };
      }
    };

    // Match the other discovery routes so a large request does not create an
    // unbounded burst, while one failed company cannot discard its neighbours.
    const CONCURRENCY = 3;
    const results = [];
    for (let i = 0; i < toSearch.length; i += CONCURRENCY) {
      const chunk = await Promise.all(toSearch.slice(i, i + CONCURRENCY).map(discoverOne));
      results.push(...chunk);
    }

    // The UI sends accepted suggestions to bulk-add with source hunter. Running
    // validation twice is deliberate because the write path must never trust a
    // caller's claim that data was validated earlier.
    res.json({
      results,
      creditsBefore,
      creditsSpent: toSearch.length,
      unresolved,
      skippedBudget,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tt-reconcile/bulk-add
// body: { contacts: [{ company, first, last, title, linkedin?, city?, state?, notes? }] }
// Writes confirmed contacts to data/target-talent.md.
router.post('/api/tt-reconcile/bulk-add', async (req, res) => {
  try {
    const { contacts, source } = req.body || {};
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'contacts[] required' });
    }
    const requestSource = String(source || '').toLowerCase();
    const gated = requestSource === 'agent' || requestSource === 'hunter';
    // Existing callers without a source are hand-entry flows. Unknown values
    // stay ungated so adding this opt-in machine guard cannot refuse their writes.
    // Machine callers must opt in, and a future audit should confirm all do so.
    const existing = parseTargetTalentMd();
    const rejected = [];
    let candidates = contacts;
    if (gated) {
      const today = localDate();
      candidates = [];
      for (const contact of contacts) {
        const existingAtCompany = existing.find(row =>
          normCompany(row.company) === normCompany(contact?.company) && bareHostname(row.website));
        const knownDomain = existingAtCompany ? bareHostname(existingAtCompany.website) : undefined;
        const validation = validateStakeholder({
          ...contact,
          source: contact?.source || requestSource,
        }, { today, knownDomain });
        if (!validation.ok) {
          rejected.push({
            name: `${contact?.first || ''} ${contact?.last || ''}`.trim(),
            company: String(contact?.company || ''),
            reasons: validation.reasons,
          });
          continue;
        }
        candidates.push(validation.person);
      }
    }
    // Dedup by (normalized company + last + first) against existing rows
    const existingKeys = new Set(existing.map(r => `${normCompany(r.company)}|${(r.last || '').toLowerCase()}|${(r.first || '').toLowerCase()}`));
    const toWrite = candidates.filter(c => {
      const k = `${normCompany(c.company)}|${(c.last || '').toLowerCase()}|${(c.first || '').toLowerCase()}`;
      return !existingKeys.has(k);
    });
    // Snapshot the "NEW since last reconcile" watermark HERE, just before writing,
    // so the rows we are about to add (higher ids) read as NEW and the previous
    // batch stops being new. Guarded on toWrite.length so an all-duplicate add
    // does not needlessly advance the watermark.
    if (toWrite.length) setNewBaselineId(maxTTId());
    const written = appendTTRows(toWrite);   // [{id}], in the same order as toWrite
    if (written.length) addReconcileDismissed(toWrite.map(dismissKey));

    const hkey = loadEnvKey('HUNTER_API_KEY');
    const mkey = loadEnvKey('MILLIONVERIFIER_API_KEY');
    res.json({
      ok: true, requested: contacts.length, written: written.length,
      skipped: contacts.length - written.length, rejected, gated,
      verifierKeys: !!(hkey && mkey),
      emailVerification: (hkey && mkey) ? 'running' : 'skipped',
    });
    if (hkey && mkey) verifyEmailsInBackground(written, toWrite, hkey, mkey).catch(() => {});
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
    const existingKeys = new Set(existing.map(r => `${normCompany(r.company)}|${(r.last || '').toLowerCase()}|${(r.first || '').toLowerCase()}`));
    const toWrite = rows.filter(c => !existingKeys.has(`${normCompany(c.company)}|${(c.last || '').toLowerCase()}|${(c.first || '').toLowerCase()}`));
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

