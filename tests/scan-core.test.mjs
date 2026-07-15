#!/usr/bin/env node
/**
 * scan-core.test.mjs — unit tests for lib/scan-core.mjs, the scanner's dedup
 * and title-filter primitives. These drive whether a new posting is re-added
 * (dedup) or ever reaches evaluation (title filter), and were previously
 * module-private in scan.mjs with no direct coverage.
 *
 * Run: node tests/scan-core.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { normalizeUrl, buildTitleFilter, normalizeForMatch, scoreOffer } from '../lib/scan-core.mjs';

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
check(normalizeUrl('https://jobs.lever.co/applydigital/be70d3cb-2d5e-4b59') === 'https://jobs.lever.co/applydigital/be70d3cb-2d5e-4b59',
  'does NOT strip "apply" inside the applydigital company slug');
check(normalizeUrl('https://apply.workable.com/fleetio/j/BA4D0137BF/') === 'https://apply.workable.com/fleetio/j/BA4D0137BF',
  'does NOT strip the apply.workable.com host (apply only in hostname)');

// ── normalizeForMatch ─────────────────────────────────────────────────────────
check(normalizeForMatch('Head of Applied AI') === 'head applied ai',
  'lowercases and drops " of "');
check(normalizeForMatch('Engineer (Backend), Remote') === 'engineer backend remote',
  'strips parens and commas');
check(normalizeForMatch('Sales & Marketing') === 'sales marketing',
  'drops " & "');
check(normalizeForMatch('') === '', 'empty stays empty');
// Spelled-out "Vice President" folds to "vp" so one "VP of X" positive covers
// both forms (audit 2026-07-15: GitLab "Vice President, Data & Insights" was
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
check(wb('Director, GTM Engineering') === true, 'negative "engineer" does not drop "Engineering"');
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
