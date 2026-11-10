#!/usr/bin/env node

/**
 * Read-only live audit for location-filter changes.
 *
 * Usage: node audit-location-filter.mjs --urls posting-urls.txt
 *
 * The script only reads config/input, fetches public ATS JSON, and writes TSV
 * to stdout. It deliberately imports the production parsers from scan.mjs so
 * arrangement and country mapping cannot drift from the scanner.
 */

import { existsSync, readFileSync } from 'fs';
import yaml from 'js-yaml';
import { buildLocationDecision } from './lib/scan-core.mjs';
import { parseAshby, parseGreenhouse, parseLever } from './scan.mjs';

const args = process.argv.slice(2);
const urlsIndex = args.indexOf('--urls');
const urlsPath = urlsIndex >= 0 ? args[urlsIndex + 1] : '';
if (!urlsPath) {
  console.error('Usage: node audit-location-filter.mjs --urls <file>');
  process.exit(2);
}

const configPath = existsSync('portals.yml') ? 'portals.yml' : 'templates/portals.example.yml';
const config = yaml.load(readFileSync(configPath, 'utf8')) || {};
const decideLocation = buildLocationDecision(config.title_filter);
const legacyLocationFilter = buildLegacyLocationFilter(config.title_filter);
const inputUrls = readFileSync(urlsPath, 'utf8')
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));

const ashbyBoards = new Map();
let lastFetchAt = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const waitMs = Math.max(0, 250 - (Date.now() - lastFetchAt));
  if (waitMs) await sleep(waitMs);
  lastFetchAt = Date.now();
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function parsePostingUrl(rawUrl) {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'jobs.ashbyhq.com' && parts.length >= 2) {
    return { ats: 'ashby', board: parts[0], id: parts[1] };
  }
  if (host === 'jobs.lever.co' && parts.length >= 2) {
    return { ats: 'lever', board: parts[0], id: parts[1] };
  }
  if (/greenhouse\.io$/.test(host)) {
    const jobsIndex = parts.indexOf('jobs');
    const board = jobsIndex > 0 ? parts[jobsIndex - 1] : parts[0];
    const id = jobsIndex >= 0 ? parts[jobsIndex + 1] : url.searchParams.get('gh_jid');
    if (board && id) return { ats: 'greenhouse', board, id };
  }
  return null;
}

function ashbyJobMatches(job, id) {
  if (String(job?.id || '') === id) return true;
  try {
    const parts = new URL(job?.jobUrl || '').pathname.split('/').filter(Boolean);
    return parts.includes(id);
  } catch {
    return false;
  }
}

