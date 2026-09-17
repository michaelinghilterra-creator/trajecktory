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
import { openEventStore, readEvents } from '../lib/event-store.mjs';
import {
  compareFollowups,
  importFollowups,
  rebuildFollowupRows,
} from '../lib/import/followups-import.mjs';
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

function tableRow(cells) {
  return `| ${cells.join(' | ')} |`;
}

function trackerRow(num, company) {
  return tableRow([
    num,
    '2030-01-01',
    company,
    'Example Pulley Role',
    '0.01/5',
    'Applied',
    'no',
    'fixture.docx',
    `[${num}](fixtures/${num}.md)`,
    'Invented tracker note',
    `https://jobs.example.test/${num}`,
  ]);
}

const trackerText = [
  '# Invented Applications Tracker',
  TRACKER_HEADER,
  TRACKER_SEPARATOR,
  trackerRow('900001', 'Zorblax Widgetry'),
  trackerRow('900002', 'Quennox Ratchet Works'),
].join('\n');

const directEmail = tableRow([
  '1', '900001', '2030-01-02', 'Zorblax Widgetry', 'Example Pulley Role',
  'Email', 'Example Personone', 'Invented direct signal',
]);
const skipNotes = tableRow([
  '13', '900001', '2030-01-14', 'Zorblax Widgetry', 'Example Pulley Role',
  'Email', 'Example Personthirteen', 'SKIP',
]);
const skipContact = tableRow([
  '14', '900002', '2030-01-15', 'Quennox Ratchet Works', 'Example Pulley Role',
  'LinkedIn', 'SKIP', 'Invented placeholder signal',
]);
const skpNotes = tableRow([
  '15', '900001', '2030-01-16', 'Zorblax Widgetry', 'Example Pulley Role',
  'Email', 'Example Personfourteen', 'SKP',
]);
const backFilled = tableRow([
  '16', '900002', '2030-01-17', 'Quennox Ratchet Works', 'Example Pulley Role',
  'Email', 'Example Personfifteen', 'Back-filled from Talent Acquisition (status snapshot)',
]);
const backFill = tableRow([
  '17', '900001', '2030-01-18', 'Zorblax Widgetry', 'Example Pulley Role',
  'LinkedIn', 'Example Personsixteen', 'Back-fill',
]);
const escapedPipe = tableRow([
  '18', '900002', '2030-01-19', 'Quennox Ratchet Works', 'Example Pulley Role',
  'Email', 'Example Personseventeen', 'Invented escaped \\| pipe signal',
]);
const followupLines = [
  '# Invented Follow-Ups',
  'This fixture documents invented messages.',
  'Rows below exercise preservation rules.',
  '| # | app# | date | company | role | channel | contact | notes |',
  '|---|------|------|---------|------|---------|---------|-------|',
  directEmail,
  tableRow(['2', '900002', '2030-01-03', 'Quennox Ratchet Works', 'Example Pulley Role', 'LinkedIn', 'Example Persontwo', 'Invented linked signal']),
  tableRow(['3', '900001', '2030-01-04', 'Zorblax Widgetry', 'Example Pulley Role', 'Email', 'Example Personthree', 'Cross-logged from Talent Acquisition after connection request']),
  tableRow(['4', '900002', '2030-01-05', 'Quennox Ratchet Works', 'Example Pulley Role', 'LinkedIn', 'Example Personfour', 'Cross-logged from Talent Acquisition']),
  tableRow(['5', '900001', '2030-01-06', 'Zorblax Widgetry', 'Example Pulley Role', 'Email', 'Example Personfive', 'Backfill 2030-01-01: invented snapshot']),
  tableRow(['6', '900001', '2030-01-02', 'Zorblax Widgetry', 'Example Pulley Role', 'Email', 'Example Personone', 'Invented direct signal']),
  tableRow(['7', '900001', '2030-01-07', 'Zorblax Widgetry', 'Example Pulley Role', 'Cross-ref', 'Example Personsix', 'Invented cross reference']),
  tableRow(['8', '900002', '2030-01-08', 'Quennox Ratchet Works', 'Example Pulley Role', 'Other', 'Example Personseven', 'Invented other route']),
  tableRow(['9', '900001', '2030-01-09', 'Zorblax Widgetry', 'Example Pulley Role', 'Email', 'Example Personeight', 'Invented extra cell signal', 'invented-extra']),
  tableRow(['10', '900002', '2030-02-30', 'Quennox Ratchet Works', 'Example Pulley Role', 'LinkedIn', 'Example Personnine', 'Invented invalid date signal']),
  tableRow(['11', 'not-digits', '2030-01-11', 'Zorblax Widgetry', 'Example Pulley Role', 'Email', 'Example Personten', 'Invented invalid app signal']),
  tableRow(['12', '900999', '2030-01-12', 'Quennox Ratchet Works', 'Example Pulley Role', 'LinkedIn', 'Example Personeleven', 'Invented absent tracker signal']),
  tableRow(['12', '900002', '2030-01-13', 'Quennox Ratchet Works', 'Example Pulley Role', 'Email', 'Example Persontwelve', 'Invented repeated number signal']),
  skipNotes,
  skipContact,
  skpNotes,
  backFilled,
  backFill,
  escapedPipe,
];
const followupsText = followupLines
  .map((line, index) => (index === 6 ? `${line}\r` : line))
  .join('\n');
