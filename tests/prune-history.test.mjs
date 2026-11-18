#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decidePrune } from '../prune-history.mjs';
import { makeRepoSandbox } from './helpers/sandbox.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'prune-history.mjs');
const sandbox = makeRepoSandbox(ROOT, 'prune-history');
const dataDir = path.join(sandbox, 'data');
const history = path.join(dataDir, 'scan-history.tsv');
const cutoff = new Date('2035-01-01T00:00:00Z').getTime();

let passed = 0;
let failed = 0;
const check = (condition, label) => {
  if (condition) { console.log(`  PASS ${label}`); passed++; }
  else { console.log(`  FAIL ${label}`); failed++; }
};

const row = (firstSeen, status) => ({ firstSeen, status });
const decide = (firstSeen, status, skipCutoffMs = null) => decidePrune(
  row(firstSeen, status),
  { addedCutoffMs: cutoff, skipCutoffMs },
);
const backups = () => fs.readdirSync(dataDir).filter(name => name.includes('.bak-'));
const run = args => spawnSync(process.execPath, [SCRIPT, ...args], {
  cwd: sandbox,
  encoding: 'utf8',
});

console.log('prune-history.test.mjs');

check(decide('2030-01-01', 'skipped_title') === 'keep',
  'old skip rows stay when skip pruning is not enabled');
check(decide('2030-01-01', 'skipped_title', cutoff) === 'prune_skip',
  'old skip rows are pruned when skip pruning is enabled');
check(decide('2039-01-01', 'skipped_title', cutoff) === 'keep',
  'newer skip rows stay when skip pruning is enabled');
check(decide('2030-01-01', 'added') === 'prune_added'
  && decide('2039-01-01', 'added') === 'keep',
  'added row pruning keeps its existing cutoff behavior');
check(decide('', 'added') === 'keep'
  && decide('not-a-date', 'skipped_title', cutoff) === 'keep',
  'empty and unreadable dates are kept');

fs.mkdirSync(dataDir, { recursive: true });
const header = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus';
const keptOne = 'https://example.test/jobs/2\t2039-02-03\tgreenhouse\tSignal Builder\tZorblax Systems\tskipped_title';
const keptTwo = 'https://example.test/jobs/1\t2038-04-05\tlever\tData Keeper\tQuennox Labs\tadded';
const fixture = `${header}\r\n${keptOne}\r\n${keptTwo}\r\n`;
fs.writeFileSync(history, fixture, 'utf8');

const dry = run(['--dry-run', '--skips-older-than', '30']);
check(dry.status === 0 && fs.readFileSync(history, 'utf8') === fixture,
  'dry run leaves the history file unchanged');
check(backups().length === 0, 'dry run writes no backup');
check(dry.stdout.includes('Rows before: 2')
  && dry.stdout.includes('Pruned added: 0')
  && dry.stdout.includes('Rows kept: 2')
  && dry.stdout.includes('(estimated)'),
  'dry run reports row and estimated size details');

for (const value of ['29', 'nope']) {
  const before = fs.readFileSync(history, 'utf8');
  const invalid = run(['--skips-older-than', value]);
  check(invalid.status === 2 && invalid.stderr.includes('Usage:'),
    `skip age ${value} exits 2 through usage`);
  check(fs.readFileSync(history, 'utf8') === before && backups().length === 0,
    `skip age ${value} does not touch the file`);
}

const applied = run(['--skips-older-than', '30']);
const backupNames = backups();
check(applied.status === 0 && backupNames.length === 1,
  'a real run writes one timestamped backup');
check(/^scan-history\.tsv\.bak-\d{8}-\d{6}-prune$/.test(backupNames[0]),
  'the backup name has the prune timestamp suffix');
check(fs.readFileSync(path.join(dataDir, backupNames[0]), 'utf8') === fixture,
  'the backup contains the original file');
check(fs.readFileSync(history, 'utf8') === fixture,
  'the header and kept lines remain byte-identical and in order');
check(applied.stdout.includes(`Backup: data/scan-history.tsv.bak-`),
  'the real run prints its backup path');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
