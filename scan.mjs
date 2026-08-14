#!/usr/bin/env node

/**
 * scan.mjs — Zero-token portal scanner
 *
 * Fetches Greenhouse, Ashby, and Lever APIs directly, applies title
 * filters from portals.yml, deduplicates against existing history,
 * and appends new offers to pipeline.md + scan-history.tsv.
 *
 * Zero Claude API tokens — pure HTTP + JSON.
 *
 * Usage:
 *   node scan.mjs                        # scan all enabled companies
 *   node scan.mjs --dry-run              # preview without writing files
 *   node scan.mjs --company Cohere       # scan a single company
 *   node scan.mjs --max-age-days 30      # stricter age filter (default: 60)
 *   node scan.mjs --no-age-filter        # disable age filter entirely
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { pathToFileURL } from 'url';
import yaml from 'js-yaml';
import { buildTitleFilter, buildLocationFilter, normalizeUrl, scoreOffer } from './lib/scan-core.mjs';
import { sanitizeCell } from './lib/sanitize-cell.mjs';
const parseYaml = yaml.load;

// ── Config ──────────────────────────────────────────────────────────

const PORTALS_PATH = 'portals.yml';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const PIPELINE_PATH = 'data/pipeline.md';
const APPLICATIONS_PATH = 'data/applications.md';

// Ensure required directories exist (fresh setup)
mkdirSync('data', { recursive: true });

const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 10_000;

// TEST CAP (temporary): when TJK_TEST_LIMIT is set (e.g. a line in
// dashboard-web/.env), only the first N new offers are written to the pipeline,
// so a test run does not flood it and the Evaluate Pipeline that follows does
// not burn through Claude usage. Inert in production when the env var is unset.
// Remove the env var (or this block) to restore full scans.
const TEST_LIMIT = parseInt(process.env.TJK_TEST_LIMIT, 10) || 0;

// ── API detection ───────────────────────────────────────────────────

function detectApi(company) {
  // Greenhouse: explicit api field
  if (company.api && company.api.includes('greenhouse')) {
    // ?content=true returns the full JD body per job, which the location filter
    // greps for a "remote" signal (a remote role listing only its HQ city would
    // otherwise be geo-blocked as out-of-region).
    const api = company.api.includes('content=true')
      ? company.api
      : company.api + (company.api.includes('?') ? '&' : '?') + 'content=true';
    return { type: 'greenhouse', url: api };
  }

  const url = company.careers_url || '';

  // Ashby
  const ashbyMatch = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/);
  if (ashbyMatch) {
    return {
      type: 'ashby',
      url: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}?includeCompensation=true`,
    };
  }

  // Lever
  const leverMatch = url.match(/jobs\.lever\.co\/([^/?#]+)/);
  if (leverMatch) {
    return {
      type: 'lever',
      url: `https://api.lever.co/v0/postings/${leverMatch[1]}`,
    };
  }

  // Greenhouse EU boards
  const ghEuMatch = url.match(/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/);
  if (ghEuMatch && !company.api) {
    return {
      type: 'greenhouse',
      url: `https://boards-api.greenhouse.io/v1/boards/${ghEuMatch[1]}/jobs?content=true`,
    };
  }

  // Workday: detect from myworkdayjobs.com URL
  // Pattern: https://{tenant}.{shard}.myworkdayjobs.com/{site}
  const wdMatch = url.match(/([^./]+)\.(wd\d+)\.myworkdayjobs\.com\/([^?#/][^?#]*)/);
  if (wdMatch) {
    const [, tenant, shard, site] = wdMatch;
    const sitePath = site.replace(/\/$/, '');
    const baseUrl = `https://${tenant}.${shard}.myworkdayjobs.com`;
    return {
      type: 'workday',
      url: `${baseUrl}/wday/cxs/${tenant}/${sitePath}/jobs`,
      meta: { baseUrl },
    };
  }

  // SmartRecruiters: careers.smartrecruiters.com/{id} or jobs.smartrecruiters.com/{id}/…
  // Public postings API is paginated (like Workday) — see fetchSmartRecruitersJobs.
  const srMatch = url.match(/smartrecruiters\.com\/([^/?#]+)/i);
  if (srMatch && !/^(www|jobs|careers|api)$/i.test(srMatch[1])) {
    const companyId = srMatch[1];
    return {
      type: 'smartrecruiters',
      url: `https://api.smartrecruiters.com/v1/companies/${companyId}/postings`,
      meta: { companyId },
    };
  }

  // Workable: apply.workable.com/{slug} or {slug}.workable.com. The public widget
  // API returns the whole board in one call (no auth).
  const wkApply = url.match(/apply\.workable\.com\/([^/?#]+)/i);
  const wkSub = url.match(/https?:\/\/([^./]+)\.workable\.com/i);
  const workableSlug = wkApply ? wkApply[1]
    : (wkSub && !/^(apply|www)$/i.test(wkSub[1]) ? wkSub[1] : null);
  if (workableSlug) {
    return {
      type: 'workable',
      url: `https://apply.workable.com/api/v1/widget/accounts/${workableSlug}?details=true`,
    };
  }

  return null;
}

// Which ATS a company sits on when detectApi() could NOT reach it. Used only for
// the skipped-coverage report, so an unrecognized host is a fine answer: the point
// is to separate "one parser away" from "bespoke page, nothing to build".
const SKIP_PLATFORMS = [
  [/jobvite\.com/i, 'Jobvite'],
  [/icims\.com/i, 'iCIMS'],
  [/recruitee\.com/i, 'Recruitee'],
  [/breezy\.hr/i, 'Breezy'],
  [/rippling(?:ats)?\.com/i, 'Rippling'],
  [/bamboohr\.com/i, 'BambooHR'],
  [/teamtailor\.com/i, 'Teamtailor'],
  [/(?:paylocity|adp|hirebridge|ultipro|dayforce)\./i, 'HR suite'],
];

function skipPlatform(company) {
  const u = `${company.careers_url || ''} ${company.api || ''}`;
  for (const [re, name] of SKIP_PLATFORMS) if (re.test(u)) return name;
  return 'bespoke/unrecognized';
}

// ── API parsers ─────────────────────────────────────────────────────

function parseGreenhouse(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.absolute_url || '',
    company: companyName,
    location: j.location?.name || '',
    postedAt: j.updated_at || null,   // ISO string; best available proxy for age
    remoteHint: j.content || '',      // JD body (needs ?content=true) — grepped for "remote"
  }));
}

function parseAshby(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.jobUrl || '',
    company: companyName,
    location: j.location || '',
    postedAt: j.publishedDate || j.createdAt || null,  // ISO string
    // Ashby exposes an explicit isRemote flag + workplaceType — precise, no body grep needed.
    remoteHint: `${j.isRemote ? 'remote' : ''} ${j.workplaceType || ''} ${j.descriptionPlain || ''}`,
  }));
}

function parseLever(json, companyName) {
  if (!Array.isArray(json)) return [];
  return json.map(j => ({
    title: j.text || '',
    url: j.hostedUrl || '',
    company: companyName,
    location: j.categories?.location || '',
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,  // Unix ms → ISO
    // Lever exposes workplaceType ("remote"/"hybrid"/"on-site") — precise signal + body backup.
    remoteHint: `${j.workplaceType || ''} ${j.descriptionPlain || ''}`,
  }));
}

function parseWorkday(json, companyName, baseUrl) {
  const jobs = json.jobPostings || [];
  return jobs.map(j => {
    const bullets = Array.isArray(j.bulletFields) ? j.bulletFields : [];
    return {
      title: j.title || '',
      url: j.externalPath ? `${baseUrl}${j.externalPath}` : '',
      company: companyName,
      // locationsText is a flat string; bulletFields[0] sometimes carries location
      location: j.locationsText || bullets[0] || '',
      postedAt: j.postedOn || null,
      // Workday's list API returns no JD body and no explicit remote flag, so a
      // genuinely-remote role listing only its HQ city was geo-blocked as
      // out-of-region — parseWorkday was the ONE parser with no remoteHint.
      // Fold title + all bulletFields + locationsText into the hint so the
      // location filter can still find a "remote" signal wherever Workday put it
      // (commonly a "(Remote)" suffix in the title).
      remoteHint: [j.title, ...bullets, j.locationsText].filter(Boolean).join(' '),
    };
  });
}

function parseWorkable(json, companyName) {
  const jobs = json.jobs || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.url || j.shortlink || j.application_url || '',
    company: companyName,
    location: [j.city, j.state, j.country].filter(Boolean).join(', '),
    postedAt: j.published_on || j.created_at || null,   // ISO date string
    // telecommuting is Workable's explicit remote flag; department adds context.
    remoteHint: `${j.telecommuting ? 'remote' : ''} ${j.department || ''}`,
  }));
}

function parseSmartRecruiters(json, companyName, companyId) {
  const jobs = json.content || [];
  return jobs.map(j => ({
    title: j.name || '',
    // The list API carries no apply URL; the {companyId}/{id} public posting URL 200s.
    url: `https://jobs.smartrecruiters.com/${companyId}/${j.id}`,
    company: companyName,
    location: j.location?.fullLocation
      || [j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', '),
    postedAt: j.releasedDate || null,   // ISO string
    // location.remote / .hybrid are explicit booleans — precise signal, no body grep.
    remoteHint: `${j.location?.remote ? 'remote' : ''} ${j.location?.hybrid ? 'hybrid' : ''}`,
  }));
}

// ── Age filter ──────────────────────────────────────────────────────

/**
 * Returns true if the posting is within maxDays old (or age is unknown).
 * Unknown/unparseable dates are allowed through — don't penalize APIs
 * that don't return timestamps.
 */
