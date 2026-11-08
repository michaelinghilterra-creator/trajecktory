import { readFileSync, readdirSync } from 'fs';
import { resolve, sep } from 'path';
import { parseTrackerLine } from './tracker.mjs';
import {
  canonicalUrl,
  normalizeCompany,
  sameRole,
  urlForRow,
  canonicalPostingUrl,
} from './identity.mjs';

export const SIMILAR_JD_THRESHOLD = 0.6;
export const MIN_JD_WORDS = 120;

function inside(base, candidate) {
  return candidate === base || candidate.startsWith(base + sep);
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

export function jdShingles(text) {
  const raw = String(text ?? '').replace(/\r/g, '');
  const lines = raw.split('\n');
  const headerEnd = lines.findIndex((line) => line.trim() === '---');
  const bodyLines = headerEnd >= 0 ? lines.slice(headerEnd + 1) : lines;
  const kept = bodyLines.filter((line, index) => {
    if (index >= 10) return true;
    if (/^\s*\*{0,2}(Source(?: URL)?|URL|Pulled|Company|Role|Location|Date):/i.test(line)) return false;
    return !/^\s*#\s+/.test(line);
  });
  // A tag cannot contain another '<', so each '<' is scanned once; the older pattern rescanned to the end of the text per '<'.
  const tokens = decodeEntities(kept.join('\n').replace(/<[^<>]*>/g, ' '))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  if (tokens.length < MIN_JD_WORDS) return null;
  const shingles = new Set();
  for (let i = 0; i <= tokens.length - 4; i++) {
    shingles.add(tokens.slice(i, i + 4).join(' '));
  }
  return shingles;
}

function shingleSimilarity(a, b) {
  let intersection = 0;
  for (const shingle of a) {
    if (b.has(shingle)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

export function jdSimilarity(textA, textB) {
  const a = jdShingles(textA);
  const b = jdShingles(textB);
  if (!a || !b) return null;
  return shingleSimilarity(a, b);
}

export function snapshotBody(relPath, rootDir) {
  if (!rootDir || typeof relPath !== 'string') return null;
  const rel = relPath.replace(/^local:/i, '').trim();
  if (!rel) return null;
  const jdsRoot = resolve(rootDir, 'jds');
  const full = resolve(rootDir, rel);
  if (!inside(jdsRoot, full)) return null;
  try {
    return readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

function reportText(reportCell, rootDir) {
  if (!reportCell || !rootDir) return null;
  const match = String(reportCell).match(/\(([^)]*reports\/[^)]+\.md)\)/);
  const rel = match ? match[1] : (/reports\/.+\.md$/.test(reportCell) ? reportCell : null);
  if (!rel) return null;
  const reportsRoot = resolve(rootDir, 'reports');
  const full = resolve(rootDir, rel);
  if (!inside(reportsRoot, full)) return null;
  try {
    return readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

// One directory listing per index build: listing jds/ for every tracker row made
// the build quadratic (thousands of rows times thousands of files).
function jdsFileNames(rootDir) {
  try {
    return readdirSync(resolve(rootDir, 'jds'));
  } catch {
    return [];
  }
}

function fallbackSnapshot(num, names) {
  const prefix = `${num}-`;
  const name = names.find((entry) => entry.startsWith(prefix));
  return name ? `jds/${name}` : null;
}

export function snapshotTextForRow(row, rootDir, names = jdsFileNames(rootDir)) {
  if (!row || !rootDir) return null;
  const report = reportText(row.report, rootDir);
  const snapshotMatch = report && report.match(/"jdSnapshot"\s*:\s*"([^"]+)"/);
  const snapshotPath = snapshotMatch ? snapshotMatch[1] : fallbackSnapshot(row.num, names);
  return snapshotPath ? snapshotBody(snapshotPath, rootDir) : null;
}

// The per-row work that reads files: the report (for the snapshot path), the
// snapshot, and the row's canonical url. Null when the row has no usable snapshot.
function deriveSnapshot(row, rootDir, names) {
  const body = snapshotTextForRow(row, rootDir, names);
  if (body === null) return null;
  const shingles = jdShingles(body);
  if (!shingles) return null;
  return { shingles, canonical: canonicalUrl(urlForRow(row, rootDir)) || '' };
}

export function buildSimilarityIndex({ appsPath, rootDir, companies, allCompanies, cache }) {
  const index = new Map();
  const includeAllCompanies = allCompanies === true;
  if (!includeAllCompanies && (!(companies instanceof Set) || !companies.size)) return index;

  let apps;
  try {
    apps = readFileSync(appsPath, 'utf8');
  } catch {
    return index;
  }

  const names = jdsFileNames(rootDir);
  for (const line of apps.split(/\r?\n/)) {
    const row = parseTrackerLine(line);
    if (!row || !row.num) continue;
    const companyKey = normalizeCompany(row.company);
    if (!includeAllCompanies && (!companyKey || !companies.has(companyKey))) continue;

    // A long-lived caller (the dashboard) passes a Map so a snapshot is read and
    // shingled once per process: the reads dominate the build time on Windows.
    const cacheKey = `${rootDir}|${row.num}|${row.report}|${row.url}`;
    let derived = cache ? cache.get(cacheKey) : undefined;
    if (derived === undefined) {
      derived = deriveSnapshot(row, rootDir, names);
      if (cache) cache.set(cacheKey, derived);
    }
    if (!derived) continue;

    const entry = {
      num: row.num,
      status: row.status,
      company: row.company,
      role: row.role,
      canonical: derived.canonical,
      shingles: derived.shingles,
    };
    if (!index.has(companyKey)) index.set(companyKey, []);
    index.get(companyKey).push(entry);
  }
  return index;
}

export function findSimilarPosting(index, { company, role, text, url, rootDir, beforeNum }) {
  const shingles = jdShingles(text);
  if (!shingles) return null;
  const companyKey = normalizeCompany(company);
  const postingCanonical = canonicalPostingUrl(url, rootDir);
  let best = null;

  // Similarity handles evaluator paraphrases that can never share a byte hash.
  for (const candidate of index?.get(companyKey) || []) {
    if (Number.isFinite(beforeNum) && candidate.num >= beforeNum) continue;
    if (!sameRole(candidate.role, role)) continue;
    if (postingCanonical && candidate.canonical && postingCanonical === candidate.canonical) continue;
    const similarity = shingleSimilarity(candidate.shingles, shingles);
    // This threshold is the measured working value for paraphrased snapshots.
    if (similarity < SIMILAR_JD_THRESHOLD) continue;
    if (!best || similarity > best.similarity ||
        (similarity === best.similarity && candidate.num < best.num)) {
      best = {
        num: candidate.num,
        status: candidate.status,
        company: candidate.company,
        role: candidate.role,
        similarity,
      };
    }
  }
  return best;
}

export function findSimilarText(index, { text, url, rootDir, beforeNum }) {
  const shingles = jdShingles(text);
  if (!shingles) return null;
  const postingCanonical = canonicalPostingUrl(url, rootDir);
  let best = null;

  for (const entries of index?.values() || []) {
    for (const candidate of entries) {
      if (Number.isFinite(beforeNum) && candidate.num >= beforeNum) continue;
      if (postingCanonical && candidate.canonical && postingCanonical === candidate.canonical) continue;
      const similarity = shingleSimilarity(candidate.shingles, shingles);
      if (similarity < SIMILAR_JD_THRESHOLD) continue;
      if (!best || similarity > best.similarity ||
          (similarity === best.similarity && candidate.num < best.num)) {
        best = {
          num: candidate.num,
          status: candidate.status,
          company: candidate.company,
          role: candidate.role,
          similarity,
        };
      }
    }
  }
  return best;
}

export function similarRepostFor(index, pending, rootDir) {
  if (!pending?.local || !pending.company || !pending.role) return null;
  const text = snapshotBody(pending.local, rootDir);
  if (text === null) return null;
  return findSimilarPosting(index, {
    company: pending.company,
    role: pending.role,
    text,
    url: pending.url,
    rootDir,
  });
}
