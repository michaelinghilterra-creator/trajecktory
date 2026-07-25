#!/usr/bin/env node
/**
 * v1-loader.test.mjs — the report read path (dashboard-web/server/v1-loader.mjs).
 *
 * Focus: the scoring fields the redesign added. v1ToCheatsheet must project
 * scoreSource and scoreBasis onto the drawer's cs object, defaulting a report with
 * no source tag to 'legacy' (so the 653 existing reports read as legacy without
 * being rewritten) and passing keyed globalScore dimensions + evidence through
 * unchanged (so the drawer can show the derived breakdown).
 *
 * Run: node tests/v1-loader.test.mjs   (exit 0 = pass, 1 = fail)
 */
import { v1ToCheatsheet, hasV1Frontmatter, parseV1 } from '../dashboard-web/server/v1-loader.mjs';

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };

console.log('v1-loader.test.mjs');

// ── scoreSource defaulting (absent → legacy) ─────────────────────────────────
const legacyCs = v1ToCheatsheet({ score: 3.7, globalScore: [{ dim: 'CV Match', val: 4, max: 5 }] });
check(legacyCs.scoreSource === 'legacy', 'a report with no scoreSource reads as legacy (never rewritten)');
check(legacyCs.scoreBasis === null, 'no scoreBasis on a legacy report → null');

const junkSource = v1ToCheatsheet({ scoreSource: 'authored', globalScore: [] });
check(junkSource.scoreSource === 'legacy', 'an unrecognized scoreSource coerces to legacy (only "derived" counts)');

// ── derived passthrough ──────────────────────────────────────────────────────
const derived = v1ToCheatsheet({
  score: 4.1,
  scoreSource: 'derived',
  scoreBasis: { weights: { fit: 0.35 }, contributions: [{ key: 'fit', val: 4, weight: 0.35, points: 1.4 }], penalty: 0 },
  globalScore: [
    { key: 'fit', dim: 'Fit / CV Match', val: 4, max: 5, evidence: 'eight years in the exact stack' },
    { key: 'redFlags', dim: 'Red Flags', val: 5, max: 5, evidence: 'none found' },
  ],
});
check(derived.scoreSource === 'derived', 'scoreSource "derived" is preserved');
check(derived.scoreBasis && Array.isArray(derived.scoreBasis.contributions), 'scoreBasis object is passed through for the formula line');
check(derived.globalScore[0].key === 'fit' && derived.globalScore[0].evidence === 'eight years in the exact stack',
  'keyed globalScore dimensions keep their key + evidence for the drawer');

// ── scoreBasis must be an object, never a stray scalar ───────────────────────
const badBasis = v1ToCheatsheet({ scoreSource: 'derived', scoreBasis: 'oops', globalScore: [] });
check(badBasis.scoreBasis === null, 'a non-object scoreBasis is dropped to null (never renders half a formula)');

// ── the rest of the projection still works (guard against a regression) ──────
const full = v1ToCheatsheet({
  url: 'https://example.test/job', domain: 'RevOps',
  summary: { archetypeDetected: 'Director RevOps', compStated: '$200k' },
  comp: { stated: '$200k', score: 4 },
  recommendation: 'Apply', keywords: ['revops', 'salesforce'],
});
check(full.archetypeDetected === 'Director RevOps' && full.domain === 'RevOps', 'summary + domain still project');
check(full.comp.score === 4 && full.keywords.length === 2, 'comp + keywords still project alongside the new score fields');

// ── frontmatter detection sanity (used to decide v1 vs legacy path) ──────────
const md = '---\n{ "schema": "trajecktory-report/v1", "id": 1, "scoreSource": "derived" }\n---\n# Body\n';
check(hasV1Frontmatter(md) === true, 'a v1 frontmatter block is detected');
check(parseV1(md).data.scoreSource === 'derived', 'parseV1 surfaces scoreSource from the frontmatter JSON');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
