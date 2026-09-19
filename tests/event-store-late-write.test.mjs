#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeFileAtomic } from '../lib/atomic-write.mjs';
import { TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { runEventStore } from '../scripts/event-store.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  PASS ${msg}`); passed++; }
  else { console.log(`  FAIL ${msg}`); failed++; }
}

const root = makeSandbox('event-store-late-write');
console.log('event-store-late-write.test.mjs');

function fixture(name) {
  const base = join(root, name);
  const dataDir = join(base, 'input');
  const outputDir = join(base, 'generated');
  const backupsDir = join(base, 'saved-copies');
  for (const dir of [dataDir, outputDir, backupsDir]) mkdirSync(dir, { recursive: true });
  const row = '| 900001 | 2030-03-01 | Zorblax Widgetry | Example Cog Lead | 0.11/5 | Evaluated | no | example.docx | [900001](https://example.test/r/900001) | Invented fixture | https://example.test/jobs/900001 |';
  writeFileSync(join(dataDir, 'applications.md'), ['# Invented Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, row, ''].join('\n'), 'utf8');
  writeFileSync(join(dataDir, 'apply-dates.json'), '{\n  "900001": "2030-03-02"\n}\n', 'utf8');
  mkdirSync(join(dataDir, 'target-talent-correspondence'));
  writeFileSync(join(dataDir, 'target-talent-correspondence', '900001.md'), '# Example Personone\n\nInvented message for Zorblax Widgetry.\n', 'utf8');
  return { dataDir, outputDir, backupsDir };
}

function flip(item, extra = {}) {
  const stdout = [];
  const stderr = [];
  const previous = process.env.TJK_DATA_DIR;
  process.env.TJK_DATA_DIR = item.dataDir;
  let code;
  try {
    code = runEventStore(['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir], {
      backupsDir: item.backupsDir,
      getOwnerName: () => 'Example Personone',
      now: () => new Date('2030-03-04T05:06:07.000Z'),
      findOtherWriters: () => [],
      isProcessAlive: () => false,
      io: { log: value => stdout.push(String(value)), error: value => stderr.push(String(value)) },
      ...extra,
    });
  } finally {
    if (previous === undefined) delete process.env.TJK_DATA_DIR;
    else process.env.TJK_DATA_DIR = previous;
  }
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

// A writeSwitch that behaves like the real one and lets the test act just after the 'on' write.
function switchWriter(onFirstOn, { failOff = false } = {}) {
  const calls = [];
  const write = (path, text, encoding) => {
    calls.push(text);
    if (failOff && text.includes('"writes": "off"')) throw new Error('disk full');
    writeFileAtomic(path, text, encoding);
    if (text.includes('"writes": "on"') && calls.filter(value => value.includes('"writes": "on"')).length === 1) onFirstOn();
  };
  write.calls = calls;
  return write;
}

const switchFile = item => join(item.dataDir, 'event-store.json');
const noDatabase = item => !existsSync(join(item.dataDir, 'trajecktory.db')) && !existsSync(join(item.dataDir, 'trajecktory.db-wal')) && !existsSync(join(item.dataDir, 'trajecktory.db-shm'));

// A clean flip is unaffected: one switch write, switch on, database present.
{
  const item = fixture('clean');
  const before = readFileSync(join(item.dataDir, 'applications.md'), 'utf8');
  const write = switchWriter(() => {});
  const result = flip(item, { writeSwitch: write });
  check(result.code === 0, 'a clean flip still returns 0');
  check(write.calls.length === 1 && JSON.parse(readFileSync(switchFile(item), 'utf8')).writes === 'on', 'the switch is written once and left on');
  check(existsSync(join(item.dataDir, 'trajecktory.db')) && readFileSync(join(item.dataDir, 'applications.md'), 'utf8') === before, 'the database is present and the data files are untouched');
}

// A write to an imported file after the switch is on fails the flip and turns the switch off.
{
  const item = fixture('late-table');
  const write = switchWriter(() => appendFileSync(join(item.dataDir, 'applications.md'), '\nInvented late line.\n', 'utf8'));
  const result = flip(item, { writeSwitch: write });
  check(result.code === 1, 'a late write to a table file fails the flip');
  check(result.stderr.includes('after the switch was turned on') && result.stderr.includes('applications.md'), 'the message says when it happened and names the file');
  check(JSON.parse(readFileSync(switchFile(item), 'utf8')).writes === 'off', 'the switch is turned back off');
  check(noDatabase(item), 'the new database is removed');
  check(readdirSync(item.backupsDir).length === 1 && result.stderr.includes('Backup retained'), 'the backup is retained');
  check(write.calls.length === 2, 'the switch was written twice, on then off');
}

// A NEW correspondence file created after the switch is on is caught too.
{
  const item = fixture('late-new-file');
  const write = switchWriter(() => writeFileSync(join(item.dataDir, 'target-talent-correspondence', '900009.md'), '# Example Personone\n\nInvented late message.\n', 'utf8'));
  const result = flip(item, { writeSwitch: write });
  check(result.code === 1 && result.stderr.includes('target-talent-correspondence/900009.md'), 'a file created after the switch is on fails the flip and is named');
  check(JSON.parse(readFileSync(switchFile(item), 'utf8')).writes === 'off' && noDatabase(item), 'the switch is off and the database is gone');
}

// If the switch cannot be turned back off, the operator is told exactly what to run.
{
  const item = fixture('cannot-turn-off');
  const write = switchWriter(() => appendFileSync(join(item.dataDir, 'applications.md'), '\nInvented late line.\n', 'utf8'), { failOff: true });
  const result = flip(item, { writeSwitch: write });
  check(result.code === 1 && result.stderr.includes('could NOT be turned back off') && result.stderr.includes('rollback --apply --no-other-writers'), 'a failed turn off is reported with the rollback command');
  check(result.stderr.includes('disk full'), 'and with the underlying reason');
}

// A late write to a file the import does not track does not fail the flip.
{
  const item = fixture('late-untracked');
  const write = switchWriter(() => writeFileSync(join(item.dataDir, 'dashboard-cache.json'), '{}\n', 'utf8'));
  const result = flip(item, { writeSwitch: write });
  check(result.code === 0 && JSON.parse(readFileSync(switchFile(item), 'utf8')).writes === 'on', 'a file the import does not track is not treated as a change');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
