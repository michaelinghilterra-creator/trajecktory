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

export function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(normalizeForMatch).filter(Boolean);
  const negative = (titleFilter?.negative || []).map(normalizeForMatch).filter(Boolean);

  return (title) => {
    const norm = normalizeForMatch(title);
    // Negative keywords must match a WHOLE token run, not a fragment buried in
    // an unrelated word. The old substring match silently dropped real, relevant
    // postings: negative "hr" hit "Ant-hr-opic" and "T-hr-eat Intelligence",
    // "java" hit "JavaScript", "engineer" hit "Engineering". Pad with spaces so
    // " hr " only matches a standalone "hr" token. Positives stay substring-
    // lenient on purpose — they widen the funnel, and a too-narrow positive list
    // (not the negatives) is what filters out most postings.
    const padded = ` ${norm} `;
    const hasPositive = positive.length === 0 || positive.some(k => norm.includes(k));
    const hasNegative = negative.some(k => padded.includes(` ${k} `));
    return hasPositive && !hasNegative;
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
  const positive = (titleFilter?.positive || []).map(normalizeForMatch).filter(Boolean);
  const seniority = (titleFilter?.seniority_boost || []).map(normalizeForMatch).filter(Boolean);
  let score = 0;
  for (const k of positive) if (norm.includes(k)) score += 2;
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
 *  1. Empty/unknown location          → PASS
 *  2. City-less arrangement/country/
 *     placeholder string              → PASS (UNKNOWN, let eval decide)
 *  3. Hard-no city                    → BLOCK (unless a remote signal is present)
 *  4. Dallas / Fort Worth / DFW       → PASS (any arrangement)
 *  5. DFW metro suburb                → PASS (any arrangement)
 *  6. Austin                          → PASS if remote/hybrid, BLOCK if onsite
 *  7. Other TX city ≤ radius miles    → PASS (any arrangement)
 *  8. Other TX city > radius + remote → PASS
 *  9. Other TX city > radius + onsite → BLOCK
 * 10. Non-TX with "remote" signal     → PASS
 * 11. Non-TX without "remote"         → BLOCK
 *
 * Rules 7-9 need location_policy.home.{lat,lon} in portals.yml. Without them
 * the radius math is skipped and TX cities pass through to eval via rule 7's
 * unknown-city path. No home coordinates are hardcoded in this module.
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
    //    blocks (cannot make in-office days from TX). Errs toward catching: a
    //    geo-restricted "remote, Bay Area only" role slips through to eval, where
    //    the full JD and the user make the call. (Widen 2026-06-23.)
    if (hardNo.some(city => loc.includes(city))) {
      if (hasRemote) return true;
      return false;
    }

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
      // Try haversine against known TX city coords. With no home configured
      // there is no origin to measure from, so every TX city falls through to
      // the pass-through below and eval makes the call.
      const match = hasHome ? txCoords.find(c => loc.includes(c.name)) : null;
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

// Query keys that uniquely IDENTIFY a posting and must survive normalization
// even though the rest of the query string is discarded. Some companies proxy
// their Greenhouse board through a custom domain with one static path shared
// by every posting (e.g. contoso.com/company/careers/open-positions/job)
// where `gh_jid` is the ONLY thing distinguishing one job from another —
// stripping it collapsed every posting from that company to the same dedup
// key (audit 2026-07-15: ~14 companies, ~1,000 postings made permanently
// invisible). Lever (hostedUrl) and Ashby (jobUrl) always bake the job id
// into the URL PATH instead, so neither needs an entry here.
const ID_QUERY_KEYS = new Set(['gh_jid']);

// Strip tracking query params (utm_*, gh_src, etc. — anything not in
// ID_QUERY_KEYS) and a trailing /application or /apply so the same posting
// isn't re-added just because the URL variant changed (Ashby/Greenhouse expose
// /application, Lever exposes /apply). Query filtering happens on the query
// string alone, and /application|/apply stripping happens on the base path
// alone, so the two never interfere with each other regardless of which one
// the URL has. The (?:application|apply) group only strips a WHOLE trailing
// segment, so a company slug like jobs.lever.co/applydigital/{uuid} is left
// intact ("apply" there is followed by "digital", not "/" or end-of-string).
export function normalizeUrl(url) {
  const qIndex = url.indexOf('?');
  const rawBase = qIndex === -1 ? url : url.slice(0, qIndex);
  const query = qIndex === -1 ? '' : url.slice(qIndex + 1);

  const base = rawBase.replace(/\/(?:application|apply)(\/.*)?$/, '').replace(/\/$/, '');
  if (!query) return base;

  const kept = query.split('&').filter(pair => ID_QUERY_KEYS.has(pair.split('=')[0]));
  return kept.length ? `${base}?${kept.join('&')}` : base;
}