function isWithinAge(postedAt, maxDays) {
  if (!postedAt) return true;
  const posted = new Date(postedAt);
  if (isNaN(posted.getTime())) return true;
  const ageDays = (Date.now() - posted.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays <= maxDays;
}

const PARSERS = { greenhouse: parseGreenhouse, ashby: parseAshby, lever: parseLever, workable: parseWorkable };

// ── Fetch with timeout ──────────────────────────────────────────────

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Workday requires POST + pagination (returns max 20 per page by default)
async function fetchWorkdayJobs(apiUrl, baseUrl, companyName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS * 3);
  const limit = 20;  // Workday rejects limit > 20 on most tenants
  let offset = 0;
  let allPostings = [];

  try {
    while (true) {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit, offset, searchText: '' }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const page = json.jobPostings || [];
      allPostings = allPostings.concat(page);
      if (page.length < limit || allPostings.length >= (json.total || 0)) break;
      offset += limit;
    }
    return parseWorkday({ jobPostings: allPostings }, companyName, baseUrl);
  } finally {
    clearTimeout(timer);
  }
}

// SmartRecruiters paginates (100/page). Public read API, no auth.
async function fetchSmartRecruitersJobs(apiUrl, companyId, companyName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS * 3);
  const limit = 100;
  let offset = 0;
  let allContent = [];

  try {
    while (true) {
      const res = await fetch(`${apiUrl}?limit=${limit}&offset=${offset}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const page = json.content || [];
      allContent = allContent.concat(page);
      if (page.length < limit || allContent.length >= (json.totalFound || 0)) break;
      offset += limit;
    }
    return parseSmartRecruiters({ content: allContent }, companyName, companyId);
  } finally {
    clearTimeout(timer);
  }
}

// ── Title filter ────────────────────────────────────────────────────

// Normalize a title or filter entry into a separator-agnostic canonical form so
// substring matching catches "Director of X", "Director, X", "Director — X",
// "Director / X", and "Director X" identically.
//
// Transformations (in order):
//   1. lowercase
//   2. dashes (— – -), parens, commas, colons, pipes, slashes → space
//   3. " of " → space        (Director "of" Business Ops vs Director Business Ops)
//   4. " and " / " & " → space (Data and Insights vs Data & Insights vs Data Insights)
//   5. collapse runs of whitespace
//
// Both sides of the comparison are normalized — so a filter entry of
// "Director of Business Operations" and a job title of "Director, Business Operations"
// both become "director business operations" and match cleanly.
//
// normalizeForMatch and buildTitleFilter now live in lib/scan-core.mjs.

// haversineMiles and buildLocationFilter now live in lib/scan-core.mjs.

// ── Dedup ───────────────────────────────────────────────────────────

// normalizeUrl now lives in lib/scan-core.mjs.

function loadSeenUrls(maxHistoryDays = 30) {
  const seen = new Set();
  const cutoffMs = maxHistoryDays > 0 ? Date.now() - maxHistoryDays * 86400000 : 0;

  // scan-history.tsv — age out "added" and TRANSIENT skip statuses
  // (skipped_dup / skipped_title) older than maxHistoryDays, so a genuinely-new
  // reposting can resurface. A skipped_dup is NOT a dead post: it duplicated a
  // then-live posting, and once that twin churns out of pipeline.md /
  // applications.md the dup must be allowed back, or real repostings are
  // suppressed forever (the scanner had ~115 URLs permanently trapped this way).
  // Genuinely-dead (skipped_expired) and geo-blocked (skipped_location, stable
  // policy) stay permanent.
  const AGEABLE = new Set(['added', 'skipped_dup', 'skipped_title']);
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) { // skip header
      const parts = line.split('\t');
      const url = parts[0];
      const dateStr = parts[1];
      const status = parts[5];
      if (!url) continue;
      if (cutoffMs > 0 && AGEABLE.has(status) && dateStr) {
        const entryTime = new Date(dateStr).getTime();
        if (!isNaN(entryTime) && entryTime < cutoffMs) continue; // aged out
      }
      seen.add(normalizeUrl(url));
    }
  }

  // pipeline.md — extract the first URL from each checkbox line. Lines come in
  // two shapes: a bare `- [ ] https://…` and the dominant table form
  // `- [x] #NNN | https://… | company | …`, so the URL is matched ANYWHERE on the
  // line, not just immediately after the checkbox (the old `(https?…)` capture
  // only caught the bare form and missed every table-form line — ~93% of them).
  // `[!]` = a gate-flagged dead posting, still a URL we've seen — keep it in the
  // dedup set. URL terminator [^\s|)] matches the applications.md reader below.
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const line of text.split('\n')) {
      if (!/^- \[[ x!]\]/.test(line)) continue;
      const m = line.match(/https?:\/\/[^\s|)]+/);
      if (m) seen.add(normalizeUrl(m[0]));
    }
  }

  // applications.md — extract URLs from report links and any inline URLs
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const match of text.matchAll(/https?:\/\/[^\s|)]+/g)) {
      seen.add(normalizeUrl(match[0]));
    }
  }

  return seen;
}


