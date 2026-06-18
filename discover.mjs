#!/usr/bin/env node
/**
 * discover.mjs — Expand zero-token scanner coverage automatically
 *
 * Three phases run each time:
 *
 *   Phase 1 (always): Read every Greenhouse/Ashby/Lever URL from pipeline.md
 *   and scan-history.tsv, register any new company slugs in portals.yml so
 *   future zero-token scans cover them automatically.
 *
 *   Phase 2 (if BRAVE_API_KEY in env): Brave Search API — proactive site:
 *   searches for new ATS job URLs; new URLs → pipeline.md, new slugs → portals.yml.
 *   Queries are built at runtime from portals.yml `search_queries` (the enabled
 *   ATS-board ones), so Brave coverage tracks the active archetypes automatically.
 *
 *   Phase 3 (if MUSE_API_KEY in dashboard-web/.env): The Muse API — fetches
 *   Director/VP-level jobs from Business & Strategy / Data & Analytics /
 *   Sales & BD categories; new Muse job URLs → pipeline.md.
 *
 * Usage:
 *   node discover.mjs            # run all active phases
 *   node discover.mjs --dry-run  # preview without writing
 *   node discover.mjs --verbose  # show filtered/skipped detail
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';

const DRY_RUN   = process.argv.includes('--dry-run');
const VERBOSE   = process.argv.includes('--verbose');

const PORTALS_PATH  = 'portals.yml';
const PIPELINE_PATH = 'data/pipeline.md';
const HISTORY_PATH  = 'data/scan-history.tsv';
const APPS_PATH     = 'data/applications.md';
const ENV_PATH      = 'dashboard-web/.env';

// ─── Load API keys from .env file ──────────────────────────────────

function loadEnvKey(key) {
  if (!existsSync(ENV_PATH)) return '';
  const env = readFileSync(ENV_PATH, 'utf8');
  const m = env.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.trim() || '';
}

const BRAVE_KEY = process.env.BRAVE_API_KEY || loadEnvKey('BRAVE_API_KEY');
const MUSE_KEY  = loadEnvKey('MUSE_API_KEY');

// ─── Brave search queries (Phase 2) ────────────────────────────────
// Single source of truth: Brave queries are built at runtime from portals.yml
// `search_queries` (the same list the agent scan flow uses), NOT a separate
// hardcoded list — so the web-search path never drifts from the active
// archetypes. Dropped tracks (enabled: false) are excluded automatically;
// newly-added tracks appear here as soon as they're added to portals.yml.
//
// We feed Brave only the queries that target an ATS board (Greenhouse/Ashby/
// Lever): those are the only results parseAtsUrl() can turn into usable job
// URLs. Aggregator queries (Remotive, The Muse, etc.) are left to Phase 3 and
// the agent scan flow.
const ATS_SITE_RE = /greenhouse\.io|ashbyhq\.com|lever\.co/i;

function buildBraveQueries(portals) {
  return (portals.search_queries || [])
    .filter(q => q && q.enabled !== false && q.query && ATS_SITE_RE.test(q.query))
    .map(q => q.query);
}

// ─── Muse query config (Phase 3) ───────────────────────────────────
// Note: Muse's category filter is non-functional (always returns 0).
// Only level=Senior Level works. We scan 10 pages (200 jobs) and rely
// on client-side title filtering to find Director/VP-level matches.

const MUSE_QUERIES = [
  { level: 'Senior Level' },
];
const MUSE_MAX_PAGES = 10; // 20 results/page × 10 = 200 jobs scanned

// ─── URL parsing (ATS only) ────────────────────────────────────────

function parseAtsUrl(rawUrl) {
  let url;
  try {
    const u = new URL(rawUrl.trim());
    url = `${u.origin}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return null;
  }

  let m;
  m = url.match(/(?:job-boards(?:\.eu)?|boards(?:\.eu)?)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/);
  if (m) return { type: 'greenhouse', slug: m[1], jobId: m[2], url };

  m = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (m) return { type: 'ashby', slug: decodeURIComponent(m[1]), jobId: m[2], url };

  m = url.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (m) return { type: 'lever', slug: m[1], jobId: m[2], url };

  return null;
}

function slugToName(slug) {
  return decodeURIComponent(slug).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

// ─── Collect ATS URLs already in local files ────────────────────────

const ATS_URL_RE = /https?:\/\/(?:job-boards(?:\.eu)?|boards(?:\.eu)?)\.greenhouse\.io\/[^\s|)\]]+|https?:\/\/jobs\.ashbyhq\.com\/[^\s|)\]]+|https?:\/\/jobs\.lever\.co\/[^\s|)\]]+/g;

function isValidCompanyHint(s) {
  if (!s) return false;
  if (/^\d+\.?\d*\/\d+/.test(s)) return false;
  if (/^PDF/i.test(s)) return false;
  if (/^#\d+$/.test(s)) return false;
  return s.length >= 2;
}

function extractCompanyHint(line, rawUrl) {
  const parts = line.split(/\s*\|\s*/);
  const urlIdx = parts.findIndex(p => p.includes(rawUrl.slice(0, 40)));
  if (urlIdx >= 0 && urlIdx + 1 < parts.length) {
    const hint = parts[urlIdx + 1].trim();
    if (isValidCompanyHint(hint)) return hint;
  }
  return '';
}

