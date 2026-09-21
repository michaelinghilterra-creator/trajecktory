#!/usr/bin/env node
/**
 * portals.test.mjs — unit tests for lib/portals.mjs, the company identity
 * matcher that decides whether a discovered ATS board is a company we already
 * track.
 *
 * The regression these lock down is real and dated: on 2030-07-15 discovery
 * re-registered two companies from stale Greenhouse URLs, even
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
check(normalizeToken('Zorblax Widgetry') === 'zorblaxwidgetry', 'name → key');
check(normalizeToken('zorblax-widgetry') === 'zorblaxwidgetry', 'hyphenated slug → same key');
check(normalizeToken('zorblaxwidgetry') === 'zorblaxwidgetry', 'bare slug → same key');
check(normalizeToken('Zorblax & Sons') === 'zorblaxsons', 'ampersand is dropped, not expanded');
check(normalizeToken('Zorblax, Inc.') === 'zorblax', 'legal suffix stripped');
check(normalizeToken('Example Co') === 'exampleco', '"Co" is NOT stripped (collides with real names)');
check(normalizeToken('Quennox AB') === 'quennox', 'non-US legal suffix stripped');
check(normalizeToken('Blücher') === 'blucher', 'accents folded');
check(normalizeToken('') === '' && normalizeToken(null) === '' && normalizeToken(undefined) === '',
  'empty / null / undefined → empty key');

// ── atsSlug ─────────────────────────────────────────────────────────────────
check(atsSlug('https://job-boards.greenhouse.io/quennoxold') === 'quennoxold', 'greenhouse board slug');
check(atsSlug('https://boards-api.greenhouse.io/v1/boards/quennoxold/jobs') === 'quennoxold', 'greenhouse api slug');
check(atsSlug('https://job-boards.eu.greenhouse.io/acme') === 'acme', 'greenhouse EU host');
check(atsSlug('https://jobs.ashbyhq.com/quennox') === 'quennox', 'ashby slug');
check(atsSlug('https://jobs.lever.co/zorblax') === 'zorblax', 'lever slug');
check(atsSlug('https://jobs.ashbyhq.com/zorblax%2Dwidgetry') === 'zorblax-widgetry', 'percent-encoded slug decoded');
check(atsSlug('https://zorblax.wd1.myworkdayjobs.com/zorblax') === '', 'non-ATS host → no slug');
check(atsSlug('') === '' && atsSlug(null) === '', 'empty url → no slug');

// ── companyKeys ─────────────────────────────────────────────────────────────
const quennox = { name: 'Quennox', careers_url: 'https://jobs.ashbyhq.com/quennox' };
check(companyKeys(quennox).has('quennox'), 'entry is keyed by its name and slug');

const alignKeys = companyKeys({ name: 'Quennox (Q-RATCHET)', careers_url: 'https://job-boards.greenhouse.io/quennox' });
check(alignKeys.has('qratchet'), 'single-word parenthetical is indexed as an alias');

const fetchKeys = companyKeys({ name: 'Zorblax (Pet Insurance)', careers_url: 'https://job-boards.greenhouse.io/zorblax' });
check(fetchKeys.has('zorblax') && !fetchKeys.has('petinsurance'),
  'multi-word parenthetical is a disambiguator, NOT an alias');

const gh = companyKeys({
  name: 'Acme',
  careers_url: 'https://job-boards.greenhouse.io/acmeco',
  api: 'https://boards-api.greenhouse.io/v1/boards/acmeco/jobs',
});
check(gh.has('acme') && gh.has('acmeco'), 'both careers_url and api contribute keys');

// ── The 2030-07-15 regression: ATS migration must not read as a new company ──
const tracked = [
  // Ashby entries that already existed when the stale Greenhouse URLs were replayed.
  { name: 'Quennox Ratchet Works', careers_url: 'https://jobs.ashbyhq.com/quennox' },
  { name: 'Zorblax Widgetry', careers_url: 'https://jobs.ashbyhq.com/zorblax-widgetry',
    notes: 'Migrated from Greenhouse -> Ashby 2030-06-10' },
];
const index = buildCompanyIndex(tracked);

const growth = findKnownCompany(index, { slug: 'zorblaxwidgetry', name: 'Zorblax Widgetry' });
check(growth !== null, 'REGRESSION: greenhouse "zorblaxwidgetry" is recognised as tracked Zorblax Widgetry');
check(growth?.matchedOn === 'slug', 'Zorblax Widgetry matches on slug alone (punctuation-only drift)');

const elise = findKnownCompany(index, { slug: 'quennoxold', name: 'Quennox Ratchet Works' });
check(elise !== null, 'REGRESSION: greenhouse "quennoxold" is recognised as tracked Quennox Ratchet Works');
check(elise?.matchedOn === 'name', 'Quennox Ratchet Works matches on name (slug genuinely differs)');
check(elise?.entry.name === 'Quennox Ratchet Works', 'the matched entry is returned for reporting');

// Without a company hint the differing slug is unknowable — documents the limit.
check(findKnownCompany(index, { slug: 'quennoxold', name: '' }) === null,
  'a differing slug with NO name hint is still unmatched (why tombstones exist)');

// ── Tombstones must stay indexed ────────────────────────────────────────────
const withTombstone = buildCompanyIndex([
  { name: 'Zorblax Widgetry', careers_url: 'https://jobs.ashbyhq.com/zorblax-widgetry' },
  { name: 'Zorblax Widgetry (legacy Greenhouse slug)', enabled: false,
    careers_url: 'https://job-boards.greenhouse.io/zorblaxlegacy' },
]);
check(findKnownCompany(withTombstone, { slug: 'zorblaxlegacy' }) !== null,
  'a disabled tombstone still blocks rediscovery of its dead slug');

// ── Distinct companies sharing a name must stay distinct ────────────────────
const fetchIndex = buildCompanyIndex([
  { name: 'Zorblax (Pet Insurance)', careers_url: 'https://job-boards.greenhouse.io/zorblax' },
  { name: 'Zorblax Package',         careers_url: 'https://jobs.lever.co/zorblaxpackage' },
]);
const pet = findKnownCompany(fetchIndex, { slug: 'zorblax' });
const pkg = findKnownCompany(fetchIndex, { slug: 'zorblaxpackage' });
check(pet?.entry.name === 'Zorblax (Pet Insurance)' && pkg?.entry.name === 'Zorblax Package',
  'two companies named Zorblax resolve to their own entries');

// A name collision is reported as a NAME match so callers can surface it rather
// than dropping it — these are the cases only a human can adjudicate.
const collision = findKnownCompany(fetchIndex, { slug: 'zorblaxrewards', name: 'Zorblax' });
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
