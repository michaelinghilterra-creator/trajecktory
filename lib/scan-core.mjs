/**
 * lib/scan-core.mjs — pure helpers for the portal scanner.
 *
 * Extracted from scan.mjs so the dedup and title-filter primitives can be
 * unit-tested in isolation (they were previously module-private and only
 * exercisable through a full end-to-end scan). No I/O, no network.
 */

// Note: "Chief of Staff" normalizes to "chief staff", which is fine — no
// real job title contains "chief staff" as a substring except actual
// Chief-of-Staff postings.
export function normalizeForMatch(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[—–()|/,:\-]/g, ' ')   // em-dash, en-dash, parens, comma, colon, pipe, slash, hyphen
    .replace(/\s+/g, ' ')
    .replace(/ of /g, ' ')
    .replace(/ (?:and|&) /g, ' ')
    // Fold the spelled-out form into the abbreviation so one "VP of X" positive
    // covers both. Runs after punctuation/whitespace normalization so
    // "Vice-President" and "Vice  President" fold too. (Audit 2026-07-15: a
    // "Vice President, Data & Insights" posting was invisible to the "VP of
    // Data & Insights" positive.)
    .replace(/\bvice president\b/g, 'vp')
    .trim();
}

// Expand a title_filter.matrix block into match primitives, or return null when
// no matrix is configured (callers then fall back to the legacy flat lists).
//
// The matrix replaces ~200 hand-listed "seniority + function" phrases with a
// compact definition of intent:
//   functions_bare    pass at ANY level (RevOps / Sales Ops / GTM Ops ...).
//   functions_ranked  need a seniority word ADJACENT (either order), because
//                     their bare form floods with IC/analyst roles.
//   modifiers         an optional scope word ("Global", "Enterprise") allowed
//                     between the seniority and the function.
// normalizeForMatch strips "of"/commas/"and"/"&" and folds "vice president"->
// "vp", so ONE entry per (level, function) covers every surface form:
// "Director of Analytics" == "Director, Analytics" == norm "director analytics".
// Generating both orders also catches trailing forms ("Analytics Director")
// that the old hand-list silently missed. Cached by matrix identity so the
// (potentially thousands of) generated substrings are built once per config.
const _matrixCache = new WeakMap();
export function expandTitleMatrix(matrix) {
  if (!matrix) return null;
  if (_matrixCache.has(matrix)) return _matrixCache.get(matrix);
  const norm = (a) => (a || []).map(normalizeForMatch).filter(Boolean);
  const seniority = norm(matrix.seniority);
  const modifiers = norm(matrix.modifiers);
  const bare = norm(matrix.functions_bare);
  const ranked = norm(matrix.functions_ranked);
  const adjacency = [];
  for (const s of seniority) for (const f of ranked) {
    adjacency.push(`${s} ${f}`);
    adjacency.push(`${f} ${s}`);
    for (const m of modifiers) adjacency.push(`${s} ${m} ${f}`);
  }
  // Tokenized runs for the proximity pass (see matchesRankedProximity). The
  // literal `adjacency` strings above stay as the fast path and as the
  // backward-compatible contract; proximity only ever ADDS matches.
  const tok = (s) => s.split(' ').filter(Boolean);
  const seniorityTok = seniority.map(tok);
  const rankedTok = ranked.map(tok);
  const out = { bare, ranked, adjacency, seniorityTok, rankedTok };
  _matrixCache.set(matrix, out);
  return out;
}

/**
 * Span of `phrase` inside `tokens`, allowing up to `maxGap` filler tokens
 * between consecutive phrase words. Returns [start, end] or null.
 *
 * Strict adjacency made the matrix blind to titles that interleave a qualifier:
 * "Sales Platform Strategy" never matched the ranked function "sales strategy",
 * and "Enablement, Strategy & Channel Operations" never matched "strategy
 * operations". maxGap=1 recovers those without letting two unrelated words on
 * opposite ends of a long title pair up.
 *
 * The titles in these comments are invented. Real ones are traceable back to a
 * specific posting and employer, and this file ships to every user.
 */
