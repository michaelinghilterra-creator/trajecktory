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
import { importCorrespondence } from '../lib/import/correspondence-import.mjs';
import {
  compareLinkedIn,
  importLinkedIn,
} from '../lib/import/linkedin-import.mjs';
import { importPeople } from '../lib/import/people-import.mjs';
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

function targetTalentRow(id, suffix) {
  return `| ${id} | Zorblax Widgetry | Person${suffix} | Example |  | Example Pulley Role |  |  |  |  | example.${suffix}@example.test | https://www.linkedin.com/in/example-person-${suffix} | Not Contacted |  | Invented note |  |`;
}

function correspondenceEntry(timestamp, subject) {
  return `## ${timestamp} | Sent | LinkedIn | ${subject}\n\nInvented correspondence body.\n\n`;
}

function setupPeople(store, definitionsVersion, importedOn) {
  const targetTalentText = [
    '# Invented target talent',
    targetTalentRow('900001', 'one'),
    targetTalentRow('900002', 'two'),
    targetTalentRow('900003', 'three'),
    targetTalentRow('900004', 'four'),
  ].join('\n');
  importPeople(store, {
    targetTalentText,
    referralsText: '',
    pins: {},
    definitionsVersion,
    importedOn,
  });
  return targetTalentText;
}

const definitionsVersion = 'fixture-v1';
const importedOn = '2030-12-31';
const existingCorrespondence = correspondenceEntry(
  '2030-01-02 09:00',
  'Example LinkedIn connection request',
);
const ledger = [
  { date: '2030-01-02', name: 'Example Personone', source: 'ta', id: 900001 },
  { date: '2030-01-03', name: 'Example Persontwo', source: 'ta', id: 900002 },
  { date: '2030-01-03', name: 'Example Persontwo', source: 'ta', id: 900002 },
  { date: '2030-01-04', name: 'Example Noidentifier', source: 'ta' },
  { date: '2030-01-04', name: 'Example Unknownperson', source: 'ta', id: 999998 },
  { date: '2030-02-30', name: 'Example Personfour', source: 'ta', id: 900004 },
];
const sidecar = {
  900003: { state: 'Invite Pending', updated: '2030-01-04' },
  900001: { state: 'Invite Pending', updated: '2030-01-05' },
  900002: { state: 'Connected', updated: '2030-01-06' },
  999999: { state: 'Connected', updated: '2030-01-07' },
};
const connectionsDocument = {
  importedAt: '2030-01-10T12:00:00.000Z',
  source: 'upload',
  count: 5,
  connections: [
    { first: 'Example', last: 'Personone', url: 'https://www.linkedin.com/in/example-person-one', email: 'example.one@example.test', company: 'Zorblax Widgetry', position: 'Example Pulley Role', on: '05 Jan 2030' },
    { first: 'Example', last: 'Unmatched', url: 'https://www.linkedin.com/in/example-person-unmatched', email: 'example.unmatched@example.test', company: 'Quux Fabrication', position: 'Example Gear Role', on: '06 Jan 2030' },
    { first: 'Example', last: 'Badurl', url: 'not-a-linkedin-url', email: 'example.badurl@example.test', company: 'Quux Fabrication', position: 'Example Gear Role', on: '07 Jan 2030' },
    { first: 'Example', last: 'Personone', url: 'https://www.linkedin.com/in/example-person-one', email: 'example.duplicate@example.test', company: 'Zorblax Widgetry', position: 'Example Pulley Role', on: '08 Jan 2030' },
    { first: 'Example', last: 'Baddate', url: 'https://www.linkedin.com/in/example-person-baddate', email: 'example.baddate@example.test', company: 'Quux Fabrication', position: 'Example Gear Role', on: '32 Jan 2030' },
  ],
};
const files = {
  connectsText: `${JSON.stringify(ledger, null, 2)}\n`,
  sidecarText: JSON.stringify(sidecar, null, 2),
  connectionsText: JSON.stringify(connectionsDocument),
};

const sandbox = makeSandbox('linkedin-import');
console.log('linkedin-import.test.mjs');
const store = openEventStore(join(sandbox, 'linkedin.db'));
const targetTalentText = setupPeople(store, definitionsVersion, importedOn);
importCorrespondence(store, {
  targetTalentFiles: { '900001.md': existingCorrespondence },
  referralFiles: {},
  definitionsVersion,
  importedOn,
});
const report = importLinkedIn(store, { ...files, definitionsVersion, importedOn });
const comparison = compareLinkedIn(files, store);

