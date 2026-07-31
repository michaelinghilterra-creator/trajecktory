// lib/employer-directory.mjs — cached employer HQ directory for the TWC report.
//
// The TWC work-search log wants an employer mailing address and phone. The tracker
// stores neither — it knows the company name and the posting URL and nothing more.
// Rather than hand-key an address for every application, the TWC tab looks each
// distinct employer up once via web search (see lib/twc.mjs enrichEmployers) and
// remembers the answer here, so regenerating a report never re-searches a company
// that was already resolved.
//
// One version:1 JSON sidecar under DATA_DIR (gitignored user data, covered by
// data/* in .gitignore), whole-file rewrite, keyed by normalizeToken(company) from
// lib/portals.mjs so "Example Inc." and "Example" collapse to one entry. Mirrors
// the coach/posts persistence exactly. The file is hand-editable: correcting a
// wrong address means opening the JSON and fixing the row.
import fs from 'fs';
import { EMPLOYER_CACHE_PATH } from '../config.mjs';
import { normalizeToken } from '../../../lib/portals.mjs';

function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(EMPLOYER_CACHE_PATH, 'utf8'));
    return { employers: (raw && typeof raw.employers === 'object' && raw.employers) || {} };
  } catch { return { employers: {} }; }
}
function writeStore(store) {
  fs.writeFileSync(EMPLOYER_CACHE_PATH, JSON.stringify({
    version: 1,
    employers: store.employers || {},
  }, null, 2) + '\n');
}

// The normalized cache key for a company name (exported so callers can dedupe a
// report's employers on the exact key the directory uses).
export function employerKey(company) { return normalizeToken(company); }

// The whole directory as { normalizedKey: entry }. Read-only snapshot.
export function readEmployerDirectory() {
  return readStore().employers;
}

// One employer's cached record, or null. Keyed by the normalized company name.
export function getEmployer(company) {
  const key = normalizeToken(company);
  if (!key) return null;
  return readStore().employers[key] || null;
}

// Has this company been looked up at all? An entry exists even when the search
// found nothing (source 'not-found'), so a company with no discoverable HQ is not
// re-searched on every report.
export function hasEmployer(company) {
  const key = normalizeToken(company);
  return !!(key && readStore().employers[key]);
}

function normalizeEntry(e, now) {
  return {
    company: String(e.company || '').trim(),
    hqAddress: String(e.hqAddress || '').trim(),
    phone: String(e.phone || '').trim(),
    website: String(e.website || '').trim(),
    source: e.source || 'web-search',
    fetchedAt: e.fetchedAt || now,
  };
}

// Upsert one looked-up employer. Returns the stored entry.
export function setEmployer(company, fields = {}) {
  const key = normalizeToken(company);
  if (!key) return null;
  const store = readStore();
  store.employers[key] = normalizeEntry({ company, ...fields }, new Date().toISOString());
  writeStore(store);
  return store.employers[key];
}

// Batch upsert — one read-modify-write for many employers. Enrichment runs several
// lookups concurrently, and each setEmployer would rewrite the whole file; doing
// them together avoids a lost-update race on the single JSON file. Returns the
// updated { key: entry } map.
export function mergeEmployers(entries) {
  const store = readStore();
  const now = new Date().toISOString();
  for (const e of (entries || [])) {
    const key = normalizeToken(e && e.company);
    if (!key) continue;
    store.employers[key] = normalizeEntry(e, now);
  }
  writeStore(store);
  return store.employers;
}