export function findLooseRun(tokens, phrase, maxGap = 1) {
  if (!phrase.length) return null;
  for (let start = 0; start < tokens.length; start++) {
    if (tokens[start] !== phrase[0]) continue;
    let i = start, p = 1;
    while (p < phrase.length) {
      let found = -1;
      const limit = Math.min(i + 1 + maxGap, tokens.length - 1);
      for (let j = i + 1; j <= limit; j++) if (tokens[j] === phrase[p]) { found = j; break; }
      if (found === -1) break;
      i = found; p++;
    }
    if (p === phrase.length) return [start, i];
  }
  return null;
}

/**
 * Does a ranked function sit NEAR a seniority word, rather than glued to it?
 *
 * The literal-adjacency pass requires the seniority token to touch the function
 * phrase, so a seniority word pushed to the other side of a qualifier was
 * dropped: "Revenue Strategy & Forecasting, Sr. Manager" failed only because
 * "forecasting" sat between "revenue strategy" and "sr manager". An audit found
 * this class rejecting roles above the apply floor.
 *
 * Seniority runs must still be contiguous (maxGap 0), because "senior director"
 * is a fixed phrase, while the function may absorb one filler word, and up to
 * `window` tokens may separate the two runs.
 */
export function matchesRankedProximity(tokens, matrix, { maxGap = 1, window = 2 } = {}) {
  if (!matrix?.seniorityTok?.length || !matrix?.rankedTok?.length) return false;
  const seniorityHits = [];
  for (const s of matrix.seniorityTok) {
    const run = findLooseRun(tokens, s, 0);
    if (run) seniorityHits.push(run);
  }
  if (!seniorityHits.length) return false;
  for (const f of matrix.rankedTok) {
    const fr = findLooseRun(tokens, f, maxGap);
    if (!fr) continue;
    for (const sr of seniorityHits) {
      const gap = fr[0] > sr[1] ? fr[0] - sr[1] - 1
                : sr[0] > fr[1] ? sr[0] - fr[1] - 1
                : 0;                                   // overlapping runs
      if (gap <= window) return true;
    }
  }
  return false;
}

// "Associate Director" / "Associate VP" / "Associate Head" are director/VP-tier
// titles, NOT the junior "Associate" IC that the negative list targets. Drop the
// "associate" prefix when it directly precedes a seniority word, so the compound
// is judged by its real seniority ("associate director" -> "director"), while a
// standalone "Associate" (or "Associate Coordinator") keeps the word and is still
// blocked. Audit 2026-08-22: real "Associate Director, Revenue Operations" roles
// at multiple employers were being vetoed by the "associate" negative and
// vanished silently. normalizeForMatch has already folded "vice president" ->
// "vp", so only director/vp/head/chief need listing here.
export function promoteSeniorCompounds(norm) {
  return norm.replace(/\bassociate\s+(?=(?:director|vp|head|chief)\b)/g, '');
}

// True when `phrase` occurs in `text` with no letter or digit touching either
// end, so punctuation left by normalizeForMatch ("analytics.") still matches
// but a word fragment ("zx" inside "zxylophone") does not.
export function containsWholePhrase(text, phrase) {
  if (!phrase) return false;
  const isWordChar = (c) => c !== undefined && /[a-z0-9]/.test(c);
  for (let i = text.indexOf(phrase); i !== -1; i = text.indexOf(phrase, i + 1)) {
    if (!isWordChar(text[i - 1]) && !isWordChar(text[i + phrase.length])) return true;
  }
  return false;
}

