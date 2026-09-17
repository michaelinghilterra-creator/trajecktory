#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openEventStore } from '../lib/event-store.mjs';
import { findCompany, mergeCompanies } from '../lib/identity-store.mjs';
import {
  compareTracker,
  importTracker,
  rebuildTrackerRows,
} from '../lib/import/tracker-import.mjs';
import { canonicalUrl } from '../lib/identity.mjs';
import { TRACKER_HEADER, TRACKER_SEPARATOR, parseTrackerLine } from '../lib/tracker.mjs';
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

function duplicateFixture(entries) {
  return [
    '# Invented Applications Tracker',
    TRACKER_HEADER,
    TRACKER_SEPARATOR,
    ...entries.map(({ num, company, role, url }) => row([
      num,
      '2030-03-01',
      company,
      role,
      '0.01/5',
      'Reviewed',
      'no',
      'fixture.docx',
      `[${num}](fixtures/${num}.md)`,
      'Invented fixture note',
      url ?? '',
    ])),
  ].join('\n');
}

const fixtureLines = [
  '# Invented Applications Tracker',
  TRACKER_HEADER,
  TRACKER_SEPARATOR,
  row(['900001', '2030-01-01', 'Example, Inc.', 'Example Sprocket Role', '0.12/5', 'Reviewed', 'yes', 'example-one.docx', '[900001](fixtures/900001.md)', 'First invented note', 'https://jobs.example.test/roles/900101']),
  `${row(['900002', '2030-01-02', 'Example', 'Example Sprocket Role', '0.13/5', 'Reviewed', 'yes', 'example-two.docx', '[900002](fixtures/900002.md)', 'Second invented note', 'https://jobs.example.test/roles/900101'])}\r`,
  row(['900003', '2030-01-03', 'Sample Labs', 'Example Cog Role', '0.10/5', 'Saved', 'no', 'sample.docx', '[900003](fixtures/900003.md)', 'Legacy ten cell note']),
  row(['900004', 'not-a-date', 'Other Sample', 'Example Pulley Role', '0.09/5', 'Saved', 'no', '[900004](fixtures/900004.md)', 'Legacy nine cell note']),
  row(['900005', '2030-01-05', 'Example.io', 'Example Ratchet Role', '0.11/5', 'Reviewed', 'yes', 'rocket.docx', '[900005](fixtures/900005.md)', 'Prefix candidate note', 'https://jobs.example.test/roles/900105']),
  row(['900006', '2030-01-06', 'Other Sample', 'Example Alternate Role', '0.08/5', 'Reviewed', 'yes', 'alternate.docx', '[900006](fixtures/900006.md)', 'Conflicting owner note', 'https://jobs.example.test/roles/900105']),
  row(['900006', '2030-01-07', 'Sample Labs', 'Example Gauge Role', '0.14/5', 'Reviewed', 'yes', 'gauge.docx', '[900006](fixtures/900006-b.md)', 'Duplicate number note', 'https://jobs.example.test/roles/900107']),
  row(['900008', '2030-01-08', '', 'Example Empty Company Role', '0.07/5', 'Saved', 'no', 'empty.docx', '[900008](fixtures/900008.md)', 'Empty company note', 'https://jobs.example.test/roles/900108']),
  row(['900009', '2030-01-09', 'Sample Labs', '', '0.06/5', 'Saved', 'no', 'no-role.docx', '[900009](fixtures/900009.md)', 'Empty role note', 'https://jobs.example.test/roles/900109']),
  row(['900010', '2030-01-10', 'Sample Labs', 'Example Stray Role', '0.05/5', 'Saved', 'no', 'stray.docx', '[900010](fixtures/900010.md)', 'Stray cell note', 'not-a-url']),
  row(['900011', '2030-01-11', 'Sample Labs', 'Example Extra Cell Role', '0.04/5', 'Saved', 'no', 'extra.docx', '[900011](fixtures/900011.md)', 'Extra cell note', 'https://jobs.example.test/roles/900111', 'extra']),
  row(['900012', '2030-01-12', 'Sample Labs', 'Example Placeholder Role', '0.03/5', 'Saved', 'no', 'placeholder.docx', '[900012](fixtures/900012.md)', 'Placeholder URL note', '—']),
  row(['900013', '2030-01-13', 'Sample Labs', 'Example Local Role', '0.02/5', 'Saved', 'no', 'local-one.docx', '[900013](fixtures/900013.md)', 'First local note', 'local:fixtures/900013.md']),
  row(['900014', '2030-01-14', 'Sample Labs', 'Example Local Role', '0.01/5', 'Saved', 'no', 'local-two.docx', '[900014](fixtures/900014.md)', 'Second local note', 'local:fixtures/900014.md']),
];
const fixture = fixtureLines.join('\n');
const importedOn = '2030-02-01';
const definitionsVersion = 'fixture-v1';
const sandbox = makeSandbox('tracker-import');

