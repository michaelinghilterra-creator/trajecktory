#!/usr/bin/env node
/**
 * parser-fixtures.test.mjs — pin the dashboard report-parsing behavior.
 *
 * Covers both read paths used by dashboard-web/server/index.mjs:
 *   - v1 reports (JSON frontmatter) via v1-loader.mjs
 *   - legacy reports (## A)..## G) blocks) via parser.mjs
 * plus header-format variants, so any change to the parsers that alters
 * what the drawer receives fails loudly here instead of silently
 * rendering empty tabs.
 *
 * Fixtures (tests/fixtures/) are fully synthetic: invented companies, roles,
 * comp figures, and work history. They mirror the STRUCTURE of real reports
 * (every field the parsers read, every heading shape) so the parsers are
 * genuinely exercised, but carry no personal data. tests/ is tracked, and
 * installer/build-bundle.ps1 ships every tracked file to end users via
 * `git archive`, so never paste a real report from reports/ in here.
 * Run: node tests/parser-fixtures.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const { parseReport } = await import(new URL('../dashboard-web/server/parser.mjs', import.meta.url));
const { hasV1Frontmatter, parseV1, v1ToCheatsheet, stripFrontmatter } =
  await import(new URL('../dashboard-web/server/v1-loader.mjs', import.meta.url));

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

const legacyMd = readFileSync(join(HERE, 'fixtures/legacy-report.md'), 'utf8');
const v1Md = readFileSync(join(HERE, 'fixtures/v1-report.md'), 'utf8');

// ── 1. Legacy path (parser.mjs) ──────────────────────────────────────────────
console.log('\n1. Legacy report (## X) block format)');
{
  const cs = parseReport(legacyMd);
  check(cs.keywords.length === 20, `keywords extracted (${cs.keywords.length}/20)`);
  check(cs.starStories.length === 38, `starStories extracted (${cs.starStories.length}/38)`);
  check(cs.cvMatch.length === 9, `cvMatch rows extracted (${cs.cvMatch.length}/9)`);
  check(cs.customizationCV.length === 5, `customizationCV extracted (${cs.customizationCV.length}/5)`);
  check(cs.legitimacySignals.length === 6, `legitimacySignals extracted (${cs.legitimacySignals.length}/6)`);
  check(cs.comp.stated === '$120K–$145K ($132K median)', `comp.stated parsed (${cs.comp.stated})`);
  check(!!cs.tldr, 'tldr present');
  check(!!cs.archetypeDetected, 'archetype detected');
}

// ── 2. Supported header variants must keep parsing ───────────────────────────
console.log('\n2. Supported legacy header variants');
{
  const dot = parseReport(legacyMd.replace(/^## ([A-G])\)/gm, '## $1.'));
  check(dot.cvMatch.length === 9 && dot.starStories.length === 38, '"## A." header variant parses fully');

  const emdash = parseReport(legacyMd.replace(/^## ([A-G])\)/gm, '## $1 —'));
  check(emdash.cvMatch.length === 9 && emdash.starStories.length === 38, '"## A —" (em-dash) header variant parses fully');

  const block = parseReport(legacyMd.replace(/^## ([A-G])\)/gm, '## Block $1)'));
  check(block.cvMatch.length === 9 && block.starStories.length === 38, '"## Block A)" header variant parses fully');
}

// ── 3. Known drift: documents current SILENT-LOSS behavior ──────────────────
// These pin the failure mode found in the 2026-06-12 audit. When parser.mjs
// is hardened (audit task 1.4), flip these assertions to expect full parses.
console.log('\n3. Known drift behavior (documents silent loss — see audit task 1.4)');
{
  const h3 = parseReport(legacyMd.replace(/^## ([A-G])\)/gm, '### $1)'));
  check(h3.starStories.length === 0 && h3.cvMatch.length === 0,
    '"### A)" (wrong heading level) silently loses all block content [known limitation]');
  check(h3.keywords.length === 20,
    '"### A)" drift still extracts keywords (## Extracted Keywords unaffected)');
}

// ── 4. v1 path (v1-loader.mjs) ───────────────────────────────────────────────
console.log('\n4. v1 report (JSON frontmatter)');
{
  check(hasV1Frontmatter(v1Md), 'v1 frontmatter detected');
  check(!hasV1Frontmatter(legacyMd), 'legacy report NOT detected as v1');

  const { data, body } = parseV1(v1Md);
  check(data.company === 'Acme AI' && data.id === 12, `frontmatter fields (company=${data.company}, id=${data.id})`);
  check(data.score === 4.0, `score from frontmatter (${data.score})`);
  check(body.length > 0 && !body.startsWith('---'), 'narrative body separated from frontmatter');

  const cs = v1ToCheatsheet(data);
  check(cs.keywords.length === 20, `cheatsheet keywords (${cs.keywords.length}/20)`);
  check(cs.starStories.length === 5, `cheatsheet starStories (${cs.starStories.length}/5)`);
  check(cs.cvMatch.length === 10, `cheatsheet cvMatch (${cs.cvMatch.length}/10)`);
  check(!!cs.comp.stated, 'comp.stated present');
  check(!!cs.tldr && !!cs.companyBrief, 'tldr + companyBrief present');
  check(cs.legitimacy === 'Proceed with Caution', `legitimacy tier (${cs.legitimacy})`);

  check(stripFrontmatter(v1Md).startsWith('#'), 'stripFrontmatter returns clean body');
}

// ── 5. Malformed v1 frontmatter must throw, not return garbage ───────────────
console.log('\n5. Malformed v1 frontmatter');
{
  const broken = v1Md.replace('"schema"', '"schema'); // break the JSON
  let threw = false;
  try { parseV1(broken); } catch { threw = true; }
  check(threw, 'parseV1 throws on malformed JSON (no silent garbage)');
}

console.log(`\n📊 parser fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