// ── Pipeline writer ─────────────────────────────────────────────────

// Insert freshly-scanned offers into pipeline.md text. Pure (no fs) so the
// ordering is unit-testable. Offers arrive already sorted best-fit-first (see
// scoreOffer), and are placed at the TOP of the "## Pendientes" section — the
// eval agent evaluates the top N pending rows, so putting them at the BOTTOM
// (the old behavior) made every fresh find wait behind the entire stale backlog
// before it was ever looked at.
export function insertOffersIntoPipeline(text, offers) {
  if (!offers || offers.length === 0) return text;
  const rows = offers.map(o =>
    `- [ ] ${sanitizeCell(o.url)} | ${sanitizeCell(o.company)} | ${sanitizeCell(o.title)}`
  );
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    // No Pendientes section yet — create it (before Procesadas if present).
    const procIdx = text.indexOf('## Procesadas');
    const insertAt = procIdx === -1 ? text.length : procIdx;
    const block = `\n${marker}\n\n${rows.join('\n')}\n\n`;
    return text.slice(0, insertAt) + block + text.slice(insertAt);
  }
  // Prepend right after the marker line so the new rows become the FIRST pending
  // entries. `sep` guards the rare case of the marker sitting at end-of-file with
  // no trailing newline, so rows never glue onto the "## Pendientes" text.
  const lineEnd = text.indexOf('\n', idx);
  const at = lineEnd === -1 ? text.length : lineEnd + 1;
  const sep = at > 0 && text[at - 1] !== '\n' ? '\n' : '';
  return text.slice(0, at) + `${sep}${rows.join('\n')}\n` + text.slice(at);
}