console.log('tracker-import.test.mjs');

const store = openEventStore(join(sandbox, 'tracker.db'));
const report = importTracker(store, fixture, { definitionsVersion, importedOn });
const comparison = compareTracker(fixture, store);
const parsedRows = fixture.split('\n')
  .map(line => parseTrackerLine(line.replace(/\r$/, '')))
  .filter(Boolean)
  .map(({ num, date, company, role, score, status, pdf, resume, report: reportCell, notes, url, urlCell, cellCount, reportPath }) => ({
    num, date, company, role, score, status, pdf, resume, report: reportCell, notes, url, urlCell, cellCount, reportPath,
  }));

check(comparison.match, 'comparison matches after import');
check(JSON.stringify(rebuildTrackerRows(store)) === JSON.stringify(parsedRows), 'rebuilt rows equal parsed rows field by field');
check(comparison.rendered_identical + comparison.rendered_different === parsedRows.length
  && comparison.rendered_different > 0
  && comparison.rendered_different_positions.length <= 20
  && comparison.rendered_different_positions.every(Number.isInteger),
  'render comparison counts every rebuilt row and reports positions only');
check(JSON.stringify(report.counts) === JSON.stringify({
  lines: 17,
  rows: 14,
  non_row_lines: 3,
  companies_created: 4,
  companies_reused: 9,
  postings_created: 10,
  postings_reused: 1,
  evaluations: 14,
}), 'all count categories are exact');

const flagsByType = Object.groupBy(report.flags, flag => flag.type);
const expectedFlagLines = {
  no_company: [10],
  no_role: [11],
  invalid_date: [6],
  no_url: [5, 6, 12, 14],
  stray_cell: [12, 13],
  url_owned_by_other_company: [8],
  duplicate_num: [9],
};
check(Object.entries(expectedFlagLines).every(([type, lines]) => (
  JSON.stringify((flagsByType[type] ?? []).map(flag => flag.line_index)) === JSON.stringify(lines)
)), 'every flag type fires only on its intended fixture rows');
const conflictingOwner = store.db.prepare(
  'SELECT id FROM postings WHERE canonical_url = ?',
).get('https://jobs.example.test/roles/900105');
check(flagsByType.url_owned_by_other_company[0].existing_posting_id === conflictingOwner.id, 'URL ownership conflict names the existing posting id');
check(report.shared_postings.length === 1
  && JSON.stringify(report.shared_postings[0].nums) === JSON.stringify([900001, 900002]), 'shared posting reports both row numbers');
check(report.company_spellings.length === 1
  && JSON.stringify(report.company_spellings[0].spellings) === JSON.stringify(['Example, Inc.', 'Example']), 'company spelling variants are reported');
check(report.merge_candidates.length === 1
  && report.merge_candidates[0].a_key === 'example'
  && report.merge_candidates[0].b_key === 'exampleio', 'strict-prefix companies are merge candidates');
