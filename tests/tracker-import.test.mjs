#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openEventStore } from '../lib/event-store.mjs';
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
  && /"rendered_identical":\s*\d+/.test(cli.stdout)
  && /"rendered_different":\s*\d+/.test(cli.stdout)
  && writtenReport.match, 'CLI stdout contains counts only');
check(!('original_rows' in writtenReport)
  && !('rebuilt_rows' in writtenReport)
  && !('comparison' in writtenReport), 'CLI report omits row payloads');
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
