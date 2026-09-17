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
import {
  compareApplyDates,
  evidenceCompanyKey,
  importApplyEvidence,
  parseEvidenceFilename,
} from '../lib/import/apply-import.mjs';
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

function catches(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

function row(cells) {
  return `| ${cells.join(' | ')} |`;
}

function fixtureRow(num, date, company, status, url, score) {
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
    url,
  ]);
}

const trackerLines = [
  '# Invented Applications Tracker',
  TRACKER_HEADER,
  TRACKER_SEPARATOR,
  fixtureRow('900001', '2030-01-01', 'Zorblax Widgetry, Inc.', 'Applied', 'https://jobs.example.test/roles/900001', '0.01'),
  fixtureRow('900002', '2030-02-01', 'Quennox Ratchet Works LLC', 'Applied', 'https://jobs.example.test/roles/900002', '0.02'),
  fixtureRow('900003', '2030-02-02', 'Veltrix Gears Corp', 'Evaluated', 'https://jobs.example.test/roles/900003', '0.03'),
  fixtureRow('900004', '2030-02-03', 'Norvane Systems', 'Evaluated', 'https://jobs.example.test/roles/900004', '0.04'),
  fixtureRow('900005', '2030-02-04', 'Suffixora Group', 'Applied', 'https://jobs.example.test/roles/900005', '0.05'),
  fixtureRow('900006', '2030-02-05', 'Ambiguo Company', 'Evaluated', 'https://jobs.example.test/roles/900006', '0.06'),
  fixtureRow('900007', '2030-02-06', 'Ambiguo Company', 'Evaluated', 'https://jobs.example.test/roles/900007', '0.07'),
  fixtureRow('900008', '2030-02-07', 'Lonesome Holdings', 'Applied', 'https://jobs.example.test/roles/900008', '0.08'),
  fixtureRow('900009', '2030-02-08', 'Voidable Software', 'Evaluated', 'https://jobs.example.test/roles/900009', '0.09'),
  fixtureRow('900011', '2030-02-09', 'Ownerly Widgetry', 'Evaluated', 'https://jobs.example.test/roles/shared', '0.10'),
  fixtureRow('900010', '2030-02-10', 'Postless Ratchets Ltd', 'Saved', 'https://jobs.example.test/roles/shared', '0.11'),
  fixtureRow('900012', '2030-02-11', 'Twinnox Works', 'Applied', 'https://jobs.example.test/roles/twin', '0.12'),
  fixtureRow('900013', '2030-02-12', 'Twinnox Works', 'Applied', 'https://jobs.example.test/roles/twin', '0.13'),
  fixtureRow('900014', '2030-02-13', 'Takenid Cogs', 'Saved', 'https://jobs.example.test/roles/900014', '0.14'),
  fixtureRow('900015', '2030-02-13', 'Duplicata Gears', 'Evaluated', 'https://jobs.example.test/roles/900015-a', '0.14'),
  fixtureRow('900015', '2030-02-14', 'Duplicata Alternate', 'Evaluated', 'https://jobs.example.test/roles/900015-b', '0.15'),
  fixtureRow('900016', '2030-02-15', 'Invalidia Springs', 'Saved', 'https://jobs.example.test/roles/900016', '0.16'),
];
const tracker = trackerLines.join('\n');
const applyDates = {
  900001: '2030-02-10',
  900005: '2030-03-01',
  900009: '2030-03-20',
  900010: '2030-03-21',
  900012: '2030-04-01',
  900013: '2030-04-10',
  900014: '2030-04-11',
  900016: '2030-02-30',
  999997: null,
  999998: 'not-a-date',
  999999: '2030-05-01',
};
const outputFiles = [
  'Example_Person_Resume_ZorblaxWidgetry_02-11-2030.docx',
  'Example_Person_Cover_ZorblaxWidgetry_02-05-2030.html',
  'Example_Person_Resume_QuennoxRatchetWorks_02-12-2030.docx',
  'Example_Person_Cover_VeltrixGears_02-13-2030.docx',
  'cover-letter-example-person-norvane-systems-2030-02-14.pdf',
  'Example_Person_Resume_Suffixora_03-10-2030_final.docx',
  'Example_Person_Resume_Ambiguo_03-15-2030.docx',
  'Example_Person_Resume_Missingworks_03-16-2030.docx',
  'cv-zorblax-2030-03-17.pdf',
  'fixture-notes.txt',
  'Example_Person_Resume_TwinnoxWorks_04-01-2030.docx',
  'Example_Person_Resume_TwinnoxWorks_04-10-2030.docx',
];
const definitionsVersion = 'fixture-v1';
const importedOn = '2030-06-01';
const sandbox = makeSandbox('apply-import');

console.log('apply-import.test.mjs');

check(evidenceCompanyKey('Zorblax Widgetry, Inc.') === 'zorblaxwidgetry'
  && evidenceCompanyKey('Zorblax-Widgetry-LLC') === 'zorblaxwidgetry'
  && evidenceCompanyKey('ExampleInc') === 'exampleinc'
  && evidenceCompanyKey('Ratchet S.A.') === 'ratchet',
'company evidence keys strip only separate corporate words');