check(store.db.prepare('SELECT COUNT(*) AS count FROM companies').get().count === 4, 'merge candidates remain distinct companies');

const localReferences = ['local:fixtures/900013.md', 'local:fixtures/900014.md'];
const localCanonicals = localReferences.map(canonicalUrl);
const localPostings = [15, 16].map(lineIndex => store.db.prepare(`
  SELECT posting_id
  FROM events
  WHERE type = 'posting_evaluated' AND evidence_ref = ?
`).get(`applications.md#line${lineIndex}`));
const canonicalLocalsAreDistinct = localCanonicals.every(Boolean)
  && localCanonicals[0] !== localCanonicals[1];
check(canonicalLocalsAreDistinct
  ? localPostings[0].posting_id !== localPostings[1].posting_id
  : localPostings[0].posting_id === localPostings[1].posting_id,
  'local posting identity follows canonicalUrl');
check((flagsByType.no_url ?? []).every(flag => ![15, 16].includes(flag.line_index)),
  'local references are not flagged as missing URLs');
check(!(flagsByType.stray_cell ?? []).some(flag => [14, 15, 16].includes(flag.line_index)),
  'placeholder and local references are not flagged as stray cells');

const evaluation = store.db.prepare("SELECT id FROM events WHERE type = 'posting_evaluated' ORDER BY id LIMIT 1").get();
const updateError = catches(() => store.db.prepare('UPDATE events SET payload = ? WHERE id = ?').run('{}', evaluation.id));
check(/append-only/.test(String(updateError?.message)), 'event payload cannot be changed after import');
store.close();

const differentStore = openEventStore(join(sandbox, 'same-role-different.db'));
const differentFixture = duplicateFixture([
  { num: '900001', company: 'Zorblax Widgetry', role: 'Example Pulley Role', url: 'https://jobs.example.test/roles/900001' },
  { num: '900002', company: 'Zorblax Widgetry', role: 'Example Pulley Role', url: 'https://jobs.example.test/roles/900002' },
]);
const differentReport = importTracker(differentStore, differentFixture, { definitionsVersion, importedOn });
check(differentReport.same_role_postings.length === 1
  && differentReport.same_role_postings[0].reason === 'different_urls'
  && JSON.stringify(differentReport.same_role_postings[0].nums) === JSON.stringify([900001, 900002])
  && differentReport.same_role_postings[0].posting_ids.length === 2,
'same company and role with different URLs form one posting candidate group');
check(compareTracker(differentFixture, differentStore).match,
  'duplicate candidate reporting leaves tracker comparison unchanged');
differentStore.close();

const chainStore = openEventStore(join(sandbox, 'same-role-chain.db'));
const chainFixture = duplicateFixture([
  { num: '900001', company: 'Zorblax Widgetry', role: 'Senior Example Pulley Role', url: 'https://jobs.example.test/roles/900011' },
  { num: '900002', company: 'Zorblax Widgetry', role: 'Example Pulley Role', url: 'https://jobs.example.test/roles/900012' },
  { num: '900003', company: 'Zorblax Widgetry', role: 'Junior Example Pulley Role', url: 'https://jobs.example.test/roles/900013' },
]);
const chainReport = importTracker(chainStore, chainFixture, { definitionsVersion, importedOn });
check(chainReport.same_role_postings.length === 1
  && JSON.stringify(chainReport.same_role_postings[0].nums) === JSON.stringify([900001, 900002, 900003])
  && chainReport.same_role_postings[0].posting_ids.length === 3,
'role matching builds one transitive group');
chainStore.close();

const missingUrlStore = openEventStore(join(sandbox, 'same-role-missing-url.db'));
const missingUrlFixture = duplicateFixture([
  { num: '900001', company: 'Zorblax Widgetry', role: 'Example Pulley Role', url: 'https://jobs.example.test/roles/900021' },
  { num: '900002', company: 'Zorblax Widgetry', role: 'Example Pulley Role' },
]);
const missingUrlReport = importTracker(missingUrlStore, missingUrlFixture, { definitionsVersion, importedOn });
check(missingUrlReport.same_role_postings.length === 1
  && missingUrlReport.same_role_postings[0].reason === 'missing_url',
'a same-role group with a missing URL reports the missing URL reason');
missingUrlStore.close();