export function buildTitleFilter(titleFilter) {
  const negative = (titleFilter?.negative || []).map(normalizeForMatch).filter(Boolean);
  // Negative keywords must match a WHOLE token run, not a fragment buried in an
  // unrelated word. The old substring match silently dropped real postings:
  // "hr" hit "Ant-hr-opic", "java" hit "JavaScript", "engineer" hit
  // "Engineering". Pad with spaces so " hr " only matches a standalone token.
  const hasNegative = (padded) => negative.some(k => padded.includes(` ${k} `));

  // Preferred path: the declarative matrix (see expandTitleMatrix).
  const matrix = expandTitleMatrix(titleFilter?.matrix);
  if (matrix) {
    return (title) => {
      const norm = promoteSeniorCompounds(normalizeForMatch(title));
      const padded = ` ${norm} `;
      if (hasNegative(padded)) return false;
      if (matrix.bare.some(k => norm.includes(k))) return true;
      // Whole words only. A plain substring let a short ranked function match
      // the start of an unrelated word ("manager zx" inside "Manager,
      // Zxylophone Tuning"), so short ranked functions admitted unrelated roles.
      if (matrix.adjacency.some(k => containsWholePhrase(norm, k))) return true;
      // Proximity is strictly additive to the literal-adjacency pass above, so
      // nothing that matched before can stop matching.
      return matchesRankedProximity(norm.split(' ').filter(Boolean), matrix);
    };
  }

  // Legacy path: flat positive list. Kept verbatim so a portals.yml without a
  // matrix block behaves exactly as before. Positives stay substring-lenient on
  // purpose — a too-narrow positive list (not the negatives) is what filters out
  // most postings.
  const positive = (titleFilter?.positive || []).map(normalizeForMatch).filter(Boolean);
  return (title) => {
    const norm = promoteSeniorCompounds(normalizeForMatch(title));
    const padded = ` ${norm} `;
    const hasPositive = positive.length === 0 || positive.some(k => norm.includes(k));
    return hasPositive && !hasNegative(padded);
  };
}

// Cheap, no-LLM relevance score for RANKING scanned postings so the best-fit
// roles get evaluated first. The dashboard evaluates pipeline.md top-down in
// batches, so scan.mjs sorts new offers by this score before appending. Signals
// (all free at scan time): positive-keyword density (the core fit signal), a
// whole-token seniority-prefix boost, and posting recency. Higher = better fit.
// Unknown/missing dates are neutral (no recency bonus, no penalty).
export function scoreOffer(offer, titleFilter) {
  const norm = normalizeForMatch(offer?.title);
  if (!norm) return 0;
  // Density keywords: the matrix's function phrases when a matrix is configured,
  // else the legacy flat positive list. Keeps ranking meaningful under both.
  const matrix = expandTitleMatrix(titleFilter?.matrix);
  const density = matrix
    ? [...matrix.bare, ...matrix.ranked]
    : (titleFilter?.positive || []).map(normalizeForMatch).filter(Boolean);
  const seniority = (titleFilter?.seniority_boost || []).map(normalizeForMatch).filter(Boolean);
  let score = 0;
  for (const k of density) if (norm.includes(k)) score += 2;
  const padded = ` ${norm} `;
  if (seniority.some(k => padded.includes(` ${k} `))) score += 3;
  const t = offer?.postedAt ? new Date(offer.postedAt).getTime() : NaN;
  if (!isNaN(t)) {
    const ageDays = (Date.now() - t) / 86400000;
    if (ageDays < 7) score += 2; else if (ageDays < 30) score += 1;
  }
  return score;
}

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

const DEFAULT_REMOTE_COUNTRIES = [
  'united states', 'us', 'usa', 'united states of america',
];

const DEFAULT_FOREIGN_MARKERS = [
  'united kingdom', 'uk', 'england', 'london', 'ireland', 'dublin', 'europe', 'emea',
  'germany', 'berlin', 'munich', 'france', 'paris', 'spain', 'madrid', 'barcelona',
  'italy', 'milan', 'netherlands', 'amsterdam', 'poland', 'warsaw', 'portugal',
  'lisbon', 'sweden', 'stockholm', 'switzerland', 'zurich', 'apac', 'asia',
  'hong kong', 'singapore', 'china', 'japan', 'tokyo', 'korea', 'seoul', 'india',
  'bangalore', 'bengaluru', 'australia', 'sydney', 'melbourne', 'new zealand',
  'latam', 'brazil', 'sao paulo', 'mexico', 'argentina', 'colombia', 'kazakhstan',
  'almaty', 'israel', 'tel aviv', 'dubai', 'uae',
];

