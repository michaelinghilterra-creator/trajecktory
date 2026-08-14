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
    .replace(/\s+of\s+/g, ' ')
    .replace(/\s+(?:and|&)\s+/g, ' ')
    .replace(/\s+/g, ' ')
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
  const out = { bare, ranked, adjacency };
  _matrixCache.set(matrix, out);
  return out;
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
      const norm = normalizeForMatch(title);
      const padded = ` ${norm} `;
      if (hasNegative(padded)) return false;
      if (matrix.bare.some(k => norm.includes(k))) return true;
      return matrix.adjacency.some(k => norm.includes(k));
    };
  }

  // Legacy path: flat positive list. Kept verbatim so a portals.yml without a
  // matrix block behaves exactly as before. Positives stay substring-lenient on
  // purpose — a too-narrow positive list (not the negatives) is what filters out
  // most postings.
  const positive = (titleFilter?.positive || []).map(normalizeForMatch).filter(Boolean);
  return (title) => {
    const norm = normalizeForMatch(title);
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
export function buildLocationFilter(titleFilter) {
  const policy = titleFilter?.location_policy;
  if (!policy) return () => true; // no policy = allow all

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

  return (location, remoteHint = '') => {
    // 1. Unknown/empty → pass
    if (!location || !location.trim()) return true;

    const loc = location.toLowerCase();

    // Detect work arrangement signals. `remoteHint` carries a per-ATS remote
    // signal from the POSTING itself (Greenhouse JD body, Lever workplaceType,
    // Ashby isRemote) — not just the short location field. A remote role that
    // lists only its HQ city ("San Francisco, CA") was being geo-blocked as
    // out-of-region because the word "remote" lived in the JD body, which the
    // location field never carried. Checking the hint recovers those roles.
    // Strict "remote" only (a bare "hybrid" outside the home region still
    // blocks — no way to make in-office days from Justin). Word-boundary match
    // so "remotely" counts but "premote"/unrelated substrings do not.
    const REMOTE_RX = /\bremote\b/;
    const hasRemote = REMOTE_RX.test(loc) || REMOTE_RX.test(String(remoteHint).toLowerCase());
    const hasHybrid = loc.includes('hybrid');
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

    // 3. Hard-no cities block, UNLESS the posting carries a remote signal.
    //    A remote role tagged with an HQ city (e.g. "San Francisco, CA; Remote")
    //    should not be killed for the HQ. Onsite/hybrid in a hard-no metro still
    //    blocks (no way to make in-office days from the configured home region).
    //    Errs toward catching: a
    //    geo-restricted "remote, Bay Area only" role slips through to eval, where
    //    the full JD and the user make the call. (Widen 2026-06-23.)
    if (hardNo.some(city => loc.includes(city))) {
      if (hasRemote) return true;
      return false;
    }

    // 4. Home core cities → always pass
    if (homeCore.some(city => loc.includes(city))) return true;

    // 5. Home metro suburbs → always pass
    if (metro.some(city => loc.includes(city))) return true;

    // 6. Flexible-only cities → pass only if remote or hybrid signal
    if (flexOnly.some(city => loc.includes(city))) {
      return isFlexible;
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
        if (dist <= radiusMi) return true;   // within commute → any arrangement
        return isFlexible;                    // outside radius → remote/hybrid only
      }
      // In-region city not in the coords table → pass through (let Claude decide)
      return true;
    }

    // 10. Out of region with a remote signal → pass
    if (hasRemote) return true;

    // 11. Out of region, no remote signal → block, but ONLY when we actually
    //     know where home is. With no home_region configured, every location on
    //     earth is "out of region", and blocking on that would reject the user's
    //     own city. Pass to eval instead.
    return !hasRegion;
  };
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
