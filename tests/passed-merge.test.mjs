#!/usr/bin/env node
// Passed step 2: merge-tracker writes Passed with a reason for an auto discard, and a re-evaluated row that
// stays Passed keeps the reason it was passed for. Invented data in a sandbox.
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { makeRepoSandbox } from './helpers/sandbox.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  PASS ${msg}`); passed++; }
  else { console.log(`  FAIL ${msg}`); failed++; }
}

const sandbox = makeRepoSandbox(ROOT, 'passed-merge-test');
mkdirSync(join(sandbox, 'data'));
mkdirSync(join(sandbox, 'batch/tracker-additions'), { recursive: true });
mkdirSync(join(sandbox, 'lib'), { recursive: true });
mkdirSync(join(sandbox, 'templates'), { recursive: true });
mkdirSync(join(sandbox, 'reports'), { recursive: true });
mkdirSync(join(sandbox, 'dashboard-web/server'), { recursive: true });
copyFileSync(join(ROOT, 'merge-tracker.mjs'), join(sandbox, 'merge-tracker.mjs'));
for (const m of ['discard.mjs', 'tracker.mjs', 'scan-core.mjs', 'identity.mjs', 'pipeline.mjs', 'log-writes.mjs', 'local-date.mjs', 'event-store.mjs', 'event-store-switch.mjs', 'legacy-files.mjs', 'atomic-write.mjs', 'void-events.mjs', 'passed.mjs']) {
  copyFileSync(join(ROOT, 'lib', m), join(sandbox, 'lib', m));
}
copyFileSync(join(ROOT, 'templates/states.yml'), join(sandbox, 'templates/states.yml'));
copyFileSync(join(ROOT, 'dashboard-web/server/v1-loader.mjs'), join(sandbox, 'dashboard-web/server/v1-loader.mjs'));

const HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|',
].join('\n');
writeFileSync(join(sandbox, 'data/applications.md'), [
  HEADER,
  '| 900201 | 2030-06-01 | Zorblax Widgetry | Example Flange Engineer | 2.00/5 | Passed | ❌ | — | [900201](reports/900201-zorblax-2030-06-01.md) | [passed: not_a_fit] auto-discarded: score 2.0 < 3.0. Seed |',
  '',
].join('\n'));

const T = '\t';
const tsv = (parts) => parts.join(T) + '\n';
// A new low score row, and a re-eval of the Passed row that is better but still under the cut.
writeFileSync(join(sandbox, 'batch/tracker-additions/900202-quennox.tsv'), tsv(['900202', '2030-06-12', 'Quennox Ratchet Works', 'Example Gear Manager', 'Evaluated', '2.10/5', '❌', '[900202](reports/900202-quennox-2030-06-12.md)', 'Thin scope']));
writeFileSync(join(sandbox, 'batch/tracker-additions/900203-zorblax.tsv'), tsv(['900203', '2030-06-12', 'Zorblax Widgetry', 'Example Flange Engineer', 'Evaluated', '2.40/5', '❌', '[900203](reports/900203-zorblax-2030-06-12.md)', 'Second look']));
writeFileSync(join(sandbox, 'batch/tracker-additions/900204-vantrix.tsv'), tsv(['900204', '2030-06-12', 'Vantrix Sprocketry', 'Example Sprocket Designer', 'Evaluated', '4.20/5', '❌', '[900204](reports/900204-vantrix-2030-06-12.md)', 'Do not apply, location blocker']));

execFileSync(process.execPath, [join(sandbox, 'merge-tracker.mjs')], { encoding: 'utf8' });
const rows = readFileSync(join(sandbox, 'data/applications.md'), 'utf8').split('\n');
const rowOf = (num) => rows.find(l => l.startsWith(`| ${num} |`)) || '';
const cell = (line, i) => (line.split('|')[i] || '').trim();

console.log('passed-merge.test.mjs');
check(cell(rowOf(900202), 6) === 'Passed' && /^\[passed: low_score\] auto-discarded: score 2\.1 < 3\.0/.test(cell(rowOf(900202), 10)), 'a new low score row is written as Passed with the low_score reason');
check(cell(rowOf(900204), 6) === 'Passed' && /^\[passed: discarded\] auto-discarded: agent recommends against/.test(cell(rowOf(900204), 10)), 'a recommends against row is written as Passed with the discarded reason');
check(cell(rowOf(900201), 6) === 'Passed' && /^\[passed: not_a_fit\] Re-eval/.test(cell(rowOf(900201), 10)), 're-evaluating a Passed row that stays Passed keeps its reason');
check(rows.filter(l => l.startsWith('| 9002')).length === 3, 'no row was lost or added twice');

console.log(`\npassed-merge: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
