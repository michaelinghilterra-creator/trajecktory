#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { verifyImport } from '../lib/import/verify-import.mjs';
import { runEventStore } from '../scripts/event-store.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  PASS ${msg}`); passed++; }
  else { console.log(`  FAIL ${msg}`); failed++; }
}

const root = makeSandbox('event-store-preview');
console.log('event-store-preview.test.mjs');

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

function snapshot(dir) {
  const values = {};
  const visit = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(current, entry.name), key);
      else values[key] = readFileSync(join(current, entry.name)).toString('base64');
    }
  };
  visit(dir, '');
  return JSON.stringify(values);
}

function run(item, argv, extra = {}) {
  const stdout = [];
  const stderr = [];
  const previous = process.env.TJK_DATA_DIR;
  process.env.TJK_DATA_DIR = item.dataDir;
  let code;
  try {
    code = runEventStore(argv, {
      backupsDir: item.backupsDir,
      getOwnerName: () => 'Example Personone',
      now: () => new Date('2030-03-04T05:06:07.000Z'),
      findOtherWriters: () => [],
      io: { log: value => stdout.push(String(value)), error: value => stderr.push(String(value)) },
      ...extra,
    });
  } finally {
    if (previous === undefined) delete process.env.TJK_DATA_DIR;
    else process.env.TJK_DATA_DIR = previous;
  }
  return { code, stdout, stderr };
}
const previewArgs = (item, ...more) => ['flip', '--json', ...more, '--data-dir', item.dataDir, '--output-dir', item.outputDir];

// A valid folder
{
  const item = fixture('valid');
  const before = snapshot(item.dataDir);
  const result = run(item, previewArgs(item));
  check(result.code === 0, 'flip --json on a valid folder returns 0');
  check(result.stdout.length === 1, 'it prints exactly one document and nothing else');
  const doc = JSON.parse(result.stdout[0]);
  check(doc.command === 'flip' && doc.dry_run === true && doc.ok === true && doc.exit_code === 0, 'the document says it is a successful dry run');
  check(Number.isInteger(doc.events) && doc.events > 0, 'it reports how many events would be imported');
  const names = doc.checks.map(item => item.name);
  check(doc.checks.length === 8 && doc.checks.every(item => item.match === true), 'all eight comparison checks are listed and pass');
  check(['Tracker', 'Apply dates', 'Status history', 'People', 'Followups', 'Correspondence', 'LinkedIn', 'TWC'].every(name => names.includes(name)), 'the checks carry readable names, including LinkedIn and TWC');
  check(doc.byte_checks.length > 0 && doc.byte_checks.every(item => item.match === true && typeof item.file === 'string'), 'every byte check is listed and passes');
  check(doc.byte_checks.some(item => item.file === 'applications.md') && doc.byte_checks.some(item => item.file === 'target-talent-correspondence'), 'the byte checks name the files and the correspondence folders');
  check(Array.isArray(doc.messages) && doc.messages.some(line => line.startsWith('Dry run passed')) && doc.errors.length === 0, 'the messages are included and there are no errors');
  check(doc.will_add.length > 0 && doc.will_not_change.length > 0 && [...doc.will_add, ...doc.will_not_change].every(line => typeof line === 'string'), 'the document says what would be added and what stays the same');
  check(snapshot(item.dataDir) === before, 'the data folder is byte identical afterwards');
  check(!existsSync(join(item.dataDir, 'trajecktory.db')) && !existsSync(join(item.dataDir, 'event-store.json')) && readdirSync(item.backupsDir).length === 0, 'no database, switch file or backup was created');
}

