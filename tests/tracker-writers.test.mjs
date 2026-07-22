#!/usr/bin/env node
/**
 * tracker-writers.test.mjs — the scripts that REWRITE existing rows in
 * applications.md, as opposed to merge-tracker which appends them.
 *
 * These scripts hand-indexed line.split('|') against the LEGACY 9-column schema
 * (# date company role score status pdf report notes). Once the Resume column
 * landed between pdf and report, index 9 stopped being Notes and became Report.
 * Nothing failed loudly: auto-discard-low read a markdown link where it expected
 * notes, so the [self-sourced] exemption and the recommends-against check could
 * never fire, and flipping a row prepended the discard reason to the Report cell
 * while leaving the real notes untouched.
 *
 * This is the same class of bug that motivated lib/tracker.mjs on the read side.
 * These tests pin the column layout for the write side.
 *
 * Run: node tests/tracker-writers.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { parseTrackerLine } from '../lib/tracker.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('tracker-writers.test.mjs');

const HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|',
].join('\n');

// Run a root script against a sandboxed applications.md. The scripts resolve
// paths relative to their own location, so a copy inside the sandbox only ever
// touches sandbox files.
function runScript(script, rows, args = []) {
  const sb = mkdtempSync(join(ROOT, 'tracker-writers-test-'));
  mkdirSync(join(sb, 'data'), { recursive: true });
  mkdirSync(join(sb, 'lib'), { recursive: true });
  copyFileSync(join(ROOT, script), join(sb, script));
  copyFileSync(join(ROOT, 'lib/tracker.mjs'), join(sb, 'lib/tracker.mjs'));
  copyFileSync(join(ROOT, 'lib/identity.mjs'), join(sb, 'lib/identity.mjs'));
  writeFileSync(join(sb, 'data/applications.md'), [HEADER, ...rows, ''].join('\n'));
  let output = '';
  try {
    output = execFileSync(process.execPath, [join(sb, script), ...args], { encoding: 'utf8' });
  } catch (e) {
    console.log(`  ❌ ${script} crashed in sandbox:`);
    console.log((e.stdout || '') + (e.stderr || e.message));
    rmSync(sb, { recursive: true, force: true });
    process.exit(1);
  }
  const text = readFileSync(join(sb, 'data/applications.md'), 'utf8');
  rmSync(sb, { recursive: true, force: true });
  const parsed = text.split('\n').map(parseTrackerLine).filter(Boolean);
  return { output, byId: (n) => parsed.find(r => r.num === n), all: parsed };
}

// ── auto-discard-low.mjs ──────────────────────────────────────────────────────
const A = runScript('auto-discard-low.mjs', [
  '| 10 | 2026-07-20 | LowCo | Analyst | 2.4/5 | Evaluated | ❌ | — | [10](reports/10-lowco.md) | thin scope |',
  '| 11 | 2026-07-20 | PickedCo | Director | 2.2/5 | Evaluated | ❌ | — | [11](reports/11-pickedco.md) | [self-sourced] user chose this |',
  '| 12 | 2026-07-20 | RemoteCo | Manager | 4.1/5 | Evaluated | ❌ | — | [12](reports/12-remoteco.md) | do not apply, location blocker |',
  '| 13 | 2026-07-20 | GoodCo | Director | 4.1/5 | Evaluated | ❌ | — | [13](reports/13-goodco.md) | strong |',
  '| 14 | 2026-07-20 | SentCo | Analyst | 2.1/5 | Applied | ❌ | — | [14](reports/14-sentco.md) | already applied |',
], ['--apply']);

console.log('\n1. Low score flips, and the reason lands in Notes (not Report)');
{
  const r = A.byId(10);
  check(r.status === 'Discarded', `status flipped to Discarded (got "${r.status}")`);
  check(/^auto-discarded: score 2\.4 < 3\.0/.test(r.notes), `reason prepended to NOTES: "${r.notes}"`);
  check(r.notes.includes('thin scope'), 'original note preserved after the reason');
  // The regression: index 9 was Report, so the reason used to be written there.
  check(r.report === '[10](reports/10-lowco.md)', `Report cell untouched: "${r.report}"`);
  check(r.cellCount === 11, `row still has 11 cells (got ${r.cellCount})`);
}

console.log('\n2. Notes are actually read — exemptions and verdicts work');
{
  const exempt = A.byId(11);
  check(exempt.status === 'Evaluated',
    `[self-sourced] low-score row stays Evaluated (got "${exempt.status}")`);
  check(exempt.notes === '[self-sourced] user chose this', 'exempt row is written back unchanged');

  // Healthy score, but the notes say do-not-apply. Only reachable if notes are
  // read from the right cell.
  const verdict = A.byId(12);
  check(verdict.status === 'Discarded',
    `recommends-against note discards despite a 4.1 score (got "${verdict.status}")`);
  check(/recommends against/.test(verdict.notes), `verdict reason recorded: "${verdict.notes}"`);
}

console.log('\n3. Rows outside the rule are untouched');
{
  const good = A.byId(13);
  check(good.status === 'Evaluated' && good.notes === 'strong', 'healthy Evaluated row unchanged');
  const applied = A.byId(14);
  check(applied.status === 'Applied',
    `low-score row already Applied is not downgraded (got "${applied.status}")`);
  check(A.all.length === 5, `no rows lost or duplicated (${A.all.length}/5)`);
  // The fixture is written as legacy 10-column rows. A row the script rewrote
  // comes back as 11 (formatTrackerLine now emits the url cell); a row it left
  // alone stays at 10. Both are intact — what would signal the mangling this
  // suite exists to catch is a row outside that range, or a shifted field.
  check(A.all.every(r => r.cellCount === 10 || r.cellCount === 11),
    `every row has 10 (untouched) or 11 (rewritten) cells, none mangled — got ${[...new Set(A.all.map(r => r.cellCount))].join(',')}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
