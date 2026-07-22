#!/usr/bin/env node
/**
 * scan-core.test.mjs — unit tests for lib/scan-core.mjs, the scanner's dedup
 * and title-filter primitives. These drive whether a new posting is re-added
 * (dedup) or ever reaches evaluation (title filter), and were previously
 * module-private in scan.mjs with no direct coverage.
 *
 * Run: node tests/scan-core.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { normalizeUrl, buildTitleFilter, buildLocationFilter, normalizeForMatch, scoreOffer } from '../lib/scan-core.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('scan-core.test.mjs');

// ── normalizeUrl (dedup key) ──────────────────────────────────────────────────
check(normalizeUrl('https://x.com/jobs/1/application') === 'https://x.com/jobs/1',
  'strips trailing /application');
check(normalizeUrl('https://x.com/jobs/1?utm=a&src=b') === 'https://x.com/jobs/1',
  'strips query string');
check(normalizeUrl('https://x.com/jobs/1/') === 'https://x.com/jobs/1',
  'strips trailing slash');
check(normalizeUrl('https://x.com/jobs/1') === 'https://x.com/jobs/1',
  'leaves clean url unchanged');
// Query is stripped BEFORE /application, so a `/application?query` URL collapses
// to the same clean key as the bare posting (previously it kept /application and
// failed to dedupe — see lib/scan-core.mjs normalizeUrl).
check(normalizeUrl('https://x.com/jobs/1/application?utm=a') === 'https://x.com/jobs/1',
  '/application + query string both stripped (dedupes to clean url)');
check(normalizeUrl('https://x.com/jobs/1/application/?utm=a') === 'https://x.com/jobs/1',
  '/application/ + trailing slash + query all stripped');
// Lever exposes the apply variant as `.../apply` (Ashby/Greenhouse use
// `/application`). It must collapse to the same bare key, or the apply URL is
// re-added as a duplicate row. The strip is segment-anchored: a company slug
// that merely STARTS with "apply" (jobs.lever.co/applydigital/…) is NOT touched.
check(normalizeUrl('https://jobs.lever.co/acme/29bda415-3896-45d3/apply') === 'https://jobs.lever.co/acme/29bda415-3896-45d3',
  'strips trailing /apply (Lever)');
check(normalizeUrl('https://jobs.lever.co/acme/29bda415-3896-45d3/apply?utm=x') === 'https://jobs.lever.co/acme/29bda415-3896-45d3',
  '/apply + query string both stripped (dedupes to clean url)');
check(normalizeUrl('https://jobs.lever.co/applyworks/be70d3cb-2d5e-4b59') === 'https://jobs.lever.co/applyworks/be70d3cb-2d5e-4b59',
  'does NOT strip "apply" inside a company slug that merely starts with it');
check(normalizeUrl('https://apply.workable.com/northwind/j/BA4D0137BF/') === 'https://apply.workable.com/northwind/j/BA4D0137BF',
  'does NOT strip the apply.workable.com host (apply only in hostname)');

// gh_jid is the ONLY thing distinguishing postings on a Greenhouse board
// proxied through a shared-path custom domain. Stripping it collapsed every
// posting from that company to one dedup key (audit 2026-07-15). It must
// survive normalization, and two different job ids must NOT normalize to the
// same key.
check(normalizeUrl('https://contoso.com/company/careers/open-positions/job?gh_jid=4001001001') === 'https://contoso.com/company/careers/open-positions/job?gh_jid=4001001001',
  'preserves gh_jid on a shared-path Greenhouse proxy URL');
check(normalizeUrl('https://contoso.com/company/careers/open-positions/job?gh_jid=1111') !==
      normalizeUrl('https://contoso.com/company/careers/open-positions/job?gh_jid=2222'),
  'two different gh_jid values do NOT collapse to the same dedup key');
check(normalizeUrl('https://northwind.com/job?gh_jid=4002002002&utm_source=indeed&utm_medium=cpc') === 'https://northwind.com/job?gh_jid=4002002002',
  'strips utm_* tracking params while keeping gh_jid');
check(normalizeUrl('https://www.acme.com/careers?utm_source=x&gh_jid=4003003003') === 'https://www.acme.com/careers?gh_jid=4003003003',
  'keeps gh_jid regardless of its position in the query string');
check(normalizeUrl('https://x.com/jobs/1/application?gh_jid=555') === 'https://x.com/jobs/1?gh_jid=555',
  'strips /application segment while still preserving gh_jid');
check(normalizeUrl('https://x.com/jobs/1/apply?gh_jid=555') === 'https://x.com/jobs/1?gh_jid=555',
  'strips /apply segment while still preserving gh_jid');
// A board that already bakes the job id into the PATH (boards.greenhouse.io
// style) has no query-string ambiguity, so a bare gh_jid with no other
// tracking params round-trips unchanged.
check(normalizeUrl('https://boards.greenhouse.io/exampleco/jobs/5550001?gh_jid=5550001') === 'https://boards.greenhouse.io/exampleco/jobs/5550001?gh_jid=5550001',
  'path-unique Greenhouse URL keeps its gh_jid too (harmless — key stays unique either way)');
// Non-identifying query strings with no gh_jid still fully strip, unaffected
// by the new allowlist logic.
check(normalizeUrl('https://x.com/jobs/1?utm_source=a&utm_medium=b') === 'https://x.com/jobs/1',
  'non-identifying query params still strip completely (no gh_jid present)');

// ── normalizeForMatch ─────────────────────────────────────────────────────────
check(normalizeForMatch('Head of Applied AI') === 'head applied ai',
  'lowercases and drops " of "');
check(normalizeForMatch('Engineer (Backend), Remote') === 'engineer backend remote',
  'strips parens and commas');
check(normalizeForMatch('Sales & Marketing') === 'sales marketing',
  'drops " & "');
check(normalizeForMatch('') === '', 'empty stays empty');
// Spelled-out "Vice President" folds to "vp" so one "VP of X" positive covers
// both forms (audit 2026-07-15: a "Vice President, Data & Insights" posting was
// invisible to the "VP of Data & Insights" positive).
check(normalizeForMatch('Vice President, Data & Insights') === 'vp data insights',
  '"Vice President" folds to "vp"');
check(normalizeForMatch('Vice-President of Analytics') === 'vp analytics',
  'hyphenated "Vice-President" folds to "vp"');
check(normalizeForMatch('VP of Data & Insights') === 'vp data insights',
  'abbreviated VP form normalizes identically');
check(normalizeForMatch('Executive Vice President, Sales') === 'executive vp sales',
  'EVP spelled-out form folds without clobbering the prefix');

// ── buildTitleFilter (positive/negative gate) ─────────────────────────────────
const f = buildTitleFilter({ positive: ['engineer', 'developer'], negative: ['intern', 'junior'] });
check(f('Senior Software Engineer') === true, 'matches a positive keyword');
check(f('Backend Developer') === true, 'matches an alternate positive keyword');
check(f('Engineering Intern') === false, 'negative keyword excludes even with positive');
check(f('Product Manager') === false, 'no positive keyword excludes');

// Empty positive list means "match everything not negated".
const openFilter = buildTitleFilter({ positive: [], negative: ['intern'] });
check(openFilter('Anything At All') === true, 'empty positive list passes non-negated titles');
check(openFilter('Summer Intern') === false, 'empty positive list still applies negatives');

// Undefined filter config should not throw and should pass everything.
const noFilter = buildTitleFilter(undefined);
check(noFilter('Any Title') === true, 'undefined filter config passes everything');

// Negative keywords match WHOLE tokens, not fragments inside unrelated words.
// Regression: substring matching silently dropped real, relevant postings —
// "hr" hit "Anthropic"/"Threat", "java" hit "JavaScript", "engineer" hit
// "Engineering". These must now PASS, while real standalone tokens still drop.
const wb = buildTitleFilter({ positive: ['director', 'analyst'], negative: ['hr', 'java', 'engineer'] });
check(wb('Anthropic Data Analyst') === true, 'negative "hr" does not drop "Anthropic" (ant-hr-opic)');
check(wb('Threat Intelligence Analyst') === true, 'negative "hr" does not drop "Threat" (t-hr-eat)');
check(wb('Director of JavaScript Analytics') === true, 'negative "java" does not drop "JavaScript"');
check(wb('Director, Reliability Engineering') === true, 'negative "engineer" does not drop "Engineering"');
check(wb('HR Director') === false, 'negative "hr" still drops a standalone "HR" token');
check(wb('Java Director') === false, 'negative "java" still drops a standalone "Java" token');

// ── scoreOffer (best-fit ranking) ─────────────────────────────────────────────
// Drives the order scan.mjs writes pipeline.md, so the dashboard's batch
// evaluation scores the best matches first. postedAt omitted = no recency term,
// keeping these assertions deterministic.
const tf = { positive: ['AI', 'Platform Engineer', 'Product Manager'], seniority_boost: ['Senior', 'Staff', 'Director'] };
check(scoreOffer({ title: 'Senior AI Platform Engineer' }, tf) > scoreOffer({ title: 'Marketing Coordinator' }, tf),
  'a strong title outranks an off-target one');
check(scoreOffer({ title: 'Staff AI Engineer' }, tf) > scoreOffer({ title: 'AI Engineer' }, tf),
  'seniority boost lifts an otherwise-equal title');
check(scoreOffer({ title: 'Marketing Coordinator' }, tf) === 0,
  'no positive-keyword match scores 0');
check(scoreOffer({ title: '' }, tf) === 0 && scoreOffer({}, tf) === 0,
  'empty / missing title scores 0 (no throw)');
// Recency adds on top of the same title (fresh > old), proving the date term applies.
check(scoreOffer({ title: 'AI Product Manager', postedAt: new Date().toISOString() }, tf) >
      scoreOffer({ title: 'AI Product Manager', postedAt: '2000-01-01T00:00:00Z' }, tf),
  'a fresh posting outranks an identical stale one');

// ── buildLocationFilter (geo gate) ─────────────────────────────────────────────
// Mirrors the shape of portals.yml's title_filter.location_policy, trimmed to
// the entries these tests exercise.
const locPolicy = {
  location_policy: {
    home: { lat: 32.7767, lon: -96.7970, commute_radius_miles: 50 },
    hard_no: ['new york', 'san francisco', 'chicago'],
    dfw_core: ['dallas', 'fort worth', 'dfw'],
    metro_allow: ['plano', 'frisco'],
    hybrid_remote_only: ['austin'],
    tx_city_coords: [
      { name: 'waco', lat: 31.5493, lon: -97.1467 },      // ~87mi, outside radius
      { name: 'denton', lat: 33.2148, lon: -97.1331 },    // ~36mi, inside radius
    ],
  },
};
const lf = buildLocationFilter(locPolicy);

check(lf('') === true, 'empty location passes (unknown)');
check(lf(undefined) === true, 'undefined location passes (unknown)');

// Regression (audit 2026-07-15): a bare arrangement word, a country-only
// string, or a Workday "N Locations" placeholder names no city at all, so it
// must be treated as UNKNOWN and passed through to eval — not blocked.
check(lf('Hybrid') === true, 'bare "Hybrid" with no city passes as unknown');
check(lf('Remote') === true, 'bare "Remote" with no city passes as unknown');
check(lf('Onsite') === true, 'bare "Onsite" with no city passes as unknown');
check(lf('United States') === true, 'country-only "United States" passes as unknown');
check(lf('Canada/US') === true, '"Canada/US" combo passes as unknown');
check(lf('US') === true, 'bare "US" abbreviation passes as unknown');
check(lf('2 Locations') === true, 'Workday "2 Locations" placeholder passes as unknown');
check(lf('3 Locations') === true, 'Workday "3 Locations" placeholder passes as unknown');
check(lf('Multiple Locations') === true, 'Workday "Multiple Locations" placeholder passes as unknown');
check(lf('Various Locations') === true, '"Various Locations" placeholder passes as unknown');
check(lf('Several Locations') === true, '"Several Locations" placeholder passes as unknown');
check(lf('Multiple Cities') === true, '"Multiple Cities" placeholder passes as unknown');
check(lf('Various') === true, 'bare "Various" placeholder passes as unknown');
// The placeholder strip only fires on a qualifier token, so a real city that
// merely contains "city"/"cities" is NOT stripped and still blocks (non-TX).
check(lf('Kansas City, MO') === false, '"Kansas City" is not a placeholder — real non-TX city still blocks');
check(lf('Twin Cities, MN') === false, '"Twin Cities" is not a placeholder — real non-TX metro still blocks');

// A hard-no city named ALONGSIDE noise must still block — the fix only widens
// city-LESS strings, it never weakens a named-city block. Cover BOTH strip
// families: the arrangement-word strip AND the country strip (the country
// regexes are the new code, and a hard-no city + "United States" is the most
// realistic ATS string that must stay blocked — a greedier country regex that
// swallowed the city would silently re-open the bug in reverse).
check(lf('Hybrid - Chicago, IL') === false, 'hybrid role naming a hard-no city still blocks');
check(lf('San Francisco, CA') === false, 'onsite hard-no city still blocks');
check(lf('New York, United States') === false, 'hard-no city + country string still blocks (country-strip path)');
check(lf('San Francisco, United States') === false, 'hard-no city + country string still blocks (country-strip path)');
check(lf('San Francisco, CA; Remote') === true, 'hard-no city WITH a remote signal still passes (unchanged)');
// A NAMED non-TX city + arrangement word must still block: only a case that (a)
// runs the strip and (b) names a city that must survive can catch the strip
// eating a real city token. Hybrid does not rescue a non-TX city under rule 11.
check(lf('Denver, CO (Hybrid)') === false, 'named non-TX city + hybrid still blocks (over-strip guard)');

// Pre-existing DFW/metro/Austin/TX-radius/non-TX behavior must survive the change.
check(lf('Dallas, TX') === true, 'DFW core passes onsite');
check(lf('Plano, TX') === true, 'DFW metro suburb passes onsite');
check(lf('Austin, TX') === false, 'Austin onsite still blocks');
check(lf('Austin, TX (Hybrid)') === true, 'Austin hybrid still passes');
check(lf('Denton, TX') === true, 'TX city within commute radius passes onsite');
check(lf('Waco, TX') === false, 'TX city outside commute radius blocks onsite');
check(lf('Waco, TX (Remote)') === true, 'TX city outside commute radius passes remote');
check(lf('Denver, CO') === false, 'named non-TX city with no remote signal still blocks');
check(lf('Denver, CO (Remote)') === true, 'named non-TX city with remote signal still passes');

// A policy with no home block must NOT fall back to some hardcoded town: there
// is no origin to measure from, so the radius math is skipped and TX cities
// pass through to eval (rule 7's unknown-city path). Guards against a default
// coordinate pair creeping back in and silently measuring every commute from
// the wrong place. Non-TX behavior is unaffected (rules 10-11 need no origin).
const noHome = buildLocationFilter({
  location_policy: {
    hard_no: ['new york'],
    dfw_core: ['dallas'],
    tx_city_coords: [{ name: 'waco', lat: 31.5493, lon: -97.1467 }],
  },
});
check(noHome('Waco, TX') === true, 'no home configured: TX city passes through to eval, not judged by a default origin');
check(noHome('Dallas, TX') === true, 'no home configured: dfw_core list still passes (no coords needed)');
check(noHome('New York, NY') === false, 'no home configured: hard_no still blocks (no coords needed)');
check(noHome('Denver, CO') === false, 'no home configured: non-TX with no remote signal still blocks');

// ── Region is configurable, not hardcoded to Texas (fix 2026-07-21) ───────────
// Rules 7-11 used to test a literal 'texas'/' tx' token, so a user anywhere else
// got no radius math and a rule-11 block on everything not spelled out by name —
// including their own home city. Silent near-zero scans, no error, no counter.
const ohio = buildLocationFilter({
  location_policy: {
    home: { lat: 39.9612, lon: -82.9988, commute_radius_miles: 50 },  // Columbus
    home_region: ['ohio', ' oh', ', oh'],
    hard_no: ['new york'],
    home_core: ['columbus'],
    metro_allow: ['dublin', 'westerville'],
    flexible_only: ['cleveland'],
    region_city_coords: [
      { name: 'springfield', lat: 39.9242, lon: -83.8088 },  // ~44mi, inside
      { name: 'toledo',      lat: 41.6528, lon: -83.5379 },  // ~120mi, outside
    ],
  },
});
check(ohio('Columbus, OH') === true,           'generic region: home core passes onsite');
check(ohio('Dublin, OH') === true,             'generic region: metro suburb passes onsite');
check(ohio('Springfield, OH') === true,        'generic region: in-region city within radius passes onsite');
check(ohio('Toledo, OH') === false,            'generic region: in-region city outside radius blocks onsite');
check(ohio('Toledo, OH (Remote)') === true,    'generic region: in-region city outside radius passes remote');
check(ohio('Cleveland, OH') === false,         'generic region: flexible_only city blocks onsite');
check(ohio('Cleveland, OH (Hybrid)') === true, 'generic region: flexible_only city passes hybrid');
check(ohio('Denver, CO') === false,            'generic region: out-of-region blocks with no remote signal');
check(ohio('Denver, CO (Remote)') === true,    'generic region: out-of-region passes remote');
check(ohio('New York, NY') === false,          'generic region: hard_no still blocks');
// The bug in one line: under the old hardcoded test this was FALSE, because an
// Ohio address is not Texas and rule 11 blocked it.
check(ohio('Dallas, TX') === false,            'generic region: Texas is out-of-region for an Ohio user');

// Legacy Texas key names keep working untouched, so an existing portals.yml does
// not need to be rewritten and a filter the user already tuned is not silently
// widened underneath them.
const legacy = buildLocationFilter({
  location_policy: {
    home: { lat: 32.7767, lon: -96.7970, commute_radius_miles: 50 },
    dfw_core: ['dallas'],
    hybrid_remote_only: ['austin'],
    tx_city_coords: [{ name: 'denton', lat: 33.2148, lon: -97.1331 }],
  },
});
check(legacy('Dallas, TX') === true,        'legacy keys: dfw_core still passes');
check(legacy('Denton, TX') === true,        'legacy keys: tx_city_coords radius math still runs');
check(legacy('Austin, TX') === false,       'legacy keys: hybrid_remote_only still blocks onsite');
check(legacy('Denver, CO') === false,       'legacy keys: implied TX region still blocks out-of-region onsite');

// A region-less policy must NOT block the world. This is the fail-open case:
// with no home_region and no legacy TX keys there is no origin, so rule 11 stands
// down and eval makes the call. Blocking here would reject the user's own city.
const noRegion = buildLocationFilter({
  location_policy: {
    hard_no: ['new york'],
    metro_allow: ['plano'],
  },
});
check(noRegion('Denver, CO') === true,      'no region configured: out-of-region onsite passes to eval, not blocked');
check(noRegion('Columbus, OH') === true,    'no region configured: any real city passes to eval');
check(noRegion('Plano, TX') === true,       'no region configured: metro_allow still passes');
check(noRegion('New York, NY') === false,   'no region configured: hard_no still blocks (needs no origin)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
