#!/usr/bin/env node
/**
 * scan-core.test.mjs — unit tests for lib/scan-core.mjs, the scanner's dedup
 * and title-filter primitives. These drive whether a new posting is re-added
 * (dedup) or ever reaches evaluation (title filter), and were previously
 * module-private in scan.mjs with no direct coverage.
 *
 * Run: node tests/scan-core.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { normalizeUrl, buildTitleFilter, normalizeForMatch } from '../lib/scan-core.mjs';

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

// ── normalizeForMatch ─────────────────────────────────────────────────────────
check(normalizeForMatch('Head of Applied AI') === 'head applied ai',
  'lowercases and drops " of "');
check(normalizeForMatch('Engineer (Backend), Remote') === 'engineer backend remote',
  'strips parens and commas');
check(normalizeForMatch('Sales & Marketing') === 'sales marketing',
  'drops " & "');
check(normalizeForMatch('') === '', 'empty stays empty');

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
