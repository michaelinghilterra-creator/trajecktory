#!/usr/bin/env node
/**
 * merge-tracker.test.mjs — end-to-end test of the TSV → applications.md merge,
 * focused on the column-order heuristic and dedup logic flagged in the
 * 2026-06-12 audit (merge-tracker.mjs parseTsvContent, lines ~190-212).
 *
 * Runs the real merge-tracker.mjs inside a throwaway sandbox directory
 * (the script resolves all paths relative to its own location, so a copy
 * of the script inside the sandbox operates only on sandbox files).
 *
 * Run: node tests/merge-tracker.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

// ── Build sandbox ─────────────────────────────────────────────────────────────
// Sandbox lives INSIDE the project (not os.tmpdir()) so bare imports in
// merge-tracker.mjs (js-yaml) resolve against the real node_modules by walking up
// the tree. The script still resolves all its own paths relative to its own
// location, so it only ever reads/writes sandbox files.
const sandbox = mkdtempSync(join(ROOT, 'merge-tracker-test-'));
mkdirSync(join(sandbox, 'data'));
mkdirSync(join(sandbox, 'batch/tracker-additions'), { recursive: true });
copyFileSync(join(ROOT, 'merge-tracker.mjs'), join(sandbox, 'merge-tracker.mjs'));
// merge-tracker.mjs imports from ./lib, so the sandbox copy needs those modules.
mkdirSync(join(sandbox, 'lib'), { recursive: true });
copyFileSync(join(ROOT, 'lib/discard.mjs'), join(sandbox, 'lib/discard.mjs'));
copyFileSync(join(ROOT, 'lib/tracker.mjs'), join(sandbox, 'lib/tracker.mjs'));
copyFileSync(join(ROOT, 'lib/scan-core.mjs'), join(sandbox, 'lib/scan-core.mjs'));
// merge-tracker.mjs loads templates/states.yml at startup for canonical states +
// aliases, so the sandbox copy needs that file present too.
mkdirSync(join(sandbox, 'templates'), { recursive: true });
copyFileSync(join(ROOT, 'templates/states.yml'), join(sandbox, 'templates/states.yml'));

const HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|',
].join('\n');

// Seed rows: one for the skip-lower-score case, one for the update-higher case.
const seed = [
  HEADER,
  '| 1 | 2026-06-01 | SeedCo | Director of Revenue Operations | 3.0/5 | Evaluated | ❌ | — | [1](reports/1-seedco-2026-06-01.md) | Seed row |',
  '| 2 | 2026-06-01 | UpdateCo | VP Sales Strategy | 3.0/5 | Evaluated | ❌ | — | [2](reports/2-updateco-2026-06-01.md) | Seed row |',
  '',
].join('\n');
writeFileSync(join(sandbox, 'data/applications.md'), seed);

// ── TSV fixtures (9-col: num date company role status score pdf report notes) ─
const T = '\t';
const tsv = (parts) => parts.join(T) + '\n';
const cases = {
  // 1. Standard order: status in col4, score in col5
  '101-acmecorp.tsv': tsv(['101', '2026-06-12', 'AcmeCorp', 'Director of Revenue Operations',
    'Evaluated', '4.2/5', '❌', '[101](reports/101-acmecorp-2026-06-12.md)', 'Standard column order']),
  // 2. SWAPPED order: score in col4, status in col5 — heuristic must un-swap
  '102-betaworks.tsv': tsv(['102', '2026-06-12', 'BetaWorks', 'VP Sales Operations',
    '3.9/5', 'Evaluated', '❌', '[102](reports/102-betaworks-2026-06-12.md)', 'Swapped column order']),
  // 3. Score with spaces ("4.0 / 5") — fails the score regex; documents behavior
  '103-gammasoft.tsv': tsv(['103', '2026-06-12', 'GammaSoft', 'Director of Analytics',
    'Evaluated', '4.0 / 5', '❌', '[103](reports/103-gammasoft-2026-06-12.md)', 'Spaced score format']),
  // 4. Lowercase status — must be canonicalized to 'Evaluated'
  '104-deltatech.tsv': tsv(['104', '2026-06-12', 'DeltaTech', 'Head of BizDev',
    'evaluated', '3.8/5', '❌', '[104](reports/104-deltatech-2026-06-12.md)', 'Lowercase status']),
  // 5. Duplicate of seed #1 with LOWER score — must be skipped
  '105-seedco.tsv': tsv(['105', '2026-06-12', 'SeedCo', 'Director of Revenue Operations',
    'Evaluated', '2.9/5', '❌', '[105](reports/105-seedco-2026-06-12.md)', 'Lower-score duplicate']),
  // 6. Duplicate of seed #2 with HIGHER score — must update in place, not add
  '106-updateco.tsv': tsv(['106', '2026-06-12', 'UpdateCo', 'VP Sales Strategy',
    'Evaluated', '4.5/5', '❌', '[106](reports/106-updateco-2026-06-12.md)', 'Higher-score re-eval']),
  // 7. Canonical "Closed" (new state in states.yml): must be preserved, not
  //    silently rewritten to Evaluated.
  '107-epsilonco.tsv': tsv(['107', '2026-06-12', 'EpsilonCo', 'Director of Strategy',
    'Closed', '4.1/5', '❌', '[107](reports/107-epsilonco-2026-06-12.md)', 'Posting closed']),
  // 8. Alias "expired": must canonicalize to "Closed".
  '108-zetalabs.tsv': tsv(['108', '2026-06-12', 'ZetaLabs', 'Head of Operations',
    'expired', '4.0/5', '❌', '[108](reports/108-zetalabs-2026-06-12.md)', 'Expired alias']),
  // 9. Canonical "Not a Fit" (new state): must be preserved.
  '109-etacorp.tsv': tsv(['109', '2026-06-12', 'EtaCorp', 'VP Marketing',
    'Not a Fit', '3.7/5', '❌', '[109](reports/109-etacorp-2026-06-12.md)', 'Poor fit']),
  // 10. Alias "naf": must canonicalize to "Not a Fit".
  '110-thetaco.tsv': tsv(['110', '2026-06-12', 'ThetaCo', 'Director of Product',
    'naf', '3.6/5', '❌', '[110](reports/110-thetaco-2026-06-12.md)', 'naf alias']),
  // 11. SWAPPED column order with a NEW state: score in col4, "Closed" in col5.
  //     The heuristic must recognize "Closed" (from states.yml) and un-swap.
  '111-iotacorp.tsv': tsv(['111', '2026-06-12', 'IotaCorp', 'Chief of Staff',
    '4.3/5', 'Closed', '❌', '[111](reports/111-iotacorp-2026-06-12.md)', 'Swapped order, new state']),
};
for (const [name, content] of Object.entries(cases)) {
  writeFileSync(join(sandbox, 'batch/tracker-additions', name), content);
}

// ── Run the real script in the sandbox ────────────────────────────────────────
let output = '';
try {
  output = execFileSync(process.execPath, [join(sandbox, 'merge-tracker.mjs')], { encoding: 'utf8' });
} catch (e) {
  console.log('  ❌ merge-tracker.mjs crashed in sandbox:');
  console.log((e.stdout || '') + (e.stderr || e.message));
  process.exit(1);
}

const result = readFileSync(join(sandbox, 'data/applications.md'), 'utf8');
const rows = result.split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l));
const rowFor = (company) => rows.find(r => r.includes(company)) || '';
const cols = (row) => row.split('|').map(s => s.trim()).slice(1, -1);
// applications.md column order: # date company role SCORE STATUS pdf resume report notes
const SCORE = 4, STATUS = 5, NOTES = 9;

console.log('\n1. Column-order heuristic');
{
  const std = cols(rowFor('AcmeCorp'));
  check(std[SCORE] === '4.2/5' && std[STATUS] === 'Evaluated',
    `standard TSV → score/status land correctly (${std[SCORE]} / ${std[STATUS]})`);

  const swapped = cols(rowFor('BetaWorks'));
  check(swapped[SCORE] === '3.9/5' && swapped[STATUS] === 'Evaluated',
    `SWAPPED TSV un-swapped by heuristic (${swapped[SCORE]} / ${swapped[STATUS]})`);

  const spaced = cols(rowFor('GammaSoft'));
  check(spaced[STATUS] === 'Evaluated' && spaced[SCORE].includes('4.0'),
    `spaced score "4.0 / 5" does not flip columns (score cell: "${spaced[SCORE]}")`);
}

console.log('\n2. Status canonicalization');
{
  const lower = cols(rowFor('DeltaTech'));
  check(lower[STATUS] === 'Evaluated', `lowercase "evaluated" canonicalized (${lower[STATUS]})`);
}

console.log('\n3. Dedup behavior');
{
  const seedRows = rows.filter(r => r.includes('SeedCo'));
  check(seedRows.length === 1, `lower-score duplicate skipped (SeedCo rows: ${seedRows.length})`);
  check(cols(seedRows[0])[SCORE] === '3.0/5', 'seed row score unchanged by lower-score duplicate');

  const updateRows = rows.filter(r => r.includes('UpdateCo'));
  check(updateRows.length === 1, `higher-score re-eval updated in place (UpdateCo rows: ${updateRows.length})`);
  const u = cols(updateRows[0]);
  check(u[SCORE] === '4.5/5', `updated score written (${u[SCORE]})`);
  check(u[0] === '2', `original entry number preserved (#${u[0]})`);
  check(u[NOTES].includes('Re-eval'), 'update annotated as re-eval in notes');
}

console.log('\n4. New canonical states + aliases (states.yml drift guard)');
{
  const closed = cols(rowFor('EpsilonCo'));
  check(closed[STATUS] === 'Closed', `canonical "Closed" preserved, not rewritten (${closed[STATUS]})`);

  const expired = cols(rowFor('ZetaLabs'));
  check(expired[STATUS] === 'Closed', `alias "expired" canonicalized to Closed (${expired[STATUS]})`);

  const notFit = cols(rowFor('EtaCorp'));
  check(notFit[STATUS] === 'Not a Fit', `canonical "Not a Fit" preserved (${notFit[STATUS]})`);

  const naf = cols(rowFor('ThetaCo'));
  check(naf[STATUS] === 'Not a Fit', `alias "naf" canonicalized to Not a Fit (${naf[STATUS]})`);

  const swappedNew = cols(rowFor('IotaCorp'));
  check(swappedNew[STATUS] === 'Closed' && swappedNew[SCORE] === '4.3/5',
    `swapped col order with new state un-swapped (${swappedNew[SCORE]} / ${swappedNew[STATUS]})`);
}

console.log('\n5. No collateral damage');
{
  check(rows.length === 11, `row count correct: 2 seeds + 9 new = ${rows.length}/11`);
  check(/Summary: \+9 added/.test(output), 'script reported +9 added');
}

rmSync(sandbox, { recursive: true, force: true });
console.log(`\n📊 merge-tracker fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