check(comparison.match
  && Object.values(comparison.files).every(file => file.match && file.bytes_identical)
  && comparison.files['linkedin-connects.json'].original_entries === 6
  && comparison.files['tt-linkedin.json'].original_entries === 4
  && comparison.files['linkedin-connections.json'].original_entries === 5,
'all three files rebuild exactly, including sidecar key order and writer byte formats');

const expectedCounts = {
  ledger_entries: 6,
  requests_created: 4,
  requests_already_recorded: 2,
  sidecar_entries: 4,
  sidecar_by_state: { 'Invite Pending': 2, Connected: 2 },
  export_connections: 5,
  acceptances_linked_to_person: 2,
  acceptances_unlinked: 3,
  files_missing: 0,
};
check(JSON.stringify(report.counts) === JSON.stringify(expectedCounts)
  && report.accepted_after_request.people === 1
  && report.accepted_after_request.median_days === 3,
'counts, accepted people and the three-day median are exact');

const expectedFlags = [
  'request_without_id:linkedin-connects.json:3',
  'request_no_person:linkedin-connects.json:4',
  'invalid_date:linkedin-connects.json:5',
  'state_no_person:tt-linkedin.json:999999',
  'unparseable_url:linkedin-connections.json:2',
  'duplicate_connection:linkedin-connections.json:3',
  'invalid_connected_date:linkedin-connections.json:4',
  'pending_state_without_request:tt-linkedin.json:900003',
  'pending_state_but_connected:tt-linkedin.json:900001',
  'connected_state_without_export:tt-linkedin.json:900002',
].sort();
const actualFlags = report.flags.map(flag => (
  `${flag.type}:${flag.file}:${flag.index ?? flag.key}`
)).sort();
check(JSON.stringify(actualFlags) === JSON.stringify(expectedFlags), 'every flag is exact');

const linkedinFiles = new Set([
  'linkedin-connects.json',
  'tt-linkedin.json',
  'linkedin-connections.json',
]);
const linkedinEvents = readEvents(store).filter(event => linkedinFiles.has(event.payload.file));
const ledgerEvents = linkedinEvents.filter(event => event.payload.file === 'linkedin-connects.json');
const sidecarEvents = linkedinEvents.filter(event => event.payload.file === 'tt-linkedin.json');
check(ledgerEvents.filter(event => event.type === 'connection_request_sent').length === 4
  && ledgerEvents.filter(event => event.type === 'legacy_record'
    && event.payload.reason === 'request_already_recorded').length === 2
  && readEvents(store, { type: 'connection_request_sent' }).length === 5,
'correspondence and same-day ledger requests are not double counted');
check(sidecarEvents.length === 5
  && sidecarEvents.every(event => event.type === 'legacy_record')
  && linkedinEvents.filter(event => event.type === 'connection_accepted').length === 5,
'the sidecar creates no request or acceptance events');

const serializedReport = JSON.stringify(report);
check([
  'Example Personone',
  'Zorblax Widgetry',
  'Example Pulley Role',
  'example.one@example.test',
  'https://www.linkedin.com/in/example-person-one',
].every(value => !serializedReport.includes(value)),
'the report contains no fixture name, company, position, email or URL');

const eventCountBeforeRepeat = readEvents(store).length;
let repeatedRefused = false;
try {
  importLinkedIn(store, { ...files, definitionsVersion, importedOn });
} catch (error) {
  repeatedRefused = /UNIQUE|unique/i.test(String(error?.message ?? error));
}
check(repeatedRefused && readEvents(store).length === eventCountBeforeRepeat,
'a repeated import is refused by dedupe keys and writes nothing');
store.close();

const missingStore = openEventStore(join(sandbox, 'missing.db'));
const missingReport = importLinkedIn(missingStore, { definitionsVersion, importedOn });
const missingComparison = compareLinkedIn({}, missingStore);
check(missingReport.counts.files_missing === 3
  && missingReport.flags.length === 0
  && missingComparison.match
  && Object.values(missingComparison.files).every(file => file.original_entries === 0
    && file.rebuilt_entries === 0),
'missing files count, skip and compare as matching empty inputs');
missingStore.close();

