#!/usr/bin/env node
/**
 * portals.test.mjs — unit tests for lib/portals.mjs, the company identity
 * matcher that decides whether a discovered ATS board is a company we already
 * track.
 *
 * The regression these lock down is real and dated: on 2026-07-15 discovery
 * re-registered EliseAI and Grow Therapy from stale Greenhouse URLs, even
 * though both had already migrated to Ashby and were already tracked. Each got
 * a second tracked_companies row pointing at a board that 404s, scanned on
 * every run, returning nothing, forever.
 *
 * Run: node tests/portals.test.mjs   (exit 0 = pass, 1 = fail)
 */

import {
  normalizeToken,
  atsSlug,
  companyKeys,
  buildCompanyIndex,
  addCompanyToIndex,
  findKnownCompany,
} from '../lib/portals.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('portals.test.mjs');

// ── normalizeToken ──────────────────────────────────────────────────────────
check(normalizeToken('Grow Therapy') === 'growtherapy', 'name → key');
check(normalizeToken('grow-therapy') === 'growtherapy', 'hyphenated slug → same key');
check(normalizeToken('growtherapy') === 'growtherapy', 'bare slug → same key');
check(normalizeToken('Weights & Biases') === 'weightsbiases', 'ampersand is dropped, not expanded');
check(normalizeToken('Datadog, Inc.') === 'datadog', 'legal suffix stripped');
check(normalizeToken('Example Co') === 'exampleco', '"Co" is NOT stripped (collides with real names)');
check(normalizeToken('Klarna AB') === 'klarna', 'non-US legal suffix stripped');
check(normalizeToken('Blücher') === 'blucher', 'accents folded');
check(normalizeToken('') === '' && normalizeToken(null) === '' && normalizeToken(undefined) === '',
  'empty / null / undefined → empty key');

// ── atsSlug ─────────────────────────────────────────────────────────────────
check(atsSlug('https://job-boards.greenhouse.io/meetelise') === 'meetelise', 'greenhouse board slug');
check(atsSlug('https://boards-api.greenhouse.io/v1/boards/meetelise/jobs') === 'meetelise', 'greenhouse api slug');
check(atsSlug('https://job-boards.eu.greenhouse.io/acme') === 'acme', 'greenhouse EU host');
check(atsSlug('https://jobs.ashbyhq.com/eliseai') === 'eliseai', 'ashby slug');
check(atsSlug('https://jobs.lever.co/aledade') === 'aledade', 'lever slug');
check(atsSlug('https://jobs.ashbyhq.com/grow%2Dtherapy') === 'grow-therapy', 'percent-encoded slug decoded');
check(atsSlug('https://zendesk.wd1.myworkdayjobs.com/zendesk') === '', 'non-ATS host → no slug');
check(atsSlug('') === '' && atsSlug(null) === '', 'empty url → no slug');

// ── companyKeys ─────────────────────────────────────────────────────────────
const eliseai = { name: 'EliseAI', careers_url: 'https://jobs.ashbyhq.com/eliseai' };
check(companyKeys(eliseai).has('eliseai'), 'entry is keyed by its name and slug');

const alignKeys = companyKeys({ name: 'Align (A-LIGN)', careers_url: 'https://job-boards.greenhouse.io/align' });
check(alignKeys.has('align'), 'single-word parenthetical is indexed as an alias');

const fetchKeys = companyKeys({ name: 'Fetch (Pet Insurance)', careers_url: 'https://job-boards.greenhouse.io/fetch' });
check(fetchKeys.has('fetch') && !fetchKeys.has('petinsurance'),
  'multi-word parenthetical is a disambiguator, NOT an alias');

const gh = companyKeys({
  name: 'Acme',
  careers_url: 'https://job-boards.greenhouse.io/acmeco',
  api: 'https://boards-api.greenhouse.io/v1/boards/acmeco/jobs',
});
check(gh.has('acme') && gh.has('acmeco'), 'both careers_url and api contribute keys');