// Refusals come back as a document, not a crash
{
  const item = fixture('already-on');
  writeFileSync(join(item.dataDir, 'event-store.json'), '{"writes":"on"}\n', 'utf8');
  const result = run(item, previewArgs(item));
  const doc = JSON.parse(result.stdout[0]);
  check(result.code === 1 && doc.ok === false && doc.exit_code === 1 && doc.events === null, 'a store that is already on gives ok false and no event count');
  check(doc.errors.some(line => line.includes('already on')) && doc.checks.length === 0, 'the errors say why and no checks ran');
}
{
  const item = fixture('stale-database');
  writeFileSync(join(item.dataDir, 'trajecktory.db'), 'x', 'utf8');
  const refused = JSON.parse(run(item, previewArgs(item)).stdout[0]);
  check(refused.ok === false && refused.errors.some(line => line.includes('--reimport')), 'an older database without --reimport is refused and the errors name the flag');
  const allowed = JSON.parse(run(item, previewArgs(item, '--reimport')).stdout[0]);
  check(allowed.ok === true && allowed.checks.length === 8, 'with --reimport the practice run goes ahead');
  check(readFileSync(join(item.dataDir, 'trajecktory.db'), 'utf8') === 'x', 'and the older database is left as it was');
}
{
  const item = fixture('bad-utf8');
  writeFileSync(join(item.dataDir, 'target-talent-correspondence', '900002.md'), Buffer.from([0xff, 0xfe]));
  const doc = JSON.parse(run(item, previewArgs(item)).stdout[0]);
  check(doc.ok === false && doc.errors.some(line => line.includes('not valid UTF-8') && line.includes('900002.md')), 'a file that is not valid UTF-8 is reported in the errors');
}

// A failing check is reported as a failing check
{
  const item = fixture('mismatch');
  const result = run(item, previewArgs(item), {
    verifyImportFn: (...args) => {
      const real = verifyImport(...args);
      return { ...real, ok: false, comparisons: { ...real.comparisons, tracker: { ...real.comparisons.tracker, match: false } } };
    },
  });
  const doc = JSON.parse(result.stdout[0]);
  check(result.code === 1 && doc.ok === false && doc.exit_code === 1, 'a failed verification gives ok false and exit code 1');
  check(doc.checks.find(item => item.name === 'Tracker')?.match === false && doc.checks.filter(item => item.match).length === 7, 'exactly the failing check is marked as failing');
  check(doc.events === null && doc.errors.some(line => line.includes('Verification failed')), 'there is no event count and the errors say verification failed');
}

// A file that cannot be rebuilt byte for byte shows up as a failing byte check
{
  const item = fixture('bytes-differ');
  const result = run(item, previewArgs(item), {
    verifyImportFn: (...args) => {
      const real = verifyImport(...args);
      const tables = { ...real.bytes.tables, 'applications.md': { ...real.bytes.tables['applications.md'], match: false, first_differing_line: 3 } };
      return { ...real, ok: false, bytes: { ...real.bytes, tables } };
    },
  });
  const doc = JSON.parse(result.stdout[0]);
  const differing = doc.byte_checks.filter(item => !item.match);
  check(doc.ok === false && differing.length === 1 && differing[0].file === 'applications.md', 'exactly the file that differs is marked as failing in the byte checks');
  check(doc.byte_checks.filter(item => item.match).length === doc.byte_checks.length - 1, 'every other file is still listed as matching');
}

// Combinations that are refused
{
  const item = fixture('refused-combinations');
  const applied = run(item, ['flip', '--json', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir]);
  check(applied.code === 2 && applied.stdout.length === 0 && applied.stderr.join('\n').includes('--json works with the dry run only'), '--json with --apply is refused with code 2 and prints no document');
  check(!existsSync(join(item.dataDir, 'trajecktory.db')) && !existsSync(join(item.dataDir, '.event-store-operation.lock')), 'and does nothing');
  const rollback = run(item, ['rollback', '--json']);
  check(rollback.code === 2 && rollback.stdout.length === 0 && rollback.stderr.join('\n').includes('usage'), 'rollback --json is a usage error');
  const twice = run(item, ['flip', '--json', '--json', '--data-dir', item.dataDir]);
  check(twice.code === 2, 'a repeated --json is a usage error');
}

// Without --json nothing changes
{
  const item = fixture('plain-dry-run');
  const result = run(item, ['flip', '--data-dir', item.dataDir, '--output-dir', item.outputDir]);
  check(result.code === 0 && result.stdout.some(line => line === 'TRACKER MATCH') && !result.stdout.some(line => line.trim().startsWith('{')), 'the plain dry run still prints its check lines and no JSON');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
