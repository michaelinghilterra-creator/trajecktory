/**
 * lib/portals.mjs — company identity matching for portals.yml tracked_companies.
 *
 * Why this exists: discovery deduped new companies on the ATS slug alone, so a
 * company that MIGRATED ATS looked brand new. EliseAI (Greenhouse "meetelise" →
 * Ashby "eliseai") and Grow Therapy (Greenhouse "growtherapy" → Ashby
 * "grow-therapy") were both re-registered from stale pipeline URLs on
 * 2026-07-15, each producing a second tracked_companies row pointing at a board
 * that 404s. Grow Therapy's surviving row even documented the migration in its
 * notes — but notes are prose, and no code reads prose.
 *
 * So a company gets a SET of identity keys, not one: its display name, any
 * single-word parenthetical alias, and every ATS slug it is known by, all
 * normalized to the same shape. Two entries are the same company when any key
 * matches. That catches both failure modes seen in the wild:
 *
 *   - punctuation-only drift ("growtherapy" vs "grow-therapy"), via the slug key
 *   - a genuinely different slug ("meetelise" vs "eliseai"), via the name key
 *
 * Matching is deliberately conservative. Distinct companies DO share a name —
 * Greenhouse "fetch" is Fetch (pet insurance) and Lever "fetchpackage" is Fetch
 * Package (delivery), both live, both worth scanning. Callers must therefore
 * treat a name-only match as "ask the human", not "silently drop"; see
 * discover.mjs, which skips the append but prints every collision it skipped.
 */

// Legal suffixes are noise in a company name. "co" is deliberately NOT in this
// list: it collides with real names and with AGENTS.md's folder convention,
// which keeps "Example Co" intact.
const LEGAL_SUFFIX_RE = /\b(?:inc|llc|ltd|limited|corp|corporation|gmbh|plc|ag|bv|nv|oy|ab|pty)\b/g;

// Every ATS URL shape the scanner understands, newest-style first. Kept here so
// the slug grammar has one home instead of being re-derived per script.
const SLUG_PATTERNS = [
  /(?:job-boards(?:\.eu)?|boards(?:\.eu)?)\.greenhouse\.io\/([^/?#\s]+)/,
  /boards-api\.greenhouse\.io\/v1\/boards\/([^/?#\s]+)/,
  /jobs\.ashbyhq\.com\/([^/?#\s]+)/,
  /jobs\.lever\.co\/([^/?#\s]+)/,
];

/**
 * Collapse a name or slug to a comparable key: accents folded, legal suffixes
 * dropped, everything non-alphanumeric removed. "Grow Therapy", "grow-therapy"
 * and "growtherapy" all become "growtherapy".
 *
 * Ampersands vanish rather than expanding to "and", so "Weights & Biases" →
 * "weightsbiases" lines up with a "weights-biases" slug.
 */
export function normalizeToken(s) {
  if (!s) return '';
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(LEGAL_SUFFIX_RE, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

/** Extract the board slug from any known ATS URL. '' when the host isn't one. */
export function atsSlug(url) {
  if (!url) return '';
  for (const pattern of SLUG_PATTERNS) {
    const m = String(url).match(pattern);
    if (m) return decodeURIComponent(m[1]).toLowerCase();
  }
  return '';
}

/**
 * A parenthetical is an alias only when it is a single word.
 *
 * "Align (A-LIGN)" is one company spelled two ways, so the parenthetical is a
 * real alternate name. "Fetch (Pet Insurance)" and "Lindy (legacy Ashby slug)"
 * are disambiguators and provenance notes — indexing those would make unrelated
 * companies collide on words like "insurance".
 */
function parentheticalAlias(name) {
  const m = String(name || '').match(/\(([^)]+)\)/);
  if (!m) return '';
  const inner = m[1].trim();
  return /\s/.test(inner) ? '' : inner;
}

/** Every identity key for one tracked_companies entry. */
export function companyKeys(entry) {
  const keys = new Set();
  const add = value => { const key = normalizeToken(value); if (key) keys.add(key); };

  const name = entry?.name || '';
  add(name.replace(/\([^)]*\)/g, ' '));  // base name, parentheticals stripped
  add(parentheticalAlias(name));
  for (const url of [entry?.careers_url, entry?.api].filter(Boolean)) add(atsSlug(url));

  return keys;
}

/**
 * Index every tracked company by all of its keys.
 *
 * Disabled entries are indexed too, and that is the point: an `enabled: false`
 * tombstone left behind after an ATS migration is what stops the dead slug from
 * being rediscovered. Filtering them out here would reopen this exact bug.
 */
export function buildCompanyIndex(companies = []) {
  const index = new Map();
  for (const entry of companies || []) {
    if (!entry) continue;
    for (const key of companyKeys(entry)) {
      if (!index.has(key)) index.set(key, entry);  // first entry wins, so the match is stable
    }
  }
  return index;
}

/** Fold a newly-registered company into an existing index, in place. */
export function addCompanyToIndex(index, entry) {
  for (const key of companyKeys(entry)) {
    if (!index.has(key)) index.set(key, entry);
  }
  return index;
}

/**
 * Is this discovery candidate a company we already track?
 *
 * Returns `{ entry, key, matchedOn }` where matchedOn is 'slug' or 'name', or
 * null. The slug is checked first so the common already-tracked case reports as
 * a slug match; a 'name' match means the slug is new, which is either an ATS
 * migration (skip it) or a name collision between two real companies (worth
 * surfacing). Callers need that distinction — they are not interchangeable.
 */
export function findKnownCompany(index, { slug = '', name = '' } = {}) {
  for (const [matchedOn, value] of [['slug', slug], ['name', name]]) {
    const key = normalizeToken(value);
    if (key && index.has(key)) return { entry: index.get(key), key, matchedOn };
  }
  return null;
}