function appendToPipeline(offers) {
  if (offers.length === 0) return;
  // Fresh install has no pipeline.md yet — start from empty and let
  // insertOffersIntoPipeline create the "## Pendientes" section. (Reading it
  // unguarded ENOENT'd a brand-new install the moment the first scan found one.)
  const text = existsSync(PIPELINE_PATH) ? readFileSync(PIPELINE_PATH, 'utf-8') : '';
  writeFileSync(PIPELINE_PATH, insertOffersIntoPipeline(text, offers), 'utf-8');
}

function appendToScanHistory(offers, date) {
  // Ensure file + header exist
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf-8');
  }

  const clean = offers.map(o => ({ ...o, url: sanitizeCell(o.url), title: sanitizeCell(o.title), company: sanitizeCell(o.company) }));
  const lines = clean.map(o =>
    `${o.url}\t${date}\t${o.source}\t${o.title}\t${o.company}\tadded`
  ).join('\n') + '\n';

  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

// ── Parallel fetch with concurrency limit ───────────────────────────

async function parallelFetch(tasks, limit) {
  const results = [];
  let i = 0;

  async function next() {
    while (i < tasks.length) {
      const task = tasks[i++];
      results.push(await task());
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const noAgeFilter = args.includes('--no-age-filter');
  const companyFlag = args.indexOf('--company');
  const filterCompany = companyFlag !== -1 ? args[companyFlag + 1]?.toLowerCase() : null;
  const maxAgeDaysFlag = args.indexOf('--max-age-days');
  const flagAge = maxAgeDaysFlag !== -1 ? parseInt(args[maxAgeDaysFlag + 1], 10) : NaN;
  const maxHistoryDaysFlag = args.indexOf('--max-history-days');
  const maxHistoryDays = maxHistoryDaysFlag !== -1 ? parseInt(args[maxHistoryDaysFlag + 1], 10) || 30 : 30;

  // 1. Read portals.yml
  if (!existsSync(PORTALS_PATH)) {
    console.error('Error: portals.yml not found. Run onboarding first.');
    process.exit(1);
  }

  const config = parseYaml(readFileSync(PORTALS_PATH, 'utf-8'));
  const companies = config.tracked_companies || [];
  const titleFilter = buildTitleFilter(config.title_filter);
  const locationFilter = buildLocationFilter(config.title_filter);  // reads location_policy from title_filter section

  // Age cap resolution: the --max-age-days flag wins, then portals.yml
  // `scan.max_age_days`, then a 90-day default. Raised from 60 — still-open
  // senior roles routinely sit 60-90 days on a slow board, and dropping them as
  // "stale" hid live matches the user would apply to. --no-age-filter sets 0.
  const cfgAge = Number.isFinite(config.scan?.max_age_days) ? config.scan.max_age_days : 90;
  const maxAgeDays = noAgeFilter ? 0 : (Number.isFinite(flagAge) ? flagAge : cfgAge);

  // 2. Filter to enabled companies with detectable APIs
  const targets = companies
    .filter(c => c.enabled !== false)
    .filter(c => !filterCompany || c.name.toLowerCase().includes(filterCompany))
    .map(c => ({ ...c, _api: detectApi(c) }))
    .filter(c => c._api !== null);

  const skipped = companies.filter(c => c.enabled !== false && detectApi(c) === null);
  const skippedCount = skipped.length;

  console.log(`Scanning ${targets.length} companies via API (${skippedCount} skipped — no API detected)`);
  // Name WHY they were skipped, grouped by ATS. A bare count cannot tell you
  // whether it is 70 bespoke career pages, which nothing can fix, or a handful of
  // boards on one platform, which is a single parser away. Coverage reported only
  // as a number never gets closed, because nobody can see what closing it costs.
  if (skippedCount) {
    const groups = new Map();
    for (const c of skipped) {
      const k = skipPlatform(c);
      groups.set(k, (groups.get(k) || 0) + 1);
    }
    const line = [...groups.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(', ');
    console.log(`  not scanned by platform: ${line}`);
  }
  // No API-backed targets at all: this zero-token scanner can only hit
  // Greenhouse/Ashby/Lever. If every enabled company is Workday/custom (or the
  // API-backed ones were disabled), the scan returns nothing and that reads as
  // "broken" rather than "misconfigured". Say the cause and the two fixes.
  if (targets.length === 0) {
    console.log('\n⚠  No enabled company has a scannable ATS API (Greenhouse/Ashby/Lever),');
    console.log('   so this zero-token API scan has nothing to query. Either:');
    console.log('     • enable API-backed companies in portals.yml (flip `enabled: false` → true on');
    console.log('       Greenhouse/Ashby/Lever rows), or');
    console.log('     • run Agent Scan (WebSearch) for Workday/custom career sites.');
  }
  if (dryRun) console.log('(dry run — no files will be written)\n');

  // 3. Load dedup sets
  const seenUrls = loadSeenUrls(maxHistoryDays);

  // 4. Fetch all APIs
  const date = new Date().toISOString().slice(0, 10);
  let totalFound = 0;
  let totalFiltered = 0;
  let totalGeoBlocked = 0;
  let totalStale = 0;
  let totalDupes = 0;
  const newOffers = [];
  const errors = [];

  const tasks = targets.map(company => async () => {
    const { type, url, meta } = company._api;
    try {
      let jobs;
      if (type === 'workday') {
        jobs = await fetchWorkdayJobs(url, meta.baseUrl, company.name);
      } else if (type === 'smartrecruiters') {
        jobs = await fetchSmartRecruitersJobs(url, meta.companyId, company.name);
      } else {
        const json = await fetchJson(url);
        jobs = PARSERS[type](json, company.name);
      }
      totalFound += jobs.length;

      for (const job of jobs) {
        if (!titleFilter(job.title)) {
          totalFiltered++;
          continue;
        }
        if (!locationFilter(job.location, job.remoteHint)) {
          totalGeoBlocked++;
          continue;
        }
        if (maxAgeDays > 0 && !isWithinAge(job.postedAt, maxAgeDays)) {
          totalStale++;
          continue;
        }
        if (seenUrls.has(normalizeUrl(job.url))) {
          totalDupes++;
          continue;
        }
        // Mark as seen to avoid intra-scan dupes
        seenUrls.add(normalizeUrl(job.url));
        newOffers.push({ ...job, source: `${type}-api` });
      }
    } catch (err) {
      errors.push({ company: company.name, error: err.message });
    }
  });

  await parallelFetch(tasks, CONCURRENCY);

  // Rank best-fit first (no LLM) so the dashboard's batch evaluation scores the
  // most relevant roles before the long tail — the user evaluates pipeline.md
  // top-down, a batch at a time, so ordering decides which roles get scored first.
  newOffers.sort((a, b) => scoreOffer(b, config.title_filter) - scoreOffer(a, config.title_filter));

  // TEST CAP: keep only the first N new offers when TJK_TEST_LIMIT is set (now the
  // best-ranked N, since the sort above ran first).
  if (TEST_LIMIT > 0 && newOffers.length > TEST_LIMIT) {
    console.log(`[TEST] TJK_TEST_LIMIT=${TEST_LIMIT}: capping ${newOffers.length} new offers to ${TEST_LIMIT}`);
    newOffers.splice(TEST_LIMIT);
  }

  // 5. Write results
  if (!dryRun && newOffers.length > 0) {
    appendToPipeline(newOffers);
    appendToScanHistory(newOffers, date);
  }

  // 6. Print summary
  console.log(`\n${'━'.repeat(45)}`);
  console.log(`Portal Scan — ${date}`);
  console.log(`${'━'.repeat(45)}`);
  console.log(`Companies scanned:     ${targets.length}`);
  console.log(`Total jobs found:      ${totalFound}`);
  console.log(`Filtered by title:     ${totalFiltered} removed`);
  console.log(`Geo-blocked:           ${totalGeoBlocked} removed`);
  if (maxAgeDays > 0) {
    console.log(`Stale (>${maxAgeDays}d old):     ${totalStale} removed`);
  }
  console.log(`Duplicates:            ${totalDupes} skipped`);
  console.log(`New offers added:      ${newOffers.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) {
      console.log(`  ✗ ${e.company}: ${e.error}`);
    }
  }

  if (newOffers.length > 0) {
    console.log('\nNew offers:');
    for (const o of newOffers) {
      console.log(`  + ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
    }
    if (dryRun) {
      console.log('\n(dry run — run without --dry-run to save results)');
    } else {
      console.log(`\nResults saved to ${PIPELINE_PATH} and ${SCAN_HISTORY_PATH}`);
    }
  }

  console.log(`\n→ Run /trajecktory pipeline to evaluate new offers.`);
}

// Exported for unit tests (tests/scan-parsers.test.mjs). Importing this module
// must NOT kick off a scan, so main() runs only on direct CLI invocation.
export {
  detectApi,
  parseGreenhouse,
  parseAshby,
  parseLever,
  parseWorkday,
  parseWorkable,
  parseSmartRecruiters,
};

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