const parsedResume = parseEvidenceFilename('Example_Person_Resume_ZorblaxWidgetry_02-11-2030_extra.docx');
const parsedLegacy = parseEvidenceFilename(
  'cover-letter-example-person-quennox-ratchet-works-2030-02-12.html',
  'Example Person',
);
const parsedLegacyFallback = parseEvidenceFilename(
  'cover-letter-example-person-quennox-ratchet-works-2030-02-12.html',
  undefined,
  new Set(['quennoxratchetworks']),
);
const parsedImpossible = parseEvidenceFilename('Example_Person_Resume_Zorblax_02-30-2030.docx');
check(JSON.stringify(parsedResume) === JSON.stringify({
  kind: 'resume', companyKey: 'zorblaxwidgetry', date: '2030-02-11',
}) && JSON.stringify(parsedLegacy) === JSON.stringify({
  kind: 'cover_legacy', companyKey: 'quennoxratchetworks', date: '2030-02-12',
}) && parsedLegacyFallback.companyKey === 'quennoxratchetworks'
  && parsedImpossible.kind === 'unrecognized',
'filename parsing removes owner prefixes, falls back to tracker suffixes and rejects impossible dates');

const store = openEventStore(join(sandbox, 'apply.db'));
importTracker(store, tracker, { definitionsVersion, importedOn });
const seededIdentity = store.db.prepare(`
  SELECT id, posting_id, payload
  FROM events
  WHERE type = 'posting_evaluated'
  ORDER BY id
`).all().find(event => JSON.parse(event.payload).num === 900011);
store.db.prepare(
  'INSERT INTO applications (id, posting_id, created_event_id) VALUES (?, ?, ?)',
).run('900014', seededIdentity.posting_id, seededIdentity.id);
const report = importApplyEvidence(store, {
  applyDates,
  outputFiles,
  definitionsVersion,
  importedOn,
  ownerName: 'Example Person',
});

check(compareApplyDates(applyDates, store).match, 'apply dates rebuild exactly after import');
check(JSON.stringify(report.counts) === JSON.stringify({
  output_files: 12,
  resume_files: 7,
  cover_files: 2,
  cover_legacy_files: 1,
  ignored_cv_files: 1,
  unrecognized_files: 1,
  files_linked: 8,
  apply_dates_entries: 11,
  applications_linked: 8,
  applications_unlinked: 6,
  applications_total: 14,
}), 'all apply import count categories are exact');
check(JSON.stringify(report.link_rules) === JSON.stringify({ a: 3, b: 3, c: 2 })
  && JSON.stringify(report.evidence_used) === JSON.stringify({ resume: 5, cover: 2, confirmation: 7 }),
'link rules and selected evidence counts are exact');

const flagsByType = Object.groupBy(report.flags, flag => flag.type);
const expectedFlagNums = {
  evidence_without_row: [null],
  ambiguous_evidence: [null],
  date_disagreement: [900005],
  applied_status_without_evidence: [900008],
  possible_void: [900009],
  no_posting: [900010],
  posting_already_applied: [900013],
  application_id_taken: [900014],
  duplicate_num: [900015],
  invalid_apply_date: [900016, '999997', '999998'],
  apply_date_without_row: ['999997', '999998', '999999'],
};
check(Object.keys(flagsByType).length === Object.keys(expectedFlagNums).length
  && Object.entries(expectedFlagNums).every(([type, nums]) => (
    JSON.stringify((flagsByType[type] ?? []).map(flag => flag.num)) === JSON.stringify(nums)
  )), 'every flag type fires exactly on its intended rows');
check(flagsByType.date_disagreement[0].days === 9
  && flagsByType.ambiguous_evidence[0].nums.join(',') === '900006,900007'
  && flagsByType.posting_already_applied[0].other_application_id === '900012',
'flag details identify the exact disagreement, ambiguity and posting conflict');

const applicationEvents = store.db.prepare(`
  SELECT application_id, occurred_on, posting_id, payload
  FROM events
  WHERE type = 'application_submitted'
  ORDER BY id
`).all().map(event => ({ ...event, payload: JSON.parse(event.payload) }));
const eventById = new Map(applicationEvents.map(event => [event.application_id, event]));
check(eventById.get('900001').occurred_on === '2030-02-11'
  && eventById.get('900003').occurred_on === '2030-02-13'
  && eventById.get('900009').occurred_on === '2030-03-20'
  && eventById.get('900016').occurred_on === importedOn
  && eventById.get('999997').occurred_on === importedOn
  && eventById.get('999998').occurred_on === importedOn,
'occurred_on prefers resume, then cover, then confirmation');
check(eventById.get('900016').payload.apply_dates_value === '2030-02-30'
  && eventById.get('999997').payload.apply_dates_value === null
  && eventById.get('999998').payload.apply_dates_value === 'not-a-date',
'invalid apply dates remain raw in payloads for exact rebuilds');
check(store.db.prepare('SELECT COUNT(*) AS count FROM applications').get().count === 9
  && eventById.get('900010').posting_id === null
  && eventById.get('900013').posting_id === null
  && eventById.get('999999').posting_id === null,
'linked applications create identity rows and unlinked applications do not');

