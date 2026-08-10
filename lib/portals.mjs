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

// ── Writing new tracked_companies entries ─────────────────────────────────────
// Extracted from discover.mjs so BOTH the deterministic discover path AND the
// dashboard's agent-scan path (lib/portal-additions.mjs) build and insert entries
// through ONE implementation. A second copy is exactly how the read side rotted
// (five disagreeing parsers) — the same failure the identity/tracker modules
// exist to prevent, applied to the write side.

/** Turn an ATS slug into a human display name: "grow-therapy" → "Grow Therapy". */
export function slugToName(slug) {
  return decodeURIComponent(String(slug || '')).replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
}

/**
 * Build one tracked_companies entry from a parsed ATS reference.
 *
 * `parsed` = { type: 'greenhouse'|'ashby'|'lever', slug }. The careers_url and
 * (for Greenhouse) api are CONSTRUCTED from the slug here — never taken from an
 * outside string — so a caller feeding attacker-influenced discovery data cannot
 * smuggle an arbitrary host into portals.yml that a later scan would fetch (the
 * `api:` field is passed straight to fetch() by scan.mjs). Ashby/Lever derive
 * their API from careers_url at scan time, so no api line is emitted for them.
 *
 * Returns { name, company, yaml } — `company` is in tracked_companies shape so it
 * can be folded into the identity index to dedupe the rest of a run; `yaml` is the
 * text block (leading newline included) ready to insert.
 */
export function buildPortalsEntry(parsed, { today = '', note = '', companyHint = '' } = {}) {
  const { type, slug } = parsed;
  const name = companyHint || slugToName(slug);
  const company = { name };

  if (type === 'greenhouse') {
    company.careers_url = `https://job-boards.greenhouse.io/${slug}`;
    company.api = `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
  } else if (type === 'ashby') {
    company.careers_url = `https://jobs.ashbyhq.com/${encodeURIComponent(slug)}`;
  } else if (type === 'lever') {
    company.careers_url = `https://jobs.lever.co/${slug}`;
  }

  // The note is quoted YAML; a stray double-quote inside would break the file, so
  // collapse quotes to apostrophes. The name is emitted UNQUOTED (matching every
  // existing entry), so its safety is the caller's job — parsePortalAdditions
  // sanitizes agent-supplied names before they reach here.
  const safeNote = String(note || `Discovered ${today}.`).replace(/"/g, "'").replace(/[\r\n]+/g, ' ');
  const lines = [`\n  - name: ${name}`];
  if (company.careers_url) lines.push(`    careers_url: ${company.careers_url}`);
  if (company.api)         lines.push(`    api: ${company.api}`);
  lines.push(`    notes: "${safeNote}"`);
  lines.push(`    enabled: true`);

  return { name, company, yaml: lines.join('\n') };
}

/**
 * Insert entry YAML blocks into portals.yml text, returning the new text (pure —
 * the caller writes it). Inserts right after the "Auto-discovered" header comment
 * when present so all machine-added entries stay grouped, else appends at the end.
 *
 * EOL-agnostic: portals.yml is user-edited and may be CRLF or LF. Matching a
 * header + '\n' literal against a CRLF file never hit, so the old writer rewrote
 * identical bytes and every registration silently no-oped. We locate the header
 * by index and emit the block in the file's OWN detected EOL.
 */
export const AUTODISCOVER_HEADER = '  # -- Auto-discovered via site: search --';

export function insertPortalsEntries(portalsRaw, yamlBlocks) {
  const blocks = (yamlBlocks || []).filter(Boolean);
  if (!blocks.length) return portalsRaw;
  const eol = portalsRaw.includes('\r\n') ? '\r\n' : '\n';
  const block = (blocks.join('') + '\n').split('\n').join(eol);
  let text = portalsRaw;
  const headerIdx = text.indexOf(AUTODISCOVER_HEADER);
  if (headerIdx !== -1) {
    const lineEnd = text.indexOf('\n', headerIdx);
    const insertAt = lineEnd === -1 ? text.length : lineEnd + 1;
    return text.slice(0, insertAt) + block + text.slice(insertAt);
  }
  return text.trimEnd() + eol + eol + AUTODISCOVER_HEADER + block;
}