async function fetchOffer(rawUrl) {
  const parsed = parsePostingUrl(rawUrl);
  if (!parsed) throw new Error('unsupported ATS URL');

  if (parsed.ats === 'greenhouse') {
    const json = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(parsed.board)}/jobs/${encodeURIComponent(parsed.id)}?content=true`);
    return parseGreenhouse({ jobs: [json] }, parsed.board)[0];
  }

  if (parsed.ats === 'lever') {
    const json = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(parsed.board)}/${encodeURIComponent(parsed.id)}`);
    return parseLever([json], parsed.board)[0];
  }

  if (!ashbyBoards.has(parsed.board)) {
    ashbyBoards.set(parsed.board, fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(parsed.board)}`));
  }
  const board = await ashbyBoards.get(parsed.board);
  const job = (board.jobs || []).find(candidate => ashbyJobMatches(candidate, parsed.id));
  if (!job) {
    const error = new Error('HTTP 404');
    error.status = 404;
    throw error;
  }
  return parseAshby({ jobs: [job] }, parsed.board)[0];
}

function tsv(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

console.log('url\ttitle\tlocation\tworkplace\tcountries\told_verdict\tnew_verdict\trule_that_fired');
let oldPasses = 0;
let newPasses = 0;
let newlyBlocked = 0;
let gone = 0;

for (const rawUrl of inputUrls) {
  try {
    const offer = await fetchOffer(rawUrl);
    const legacyHint = offer.legacyRemoteHint ?? offer.remoteHint;
    const oldPass = legacyLocationFilter(offer.location, legacyHint);
    const decision = decideLocation(offer.location, offer.remoteHint, {
      workplace: offer.workplace,
      countries: offer.countries,
      title: offer.title,
    });
    if (oldPass) oldPasses++;
    if (decision.pass) newPasses++;
    const changed = oldPass && !decision.pass;
    if (changed) newlyBlocked++;
    const newVerdict = decision.pass ? 'pass' : (changed ? 'block NEWLY_BLOCKED' : 'block');
    console.log([
      rawUrl,
      offer.title,
      offer.location,
      offer.workplace,
      (offer.countries || []).join(','),
      oldPass ? 'pass' : 'block',
      newVerdict,
      decision.rule,
    ].map(tsv).join('\t'));
  } catch (error) {
    gone++;
    console.log([rawUrl, '', '', '', '', 'gone', 'gone', 'gone'].map(tsv).join('\t'));
  }
}

console.log(`# summary\ttotal=${inputUrls.length}\told_pass=${oldPasses}\tnew_pass=${newPasses}\tnewly_blocked=${newlyBlocked}\tgone=${gone}`);

/** Frozen copy of the pre-change location filter from main. */
function buildLegacyLocationFilter(titleFilter) {
  const policy = titleFilter?.location_policy;
  if (!policy) return () => true;
  const home = policy.home || {};
  const hasHome = Number.isFinite(home.lat) && Number.isFinite(home.lon);
  const radiusMi = home.commute_radius_miles || 50;
  const hardNo = (policy.hard_no || []).map(k => k.toLowerCase());
  const homeCore = (policy.home_core || policy.dfw_core || []).map(k => k.toLowerCase());
  const metro = (policy.metro_allow || []).map(k => k.toLowerCase());
  const flexOnly = (policy.flexible_only || policy.hybrid_remote_only || []).map(k => k.toLowerCase());
  const regionCoords = (policy.region_city_coords || policy.tx_city_coords || []).map(c => ({
    name: c.name.toLowerCase(), lat: c.lat, lon: c.lon,
  }));
  const legacyRegion = policy.dfw_core || policy.tx_city_coords;
  const regionTokens = (policy.home_region || (legacyRegion ? ['texas', ' tx', ', tx'] : []))
    .map(k => k.toLowerCase());
  const hasRegion = regionTokens.length > 0;

  return (location, remoteHint = '') => {
    if (!location || !location.trim()) return true;
    const loc = location.toLowerCase();
    const remoteRx = /\bremote\b/;
    const hasRemote = remoteRx.test(loc) || remoteRx.test(String(remoteHint).toLowerCase());
    const hasHybrid = loc.includes('hybrid');
    const isFlexible = hasRemote || hasHybrid;
    const residual = loc
      .replace(/\bremote\b/g, ' ')
      .replace(/\bhybrid\b/g, ' ')
      .replace(/\bon-?site\b/g, ' ')
      .replace(/\bunited states(?: of america)?\b/g, ' ')
      .replace(/\bu\.?s\.?a?\.?\b/g, ' ')
      .replace(/\bcanada\b/g, ' ')
      .replace(/\b(?:\d+|multiple|various|several|many)\s+(?:locations?|offices?|sites?|cities)\b/g, ' ')
      .replace(/\bvarious\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (!residual) return true;
    if (hardNo.some(city => loc.includes(city))) return hasRemote;
    if (homeCore.some(city => loc.includes(city))) return true;
    if (metro.some(city => loc.includes(city))) return true;
    if (flexOnly.some(city => loc.includes(city))) return isFlexible;
    const inRegion = hasRegion && regionTokens.some(token => loc.includes(token));
    if (inRegion) {
      const match = hasHome ? regionCoords.find(city => loc.includes(city.name)) : null;
      if (!match) return true;
      const distance = haversineMiles(home.lat, home.lon, match.lat, match.lon);
      return distance <= radiusMi || isFlexible;
    }
    if (hasRemote) return true;
    return !hasRegion;
  };
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const earthRadiusMiles = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
