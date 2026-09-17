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
  compareCorrespondence,
  importCorrespondence,
  rebuildCorrespondenceFiles,
} from '../lib/import/correspondence-import.mjs';
import { importFollowups } from '../lib/import/followups-import.mjs';
import { importPeople } from '../lib/import/people-import.mjs';
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

function trackerRow(num) {
  return tableRow([
    num,
    '2030-01-01',
    'Zorblax Widgetry',
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

function targetTalentRow(id, company, last, first) {
  return `| ${id} | ${company} | ${last} | ${first} |  | Example Title |  |  |  |  | example.person@example.test | https://www.linkedin.com/in/example-person-${id} | Not Contacted |  | Invented contact note |  |`;
}

function correspondenceEntry(timestamp, direction, subject, body, channel = '') {
  const channelPart = channel ? `${channel} | ` : '';
  return `## ${timestamp} | ${direction} | ${channelPart}${subject}\r\n\r\n${body}\r\n\r\n`;
}

function copyRow(n, app, date, subject, contact = 'Example Personone', company = 'Zorblax Widgetry') {
  return tableRow([
    n,
    app,
    date,
    'Zorblax Widgetry',
    'Example Pulley Role',
    'Email',
    contact,
    `Cross-logged from Talent Acquisition · ${company} · Subject: ${subject}`,
  ]);
}

const definitionsVersion = 'fixture-v1';
const importedOn = '2030-12-31';
const trackerText = [
  '# Invented Applications Tracker',
  TRACKER_HEADER,
  TRACKER_SEPARATOR,
  trackerRow('900001'),
  trackerRow('900002'),
].join('\n');
const targetTalentText = [
  '# Invented target talent',
  targetTalentRow(900001, 'Zorblax Widgetry', 'Personone', 'Example'),
].join('\n');

const followupsText = [
  '# Invented Follow-Ups',
  '| # | app# | date | company | role | channel | contact | notes |',
  '|---|------|------|---------|------|---------|---------|-------|',
  copyRow('1', '900002', '2030-01-02', 'Example pulley follow-up'),
  copyRow('2', '900001', '2030-01-02', 'Example pulley follow-up'),
  copyRow('3', '900001', '2030-01-03', 'Example LinkedIn note'),
  copyRow('4', '900001', '2030-01-04', 'Example missing source'),
  copyRow('5', '900001', '2030-01-05', 'Example twin signal'),
].join('\n');

const targetTalentCorrespondence = [
  'Invented text before the first heading.\r\n',
  correspondenceEntry('2030-01-02', 'Sent', 'Example pulley follow-up', 'Invented filler alpha.'),
  correspondenceEntry('2030-01-03 09:10', 'Sent', 'Example LinkedIn note', 'Invented filler beta.', 'LinkedIn'),
  correspondenceEntry('2030-01-03 10:10', 'Received', 'Example email reply', 'Invented filler gamma.'),
  correspondenceEntry('2030-01-03 11:10', 'Received', 'Example LinkedIn reply', 'Invented filler delta.', 'LinkedIn'),
  correspondenceEntry('2030-01-03 12:10', 'Draft', 'Example unsent draft', 'Invented filler epsilon.'),
  correspondenceEntry('2030-01-06 08:00', 'Sent', 'Example LinkedIn connection request', 'Invented filler zeta.'),
  correspondenceEntry('2030-01-06 08:30', 'Sent', 'Example second invite sent', 'Invented filler eta.', 'LinkedIn'),
  correspondenceEntry('2030-01-07 09:00', 'Sent', 'RE: Example LinkedIn connection request', 'Invented filler theta.'),
  correspondenceEntry('2030-01-05 10:00', 'Sent', 'Example twin signal', 'Invented filler iota.'),
  correspondenceEntry('2030-01-05 11:00', 'Sent', 'Example twin signal', 'Invented filler kappa.'),
  correspondenceEntry('2030-02-30 12:00', 'Sent', 'Example invalid date note', 'Invented filler lambda.'),
  '## Example malformed heading\r\n\r\nInvented unparsed filler.\r\n',
].join('');
const referralCorrespondence = '## 2030-01-08 13:00 | Sent | LinkedIn | Example referral note\n\nInvented referral filler.\n';
const files = {
  targetTalentFiles: { '900001.md': targetTalentCorrespondence },
  referralFiles: { '900002.md': referralCorrespondence },
};

const sandbox = makeSandbox('correspondence-import');
console.log('correspondence-import.test.mjs');

const store = openEventStore(join(sandbox, 'correspondence.db'));
importTracker(store, trackerText, { definitionsVersion, importedOn });
importPeople(store, {
  targetTalentText,
  referralsText: '',
  pins: {},
  definitionsVersion,
  importedOn,
});
importFollowups(store, followupsText, { definitionsVersion, importedOn });
const report = importCorrespondence(store, { ...files, definitionsVersion, importedOn });
const comparison = compareCorrespondence(files, store);

check(comparison.match
  && comparison.files === 2
  && comparison.rebuilt_files === 2
  && comparison.mismatched_files_count === 0
  && comparison.target_talent.match
  && comparison.referral.match
  && rebuildCorrespondenceFiles(store, 'target-talent-correspondence')['900001.md']
    === targetTalentCorrespondence
  && rebuildCorrespondenceFiles(store, 'referral-correspondence')['900002.md']
    === referralCorrespondence,
'every correspondence file rebuilds byte for byte, including CRLF and preamble text');

const expectedCounts = {
  target_talent_files: 1,
  referral_files: 1,
  segments: 15,
  entries: 12,
  messages_sent: 7,
  connection_requests: 1,
  messages_received: 2,
  drafts: 1,
  legacy_records: 5,
  copies_linked: 3,
  copies_without_source: 1,
};
const expectedByChannel = {
  messages_sent: { email: 5, linkedin_message: 2 },
  connection_requests: { linkedin_request: 1 },
  messages_received: { email: 1, linkedin_message: 1 },
};
check(JSON.stringify(report.counts) === JSON.stringify(expectedCounts)
  && JSON.stringify(report.by_channel) === JSON.stringify(expectedByChannel),
'classification counts and channel counts are exact');

const expectedFlags = {
  unparsed_heading: ['target-talent-correspondence/900001.md#12'],
  no_person: ['referral-correspondence/900002.md#0'],
  copy_without_source: ['6'],
  copy_matches_several_entries: ['7'],
  no_time: ['target-talent-correspondence/900001.md#1'],
  request_logged_on_email_channel: ['target-talent-correspondence/900001.md#6'],
  duplicate_request_same_day: ['target-talent-correspondence/900001.md#7'],
  invalid_date: ['target-talent-correspondence/900001.md#11'],
};
const actualFlags = Object.fromEntries(Object.entries(Object.groupBy(report.flags, flag => flag.type))
  .map(([type, items]) => [type, items.map(item => (
    item.line_index === undefined
      ? `${item.dir}/${item.file}#${item.segment_index}`
      : String(item.line_index)
  ))]));
check(Object.keys(actualFlags).length === Object.keys(expectedFlags).length
  && Object.entries(expectedFlags).every(([type, values]) => (
    JSON.stringify(actualFlags[type]) === JSON.stringify(values)
  )), 'every flag is exact');

const events = readEvents(store).filter(event => event.payload.dir);
const bySegment = new Map(events.map(event => [
  `${event.payload.dir}/${event.payload.file}#${event.payload.segment_index}`,
  event,
]));
const request = bySegment.get('target-talent-correspondence/900001.md#6');
const duplicateRequest = bySegment.get('target-talent-correspondence/900001.md#7');
const replyEmail = bySegment.get('target-talent-correspondence/900001.md#3');
const replyLinkedIn = bySegment.get('target-talent-correspondence/900001.md#4');
const replySubject = bySegment.get('target-talent-correspondence/900001.md#8');
check(request?.type === 'connection_request_sent'
  && request.channel === 'linkedin_request'
  && request.dedupe_key === `li_request:${request.person_id}:2030-01-06`
  && duplicateRequest?.type === 'legacy_record'
  && duplicateRequest.payload.reason === 'duplicate_request_same_day'
  && duplicateRequest.dedupe_key === 'import:target-talent-correspondence/900001.md:segment:7'
  && replySubject?.type === 'message_sent'
  && replySubject.channel === 'email',
'connection request dedupe behavior and the RE subject exception are exact');
check(replyEmail?.type === 'message_received'
  && replyEmail.channel === 'email'
  && replyEmail.payload.reply_type === 'unclassified'
  && replyLinkedIn?.type === 'message_received'
  && replyLinkedIn.channel === 'linkedin_message'
  && replyLinkedIn.payload.reply_type === 'unclassified',
'received entries stay unclassified on their source channels');

const multiLinked = bySegment.get('target-talent-correspondence/900001.md#1');
const singleLinked = bySegment.get('target-talent-correspondence/900001.md#2');
check(JSON.stringify(multiLinked?.payload.application_ids) === JSON.stringify(['900001', '900002'])
  && multiLinked.application_id === null
  && JSON.stringify(singleLinked?.payload.application_ids) === JSON.stringify(['900001'])
  && singleLinked.application_id === '900001',
'linked copies add sorted application ids and the single application shortcut');

const serializedReport = JSON.stringify(report);
check([
  'Example pulley follow-up',
  'Invented filler alpha',
  'Example Personone',
  'Zorblax Widgetry',
].every(value => !serializedReport.includes(value)),
'the report contains no subject, body, name or company text');

const eventCountBeforeRepeat = readEvents(store).length;
let repeatedRefused = false;
try {
  importCorrespondence(store, { ...files, definitionsVersion, importedOn });
} catch (error) {
  repeatedRefused = /UNIQUE|unique/i.test(String(error?.message ?? error));
}
check(repeatedRefused && readEvents(store).length === eventCountBeforeRepeat,
'a repeated import is refused by dedupe keys and writes nothing');
store.close();

const cliData = join(sandbox, 'fixture-input');
const cliOutput = join(sandbox, 'fixture-output');
mkdirSync(cliData);
mkdirSync(cliOutput);
mkdirSync(join(cliData, 'target-talent-correspondence'));
mkdirSync(join(cliData, 'referral-correspondence'));
writeFileSync(join(cliData, 'applications.md'), trackerText, 'utf8');
writeFileSync(join(cliData, 'target-talent.md'), targetTalentText, 'utf8');
writeFileSync(join(cliData, 'follow-ups.md'), followupsText, 'utf8');
writeFileSync(
  join(cliData, 'target-talent-correspondence', '900001.md'),
  targetTalentCorrespondence,
  'utf8',
);
writeFileSync(
  join(cliData, 'referral-correspondence', '900002.md'),
  referralCorrespondence,
  'utf8',
);
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
  && /CORRESPONDENCE MATCH/.test(cli.stdout)
  && written?.correspondence?.comparison?.match
  && written.correspondence.counts.target_talent_dir_missing === false
  && written.correspondence.counts.referral_dir_missing === false,
'dry-run CLI prints CORRESPONDENCE MATCH, records directory counts and exits zero');
check([
  'Example pulley follow-up',
  'Invented filler alpha',
  'Example Personone',
  'Zorblax Widgetry',
].every(value => !cli.stdout.includes(value)),
'dry-run CLI prints no fixture text');

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
const prohibitedDb = resolve(fileURLToPath(new URL('../data/fixture-correspondence.db', import.meta.url)));
const prohibitedReport = resolve(fileURLToPath(
  new URL('../data/fixture-correspondence-report.json', import.meta.url),
));
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