const definitionsVersion = 'fixture-v1';
const importedOn = '2030-12-31';
const sandbox = makeSandbox('followups-import');

console.log('followups-import.test.mjs');

const store = openEventStore(join(sandbox, 'followups.db'));
importTracker(store, trackerText, { definitionsVersion, importedOn });
const report = importFollowups(store, followupsText, { definitionsVersion, importedOn });
const comparison = compareFollowups(followupsText, store);

check(comparison.match
  && comparison.original_rows === 19
  && comparison.rebuilt_rows === 19
  && comparison.mismatch_positions_count === 0
  && rebuildFollowupRows(store)[1] === followupLines[6],
'follow-up rows round-trip exactly, including a CRLF input line');

check(JSON.stringify(report.counts) === JSON.stringify({
  lines: 24,
  non_row_lines: 5,
  rows: 19,
  direct: 8,
  cross_log_copy: 2,
  backfill: 3,
  skip_placeholder: 3,
  duplicate_row: 1,
  unknown_channel: 2,
}) && JSON.stringify(report.direct_by_channel) === JSON.stringify({
  email: 5,
  linkedin_message: 3,
}), 'classification counts and direct channel counts are exact');

const expectedFlagLines = {
  no_person_link: [5, 6, 13, 14, 15, 16, 17, 23],
  linkedin_request_in_email_channel: [7],
  extra_cells: [13],
  invalid_date: [14],
  invalid_app_num: [15],
  no_tracker_row: [16],
  duplicate_n: [17],
};
const actualFlagLines = Object.fromEntries(Object.entries(Object.groupBy(report.flags, flag => flag.type))
  .map(([type, items]) => [type, items.map(item => item.line_index)]));
check(Object.keys(actualFlagLines).length === Object.keys(expectedFlagLines).length
  && Object.entries(expectedFlagLines).every(([type, lines]) => (
    JSON.stringify(actualFlagLines[type]) === JSON.stringify(lines)
  )), 'every flag fires exactly on the intended rows');

const importedEvents = readEvents(store).filter(event => event.payload.file === 'follow-ups.md');
const sent = importedEvents.filter(event => event.type === 'message_sent');
// The file_layout legacy_record is whole-file metadata, not an imported follow-up row.
const legacy = importedEvents.filter(event => event.type === 'legacy_record'
  && Number.isInteger(event.payload.line_index));
check(sent.length === 8
  && legacy.length === 11
  && sent.every(event => !event.person_id)
  && legacy.map(event => event.payload.reason).sort().join(',')
    === 'backfill,backfill,backfill,cross_log_copy,cross_log_copy,duplicate_row,skip_placeholder,skip_placeholder,skip_placeholder,unknown_channel,unknown_channel',
'only direct rows create unlinked message events and every other row creates one legacy event');