const sharedStore = openEventStore(join(sandbox, 'same-role-shared.db'));
const sharedFixture = duplicateFixture([
  { num: '900001', company: 'Zorblax Widgetry', role: 'Example Pulley Role', url: 'https://jobs.example.test/roles/900031' },
  { num: '900002', company: 'Zorblax Widgetry', role: 'Example Pulley Role', url: 'https://jobs.example.test/roles/900031' },
]);
const sharedReport = importTracker(sharedStore, sharedFixture, { definitionsVersion, importedOn });
check(sharedReport.shared_postings.length === 1 && sharedReport.same_role_postings.length === 0,
  'rows sharing one posting are not repeated as same-role candidates');
sharedStore.close();

const mergedStore = openEventStore(join(sandbox, 'same-role-merged-company.db'));
const mergeSeed = duplicateFixture([
  { num: '900001', company: 'Zorblax Widgetry', role: 'Example Pulley Role', url: 'https://jobs.example.test/roles/900041' },
  { num: '900002', company: 'Quennox Ratchet Works', role: 'Example Pulley Role', url: 'https://jobs.example.test/roles/900042' },
]);
importTracker(mergedStore, mergeSeed, { definitionsVersion, importedOn, file: 'merge-seed.md' });
mergeCompanies(mergedStore, {
  fromId: findCompany(mergedStore, 'Quennox Ratchet Works'),
  intoId: findCompany(mergedStore, 'Zorblax Widgetry'),
}, {
  occurred_on: importedOn,
  source: 'cli',
  definitions_version: definitionsVersion,
  evidence_ref: 'fixture-merge',
});
const mergedFixture = duplicateFixture([
  { num: '900003', company: 'Zorblax Widgetry', role: 'Example Pulley Role', url: 'https://jobs.example.test/roles/900043' },
  { num: '900004', company: 'Quennox Ratchet Works', role: 'Example Pulley Role', url: 'https://jobs.example.test/roles/900044' },
]);
const mergedReport = importTracker(mergedStore, mergedFixture, {
  definitionsVersion,
  importedOn,
  file: 'merged-import.md',
});
check(mergedReport.same_role_postings.length === 1
  && JSON.stringify(mergedReport.same_role_postings[0].nums) === JSON.stringify([900003, 900004]),
'resolved company merges combine rows into the correct per-company group');
mergedStore.close();

const wordStore = openEventStore(join(sandbox, 'company-word.db'));
const wordFixture = duplicateFixture([
  { num: '900001', company: 'Zorblax', role: 'Example Pulley Role', url: 'https://jobs.example.test/roles/900051' },
  { num: '900002', company: 'Zorblax Widgetry', role: 'Example Cog Role', url: 'https://jobs.example.test/roles/900052' },
  { num: '900003', company: 'Zorblax Gearworks', role: 'Example Ratchet Role', url: 'https://jobs.example.test/roles/900053' },
  { num: '900004', company: 'Quennox Ratchet Works', role: 'Example Gauge Role', url: 'https://jobs.example.test/roles/900054' },
]);
const wordReport = importTracker(wordStore, wordFixture, { definitionsVersion, importedOn });
const widgetryId = findCompany(wordStore, 'Zorblax Widgetry');
const gearworksId = findCompany(wordStore, 'Zorblax Gearworks');
const wordPair = wordReport.company_word_candidates.find(candidate => (
  new Set([candidate.a_company_id, candidate.b_company_id]).has(widgetryId)
  && new Set([candidate.a_company_id, candidate.b_company_id]).has(gearworksId)
));
const mergePairs = new Set(wordReport.merge_candidates.map(candidate => (
  [candidate.a_company_id, candidate.b_company_id].sort().join(':')
)));
check(wordPair?.shared_word_length === 7
  && wordReport.company_word_candidates.every(candidate => !mergePairs.has(
    [candidate.a_company_id, candidate.b_company_id].sort().join(':'),
  )),
'company word candidates report the length and exclude merge candidates');
const newReportData = JSON.stringify({
  same_role_postings: differentReport.same_role_postings,
  company_word_candidates: wordReport.company_word_candidates,
});
check([
  'Zorblax Widgetry',
  'Zorblax Gearworks',
  'Example Pulley Role',
  'jobs.example.test',
].every(value => !newReportData.includes(value)),
'new report arrays contain no fixture company name, role or URL');
wordStore.close();