const DEFAULT_TITLE_REGION_BLOCKS = [
  'emea', 'apac', 'latam', 'dach', 'nordics', 'anz', 'southern europe',
  'northern europe', 'western europe', 'central europe', 'eastern europe',
  'japan', 'uk&i', 'uki', 'benelux', 'mena', 'apj',
];

const US_TITLE_REGIONS = [
  'north america', 'americas', 'us', 'usa', 'united states', 'namer', 'amer',
];

const US_STATE_NAMES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
  'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho',
  'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine',
  'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi',
  'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey',
  'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio',
  'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina',
  'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia',
  'washington', 'west virginia', 'wisconsin', 'wyoming', 'district of columbia',
];

const US_LOCATION_REGIONS = [
  'united states', 'united states of america', 'us', 'usa',
  'americas', 'north america', 'amer',
];

const LOCATION_REMOTE_RX = /\b(?:remote|distributed)\b|\bhome[\s-]+based\b/i;
const REMOTE_OPTION_ASSERTION = /\bremote\s+is\s+(?:always\s+)?an\s+option\b/i;

/**
 * The only body-text phrases allowed to establish that a posting is remote.
 * Keep assertions and disqualifiers together so future tuning cannot widen one
 * without reviewing the other. `remote(?:ly)?` deliberately matches both
 * "remote" and "remotely"; a plain `\bremote\b` does not match "remotely".
 */
export const REMOTE_BODY_RULES = Object.freeze({
  assertions: Object.freeze([
    /\b(?:this|the|all|our)\s+(?:role|position|job|roles|positions|jobs)\s+(?:is|are|will\s+be)\s+(?:(?:fully|completely|entirely)\s+)?remote(?:ly)?\b/i,
    /\b100\s*%\s+remote\b/i,
    /\bfully\s+remote\b/i,
    /\bremote\s*[-–—]\s*first\b/i,
    /\bremote\s*\(\s*(?:u\.?s\.?a?\.?|united\s+states(?:\s+of\s+america)?)\s*\)/i,
    /\bremote\s+(?:within|from)\s+(?:anywhere\s+in\s+)?(?:the\s+)?(?:u\.?s\.?a?\.?|united\s+states(?:\s+of\s+america)?)\b/i,
    /\bwork\s+from\s+anywhere\s+in\s+(?:the\s+)?(?:u\.?s\.?a?\.?|united\s+states(?:\s+of\s+america)?)\b/i,
    /\blocation\s*:\s*remote\b/i,
    /\bcan\s+be\s+performed\s+remote(?:ly)?\b/i,
    /\bor\s+remote(?:\s*\(\s*(?:u\.?s\.?a?\.?|united\s+states(?:\s+of\s+america)?)\s*\)|\s+(?:within\s+)?(?:the\s+)?(?:u\.?s\.?a?\.?|united\s+states(?:\s+of\s+america)?))\b/i,
    /\bremote\s*,?\s*(?:u\.?s\.?a?\.?|united\s+states(?:\s+of\s+america)?)\b/i,
    /\bselect\s+remote\b/i,
    /\b(?:in\s+(?:the\s+)?office|office|on[-\s]?site)\s*,?\s+or\s+remote(?:ly)?\b/i,
    REMOTE_OPTION_ASSERTION,
  ]),
  disqualifiers: Object.freeze([
    /\bif\b/i,
    /\bmay\b/i,
    /\bcertain\s+roles\b/i,
    /\bother\b/i,
    /\bnot\b/i,
    /\bno\s+remote\b/i,
    /\bexcept\b/i,
    /\bsome\s+roles\b/i,
    /\beligible\b/i,
    /\bpreferred\s+location\b/i,
  ]),
});

