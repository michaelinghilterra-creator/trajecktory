#!/usr/bin/env node
/**
 * resync-scope.test.mjs — planScoreResync must be restrictable to a subset.
 *
 * WHY THIS EXISTS:
 * the script was all-or-nothing, and that forced a genuinely bad choice. A restamp
 * left 10 tracker cells stale; 16 OTHER cells were also out of sync for an unrelated
 * and undiagnosed reason. Finishing the 10 meant also overwriting the 16, which
 * would not have fixed them — it would have destroyed the only evidence that
 * something is wrong with those rows. Drift is information. An operation that
 * erases it must be expressible as a subset, or people route around the real tool
 * and write tracker cells some other way, which is its own class of bug.
 *
 * Run: node tests/resync-scope.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { planScoreResync } from '../resync-tracker-scores.mjs';
import { TRACKER_HEADER, TRACKER_SEPARATOR, formatTrackerLine } from '../lib/tracker.mjs';

let passed = 0, failed = 0;
const check = (c, l) => { if (c) passed++; else { failed++; console.error(`  FAIL: ${l}`); } };

// Three rows whose tracker cell disagrees with the report's derived score.
const rows = [
  { num: '10', date: '2026-01-01', company: 'Alpha', role: 'R', score: '1.0/5', status: 'Evaluated', pdf: '', resume: '', report: '[10](reports/10-a.md)', notes: '', url: '' },
  { num: '20', date: '2026-01-01', company: 'Beta', role: 'R', score: '2.0/5', status: 'Evaluated', pdf: '', resume: '', report: '[20](reports/20-b.md)', notes: '', url: '' },
  { num: '30', date: '2026-01-01', company: 'Gamma', role: 'R', score: '3.0/5', status: 'Evaluated', pdf: '', resume: '', report: '[30](reports/30-c.md)', notes: '', url: '' },
];
const lines = [TRACKER_HEADER, TRACKER_SEPARATOR, ...rows.map(formatTrackerLine)];

const derived = { '10': 1.5, '20': 2.5, '30': 3.5 };
const loadReport = (rel) => {
  const n = String(rel).match(/reports\/(\d+)-/)?.[1];
  if (!n || !(n in derived)) return null;
  const fm = { schema: 'trajecktory-report/v1', id: Number(n), score: derived[n], scoreSource: 'derived' };
  return `---\n${JSON.stringify(fm, null, 2)}\n---\n\nbody\n`;
};

const nums = (p) => p.changes.map(c => String(c.num)).sort();

console.log('\nunscoped');
{
  const p = planScoreResync(lines, loadReport);
  check(p.changes.length === 3, `all three drift without --only (got ${p.changes.length})`);
  check(nums(p).join(',') === '10,20,30', 'all three ids planned');
}

console.log('scoped');
{
  const p = planScoreResync(lines, loadReport, { only: ['20'] });
  check(p.changes.length === 1, `only one change planned (got ${p.changes.length})`);
  check(String(p.changes[0].num) === '20', 'and it is the requested id');
  check(p.skipped.filtered === 2, `the other two are reported as filtered (got ${p.skipped.filtered})`);
}
{
  const p = planScoreResync(lines, loadReport, { only: ['10', '30'] });
  check(nums(p).join(',') === '10,30', 'a multi-id scope plans exactly those ids');
}

console.log('edge cases');
{
  const p = planScoreResync(lines, loadReport, { only: [] });
  check(p.changes.length === 0, 'an EMPTY scope plans nothing (not "everything")');
}
{
  const p = planScoreResync(lines, loadReport, { only: null });
  check(p.changes.length === 3, 'null scope means unrestricted, preserving old behaviour');
}
{
  const p = planScoreResync(lines, loadReport, { only: ['999'] });
  check(p.changes.length === 0, 'an id that matches no row plans nothing');
}
{
  const p = planScoreResync(lines, loadReport, { only: [' 20 '] });
  check(p.changes.length === 1, 'ids are trimmed, so a file with stray whitespace works');
}
{
  const p = planScoreResync(lines, loadReport, { only: [20] });
  check(p.changes.length === 1, 'numeric ids work as well as strings');
}

console.log('a scoped run does not alter what it plans for the ids in scope');
{
  const full = planScoreResync(lines, loadReport).changes.find(c => String(c.num) === '20');
  const scoped = planScoreResync(lines, loadReport, { only: ['20'] }).changes[0];
  check(full.newLine === scoped.newLine, 'the written line is byte-identical scoped or not');
  check(full.to === scoped.to, 'and the target value is the same');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