const eventByRaw = new Map(importedEvents.map(event => [event.payload.raw, event]));
check([skipNotes, skipContact, skpNotes].every(raw => (
  eventByRaw.get(raw)?.type === 'legacy_record'
    && eventByRaw.get(raw)?.payload.reason === 'skip_placeholder'
))
  && [backFilled, backFill].every(raw => (
    eventByRaw.get(raw)?.type === 'legacy_record'
      && eventByRaw.get(raw)?.payload.reason === 'backfill'
  ))
  && eventByRaw.get(escapedPipe)?.type === 'message_sent'
  && !report.flags.some(flag => flag.type === 'extra_cells' && flag.line_index === 23),
'placeholders, hyphenated backfills and an escaped pipe are classified as intended');

const eventCountBeforeRepeat = readEvents(store).length;
let repeatedRefused = false;
try {
  importFollowups(store, followupsText, { definitionsVersion, importedOn });
} catch (error) {
  repeatedRefused = /UNIQUE|unique/i.test(String(error?.message ?? error));
}
check(repeatedRefused && readEvents(store).length === eventCountBeforeRepeat,
'a repeated import is refused by dedupe keys and writes nothing');

const serializedReport = JSON.stringify(report);
check([
  'Zorblax Widgetry',
  'Quennox Ratchet Works',
  'Example Pulley Role',
  'Example Personone',
  'Invented direct signal',
].every(value => !serializedReport.includes(value)),
'the report contains no fixture company, role, contact or note text');
store.close();

const cliData = join(sandbox, 'fixture-input');
const cliOutput = join(sandbox, 'fixture-output');
mkdirSync(cliData);
mkdirSync(cliOutput);
writeFileSync(join(cliData, 'applications.md'), trackerText, 'utf8');
writeFileSync(join(cliData, 'follow-ups.md'), followupsText, 'utf8');
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
  '--owner-name', 'Example Owner',
], { encoding: 'utf8' });
const written = existsSync(cliReport) ? JSON.parse(readFileSync(cliReport, 'utf8')) : null;
check(cli.status === 0
  && /FOLLOWUPS MATCH/.test(cli.stdout)
  && written?.followups?.comparison?.match
  && written.followups.counts.followups_file_missing === false,
'dry-run CLI prints FOLLOWUPS MATCH and exits zero');
check([
  'Zorblax Widgetry',
  'Quennox Ratchet Works',
  'Example Pulley Role',
  'Example Personone',
  'Invented direct signal',
].every(value => !cli.stdout.includes(value)),
'dry-run CLI prints no fixture values');

const samePath = join(sandbox, 'same.db');
const same = spawnSync(process.execPath, [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', samePath,
  '--report', samePath,
  '--owner-name', 'Example Owner',
], { encoding: 'utf8' });
const existing = spawnSync(process.execPath, [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', cliDb,
  '--report', join(sandbox, 'existing-report.json'),
  '--owner-name', 'Example Owner',
], { encoding: 'utf8' });
const prohibitedDb = resolve(fileURLToPath(new URL('../data/fixture-followups.db', import.meta.url)));
const prohibitedReport = resolve(fileURLToPath(new URL('../data/fixture-followups-report.json', import.meta.url)));
const underDataDb = spawnSync(process.execPath, [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', prohibitedDb,
  '--report', join(sandbox, 'under-data-report.json'),
  '--owner-name', 'Example Owner',
], { encoding: 'utf8' });
const underDataReport = spawnSync(process.execPath, [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', join(sandbox, 'under-data.db'),
  '--report', prohibitedReport,
  '--owner-name', 'Example Owner',
], { encoding: 'utf8' });
check(same.status === 2
  && existing.status === 2
  && underDataDb.status === 2
  && underDataReport.status === 2
  && !existsSync(samePath),
'dry-run CLI keeps every existing refusal');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
