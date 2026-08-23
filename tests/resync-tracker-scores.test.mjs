#!/usr/bin/env node
/**
 * resync-tracker-scores.test.mjs — the tracker Score cell is a COPY of the
 * report's derived headline, and this is the script that keeps the copy honest.
 *
 * The bug it exists for: merge-tracker writes that copy only for rows flowing
 * through a merge, so re-deriving a report after its row merged leaves the two
 * diverged permanently. 195 rows drifted that way when the level-floor policy
 * shipped and every one moved upward.
 *
 * All fixtures are invented. Never copy a real company or job title out of
 * data/ (see tests/no-real-postings.test.mjs for why).
 */
import { planScoreResync, replaceScoreCell } from '../resync-tracker-scores.mjs';
import { parseTrackerLine } from '../lib/tracker.mjs';

let passed = 0, failed = 0;
const check = (cond, msg) => {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
};

console.log('\nresync-tracker-scores.test.mjs');

const derived = (score) => JSON.stringify({ schema: 'trajecktory-report/v1', score, scoreSource: 'derived' });
const report = (score) => `---\n${derived(score)}\n---\nBody.\n`;
const legacy = () => `---\n${JSON.stringify({ schema: 'trajecktory-report/v1', score: 4.4, scoreSource: 'legacy' })}\n---\nBody.\n`;

const ROW = (num, score, reportRel) =>
  `| ${num} | 2026-04-02 | Northwind Freight | Director, Revenue Operations | ${score} | Applied | ❌ | trajecktory | [${num}](${reportRel}) | invented note | https://jobs.example.com/${num} |`;

// ── the core repair ──────────────────────────────────────────────────────────
{
  const lines = [ROW(7401, '3.1/5', 'reports/7401-x.md')];
  const load = () => report(3.6);
  const plan = planScoreResync(lines, load);
  check(plan.changes.length === 1, 'a drifted row is planned for repair');
  check(plan.changes[0].to === '3.6/5', `the new cell carries the report score (got ${plan.changes[0]?.to})`);
  check(plan.checked === 1, 'the row counts as checked');
}

// ── idempotence ──────────────────────────────────────────────────────────────
{
  const lines = [ROW(7402, '3.6/5', 'reports/7402-x.md')];
  const plan = planScoreResync(lines, () => report(3.6));
  check(plan.changes.length === 0, 'a row already in sync is left alone, so a second run is a no-op');
}

// ── legacy reports are never recomputed ──────────────────────────────────────
{
  const lines = [ROW(7403, '2.0/5', 'reports/7403-x.md')];
  const plan = planScoreResync(lines, () => legacy());
  check(plan.changes.length === 0, 'a legacy report never rewrites its tracker cell');
  check(plan.skipped.legacy === 1, 'the legacy row is counted as skipped, not silently dropped');
}

// ── a row with no report link is skipped, not guessed at ─────────────────────
{
  const lines = ['| 7404 | 2026-04-02 | Contoso Robotics | Director, Analytics | 3.0/5 | Applied | ❌ | trajecktory | — | note | — |'];
  const plan = planScoreResync(lines, () => report(4.9));
  check(plan.changes.length === 0, 'a row with no report link is never rewritten');
  check(plan.skipped.noReport === 1, 'and it is counted');
}

// ── the canonical format, including a whole number ───────────────────────────
{
  const plan = planScoreResync([ROW(7405, '3.5/5', 'reports/7405-x.md')], () => report(4));
  check(plan.changes[0].to === '4.0/5', `a whole number is written as X.0/5 like merge-tracker (got ${plan.changes[0]?.to})`);
}

// ── surgical: ONLY the score cell moves ──────────────────────────────────────
{
  const before = ROW(7406, '2.9/5', 'reports/7406-x.md');
  const after = replaceScoreCell(before, '3.4/5');
  const a = parseTrackerLine(before), b = parseTrackerLine(after);
  const moved = Object.keys(a).filter(k => k !== 'raw' && String(a[k]) !== String(b[k]));
  check(moved.length === 1 && moved[0] === 'score', `only the score field changes (moved: ${moved.join(', ')})`);
  check(before.split('|').length === after.split('|').length, 'the cell count is unchanged');
  // Every cell except the score is byte-identical, spacing included.
  const pa = before.split('|'), pb = after.split('|');
  const differing = pa.map((c, i) => (c === pb[i] ? null : i)).filter(i => i !== null);
  check(differing.length === 1 && differing[0] === 5, `exactly one raw cell differs, at the score index (got ${differing})`);
}

// ── a legacy 9-column row must not gain columns ──────────────────────────────
// formatTrackerLine always emits 11 cells, so a full re-render would silently
// add Resume and URL to an old row. The surgical replace must not.
{
  const nine = '| 7407 | 2026-01-05 | Fabrikam Logistics | Manager, Sales Operations | 2.4/5 | Applied | ❌ | [7407](reports/7407-x.md) | invented note |';
  const out = replaceScoreCell(nine, '2.8/5');
  check(out !== null, 'a legacy row is still rewritable');
  check(out.split('|').length === nine.split('|').length, 'a legacy 9-column row does not gain columns');
  check(out.includes('2.8/5') && !out.includes('2.4/5'), 'and its score is updated');
}

// ── the invariant guard aborts rather than writing a damaged row ─────────────
{
  // A line with too few cells cannot be safely edited; replaceScoreCell says so
  // instead of producing a plausible-looking wrong row.
  check(replaceScoreCell('| 7408 | only | three |', '3.0/5') === null,
    'a line that is too short to be a tracker row is refused, not mangled');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