const missingStore = openEventStore(join(sandbox, 'missing.db'));
importTracker(missingStore, fixtureLines.slice(0, -1).join('\n'), { definitionsVersion, importedOn });
const missingComparison = compareTracker(fixture, missingStore);
check(!missingComparison.match
  && missingComparison.mismatches.some(item => item.field === 'count'), 'one missing evaluation produces a count mismatch');
missingStore.close();

const appsPath = join(sandbox, 'applications-fixture.md');
const cliDb = join(sandbox, 'cli.db');
const cliReport = join(sandbox, 'cli-report.json');
writeFileSync(appsPath, fixture, 'utf8');
const cliPath = resolve(fileURLToPath(new URL('../scripts/import-tracker-events.mjs', import.meta.url)));
const cli = spawnSync(process.execPath, [
  cliPath,
  '--apps', appsPath,
  '--db', cliDb,
  '--report', cliReport,
  '--definitions-version', definitionsVersion,
], { encoding: 'utf8' });
check(cli.status === 0 && /MATCH/.test(cli.stdout) && existsSync(cliReport), 'CLI writes a report and exits zero on a match');
const writtenReport = JSON.parse(readFileSync(cliReport, 'utf8'));
check(!cli.stdout.includes('Example')
  && !cli.stdout.includes('Sprocket')
  && !cli.stdout.includes('jobs.example.test')
  && /"same_role_postings":\s*\d+/.test(cli.stdout)
  && /"company_word_candidates":\s*\d+/.test(cli.stdout)
  && /"rendered_identical":\s*\d+/.test(cli.stdout)
  && /"rendered_different":\s*\d+/.test(cli.stdout)
  && writtenReport.match, 'CLI stdout contains counts only');
check(!('original_rows' in writtenReport)
  && !('rebuilt_rows' in writtenReport)
  && !('comparison' in writtenReport)
  && Array.isArray(writtenReport.same_role_postings)
  && Array.isArray(writtenReport.company_word_candidates),
'CLI report omits row payloads and includes duplicate candidate arrays');
check(writtenReport.rendered_identical === comparison.rendered_identical
  && writtenReport.rendered_different === comparison.rendered_different
  && JSON.stringify(writtenReport.rendered_different_positions) === JSON.stringify(comparison.rendered_different_positions),
  'CLI report includes render counts and differing positions');

const existing = spawnSync(process.execPath, [
  cliPath,
  '--apps', appsPath,
  '--db', cliDb,
  '--report', join(sandbox, 'existing-report.json'),
], { encoding: 'utf8' });
check(existing.status === 2 && existing.stderr.trim().split(/\r?\n/).length === 1, 'CLI refuses an existing database with one line');

const repoDataDb = resolve(fileURLToPath(new URL('../data/fixture.db', import.meta.url)));
const underData = spawnSync(process.execPath, [
  cliPath,
  '--apps', appsPath,
  '--db', repoDataDb,
  '--report', join(sandbox, 'under-data-report.json'),
], { encoding: 'utf8' });
check(underData.status === 2 && underData.stderr.trim().split(/\r?\n/).length === 1, 'CLI refuses a database path under the repository data folder');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
