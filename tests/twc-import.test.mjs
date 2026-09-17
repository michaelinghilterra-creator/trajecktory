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
import { importApplyEvidence } from '../lib/import/apply-import.mjs';
import { importStatusHistory } from '../lib/import/status-import.mjs';
import { importTracker } from '../lib/import/tracker-import.mjs';
import { compareTwc, importTwc } from '../lib/import/twc-import.mjs';
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

function trackerRow(num, date, company, status) {
  return `| ${[
    num,
    date,
    company,
    'Example Pulley Role',
    '0.01/5',
    status,
    'no',
    'fixture.docx',
    `[${num}](fixtures/${num}.md)`,
    'Invented fixture note',
    `https://jobs.example.test/roles/${num}`,
  ].join(' | ')} |`;
}

const trackerText = [
  '# Invented Applications Tracker',
  TRACKER_HEADER,
  TRACKER_SEPARATOR,
  trackerRow('900001', '2030-01-01', 'Zorblax Widgetry, Inc.', 'Applied'),
  trackerRow('900002', '2030-01-02', 'Quennox Ratchet Works LLC', 'Applied'),
].join('\n');
const applyDates = {
  900001: '2030-01-05',
  900002: '2030-01-06',
};
const statusText = [
  'app#\tdate\tstatus\tcompany\tlogged',
  '900001\t2030-01-10\tPhone Screen\tZorblax Widgetry\t2030-01-10',
  '900002\t2030-01-11\tApplied\tQuennox Ratchet Works\t2030-01-11',
].join('\n');
const definitionsVersion = 'fixture-v1';
const importedOn = '2030-12-31';

const eventEntries = [
  {
    id: 'example-event-one', date: '2030-02-01', type: 'Networking event or job club',
    organizer: 'Example Job Club', contact: 'Example Personone', method: 'Online',
    notes: 'Invented filler one', createdAt: '2030-02-01T12:00:00.000Z',
  },
  {
    id: 'example-event-two', date: '2030-02-02', type: 'Job fair',
    organizer: 'Example Job Fair', contact: 'Example Persontwo', method: 'In person',
    notes: 'Invented filler two', createdAt: '2030-02-02T12:00:00.000Z',
  },
  {
    id: 'example-event-one', date: '2030-02-03', type: 'Mystery gathering',
    organizer: 'Example Mystery Group', contact: '', method: 'Carrier pigeon',
    notes: 'Invented filler three', createdAt: '2030-02-03T12:00:00.000Z',
  },
  {
    id: 'example-event-four', date: '2030-02-01', type: 'Networking event or job club',
    organizer: 'Example Job Club', contact: 'Example Personthree', method: 'Online',
    notes: 'Invented duplicate filler', createdAt: '2030-02-04T12:00:00.000Z',
  },
  {
    id: 'example-event-five', date: '2030-02-30', type: 'WorkInTexas.com activity',
    organizer: 'Example Workforce Office', contact: '', method: 'Online',
    notes: 'Invented invalid date filler', createdAt: '2030-02-05T12:00:00.000Z',
  },
];

const overrides = {
  applications: {
    900001: { include: false, note: 'Invented excluded application filler' },
    999999: { include: true, note: 'Invented missing tracker filler' },
  },
  interviews: [
    { appId: '900001', stage: ' Phone Screen ', date: '2030-01-10', note: 'Invented match filler' },
    { appId: '900001', stage: 'Example Stage Round', date: '2030-01-12', note: 'Invented missing status filler' },
    { appId: '999999', stage: 'Panel', date: '2030-01-13', note: 'Invented missing app filler' },
    { appId: 'not-digits', stage: '', date: '2030-02-30', note: 'Invented invalid interview filler' },
  ],
  exclude: [
    {
      date: '2030-01-05', kind: 'application', contact: '', company: 'Zorblax Widgetry',
      note: 'Invented valid exclusion filler',
    },
    {
      date: '2030-01-06', kind: 'event', contact: '', company: '',
      note: 'Invented invalid exclusion filler',
    },
  ],
  add: [
    {
      date: '2030-01-05', kind: 'application', activity: 'Example online method',
      company: 'Zorblax Widgetry', role: 'Example Pulley Role', contact: 'Example Personone',
      method: 'Online', result: 'Submitted job application', note: 'Invented matching add filler',
    },
    {
      date: '2030-03-01', kind: 'application', activity: 'Example online method',
      company: 'Norvane Example Works', role: 'Example Ratchet Role', contact: 'Example Persontwo',
      method: 'Online', result: 'Submitted job application', note: 'Invented nonmatching add filler',
    },
    {
      date: '2030-03-02', kind: 'event', activity: '', company: 'Example Workshop',
      role: '', contact: 'Example Personthree', method: 'Online', result: 'Other',
      note: 'Invented invalid add filler',
    },
  ],
};
const files = {
  eventsText: `${JSON.stringify(eventEntries, null, 2)}\n`,
  overridesText: `${JSON.stringify(overrides, null, 2)}\n`,
};

function buildPrerequisites(store) {
  importTracker(store, trackerText, { definitionsVersion, importedOn });
  importApplyEvidence(store, {
    applyDates,
    outputFiles: [],
    definitionsVersion,
    importedOn,
    ownerName: 'Example Owner',
  });
  importStatusHistory(store, statusText, { definitionsVersion, importedOn });
}

const sandbox = makeSandbox('twc-import');
console.log('twc-import.test.mjs');
const store = openEventStore(join(sandbox, 'twc.db'));
buildPrerequisites(store);
const actionTypes = [
  'application_submitted',
  'status_changed',
  'connection_request_sent',
  'connection_accepted',
  'message_sent',
  'message_received',
];
const beforeActions = Object.fromEntries(actionTypes.map(type => [type, readEvents(store, { type }).length]));
const report = importTwc(store, { ...files, definitionsVersion, importedOn });
const comparison = compareTwc(files, store);

check(comparison.match
  && Object.values(comparison.files).every(file => file.match && file.bytes_identical)
  && comparison.files['twc-events.json'].original_entries === 5
  && comparison.files['twc-overrides.json'].original_entries === 11,
'both files rebuild exactly with key order and writer byte format');

const expectedCounts = {
  events: 5,
  events_by_type: {
    'Networking event or job club': 2,
    'Job fair': 1,
    'Mystery gathering': 1,
    'WorkInTexas.com activity': 1,
  },
  overrides_by_section: { applications: 2, interviews: 4, exclude: 2, add: 3 },
  add_by_kind: { application: 2, event: 1 },
  add_by_result: { 'Submitted job application': 2, Other: 1 },
  exclude_by_kind: { application: 1, event: 1 },
  interview_by_stage: { 'Phone Screen': 1, 'Example Stage Round': 1, Panel: 1, '': 1 },
  applications_include_counts: { false: 1, true: 1 },
  files_missing: 0,
};
check(JSON.stringify(report.counts) === JSON.stringify(expectedCounts), 'all event and override counts are exact');

const expectedFlags = [
  'unknown_event_type:events:2',
  'unknown_method:events:2',
  'duplicate_event_id:events:2',
  'duplicate_event:events:3',
  'invalid_date:events:4',
  'excluded_app_has_application:applications:900001',
  'override_app_without_tracker_row:applications:999999',
  'interview_override_without_status_event:interviews:1',
  'override_app_without_tracker_row:interviews:2',
  'interview_override_without_status_event:interviews:2',
  'invalid_date:interviews:3',
  'invalid_interview_override:interviews:3',
  'override_app_without_tracker_row:interviews:3',
  'invalid_exclude_override:exclude:1',
  'add_application_matches_existing:add:0',
  'invalid_add_override:add:2',
].sort();
const actualFlags = report.flags.map(flag => (
  `${flag.type}:${flag.section ?? flag.file}:${flag.index ?? flag.key ?? ''}`
)).sort();
check(JSON.stringify(actualFlags) === JSON.stringify(expectedFlags), 'every validation and cross-check flag is exact');

const afterActions = Object.fromEntries(actionTypes.map(type => [type, readEvents(store, { type }).length]));
const twcEvents = readEvents(store).filter(event => (
  event.payload.file === 'twc-events.json' || event.payload.file === 'twc-overrides.json'
));
check(JSON.stringify(beforeActions) === JSON.stringify(afterActions)
  && twcEvents.filter(event => event.type === 'work_search_event_logged').length === 5
  && twcEvents.filter(event => event.type === 'legacy_record').length === 13,
'overrides remain legacy records and create no applications, statuses, touches or acceptances');

const serializedReport = JSON.stringify(report);
check([
  'Example Job Club',
  'Zorblax Widgetry',
  'Example Pulley Role',
  'Example Personone',
  'Example online method',
  'Invented matching add filler',
].every(value => !serializedReport.includes(value)),
'the report contains no fixture organizer, company, role, contact, activity or note text');

const eventCountBeforeRepeat = readEvents(store).length;
let repeatedRefused = false;
try {
  importTwc(store, { ...files, definitionsVersion, importedOn });
} catch (error) {
  repeatedRefused = /UNIQUE|unique/i.test(String(error?.message ?? error));
}
check(repeatedRefused && readEvents(store).length === eventCountBeforeRepeat,
'a repeated import is refused by dedupe keys and writes nothing');
store.close();

const missingStore = openEventStore(join(sandbox, 'missing.db'));
const emptyOverridesText = `${JSON.stringify({ applications: {}, interviews: [], exclude: [], add: [] }, null, 2)}\n`;
const missingReport = importTwc(missingStore, {
  eventsText: null,
  overridesText: emptyOverridesText,
  definitionsVersion,
  importedOn,
});
const missingComparison = compareTwc({ eventsText: null, overridesText: emptyOverridesText }, missingStore);
check(missingReport.counts.files_missing === 1
  && missingReport.counts.events === 0
  && missingReport.flags.length === 0
  && missingComparison.match
  && missingComparison.files['twc-events.json'].original_entries === 0
  && missingComparison.files['twc-events.json'].rebuilt_entries === 0,
'a missing events file counts, skips and compares as an empty matching input');
missingStore.close();

const invalidStore = openEventStore(join(sandbox, 'invalid.db'));
const invalidFiles = { eventsText: null, overridesText: '{not json' };
const invalidReport = importTwc(invalidStore, { ...invalidFiles, definitionsVersion, importedOn });
const invalidComparison = compareTwc(invalidFiles, invalidStore);
check(invalidReport.counts.files_missing === 1
  && JSON.stringify(invalidReport.flags) === JSON.stringify([
    { type: 'unreadable_file', file: 'twc-overrides.json' },
  ])
  && !invalidComparison.match
  && invalidComparison.files['twc-events.json'].match
  && !invalidComparison.files['twc-overrides.json'].match,
'invalid override JSON is flagged and mismatches while a missing events file matches');
invalidStore.close();

const cliData = join(sandbox, 'fixture-input');
const cliOutput = join(sandbox, 'fixture-output');
mkdirSync(cliData);
mkdirSync(cliOutput);
writeFileSync(join(cliData, 'applications.md'), trackerText, 'utf8');
writeFileSync(join(cliData, 'apply-dates.json'), `${JSON.stringify(applyDates, null, 2)}\n`, 'utf8');
writeFileSync(join(cliData, 'status-events.tsv'), statusText, 'utf8');
writeFileSync(join(cliData, 'twc-events.json'), files.eventsText, 'utf8');
writeFileSync(join(cliData, 'twc-overrides.json'), files.overridesText, 'utf8');

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
  && /TWC MATCH/.test(cli.stdout)
  && written?.twc?.comparison?.match
  && written.twc.counts.events === 5,
'dry-run CLI prints TWC MATCH, records counts and exits zero');
check([
  'Example Job Club',
  'Zorblax Widgetry',
  'Example Pulley Role',
  'Example Personone',
  'Example online method',
  'Invented matching add filler',
].every(value => !cli.stdout.includes(value)),
'dry-run CLI prints no fixture text');

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
const prohibitedDb = resolve(fileURLToPath(new URL('../data/fixture-twc.db', import.meta.url)));
const prohibitedReport = resolve(fileURLToPath(new URL('../data/fixture-twc-report.json', import.meta.url)));
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