// ── The 2026-07-15 regression: ATS migration must not read as a new company ──
const tracked = [
  // Ashby entries that already existed when the stale Greenhouse URLs were replayed.
  { name: 'EliseAI',      careers_url: 'https://jobs.ashbyhq.com/eliseai' },
  { name: 'Grow Therapy', careers_url: 'https://jobs.ashbyhq.com/grow-therapy',
    notes: 'Migrated from Greenhouse -> Ashby 2026-06-10' },
];
const index = buildCompanyIndex(tracked);

const growth = findKnownCompany(index, { slug: 'growtherapy', name: 'Grow Therapy' });
check(growth !== null, 'REGRESSION: greenhouse "growtherapy" is recognised as tracked Grow Therapy');
check(growth?.matchedOn === 'slug', 'Grow Therapy matches on slug alone (punctuation-only drift)');

const elise = findKnownCompany(index, { slug: 'meetelise', name: 'EliseAI' });
check(elise !== null, 'REGRESSION: greenhouse "meetelise" is recognised as tracked EliseAI');
check(elise?.matchedOn === 'name', 'EliseAI matches on name (slug genuinely differs)');
check(elise?.entry.name === 'EliseAI', 'the matched entry is returned for reporting');

// Without a company hint the differing slug is unknowable — documents the limit.
check(findKnownCompany(index, { slug: 'meetelise', name: '' }) === null,
  'a differing slug with NO name hint is still unmatched (why tombstones exist)');

// ── Tombstones must stay indexed ────────────────────────────────────────────
const withTombstone = buildCompanyIndex([
  { name: 'Interview Kickstart', careers_url: 'https://jobs.ashbyhq.com/interview-kickstart' },
  { name: 'Interview Kickstart (legacy Greenhouse slug)', enabled: false,
    careers_url: 'https://job-boards.greenhouse.io/interviewkickstart' },
]);
check(findKnownCompany(withTombstone, { slug: 'interviewkickstart' }) !== null,
  'a disabled tombstone still blocks rediscovery of its dead slug');

// ── Distinct companies sharing a name must stay distinct ────────────────────
const fetchIndex = buildCompanyIndex([
  { name: 'Fetch (Pet Insurance)', careers_url: 'https://job-boards.greenhouse.io/fetch' },
  { name: 'Fetch Package',         careers_url: 'https://jobs.lever.co/fetchpackage' },
]);
const pet = findKnownCompany(fetchIndex, { slug: 'fetch' });
const pkg = findKnownCompany(fetchIndex, { slug: 'fetchpackage' });
check(pet?.entry.name === 'Fetch (Pet Insurance)' && pkg?.entry.name === 'Fetch Package',
  'two real companies named Fetch resolve to their own entries');

// A name collision is reported as a NAME match so callers can surface it rather
// than dropping it — these are the cases only a human can adjudicate.
const collision = findKnownCompany(fetchIndex, { slug: 'fetchrewards', name: 'Fetch' });
check(collision?.matchedOn === 'name', 'name collision surfaces as a name match, not a slug match');

// ── Index mechanics ─────────────────────────────────────────────────────────
check(buildCompanyIndex([]).size === 0, 'empty company list → empty index');
check(buildCompanyIndex(undefined).size === 0, 'undefined company list → empty index');
check(buildCompanyIndex([null, undefined]).size === 0, 'null entries are skipped');

const first = { name: 'Acme', careers_url: 'https://jobs.lever.co/acme' };
const dupIdx = buildCompanyIndex([first, { name: 'Acme', careers_url: 'https://jobs.lever.co/acme' }]);
check(findKnownCompany(dupIdx, { slug: 'acme' })?.entry === first, 'first entry wins on duplicate keys');

const live = buildCompanyIndex([{ name: 'Acme', careers_url: 'https://jobs.lever.co/acme' }]);
check(findKnownCompany(live, { slug: 'newco' }) === null, 'unknown company is not matched');
addCompanyToIndex(live, { name: 'NewCo', careers_url: 'https://jobs.lever.co/newco' });
check(findKnownCompany(live, { slug: 'newco' }) !== null,
  'a company registered mid-run dedupes the rest of that run');

check(findKnownCompany(live, {}) === null, 'no slug and no name → no match');

console.log(`\n${failed === 0 ? '✅' : '❌'} portals.test.mjs: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
