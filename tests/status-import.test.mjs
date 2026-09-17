#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openEventStore } from '../lib/event-store.mjs';
import { importApplyEvidence } from '../lib/import/apply-import.mjs';
import {
  compareStatusHistory,
  importStatusHistory,
  rebuildStatusRows,
} from '../lib/import/status-import.mjs';
import { importTracker } from '../lib/import/tracker-import.mjs';
import { TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) {
    console.log(`  PASS ${message}`);
    passed++;
  } else {
    console.log(`  FAIL ${message}`);
    failed++;
  }
}

function row(cells) {
  return `| ${cells.join(' | ')} |`;
}

function trackerRow(num, date, company, status, score) {
  return row([
    num,
    date,
    company,
    'Example Pulley Role',
    `${score}/5`,
    status,
    'no',
    'fixture.docx',
    `[${num}](fixtures/${num}.md)`,
    'Invented fixture note',
    `https://jobs.example.test/roles/${num}`,
  ]);
}

const tracker = [
  '# Invented Applications Tracker',
  TRACKER_HEADER,
  TRACKER_SEPARATOR,
  trackerRow('900001', '2030-01-01', 'Zorblax Widgetry, Inc.', 'Applied', '0.01'),
  trackerRow('900002', '2030-01-02', 'Quennox Ratchet Works LLC', 'Evaluated', '0.02'),
  trackerRow('900003', '2030-01-03', 'Veltrix Gears Corp', 'Applied', '0.03'),
].join('\n');

const statusLines = [
  'app#\tdate\tstatus\tcompany\tlogged',
  '',
  ' 900001 \t 2030-01-02 \t Applied \t Zórblax-Widgetry Inc. \t 2030-01-02 ',
  '900001\t2030-01-02\tApplied\tZorblax Widgetry\t2030-01-02',
  '900001\t2030-01-02\tNot a Fit\tZorblax Widgetry\t2030-01-02',
  '900002\t2030-02-30\tEvaluated\tQuennox Ratchet Works\t2030-02-28',
  '900002\t2030-02-01\tEvaluated\tQuennox Ratchet Works\t2030-13-40',
  '900002\t2030-02-02\tMystery Orbit\tQuennox Ratchet Works',
  '900003\t2030-03-03\tEvaluated\tQuennox Ratchet Works\t2030-03-03',
  '900999\t2030-04-01\tClosed\tVeltrix Gears\t2030-04-01',
  'not-digits\t2030-04-02\tApplied\tVeltrix Gears\t2030-04-02',
  '900004\t2030-05-01\tApplied',
  '900005\t2030-05-02\tApplied\tQuennox Ratchet Works\t2030-05-01\textra-cell',
];
const statusText = statusLines
  .map((line, index) => (index === 2 ? `${line}\r` : line))
  .join('\n');
const definitionsVersion = 'fixture-v1';
const importedOn = '2030-12-31';
const sandbox = makeSandbox('status-import');

console.log('status-import.test.mjs');

const store = openEventStore(join(sandbox, 'status.db'));
importTracker(store, tracker, { definitionsVersion, importedOn });
importApplyEvidence(store, {
  applyDates: { 900001: '2030-01-02', 900003: '2030-01-03' },
  outputFiles: [],
  definitionsVersion,
  importedOn,
  ownerName: 'Example Person',
});
const report = importStatusHistory(store, statusText, { definitionsVersion, importedOn });
const comparison = compareStatusHistory(statusText, store);

check(comparison.match
  && comparison.original_rows === 11
  && comparison.rebuilt_rows === 11
  && comparison.mismatch_positions_count === 0
  && comparison.rendered_identical === 11
  && comparison.rendered_different === 0,
'status history rebuild matches cell for cell and every rendered row is identical');

const rebuilt = rebuildStatusRows(store);
check(rebuilt[0][0] === ' 900001 '
  && rebuilt[0][1] === ' 2030-01-02 '
  && rebuilt[0][2] === ' Applied '
  && rebuilt[0][3] === ' Zórblax-Widgetry Inc. '
  && rebuilt[0][4] === ' 2030-01-02 ',
'surrounding spaces and CRLF rows round-trip without trimming payload cells');

check(JSON.stringify(report.counts) === JSON.stringify({
  lines: 13,
  header_lines: 1,
  blank_lines: 1,
  events: 11,
  apps_with_history: 6,
  legacy_rows: 1,
}), 'status import counts are exact');

const expectedStatusCounts = {
  Applied: 5,
  'Not a Fit': 1,
  Evaluated: 3,
  other: 1,
  Closed: 1,
};
check(JSON.stringify(report.status_counts) === JSON.stringify(expectedStatusCounts),
  'canonical status counts and the other bucket are exact');

const actualFlagLines = Object.fromEntries(Object.entries(Object.groupBy(report.flags, flag => flag.type))
  .map(([type, flags]) => [type, flags.map(flag => flag.line_index)]));