function decodeHtmlText(value) {
  const named = {
    lt: '<', gt: '>', amp: '&', nbsp: ' ', '#39': "'", quot: '"',
    mdash: '—', ndash: '–', hellip: '…',
  };
  return String(value || '')
    .replace(/&(#(?:x[0-9a-f]+|\d+)|lt|gt|amp|nbsp|quot|mdash|ndash|hellip);/gi, (match, entity) => {
      const key = entity.toLowerCase();
      if (key.startsWith('#')) {
        const hex = key[1] === 'x';
        const codePoint = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (Number.isFinite(codePoint)) {
          try { return String.fromCodePoint(codePoint); } catch { return match; }
        }
      }
      return named[key] ?? match;
    })
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasRemoteBodyAssertion(body) {
  const text = decodeHtmlText(body);
  if (!text) return false;
  const sentences = text.split(/(?:[.!?;]+|\s+[\u2013\u2014]\s+)/).map(s => s.trim()).filter(Boolean);
  const hasCleanAssertion = sentences.some(sentence =>
    REMOTE_BODY_RULES.assertions.some(rule => rule.test(sentence)) &&
    !REMOTE_BODY_RULES.disqualifiers.some(rule => rule.test(sentence)));
  if (hasCleanAssertion) return true;

  // "If not, remote is always an option" is an affirmative fallback, but the
  // sentence-level `if`/`not` disqualifiers would hide it. Only this assertion
  // gets comma-clause handling: conditional phrases such as "if the role can
  // be performed remote, ..." remain blocked by the normal sentence check.
  return sentences.some(sentence => sentence.split(',').some(clause =>
    REMOTE_OPTION_ASSERTION.test(clause) &&
    !REMOTE_BODY_RULES.disqualifiers.some(rule => rule.test(clause))));
}

function phrasePattern(phrase) {
  const escaped = String(phrase || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return escaped ? new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i') : null;
}

function containsPhrase(text, phrases) {
  return phrases.some(phrase => phrasePattern(phrase)?.test(text));
}

function normalizeWorkplace(value) {
  const normalized = String(value || '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  if (normalized === 'remote') return 'remote';
  if (normalized === 'hybrid') return 'hybrid';
  if (normalized === 'onsite' || normalized === 'on site') return 'onsite';
  return '';
}

function hasUsLocationToken(location) {
  if (containsPhrase(location, [...US_LOCATION_REGIONS, ...US_STATE_NAMES])) return true;
  return /,\s*(?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)\b/i.test(location);
}

/**
 * Builds a smart location filter from portals.yml location_policy.
 *
 * Decision tree (applied in order):
 *  1. Empty/unknown location            → PASS
 *  2. City-less arrangement/country/
 *     placeholder string                → PASS (UNKNOWN, let eval decide)
 *  3. Hard-no city                      → BLOCK (unless a remote signal is present)
 *  4. Home core city                    → PASS (any arrangement)
 *  5. Home metro suburb                 → PASS (any arrangement)
 *  6. Flexible-only city                → PASS if remote/hybrid, BLOCK if onsite
 *  7. Other in-region city ≤ radius     → PASS (any arrangement)
 *  8. Other in-region city > radius,
 *     remote/hybrid                     → PASS
 *  9. Other in-region city > radius,
 *     onsite                            → BLOCK
 * 10. Out-of-region with "remote"       → PASS
 * 11. Out-of-region without "remote"    → BLOCK, but ONLY if a home region is
 *                                         configured (see below)
 *
 * Rules 7-9 need location_policy.home.{lat,lon}. Without them the radius math is
 * skipped and in-region cities pass through to eval via rule 7's unknown-city
 * path. No home coordinates are hardcoded in this module.
 *
 * ── Region is CONFIG, not geography baked into this file (fix 2026-07-21) ────
 * Rules 7-11 used to test `loc.includes('texas') || ' tx' || ', tx'` literally.
 * The city LISTS were always config-driven, so this looked harmless, but the
 * region test was not, and it broke every user outside Texas in a way that was
 * invisible:
 *
 *   - The radius math in 7-9 could never fire for them, because their own state
 *     never matched the hardcoded token. Their `commute_radius_miles` did nothing.
 *   - Rule 11 then blocked every onsite and hybrid posting that was not spelled
 *     out in home_core/metro_allow — including roles in their own home city.
 *
 * The result was a silent near-zero scan the moment the Launchpad location step
 * wrote a policy, with no error and no counter to explain it. A beta tester hit
 * exactly this (report 2026-07-21).
 *
 * `home_region` now supplies those tokens (e.g. ['ohio', ' oh', ', oh']).
 *
 * WHEN NO REGION IS CONFIGURED, RULE 11 DOES NOT BLOCK. That asymmetry is
 * deliberate and load-bearing. "I do not know which region is home" cannot mean
 * "block everywhere that is not home" — that is a filter with no origin deciding
 * that everywhere is wrong. It fails open to eval instead, matching the same
 * reasoning as the missing-home-coordinates case above: absent config, skip the
 * judgment rather than guess. Over-blocking here is invisible (roles never
 * appear); over-passing is visible and cheap (the user sees a role and skips it).
 *
 * Legacy region-specific key names are still read as aliases, so an existing
 * portals.yml keeps working untouched: dfw_core → home_core,
 * hybrid_remote_only → flexible_only, tx_city_coords → region_city_coords.
 * Those names date from a build that hardcoded one metro. A policy carrying
 * them but no explicit `home_region` keeps that original region behavior rather
 * than silently widening a filter the user already tuned.
 */
export function buildLocationDecision(titleFilter) {
  const policy = titleFilter?.location_policy;
  if (!policy) return () => ({ pass: true, rule: 'no_policy' }); // no policy = allow all

  const home       = policy.home || {};
  // Home comes from config, and there is deliberately NO fallback coordinate
  // pair. A hardcoded default would silently measure every commute from some
  // other person's town and mis-filter the whole scan while looking like it
  // worked. Absent lat/lon, skip the radius math instead of guessing.
  const hasHome    = Number.isFinite(home.lat) && Number.isFinite(home.lon);
  const homeLat    = home.lat;
  const homeLon    = home.lon;
  const radiusMi   = home.commute_radius_miles || 50;

  const hardNo     = (policy.hard_no || []).map(k => k.toLowerCase());
  const homeCore   = (policy.home_core || policy.dfw_core || []).map(k => k.toLowerCase());
  const metro      = (policy.metro_allow || []).map(k => k.toLowerCase());
  const flexOnly   = (policy.flexible_only || policy.hybrid_remote_only || []).map(k => k.toLowerCase());
  const regionCoords = (policy.region_city_coords || policy.tx_city_coords || []).map(c => ({
    name: c.name.toLowerCase(),
    lat: c.lat,
    lon: c.lon,
  }));

  // Tokens that mark a posting as being in the user's home region. An explicit
  // home_region wins. Failing that, a policy still on the legacy key names keeps
  // the region those keys implied, rather than silently widening a filter the
  // user already tuned. A policy with neither is region-less, and rule 11 stands
  // down (see the docblock).
  const legacyRegion = policy.dfw_core || policy.tx_city_coords;
  const regionTokens = (policy.home_region || (legacyRegion ? ['texas', ' tx', ', tx'] : []))
    .map(k => k.toLowerCase());
  const hasRegion = regionTokens.length > 0;

  const remoteCountries = (policy.remote_countries || DEFAULT_REMOTE_COUNTRIES)
    .map(k => String(k).toLowerCase().trim()).filter(Boolean);
  const foreignMarkers = (policy.foreign_markers || DEFAULT_FOREIGN_MARKERS)
    .map(k => String(k).toLowerCase().trim()).filter(Boolean);
  const titleRegionBlocks = (policy.title_region_blocks || DEFAULT_TITLE_REGION_BLOCKS)
    .map(k => String(k).toLowerCase().trim()).filter(Boolean);

  return (location, remoteHint = '', meta = {}) => {
    // 1. Unknown/empty → pass
    const loc = String(location || '').toLowerCase().trim();
    const title = String(meta?.title || '').toLowerCase();
    const countries = Array.isArray(meta?.countries)
      ? meta.countries.map(country => String(country).toLowerCase().trim()).filter(Boolean)
      : [];
    const workplace = normalizeWorkplace(meta?.workplace);

    // Region/country exclusions run before every remote rescue. Structured
    // country data is authoritative; only fall back to parsing the location
    // string when the ATS supplied no countries.
    if (containsPhrase(title, titleRegionBlocks) && !containsPhrase(title, US_TITLE_REGIONS)) {
      return { pass: false, rule: 'title_region_block' };
    }
    if (countries.length && !countries.some(country => remoteCountries.includes(country))) {
      return { pass: false, rule: 'structured_country_block' };
    }
    if (!countries.length && loc && containsPhrase(loc, foreignMarkers) && !hasUsLocationToken(loc)) {
      return { pass: false, rule: 'foreign_location_block' };
    }

    if (!loc) return { pass: true, rule: 'unknown_location' };

    // Structured arrangement wins. Body text is considered only when the ATS
    // has no structured value, and then only a role-level assertion counts.
    // The short location remains lenient for ATS labels such as "Remote" and
    // "San Francisco, CA; Remote". A plain \bremote\b does not match
    // "remotely"; REMOTE_BODY_RULES handles that form explicitly.
    const hasRemote = workplace === 'remote' ||
      (workplace === '' && (LOCATION_REMOTE_RX.test(loc) || hasRemoteBodyAssertion(remoteHint)));
    const hasHybrid = workplace === 'hybrid' || (workplace === '' && /\bhybrid\b/.test(loc));
    const isFlexible = hasRemote || hasHybrid;

    // 2. City-less arrangement/country/placeholder strings pass through as
    //    UNKNOWN, same as rule 1. A bare work-arrangement word ("Hybrid" with
    //    no city), a country-only string ("United States", "Canada/US"), or a
    //    Workday location-count placeholder ("2 Locations", "Multiple
    //    Locations") tells us nothing about commute distance — only that the
    //    ATS omitted or genericized the actual city. Blocking these outright
    //    killed ~10 on-target Director+ roles across six employers (audit
    //    2026-07-15). Strip known
    //    arrangement/country noise and a "<count-or-vague-qualifier> <place>"
    //    placeholder ("2 Locations", "Multiple Locations", "Various Locations",
    //    "Multiple Cities", "Several Offices" — the same city-less placeholder
    //    across Workday/Greenhouse/Lever/Ashby), plus a bare "Various"; if
    //    nothing but punctuation is left, there's no city to judge — pass it to
    //    eval, where the full JD makes the real location call. A string that
    //    also names an actual city (blocked or not) leaves a non-empty residual
    //    and falls through to the checks below unaffected — this does NOT weaken
    //    the hard-no block for a hybrid/onsite role that names a blocked city.
    //    The placeholder strip only fires on a qualifier token (a digit /
    //    multiple / various / several / many) IMMEDIATELY before a place noun,
    //    so a real city that merely contains "city"/"office"/"site" ("Kansas
    //    City", "Twin Cities") has no qualifier and is never touched. The
    //    qualifier+noun strip runs BEFORE the bare-"various" strip, so "Various
    //    Locations" collapses whole (not to a dangling "Locations").
    const residual = loc
      .replace(/\b(?:remote|distributed)\b/g, ' ')
      .replace(/\bhome[\s-]+based\b/g, ' ')
      .replace(/\bhybrid\b/g, ' ')
      .replace(/\bon-?site\b/g, ' ')
      .replace(/\bunited states(?: of america)?\b/g, ' ')
      .replace(/\bu\.?s\.?a?\.?\b/g, ' ')
      .replace(/\bcanada\b/g, ' ')
      .replace(/\b(?:\d+|multiple|various|several|many)\s+(?:locations?|offices?|sites?|cities)\b/g, ' ')
      .replace(/\bvarious\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    if (!residual) return { pass: true, rule: 'cityless_location' };

    // 3. Hard-no cities block, UNLESS the posting carries a remote signal.
    //    A remote role tagged with an HQ city (e.g. "San Francisco, CA; Remote")
    //    should not be killed for the HQ. Onsite/hybrid in a hard-no metro still
    //    blocks (no way to make in-office days from the configured home region).
    //    Errs toward catching: a
    //    geo-restricted "remote, Bay Area only" role slips through to eval, where
    //    the full JD and the user make the call. (Widen 2026-06-23.)
    if (hardNo.some(city => loc.includes(city))) {
      if (hasRemote) return { pass: true, rule: 'hard_no_remote_rescue' };
      return { pass: false, rule: 'hard_no_block' };
    }

    // 4. Home core cities → always pass
    if (homeCore.some(city => loc.includes(city))) return { pass: true, rule: 'home_core' };

    // 5. Home metro suburbs → always pass
    if (metro.some(city => loc.includes(city))) return { pass: true, rule: 'metro_allow' };

    // 6. Flexible-only cities → pass only if remote or hybrid signal
    if (flexOnly.some(city => loc.includes(city))) {
      return { pass: isFlexible, rule: isFlexible ? 'flexible_only_flexible' : 'flexible_only_block' };
    }

    // 7–9. Other city inside the home region
    const inRegion = hasRegion && regionTokens.some(tok => loc.includes(tok));
    if (inRegion) {
      // Try haversine against known in-region city coords. With no home
      // configured there is no origin to measure from, so every in-region city
      // falls through to the pass-through below and eval makes the call.
      const match = hasHome ? regionCoords.find(c => loc.includes(c.name)) : null;
      if (match) {
        const dist = haversineMiles(homeLat, homeLon, match.lat, match.lon);
        if (dist <= radiusMi) return { pass: true, rule: 'in_region_within_radius' };
        return { pass: isFlexible, rule: isFlexible ? 'in_region_flexible' : 'in_region_outside_radius' };
      }
      // In-region city not in the coords table → pass through (let Claude decide)
      return { pass: true, rule: 'in_region_unknown_city' };
    }

    // 10. Out of region with a remote signal → pass
    if (hasRemote) return { pass: true, rule: 'out_of_region_remote' };

    // 11. Out of region, no remote signal → block, but ONLY when we actually
    //     know where home is. With no home_region configured, every location on
    //     earth is "out of region", and blocking on that would reject the user's
    //     own city. Pass to eval instead.
    return { pass: !hasRegion, rule: hasRegion ? 'out_of_region_block' : 'no_home_region' };
  };
}

export function buildLocationFilter(titleFilter) {
  const decide = buildLocationDecision(titleFilter);
  const filter = (location, remoteHint = '', meta = {}) => decide(location, remoteHint, meta).pass;
  filter.explain = decide;
  return filter;
}

// URL normalization moved to lib/identity.mjs, which is now the ONE place that
// decides whether two things are the same posting. It used to live here, and
// three other files each grew their own slightly different copy: one matched
// raw strings, one stripped the entire query (destroying the gh_jid that is the
// only id on some Greenhouse boards), one stripped the query but not a trailing
// /application. They disagreed, so the same posting was "seen" by one check and
// "new" to another.
//
// Re-exported under the old name so every existing caller (scan.mjs,
// merge-tracker.mjs, and the scan-core tests) keeps working unchanged.
export { canonicalUrl as normalizeUrl } from './identity.mjs';