function collectLocalUrls() {
  const found = new Map();
  for (const path of [PIPELINE_PATH, HISTORY_PATH, APPS_PATH]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      for (const m of [...line.matchAll(new RegExp(ATS_URL_RE.source, 'g'))]) {
        const raw = m[0].replace(/[|)\].,;]+$/, '');
        if (!found.has(raw)) found.set(raw, extractCompanyHint(line, raw));
      }
    }
  }
  return found;
}

// ─── Existing tracked slugs ─────────────────────────────────────────

function loadExistingSlugs(portals) {
  const slugs = new Set();
  const patterns = [
    /(?:job-boards(?:\.eu)?|boards(?:\.eu)?)\.greenhouse\.io\/([^/?#\s]+)/,
    /boards-api\.greenhouse\.io\/v1\/boards\/([^/?#\s]+)/,
    /jobs\.ashbyhq\.com\/([^/?#\s]+)/,
    /jobs\.lever\.co\/([^/?#\s]+)/,
  ];
  for (const co of portals.tracked_companies || []) {
    for (const url of [co.careers_url, co.api].filter(Boolean)) {
      for (const p of patterns) {
        const match = url.match(p);
        if (match) { slugs.add(decodeURIComponent(match[1]).toLowerCase()); break; }
      }
    }
  }
  return slugs;
}

// ─── Seen URLs (dedup for all phases) ──────────────────────────────

function loadSeenUrls() {
  const seen = new Set();
  for (const [path, re] of [
    [HISTORY_PATH,  /^([^\t]+)/],
    [PIPELINE_PATH, /(https?:\/\/[^\s|]+)/],
    [APPS_PATH,     /(https?:\/\/[^\s|)\]]+)/],
  ]) {
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(re);
      if (m && m[1] !== 'url') seen.add(m[1].trim());
    }
  }
  return seen;
}

// ─── Title filter ───────────────────────────────────────────────────

function passesFilter(title, filter) {
  if (!title) return true;
  const t = title.toLowerCase();
  if (!filter.positive.some(p => t.includes(p.toLowerCase()))) return false;
  if (filter.negative.some(n => t.includes(n.toLowerCase()))) return false;
  return true;
}

// ─── portals.yml entry builder ──────────────────────────────────────

function buildPortalsEntry(parsed, today, companyHint) {
  const { type, slug } = parsed;
  const name = companyHint || slugToName(slug);
  const lines = [`\n  - name: ${name}`];

  if (type === 'greenhouse') {
    lines.push(`    careers_url: https://job-boards.greenhouse.io/${slug}`);
    lines.push(`    api: https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
  } else if (type === 'ashby') {
    lines.push(`    careers_url: https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`);
  } else if (type === 'lever') {
    lines.push(`    careers_url: https://jobs.lever.co/${slug}`);
  }

  lines.push(`    notes: "Discovered ${today} from pipeline/history."`);
  lines.push(`    enabled: true`);
  return { name, yaml: lines.join('\n') };
}

// ─── Write helpers ──────────────────────────────────────────────────

function writePortals(portalsRaw, newEntries) {
  const HEADER = '  # -- Auto-discovered via site: search --';
  let text = portalsRaw;
  const block = newEntries.map(e => e.yaml).join('') + '\n';
  if (text.includes(HEADER)) {
    text = text.replace(HEADER + '\n', HEADER + '\n' + block);
  } else {
    text = text.trimEnd() + '\n\n' + HEADER + block;
  }
  writeFileSync(PORTALS_PATH, text, 'utf8');
}

function writePipeline(newJobs, today) {
  let text = readFileSync(PIPELINE_PATH, 'utf8');
  const sectionTitle = `## Discovered — ${today}`;
  const jobBlock = newJobs.map(j => `- [ ] ${j.url} | ${j.company} | ${j.title}`).join('\n');

  if (text.includes(sectionTitle)) {
    const secStart = text.indexOf(sectionTitle);
    const nextSec  = text.indexOf('\n## ', secStart + sectionTitle.length);
    const cutAt    = nextSec === -1 ? text.length : nextSec;
    text = text.slice(0, cutAt).trimEnd() + '\n' + jobBlock + '\n' + text.slice(cutAt);
  } else {
    const firstSec = text.indexOf('\n## ');
    const section  = `\n${sectionTitle}\n\n${jobBlock}\n`;
    text = firstSec === -1
      ? text.trimEnd() + '\n' + section
      : text.slice(0, firstSec) + section + text.slice(firstSec);
  }
  writeFileSync(PIPELINE_PATH, text, 'utf8');
}

function appendHistory(jobs, today, source) {
  const needsHeader = !existsSync(HISTORY_PATH);
  const lines = jobs.map(j => {
    const p = parseAtsUrl(j.url);
    const portalTag = p ? `${source}_${p.type}` : source;
    return `${j.url}\t${today}\t${portalTag}\t${j.title || 'unknown'}\t${j.company}\tadded`;
  });
  if (needsHeader) writeFileSync(HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n', 'utf8');
  appendFileSync(HISTORY_PATH, lines.join('\n') + '\n', 'utf8');
}

// ─── Brave Search API (Phase 2) ────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function braveSearch(query) {
  const resp = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20`,
    {
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': BRAVE_KEY },
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!resp.ok) throw new Error(`Brave API HTTP ${resp.status}`);
  const data = await resp.json();
  return (data.web?.results || []).map(r => ({ url: r.url, title: r.title || '' }));
}

// ─── Muse API (Phase 3) ─────────────────────────────────────────────

async function fetchMusePage(level, page) {
  const params = new URLSearchParams({
    api_key: MUSE_KEY,
    level,
    page: String(page),
    descending: 'true',
  });
  const resp = await fetch(`https://www.themuse.com/api/public/jobs?${params}`, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!resp.ok) throw new Error(`Muse API HTTP ${resp.status}`);
  return await resp.json();
}

async function searchMuse(level, titleFilter, seenUrls) {
  const results = [];
  let page = 0;

  while (page < MUSE_MAX_PAGES) {
    let data;
    try {
      data = await fetchMusePage(level, page);
    } catch (err) {
      if (VERBOSE) console.log(`\n    [Muse error p${page}: ${err.message}]`);
      break;
    }

    const jobs = data.results || [];
    if (jobs.length === 0) break;

    for (const job of jobs) {
      const title   = job.name || '';
      const company = job.company?.name || '';
      const url     = job.refs?.landing_page || '';

      if (!url || !title) continue;
      if (!passesFilter(title, titleFilter)) {
        if (VERBOSE) console.log(`\n    SKIP (filter): "${title}"`);
        continue;
      }
      if (seenUrls.has(url)) continue;

      seenUrls.add(url);
      results.push({ url, title, company });
    }

    page++;
    if (page < MUSE_MAX_PAGES && jobs.length > 0) await sleep(300);
  }

  return results;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const activePhases = ['Phase 1 (pipeline registration)', BRAVE_KEY && 'Phase 2 (Brave Search)', MUSE_KEY && 'Phase 3 (Muse API)'].filter(Boolean);
  console.log(`\n🔍 discover.mjs${DRY_RUN ? ' [dry-run]' : ''} — ${today}`);
  console.log(`   Active: ${activePhases.join(', ')}\n`);

  const portalsRaw    = readFileSync(PORTALS_PATH, 'utf8');
  const portals       = yaml.load(portalsRaw);
  const titleFilter   = portals.title_filter;
  const braveQueries  = buildBraveQueries(portals);
  const existingSlugs = loadExistingSlugs(portals);
  const seenUrls      = loadSeenUrls();
  const addedThisRun  = new Set();

  console.log(`Known: ${existingSlugs.size} companies, ${seenUrls.size} seen URLs`);

  // ── Phase 1: Register companies from existing pipeline/history ──────

  console.log('\n📋 Phase 1: Registering companies from pipeline + history...');
  const localUrls = collectLocalUrls();
  console.log(`   Found ${localUrls.size} ATS URLs in local files`);

  const phase1Entries = [];
  for (const [rawUrl, companyHint] of localUrls) {
    const parsed = parseAtsUrl(rawUrl);
    if (!parsed) continue;
    const slugLow = parsed.slug.toLowerCase();
    if (existingSlugs.has(slugLow) || addedThisRun.has(slugLow)) continue;
    addedThisRun.add(slugLow);
    existingSlugs.add(slugLow);
    const entry = buildPortalsEntry(parsed, today, companyHint);
    phase1Entries.push(entry);
    if (VERBOSE) console.log(`   + ${entry.name} (${parsed.type})`);
  }
  console.log(`   → ${phase1Entries.length} new companies to register`);

  // ── Phase 2: Brave Search (optional) ───────────────────────────────

  const phase2Jobs    = [];
  const phase2Entries = [];

  if (BRAVE_KEY && braveQueries.length) {
    console.log(`\n🌐 Phase 2: Brave Search (${braveQueries.length} ATS queries from portals.yml)...`);
    for (let i = 0; i < braveQueries.length; i++) {
      process.stdout.write(`   [${i + 1}/${braveQueries.length}] `);
      let results;
      try { results = await braveSearch(braveQueries[i]); }
      catch (err) { console.log(`error: ${err.message}`); continue; }

      let added = 0;
      for (const { url, title } of results) {
        const parsed = parseAtsUrl(url);
        if (!parsed) continue;
        if (!passesFilter(title, titleFilter)) continue;
        if (seenUrls.has(parsed.url)) continue;
        seenUrls.add(parsed.url);
        const slugLow = parsed.slug.toLowerCase();
        if (!existingSlugs.has(slugLow) && !addedThisRun.has(slugLow)) {
          addedThisRun.add(slugLow); existingSlugs.add(slugLow);
          phase2Entries.push(buildPortalsEntry(parsed, today, ''));
        }
        phase2Jobs.push({ url: parsed.url, company: slugToName(parsed.slug), title });
        added++;
      }
      console.log(`${added} new`);
      if (i < braveQueries.length - 1) await sleep(1200);
    }
  }

  // ── Phase 3: Muse API ───────────────────────────────────────────────

  const phase3Jobs = [];

  if (MUSE_KEY) {
    console.log(`\n🎭 Phase 3: Muse API (${MUSE_QUERIES.length} queries × up to ${MUSE_MAX_PAGES} pages)...`);
    for (let i = 0; i < MUSE_QUERIES.length; i++) {
      const { level } = MUSE_QUERIES[i];
      process.stdout.write(`   [${i + 1}/${MUSE_QUERIES.length}] level=${level} (${MUSE_MAX_PAGES} pages) ... `);
      const results = await searchMuse(level, titleFilter, seenUrls);
      phase3Jobs.push(...results);
      console.log(`${results.length} new`);
      if (i < MUSE_QUERIES.length - 1) await sleep(500);
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────

  const totalNewCompanies = phase1Entries.length + phase2Entries.length;
  const totalNewJobs      = phase2Jobs.length + phase3Jobs.length;
  console.log(`\n📊 Results:`);
  console.log(`   New companies (portals.yml): ${totalNewCompanies}`);
  console.log(`   New job URLs (pipeline.md): ${totalNewJobs}${phase3Jobs.length ? ` (${phase3Jobs.length} from Muse)` : ''}`);

  if (DRY_RUN) {
    console.log('\n[dry-run — no files written]');
    if (phase1Entries.length) { console.log('\nPhase 1 — portals.yml additions:'); phase1Entries.forEach(e => console.log(`  + ${e.name}`)); }
    if (phase2Entries.length) { console.log('\nPhase 2 — portals.yml additions:'); phase2Entries.forEach(e => console.log(`  + ${e.name}`)); }
    if (phase2Jobs.length)    { console.log('\nPhase 2 — pipeline.md additions:'); phase2Jobs.forEach(j => console.log(`  - [ ] ${j.url} | ${j.company} | ${j.title}`)); }
    if (phase3Jobs.length)    { console.log('\nPhase 3 — pipeline.md additions (Muse):'); phase3Jobs.forEach(j => console.log(`  - [ ] ${j.url} | ${j.company} | ${j.title}`)); }
    return;
  }

  if (totalNewCompanies === 0 && totalNewJobs === 0) {
    console.log('\n✅ Nothing new — done.\n');
    return;
  }

  if (totalNewCompanies > 0) {
    writePortals(portalsRaw, [...phase1Entries, ...phase2Entries]);
    console.log(`\n✅ portals.yml — ${totalNewCompanies} companies added`);
  }

  const allNewJobs = [...phase2Jobs, ...phase3Jobs];
  if (allNewJobs.length > 0) {
    writePipeline(allNewJobs, today);
    appendHistory(phase2Jobs, today, 'discovery_brave');
    appendHistory(phase3Jobs, today, 'discovery_muse');
    console.log(`✅ pipeline.md + scan-history.tsv — ${allNewJobs.length} job URLs added`);
  }

  console.log('\n✨ Discovery complete.\n');
}

main().catch(err => {
  console.error('\n❌ discover.mjs error:', err.message);
  process.exit(1);
});