const expectedFlagLines = {
  duplicate_consecutive: [3],
  same_day_revert: [4],
  invalid_date: [5],
  invalid_logged: [6],
  unknown_status: [7],
  legacy_row: [7],
  company_mismatch: [8],
  no_tracker_row: [9, 11, 12],
  invalid_app_id: [10],
  odd_cell_count: [11, 12],
  date_after_logged: [12],
  history_differs_from_tracker: [4, 7, 8],
  applied_application_without_applied_event: [8],
};
check(Object.keys(actualFlagLines).length === Object.keys(expectedFlagLines).length
  && Object.entries(expectedFlagLines).every(([type, lines]) => (
    JSON.stringify(actualFlagLines[type]) === JSON.stringify(lines)
  )), 'every flag type fires exactly on its intended lines');

check(!report.flags.find(flag => flag.type === 'company_mismatch' && flag.line_index === 2)
  && report.flags.find(flag => flag.type === 'company_mismatch')?.line_index === 8,
'company folding variants match while a different company is flagged');

const serializedReport = JSON.stringify(report);
check([
  'Zorblax Widgetry',
  'Quennox Ratchet Works',
  'Veltrix Gears',
  '2030-01-02',
  '2030-02-30',
  '2030-13-40',
  'Mystery Orbit',
  'extra-cell',
  ' Zórblax-Widgetry Inc. ',
].every(value => !serializedReport.includes(value)),
'the report contains no fixture company, date or raw cell value');

store.close();

const missingStore = openEventStore(join(sandbox, 'missing.db'));
const statusMissingOne = statusLines.filter((line, index) => index !== 9).join('\n');
importStatusHistory(missingStore, statusMissingOne, { definitionsVersion, importedOn });
const missingComparison = compareStatusHistory(statusText, missingStore);
check(!missingComparison.match
  && missingComparison.original_rows === 11
  && missingComparison.rebuilt_rows === 10
  && missingComparison.mismatch_positions_count > 0,
'a store missing one status event fails comparison');
missingStore.close();

const cliData = join(sandbox, 'fixture-input');
const cliOutput = join(sandbox, 'fixture-output');
mkdirSync(cliData);
mkdirSync(cliOutput);
writeFileSync(join(cliData, 'applications.md'), tracker, 'utf8');
writeFileSync(join(cliData, 'apply-dates.json'), `${JSON.stringify({
  900001: '2030-01-02',
  900003: '2030-01-03',
})}\n`, 'utf8');
writeFileSync(join(cliData, 'status-events.tsv'), statusText, 'utf8');

const cliPath = resolve(fileURLToPath(new URL('../scripts/import-dry-run.mjs', import.meta.url)));
const cliDb = join(sandbox, 'cli.db');
const cliReport = join(sandbox, 'cli-report.json');
const cli = spawnSync(process.execPath, [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', cliDb,
  '--report', cliReport,
  '--definitions-version', definitionsVersion,
  '--owner-name', 'Example Person',
], { encoding: 'utf8' });
const writtenReport = existsSync(cliReport) ? JSON.parse(readFileSync(cliReport, 'utf8')) : null;
check(cli.status === 0
  && /STATUS HISTORY MATCH/.test(cli.stdout)
  && writtenReport?.status?.comparison?.match
  && writtenReport.status.counts.status_events_file_missing === false,
'dry-run CLI imports status history, reports a match and exits zero');
check(!cli.stdout.includes('Zorblax')
  && !cli.stdout.includes('Quennox')
  && !cli.stdout.includes('Veltrix')
  && !cli.stdout.includes('Mystery Orbit')
  && !cli.stdout.includes('2030-')
  && !cli.stdout.includes('900001'),
'dry-run CLI prints status counts and flags without fixture row values');

const samePath = join(sandbox, 'same-output.db');
const identicalPaths = spawnSync(process.execPath, [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', samePath,
  '--report', samePath,
  '--owner-name', 'Example Person',
], { encoding: 'utf8' });
const existing = spawnSync(process.execPath, [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', cliDb,
  '--report', join(sandbox, 'existing-report.json'),
  '--owner-name', 'Example Person',
], { encoding: 'utf8' });
const repoDataDb = resolve(fileURLToPath(new URL('../data/fixture-status.db', import.meta.url)));
const repoDataReport = resolve(fileURLToPath(new URL('../data/fixture-status-report.json', import.meta.url)));
const underDataDb = spawnSync(process.execPath, [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', repoDataDb,
  '--report', join(sandbox, 'under-data-db-report.json'),
  '--owner-name', 'Example Person',
], { encoding: 'utf8' });
const underDataReport = spawnSync(process.execPath, [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', join(sandbox, 'under-data-report.db'),
  '--report', repoDataReport,
  '--owner-name', 'Example Person',
], { encoding: 'utf8' });
check(identicalPaths.status === 2
  && existing.status === 2
  && underDataDb.status === 2
  && underDataReport.status === 2
  && !existsSync(samePath),
'dry-run CLI keeps all existing path and database refusals');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
