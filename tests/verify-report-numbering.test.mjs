#!/usr/bin/env node
/**
 * verify-report-numbering.test.mjs — pins the report-numbering drift guard.
 *
 * findNumberingDrift checks a linked report's own self-consistency (filename
 * number == its own frontmatter id) and collisions (two different tracker rows
 * both currently linked to reports claiming the same id). It must NOT flag a
 * tracker row whose num differs from its linked report's id — that is the
 * ordinary, correct shape of a higher-score re-eval (merge-tracker.mjs keeps the
 * row's original num while pointing it at a freshly-numbered report). An earlier
 * draft of this guard got that backwards and flagged 14 real, ordinary re-evals
 * in the user's own tracker as bugs before it ran once and was caught by hand.
 * This test exists so that regression cannot ship silently again.
 *
 * Fixture ids are 9001+, deliberately ABOVE data/jd-counter.txt's ceiling so a
 * fixture can never collide with a real report primary key (same convention as
 * verify-score-drift.test.mjs).
 *
 * Run: node tests/verify-report-numbering.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { findNumberingDrift } from '../verify-report-numbering.mjs';
import { parseTracker } from '../lib/tracker.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('verify-report-numbering.test.mjs');

const v1 = (obj) => `---\n${JSON.stringify({ schema: 'trajecktory-report/v1', ...obj })}\n---\n# body\n`;
const reports = {
  'reports/9001-clean.md':   v1({ id: 9001 }),  // filename 9001, frontmatter 9001 — consistent
  'reports/9002-reeval.md':  v1({ id: 9050 }),  // filename says 9002, frontmatter says 9050 — SELF-drift (real bug)
  'reports/9051-fresh.md':   v1({ id: 9051 }),  // filename 9051, frontmatter 9051 — self-consistent; a re-eval's fresh report
  'reports/9004-a.md':       v1({ id: 9004 }),
  'reports/9005-b.md':       v1({ id: 9004 }), // DIFFERENT tracker row, SAME frontmatter id as 9004 — collision (real bug)
};
const loadReport = (p) => reports[p] ?? null;

// Case 1: an ordinary re-eval. Tracker row #9010 keeps ITS OWN num while its
// report link points at a freshly-numbered, SELF-consistent report (id 9051, not
// 9010). This must NOT be flagged — it is exactly the working-as-designed shape
// from merge-tracker.mjs's apply-updates (`num: duplicate.num, report:
// addition.report`), which is what an earlier draft of this guard got wrong.
const reevalRows = parseTracker([
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
  '| 9010 | 2024-02-01 | Kestrel | Staff Eng | 4.1/5 | Evaluated | ❌ | — | [9051](reports/9051-fresh.md) | Re-eval 2024-02-01 (3.7->4.1) | — |',
].join('\n'));
const reevalResult = findNumberingDrift(reevalRows, loadReport);
check(reevalResult.drift.length === 0, 'a re-eval row (tracker num 9010, linked report id 9051) is NOT flagged — that mismatch is by design');

// Case 2: self-drift. A report's own filename number disagrees with its own
// frontmatter id — always wrong, regardless of tracker linkage.
const selfDriftRows = parseTracker([
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
  '| 9020 | 2024-02-02 | Northwind | Staff Eng | 4.0/5 | Evaluated | ❌ | — | [9020](reports/9002-reeval.md) | . | — |',
].join('\n'));
const selfDriftResult = findNumberingDrift(selfDriftRows, loadReport);
check(selfDriftResult.drift.length === 1 && selfDriftResult.drift[0].reason === 'filename/frontmatter id mismatch',
  'a report whose filename number disagrees with its own frontmatter id IS flagged');

// Case 3: collision. Two DIFFERENT tracker rows both currently link to a report
// claiming the same frontmatter id (9004) — the actual "reused number" bug.
const collisionRows = parseTracker([
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
  '| 9030 | 2024-02-03 | Bexad | Staff Eng | 4.0/5 | Evaluated | ❌ | — | [9004](reports/9004-a.md) | . | — |',
  '| 9031 | 2024-02-03 | Meridian | Staff Eng | 3.8/5 | Evaluated | ❌ | — | [9004](reports/9005-b.md) | . | — |',
].join('\n'));
const collisionResult = findNumberingDrift(collisionRows, loadReport);
check(collisionResult.drift.some((d) => d.reason === 'reused report number'),
  'two different tracker rows linked to reports sharing one frontmatter id ARE flagged as a collision');

// A fully clean tracker (no re-eval quirk, no self-drift, no collision) reports zero.
const cleanRows = parseTracker([
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
  '| 9001 | 2024-01-01 | Kestrel | Staff Eng | 4.2/5 | Evaluated | ❌ | — | [9001](reports/9001-clean.md) | . | — |',
].join('\n'));
const clean = findNumberingDrift(cleanRows, loadReport);
check(clean.checked === 1 && clean.drift.length === 0, 'an all-consistent tracker reports 1 checked, 0 drift');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
