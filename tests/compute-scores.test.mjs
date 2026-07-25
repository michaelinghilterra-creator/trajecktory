#!/usr/bin/env node
/**
 * compute-scores.test.mjs — the deterministic derive step (compute-scores.mjs).
 *
 * deriveReportScore stamps a derived headline into a NEW-style report (keyed
 * dimensions), and must leave every legacy report untouched (no key on the
 * dimensions), which is what makes the "implicit legacy, no rewrites" decision
 * safe. Also checks the body is preserved byte-for-byte.
 *
 * Run: node tests/compute-scores.test.mjs   (exit 0 = pass, 1 = fail)
 */
import { deriveReportScore } from '../compute-scores.mjs';

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };

console.log('compute-scores.test.mjs');

const keyedReport = (score) => `---
${JSON.stringify({
  schema: 'trajecktory-report/v1', id: 1, company: 'Kestrel', role: 'Director RevOps',
  date: '2026-07-23', url: 'https://example.test/k', score,
  globalScore: [
    { key: 'fit', dim: 'Fit / CV Match', val: 4, max: 5, evidence: 'strong' },
    { key: 'northStar', dim: 'North Star Alignment', val: 5, max: 5, evidence: 'archetype' },
    { key: 'level', dim: 'Level Match', val: 4, max: 5 },
    { key: 'comp', dim: 'Comp', val: 3, max: 5 },
    { key: 'location', dim: 'Location / Logistics', val: 5, max: 5 },
    { key: 'redFlags', dim: 'Red Flags', val: 5, max: 5 },
  ],
}, null, 2)}
---
# Kestrel — Director RevOps

Narrative body that must be preserved exactly.
`;

// Explicit weights for the arithmetic assertions, so they test the stamping and the
// round-trip rather than the current policy. DEFAULT_WEIGHTS is policy (comp is 0)
// and is asserted separately below. See the same split in score.test.mjs.
const BALANCED = Object.freeze({ fit: 0.35, northStar: 0.25, level: 0.15, comp: 0.15, location: 0.10 });

// ── a keyed report derives + stamps the fields ───────────────────────────────
const r = deriveReportScore(keyedReport(0), { weights: BALANCED });   // authored placeholder 0 → should be replaced
check(r.ok && r.reason === 'ok', 'a report with keyed dimensions is derivable');
check(r.score === 4.2, `headline derived from the dimensions (got ${r.score}, want 4.2)`);
check(/"scoreSource": "derived"/.test(r.newMd), 'scoreSource "derived" is written into the frontmatter');
check(/"scoreBasis"/.test(r.newMd) && r.scoreBasis.contributions.length === 5, 'scoreBasis with per-dimension contributions is written');
check(r.newMd.includes('Narrative body that must be preserved exactly.'), 'the narrative body is preserved');
check(r.prevScore === 0 && r.changed === true, 'the authored placeholder is reported as changed');

// round-trips: feeding the output back in is stable (idempotent)
const r2 = deriveReportScore(r.newMd, { weights: BALANCED });
check(r2.ok && r2.score === 4.2, 'derivation is idempotent (re-running yields the same score)');

// ── a hard ceiling in the report caps the derived score ──────────────────────
const ceilingReport = keyedReport(0).replace('"score": 0,', '"score": 0,\n  "scoreCeiling": 1.5,');
const rc = deriveReportScore(ceilingReport, { weights: BALANCED });
check(rc.ok && rc.score === 1.5, `a scoreCeiling in the report caps the derived headline (4.2 → 1.5, got ${rc.score})`);
check(rc.scoreBasis.ceiling === 1.5 && rc.scoreBasis.ceilingApplied === true, 'the ceiling is recorded in scoreBasis for the audit trail');

// ── POLICY: the shipped defaults leave comp out of the arithmetic ────────────
// A report still carries its comp rating (the drawer shows it); it just earns no
// points. This is what makes pay information rather than a score input.
const rd = deriveReportScore(keyedReport(0));   // no weights → the shipped defaults
check(rd.ok && rd.scoreBasis.contributions.length === 4, 'the default derivation scores four dimensions, not five');
check(!rd.scoreBasis.contributions.some(c => c.key === 'comp'), 'comp earns no points under the shipped defaults');
check(/"key": "comp"/.test(rd.newMd), 'the comp rating itself survives in the report, unscored but visible');

// ── custom weights are honored ───────────────────────────────────────────────
const rw = deriveReportScore(keyedReport(0), { weights: { fit: 1, northStar: 0, level: 0, comp: 0, location: 0 } });
check(rw.score === 4, 'custom weights change the result (fit-only → 4)');

// ── a LEGACY report (no keyed dims) is left untouched ────────────────────────
const legacy = `---
${JSON.stringify({
  schema: 'trajecktory-report/v1', id: 2, company: 'Bex Systems', role: 'RevOps Mgr',
  date: '2026-06-01', score: 3.5,
  globalScore: [
    { dim: 'CV Match', val: 4, max: 5 },
    { dim: 'North Star Alignment', val: 4, max: 5 },
    { dim: 'Red Flags', val: -2, max: 5 },
  ],
}, null, 2)}
---
# Legacy body
`;
const rl = deriveReportScore(legacy);
check(!rl.ok && rl.reason === 'no-keyed-dims', 'a legacy report (unkeyed dims) is not derivable → left as-is');
check(rl.score === 3.5, 'the legacy report keeps its authored score, never recomputed');

// ── non-v1 markdown is ignored ───────────────────────────────────────────────
const rn = deriveReportScore('# Just a markdown report\n\nNo frontmatter here.\n');
check(!rn.ok && rn.reason === 'not-v1', 'a non-v1 report is not touched');

// ── a keyed report with only unknown keys is not derivable (no fabricated score)
const junk = `---
${JSON.stringify({ schema: 'trajecktory-report/v1', id: 3, score: 2, globalScore: [{ key: 'vibes', val: 5, max: 5 }] }, null, 2)}
---
# body
`;
const rj = deriveReportScore(junk);
check(!rj.ok && rj.reason === 'no-keyed-dims', 'a report whose only keyed dim is unknown is left as-is');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
