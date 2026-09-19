#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findNonUtf8Files } from '../lib/import/utf8-guard.mjs';
import { TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { runEventStore } from '../scripts/event-store.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  PASS ${msg}`); passed++; }
  else { console.log(`  FAIL ${msg}`); failed++; }
}

function fixture(root, name) {
  const base = join(root, name);
  const dataDir = join(base, 'input');
  const outputDir = join(base, 'generated');
  const backupsDir = join(base, 'saved-copies');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(backupsDir, { recursive: true });
  return { base, dataDir, outputDir, backupsDir };
}

const root = makeSandbox('event-store-utf8');
console.log('event-store-utf8.test.mjs');

const BAD = Buffer.from([0xff, 0xfe]);
const validDates = '{\n  "900001": "2030-03-02"\n}\n';

// findNonUtf8Files
{
  const item = fixture(root, 'all-valid');
  writeFileSync(join(item.dataDir, 'applications.md'), '# Valid file\n', 'utf8');
  writeFileSync(join(item.dataDir, 'apply-dates.json'), validDates, 'utf8');
  mkdirSync(join(item.dataDir, 'target-talent-correspondence'));
  writeFileSync(join(item.dataDir, 'target-talent-correspondence', '900001.md'), '# Example Personone\n\nInvented message for Zorblax Widgetry.\n', 'utf8');
  check(findNonUtf8Files(item.dataDir).length === 0, 'a folder of valid files reports nothing');
}
{
  const item = fixture(root, 'bad-correspondence');
  mkdirSync(join(item.dataDir, 'target-talent-correspondence'));
  writeFileSync(join(item.dataDir, 'target-talent-correspondence', '900002.md'), BAD);
  check(JSON.stringify(findNonUtf8Files(item.dataDir)) === JSON.stringify(['target-talent-correspondence/900002.md']), 'a bad correspondence file is reported with a forward slash path');
}
{
  const item = fixture(root, 'bad-json-and-table');
  writeFileSync(join(item.dataDir, 'apply-dates.json'), BAD);
  writeFileSync(join(item.dataDir, 'applications.md'), BAD);
  const found = findNonUtf8Files(item.dataDir);
  check(found.includes('apply-dates.json') && found.includes('applications.md') && found.length === 2, 'a bad legacy JSON file and a bad table file are both reported');
  check(JSON.stringify(found) === JSON.stringify([...found].sort()), 'the result is sorted');
}
{
  const item = fixture(root, 'bom-and-multibyte');
  writeFileSync(join(item.dataDir, 'applications.md'), Buffer.from([0xef, 0xbb, 0xbf, 0x48, 0x69]));
  writeFileSync(join(item.dataDir, 'apply-dates.json'), Buffer.from([0xc3, 0xa9, 0xc3, 0xbc]));
  check(findNonUtf8Files(item.dataDir).length === 0, 'a byte order mark and valid multi-byte text are not reported');
}
{
  const item = fixture(root, 'truncated-sequence');
  writeFileSync(join(item.dataDir, 'applications.md'), Buffer.from([0x48, 0xc3]));
  check(findNonUtf8Files(item.dataDir).join() === 'applications.md', 'a multi-byte sequence cut short is reported');
}
{
  const item = fixture(root, 'missing');
  check(findNonUtf8Files(item.dataDir).length === 0, 'missing files and folders are skipped without an error');
}
{
  const item = fixture(root, 'two-bad');
  mkdirSync(join(item.dataDir, 'target-talent-correspondence'));
  mkdirSync(join(item.dataDir, 'referral-correspondence'));
  writeFileSync(join(item.dataDir, 'referral-correspondence', '900003.md'), BAD);
  writeFileSync(join(item.dataDir, 'target-talent-correspondence', '900002.md'), BAD);
  check(findNonUtf8Files(item.dataDir).join() === 'referral-correspondence/900003.md,target-talent-correspondence/900002.md', 'two bad files come back sorted');
}
{
  const item = fixture(root, 'subdirectory');
  mkdirSync(join(item.dataDir, 'target-talent-correspondence', 'nested'), { recursive: true });
  writeFileSync(join(item.dataDir, 'target-talent-correspondence', 'nested', '900004.md'), BAD);
  check(findNonUtf8Files(item.dataDir).length === 0, 'only files directly inside a correspondence folder are checked');
}

// Through runEventStore: the flip refuses before it backs up, imports or writes anything.
function fullFixture(name) {
  const item = fixture(root, name);
  const row = '| 900001 | 2030-03-01 | Zorblax Widgetry | Example Cog Lead | 0.11/5 | Evaluated | no | example.docx | [900001](https://example.test/r/900001) | Invented fixture | https://example.test/jobs/900001 |';
  writeFileSync(join(item.dataDir, 'applications.md'), ['# Invented Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, row, ''].join('\n'), 'utf8');
  writeFileSync(join(item.dataDir, 'apply-dates.json'), validDates, 'utf8');
  mkdirSync(join(item.dataDir, 'target-talent-correspondence'));
  writeFileSync(join(item.dataDir, 'target-talent-correspondence', '900001.md'), '# Example Personone\n\nInvented message for Zorblax Widgetry.\n', 'utf8');
  return item;
}

function flip(item, extraArgs) {
  const stdout = [];
  const stderr = [];
  const previous = process.env.TJK_DATA_DIR;
  process.env.TJK_DATA_DIR = item.dataDir;
  let code;
  try {
    code = runEventStore(['flip', ...extraArgs, '--data-dir', item.dataDir, '--output-dir', item.outputDir], {
      backupsDir: item.backupsDir,
      getOwnerName: () => 'Example Personone',
      now: () => new Date('2030-03-04T05:06:07.000Z'),
      isProcessAlive: () => false,
      io: { log: value => stdout.push(String(value)), error: value => stderr.push(String(value)) },
    });
  } finally {
    if (previous === undefined) delete process.env.TJK_DATA_DIR;
    else process.env.TJK_DATA_DIR = previous;
  }
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

for (const [label, args] of [['dry run', []], ['apply', ['--apply', '--no-other-writers']]]) {
  const item = fullFixture(`refuse-${label.replace(' ', '-')}`);
  writeFileSync(join(item.dataDir, 'target-talent-correspondence', '900002.md'), BAD);
  const result = flip(item, args);
  check(result.code === 1, `${label}: a folder with a non UTF-8 file is refused with code 1`);
  check(result.stderr.includes('not valid UTF-8') && result.stderr.includes('target-talent-correspondence/900002.md'), `${label}: the message names the problem and the file`);
  check(!existsSync(join(item.dataDir, 'trajecktory.db')) && !existsSync(join(item.dataDir, 'event-store.json')), `${label}: no database and no switch file were created`);
  check(readdirSync(item.backupsDir).length === 0, `${label}: no backup was made`);
  check(!existsSync(join(item.dataDir, '.event-store-operation.lock')), `${label}: no lock file was left behind`);
}
{
  const item = fullFixture('clean-dry-run');
  const result = flip(item, []);
  check(result.code === 0 && result.stdout.includes('Dry run passed'), 'a clean folder still passes the dry run');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
