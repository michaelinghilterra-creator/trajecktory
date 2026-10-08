import { readFileSync, readdirSync } from 'fs';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'path';
import { parseTrackerLine } from './tracker.mjs';
import { canonicalUrl, normalizeCompany, urlForRow } from './identity.mjs';

const SKIPPED_STATUSES = new Set(['Rejected', 'No Response']);

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
    // Last, so an escaped entity such as &amp;lt; decodes once and stays literal text.
    .replace(/&amp;/g, '&');
}

export function fingerprintBody(text) {
  const raw = String(text ?? '').replace(/\r/g, '');
  const body = (() => {
    const lines = raw.split('\n');
    const headerEnd = lines.findIndex((line) => line.trim() === '---');
    return headerEnd >= 0 ? lines.slice(headerEnd + 1).join('\n') : raw;
  })();
  const cleaned = decodeEntities(body.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (cleaned.length < 400) return null;
  return {
    hash: createHash('sha1').update(cleaned).digest('hex'),
    length: cleaned.length,
  };
}

export function snapshotFingerprint(relPath, rootDir) {
  if (!rootDir || typeof relPath !== 'string') return null;
  const rel = relPath.replace(/^local:/i, '').trim();
  if (!rel) return null;
  const jdsRoot = resolve(rootDir, 'jds');
  const full = resolve(rootDir, rel);
  if (!inside(jdsRoot, full)) return null;
  try {
    return fingerprintBody(readFileSync(full, 'utf8'));
  } catch {
    return null;
  }
}

export function buildFingerprintIndex({ appsPath, rootDir, companies }) {
  const index = new Map();
  const wanted = companies instanceof Set ? companies : new Set();
  if (!wanted.size) return index;

  const hashByUrl = new Map();
  const jdsRoot = resolve(rootDir, 'jds');
  try {
    for (const name of readdirSync(jdsRoot)) {
      if (!name.endsWith('.md') || /^\d+-/.test(name)) continue;
      const full = resolve(jdsRoot, name);
      if (!inside(jdsRoot, full)) continue;
      let text = '';
      try {
        text = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      const source = text.match(/^\*\*Source URL:\*\*\s*(\S+)/im);
      const key = source ? canonicalUrl(source[1]) : '';
      const fp = key ? fingerprintBody(text) : null;
      if (fp) hashByUrl.set(key, fp.hash);
    }
  } catch {
    return index;
  }

  let text;
  try {
    text = readFileSync(appsPath, 'utf8');
  } catch {
    return index;
  }
  for (const line of text.split(/\r?\n/)) {
    const row = parseTrackerLine(line);
    if (!row || !row.num || SKIPPED_STATUSES.has(row.status)) continue;
    const company = normalizeCompany(row.company);
    if (!company || !wanted.has(company)) continue;
    const url = canonicalUrl(urlForRow(row, rootDir));
    const hash = url ? hashByUrl.get(url) : null;
    if (!hash) continue;
    if (!index.has(company)) index.set(company, new Map());
    const byHash = index.get(company);
    const prior = byHash.get(hash);
    if (!prior || row.num < prior.num) byHash.set(hash, { num: row.num, status: row.status });
  }
  return index;
}

export function findDuplicateJd(index, company, hash) {
  if (!index || !company || !hash) return null;
  return index.get(normalizeCompany(company))?.get(hash) || null;
}