const invalidStore = openEventStore(join(sandbox, 'invalid.db'));
const invalidFiles = { connectsText: '{not json', sidecarText: null, connectionsText: null };
const invalidReport = importLinkedIn(invalidStore, {
  ...invalidFiles,
  definitionsVersion,
  importedOn,
});
const invalidComparison = compareLinkedIn(invalidFiles, invalidStore);
check(invalidReport.counts.files_missing === 2
  && JSON.stringify(invalidReport.flags) === JSON.stringify([
    { type: 'unreadable_file', file: 'linkedin-connects.json' },
  ])
  && !invalidComparison.match
  && !invalidComparison.files['linkedin-connects.json'].match
  && invalidComparison.files['tt-linkedin.json'].match
  && invalidComparison.files['linkedin-connections.json'].match,
'invalid JSON is flagged and mismatches while missing files still match');
invalidStore.close();

const cliData = join(sandbox, 'fixture-input');
const cliOutput = join(sandbox, 'fixture-output');
mkdirSync(cliData);
mkdirSync(cliOutput);
mkdirSync(join(cliData, 'target-talent-correspondence'));
writeFileSync(join(cliData, 'applications.md'), [
  '# Invented Applications Tracker',
  TRACKER_HEADER,
  TRACKER_SEPARATOR,
].join('\n'), 'utf8');
writeFileSync(join(cliData, 'target-talent.md'), targetTalentText, 'utf8');
writeFileSync(join(cliData, 'target-talent-correspondence', '900001.md'), existingCorrespondence, 'utf8');
writeFileSync(join(cliData, 'linkedin-connects.json'), files.connectsText, 'utf8');
writeFileSync(join(cliData, 'tt-linkedin.json'), files.sidecarText, 'utf8');
writeFileSync(join(cliData, 'linkedin-connections.json'), files.connectionsText, 'utf8');

const cliPath = resolve(fileURLToPath(new URL('../scripts/import-dry-run.mjs', import.meta.url)));
const cliDb = join(sandbox, 'cli.db');
const cliReport = join(sandbox, 'cli-report.json');
const cliArgs = [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', cliDb,
  '--report', cliReport,
  '--definitions-version', definitionsVersion,
  '--owner-name', 'Example Owner',
];
const cli = spawnSync(process.execPath, cliArgs, { encoding: 'utf8' });
const written = existsSync(cliReport) ? JSON.parse(readFileSync(cliReport, 'utf8')) : null;
check(cli.status === 0
  && /LINKEDIN MATCH/.test(cli.stdout)
  && written?.linkedin?.comparison?.match
  && written.linkedin.counts.ledger_entries === 6,
'dry-run CLI prints LINKEDIN MATCH, records counts and exits zero');
check([
  'Example Personone',
  'Zorblax Widgetry',
  'Example Pulley Role',
  'example.one@example.test',
  'https://www.linkedin.com/in/example-person-one',
].every(value => !cli.stdout.includes(value)),
'dry-run CLI prints no fixture personal values');

const samePath = join(sandbox, 'same.db');
const same = spawnSync(process.execPath, [
  cliPath, '--data-dir', cliData, '--output-dir', cliOutput,
  '--db', samePath, '--report', samePath, '--owner-name', 'Example Owner',
], { encoding: 'utf8' });
const existing = spawnSync(process.execPath, [
  cliPath, '--data-dir', cliData, '--output-dir', cliOutput,
  '--db', cliDb, '--report', join(sandbox, 'existing-report.json'),
  '--owner-name', 'Example Owner',
], { encoding: 'utf8' });
const prohibitedDb = resolve(fileURLToPath(new URL('../data/fixture-linkedin.db', import.meta.url)));
const prohibitedReport = resolve(fileURLToPath(new URL('../data/fixture-linkedin-report.json', import.meta.url)));
const underDataDb = spawnSync(process.execPath, [
  cliPath, '--data-dir', cliData, '--output-dir', cliOutput,
  '--db', prohibitedDb, '--report', join(sandbox, 'under-data-report.json'),
  '--owner-name', 'Example Owner',
], { encoding: 'utf8' });
const underDataReport = spawnSync(process.execPath, [
  cliPath, '--data-dir', cliData, '--output-dir', cliOutput,
  '--db', join(sandbox, 'under-data.db'), '--report', prohibitedReport,
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