const forbidden = [
  'Example_Person',
  'Example Person',
  'example-person',
  ...outputFiles,
  'Zorblax Widgetry',
  'Quennox Ratchet Works',
  'zorblaxwidgetry',
  'quennoxratchetworks',
];
const serializedReport = JSON.stringify(report);
const serializedPayloads = JSON.stringify(applicationEvents.map(event => event.payload));
check(forbidden.every(value => !serializedReport.includes(value))
  && forbidden.every(value => !serializedPayloads.includes(value)),
'reports and application payloads contain no prefix, filename, company name or company key');

const eventsBeforeRepeat = store.db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
const applicationsBeforeRepeat = store.db.prepare('SELECT COUNT(*) AS count FROM applications').get().count;
const repeatError = catches(() => importApplyEvidence(store, {
  applyDates,
  outputFiles,
  definitionsVersion,
  importedOn,
  ownerName: 'Example Person',
}));
check(repeatError
  && store.db.prepare('SELECT COUNT(*) AS count FROM events').get().count === eventsBeforeRepeat
  && store.db.prepare('SELECT COUNT(*) AS count FROM applications').get().count === applicationsBeforeRepeat,
'a repeated import is refused by dedupe keys without writing events or identities');
store.close();

const fallbackStore = openEventStore(join(sandbox, 'apply-fallback.db'));
importTracker(fallbackStore, tracker, { definitionsVersion, importedOn });
const fallbackReport = importApplyEvidence(fallbackStore, {
  applyDates: {},
  outputFiles: ['cover-letter-example-person-norvane-systems-2030-02-14.pdf'],
  definitionsVersion,
  importedOn,
});
const fallbackPayloads = fallbackStore.db.prepare(`
  SELECT payload FROM events WHERE type = 'application_submitted'
`).all().map(event => JSON.parse(event.payload));
check(fallbackReport.counts.files_linked === 1
  && fallbackReport.counts.applications_linked === 1
  && !JSON.stringify(fallbackReport).includes('example-person')
  && !JSON.stringify(fallbackPayloads).includes('example-person'),
'legacy cover suffix fallback links without exposing owner tokens');
fallbackStore.close();

const cliData = join(sandbox, 'fixture-input');
const cliOutput = join(sandbox, 'fixture-output');
mkdirSync(cliData);
mkdirSync(cliOutput);
writeFileSync(join(cliData, 'applications.md'), tracker, 'utf8');
writeFileSync(join(cliData, 'apply-dates.json'), `${JSON.stringify(applyDates)}\n`, 'utf8');
for (const name of outputFiles) writeFileSync(join(cliOutput, name), '', 'utf8');

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
check(cli.status === 0
  && /TRACKER MATCH/.test(cli.stdout)
  && /APPLY DATES MATCH/.test(cli.stdout)
  && existsSync(cliReport),
'CLI writes a report and exits zero when both comparisons match');
const writtenReport = JSON.parse(readFileSync(cliReport, 'utf8'));
check(!('original_rows' in writtenReport.tracker)
  && !('rebuilt_rows' in writtenReport.tracker)
  && writtenReport.tracker.match
  && writtenReport.apply_dates_match.match,
'CLI report omits tracker row data and includes both comparisons');
check(!cli.stdout.includes('Zorblax')
  && !cli.stdout.includes('Example_Person')
  && !cli.stdout.includes('Example Person')
  && !cli.stdout.includes('example-person')
  && !cli.stdout.includes('2030-')
  && !cli.stdout.includes('900001'),
'CLI stdout contains counts only');

const samePath = join(sandbox, 'same-output.db');
const identicalPaths = spawnSync(process.execPath, [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', samePath,
  '--report', samePath,
  '--owner-name', 'Example Person',
], { encoding: 'utf8' });
check(identicalPaths.status === 2
  && identicalPaths.stderr.trim().split(/\r?\n/).length === 1
  && !existsSync(samePath),
'CLI refuses identical resolved database and report paths before writing');

const existing = spawnSync(process.execPath, [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', cliDb,
  '--report', join(sandbox, 'existing-report.json'),
], { encoding: 'utf8' });
check(existing.status === 2 && existing.stderr.trim().split(/\r?\n/).length === 1,
'CLI refuses an existing database');

const repoDataDb = resolve(fileURLToPath(new URL('../data/fixture-apply.db', import.meta.url)));
const underDataDb = spawnSync(process.execPath, [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', repoDataDb,
  '--report', join(sandbox, 'under-data-db-report.json'),
], { encoding: 'utf8' });
const repoDataReport = resolve(fileURLToPath(new URL('../data/fixture-apply-report.json', import.meta.url)));
const underDataReport = spawnSync(process.execPath, [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', join(sandbox, 'under-data-report.db'),
  '--report', repoDataReport,
], { encoding: 'utf8' });
check(underDataDb.status === 2 && underDataReport.status === 2
  && underDataDb.stderr.trim().split(/\r?\n/).length === 1
  && underDataReport.stderr.trim().split(/\r?\n/).length === 1,
'CLI refuses database and report paths under the repository data folder');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
