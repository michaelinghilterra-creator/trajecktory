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
import yaml from 'js-yaml';
import { buildTitleFilter, normalizeUrl } from './lib/scan-core.mjs';
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

// ── API detection ───────────────────────────────────────────────────

function detectApi(company) {
  // Greenhouse: explicit api field
  if (company.api && company.api.includes('greenhouse')) {
    return { type: 'greenhouse', url: company.api };
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
      url: `https://boards-api.greenhouse.io/v1/boards/${ghEuMatch[1]}/jobs`,
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

  return null;
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
  }));
}

function parseWorkday(json, companyName, baseUrl) {
  const jobs = json.jobPostings || [];
  return jobs.map(j => ({
    title: j.title || '',
    url: j.externalPath ? `${baseUrl}${j.externalPath}` : '',
    company: companyName,
    // locationsText is a flat string; bulletFields[0] sometimes carries location
    location: j.locationsText || (Array.isArray(j.bulletFields) ? j.bulletFields[0] : '') || '',
    postedAt: j.postedOn || null,
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

const PARSERS = { greenhouse: parseGreenhouse, ashby: parseAshby, lever: parseLever };

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

// ── Location filter ─────────────────────────────────────────────────

/** Haversine distance in miles between two lat/lon points */
function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Builds a smart location filter from portals.yml location_policy.
 *
 * Decision tree (applied in order):
 *  1. Empty/unknown location          → PASS
 *  2. Hard-no city                    → BLOCK
 *  3. "Remote" with no city signal    → PASS
 *  4. Dallas / Fort Worth / DFW       → PASS (any arrangement)
 *  5. DFW metro suburb                → PASS (any arrangement)
 *  6. Austin                          → PASS if remote/hybrid, BLOCK if onsite
 *  7. Other TX city ≤ radius miles    → PASS (any arrangement)
 *  8. Other TX city > radius + remote → PASS
 *  9. Other TX city > radius + onsite → BLOCK
 * 10. Non-TX with "remote" signal     → PASS
 * 11. Non-TX without "remote"         → BLOCK
 */
function buildLocationFilter(titleFilter) {
  const policy = titleFilter?.location_policy;
  if (!policy) return () => true; // no policy = allow all

  const home       = policy.home || {};
  const homeLat    = home.lat || 33.0857;
  const homeLon    = home.lon || -97.2969;
  const radiusMi   = home.commute_radius_miles || 50;

  const hardNo     = (policy.hard_no || []).map(k => k.toLowerCase());
  const dfwCore    = (policy.dfw_core || []).map(k => k.toLowerCase());
  const metro      = (policy.metro_allow || []).map(k => k.toLowerCase());
  const hybridOnly = (policy.hybrid_remote_only || []).map(k => k.toLowerCase());
  const txCoords   = (policy.tx_city_coords || []).map(c => ({
    name: c.name.toLowerCase(),
    lat: c.lat,
    lon: c.lon,
  }));

  return (location) => {
    // 1. Unknown/empty → pass
    if (!location || !location.trim()) return true;

    const loc = location.toLowerCase();

    // Detect work arrangement signals in the location string
    const hasRemote = loc.includes('remote');
    const hasHybrid = loc.includes('hybrid');
    const isFlexible = hasRemote || hasHybrid;

    // 2. Hard-no cities → block unconditionally
    if (hardNo.some(city => loc.includes(city))) return false;

    // 3. Pure "remote" with no city noise → pass
    if (hasRemote && loc.replace(/remote/g, '').trim().length < 5) return true;

    // 4. DFW core (Dallas, Fort Worth, DFW) → always pass
    if (dfwCore.some(city => loc.includes(city))) return true;

    // 5. DFW metro suburbs → always pass
    if (metro.some(city => loc.includes(city))) return true;

    // 6. Austin → pass only if remote or hybrid signal
    if (hybridOnly.some(city => loc.includes(city))) {
      return isFlexible;
    }

    // 7–9. Other TX city (contains "texas", " tx" or ", tx")
    const isTX = loc.includes('texas') || loc.includes(' tx') || loc.includes(', tx');
    if (isTX) {
      // Try haversine against known TX city coords
      const match = txCoords.find(c => loc.includes(c.name));
      if (match) {
        const dist = haversineMiles(homeLat, homeLon, match.lat, match.lon);
        if (dist <= radiusMi) return true;   // within commute → any arrangement
        return isFlexible;                    // outside radius → remote/hybrid only
      }
      // Unknown TX city not in coords table → pass through (let Claude decide)
      return true;
    }

    // 10. Non-TX with remote signal → pass
    if (hasRemote) return true;

    // 11. Non-TX, no remote signal → block
    return false;
  };
}

// ── Dedup ───────────────────────────────────────────────────────────

// normalizeUrl now lives in lib/scan-core.mjs.

function loadSeenUrls(maxHistoryDays = 30) {
  const seen = new Set();
  const cutoffMs = maxHistoryDays > 0 ? Date.now() - maxHistoryDays * 86400000 : 0;

  // scan-history.tsv — age out "added" entries older than maxHistoryDays;
  // keep skipped_expired/skipped_dup/etc. permanently (dead posts stay dead)
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    for (const line of lines.slice(1)) { // skip header
      const parts = line.split('\t');
      const url = parts[0];
      const dateStr = parts[1];
      const status = parts[5];
      if (!url) continue;
      if (cutoffMs > 0 && status === 'added' && dateStr) {
        const entryTime = new Date(dateStr).getTime();
        if (!isNaN(entryTime) && entryTime < cutoffMs) continue; // aged out
      }
      seen.add(normalizeUrl(url));
    }
  }

  // pipeline.md — extract URLs from checkbox lines
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const match of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) {
      seen.add(normalizeUrl(match[1]));
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

function appendToPipeline(offers) {
  if (offers.length === 0) return;

  let text = readFileSync(PIPELINE_PATH, 'utf-8');

  // Find "## Pendientes" section and append after it
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  if (idx === -1) {
    // No Pendientes section — append at end before Procesadas
    const procIdx = text.indexOf('## Procesadas');
    const insertAt = procIdx === -1 ? text.length : procIdx;
    const block = `\n${marker}\n\n` + offers.map(o =>
      `- [ ] ${o.url} | ${o.company} | ${o.title}`
    ).join('\n') + '\n\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  } else {
    // Find the end of existing Pendientes content (next ## or end)
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;

    const block = '\n' + offers.map(o =>
      `- [ ] ${o.url} | ${o.company} | ${o.title}`
    ).join('\n') + '\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }

  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  // Ensure file + header exist
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf-8');
  }

  const lines = offers.map(o =>
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
  const maxAgeDays = noAgeFilter ? 0
    : maxAgeDaysFlag !== -1 ? parseInt(args[maxAgeDaysFlag + 1], 10) || 60
    : 60;  // default: skip postings older than 60 days
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

  // 2. Filter to enabled companies with detectable APIs
  const targets = companies
    .filter(c => c.enabled !== false)
    .filter(c => !filterCompany || c.name.toLowerCase().includes(filterCompany))
    .map(c => ({ ...c, _api: detectApi(c) }))
    .filter(c => c._api !== null);

  const skippedCount = companies.filter(c => c.enabled !== false).length - targets.length;

  console.log(`Scanning ${targets.length} companies via API (${skippedCount} skipped — no API detected)`);
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
        if (!locationFilter(job.location)) {
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

  console.log(`\n→ Run /career-ops pipeline to evaluate new offers.`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
