#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIdentity } from '../dashboard-web/server/lib/profile.mjs';
import { openEventStore } from '../lib/event-store.mjs';
import {
  compareApplyDates,
  importApplyEvidence,
} from '../lib/import/apply-import.mjs';
import {
  compareStatusHistory,
  importStatusHistory,
} from '../lib/import/status-import.mjs';
import { compareTracker, importTracker } from '../lib/import/tracker-import.mjs';

function refuse(message) {
  console.error(message);
  process.exit(2);
}

function argumentsFrom(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      refuse('usage: --data-dir, --output-dir, --db and --report are required');
    }
    options[key.slice(2)] = value;
  }
  return options;
}

function isInside(candidate, parent) {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function localDate() {
  const now = new Date();
  const part = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())}`;
}

function flagCounts(flags) {
  const counts = {};
  for (const flag of flags) counts[flag.type] = (counts[flag.type] ?? 0) + 1;
  return counts;
}

const options = argumentsFrom(process.argv.slice(2));
if (!options['data-dir'] || !options['output-dir'] || !options.db || !options.report) {
  refuse('usage: --data-dir, --output-dir, --db and --report are required');
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryDataDir = resolve(root, 'data');
const dbPath = resolve(options.db);
const reportPath = resolve(options.report);
const pathsMatch = process.platform === 'win32'
  ? dbPath.toLowerCase() === reportPath.toLowerCase()
  : dbPath === reportPath;
if (pathsMatch) refuse('--db and --report must resolve to different paths');
if (isInside(dbPath, repositoryDataDir)) refuse('--db must not be inside the repository data folder');
if (isInside(reportPath, repositoryDataDir)) refuse('--report must not be inside the repository data folder');
if (existsSync(dbPath)) refuse('--db must not already exist');

const inputDir = resolve(options['data-dir']);
const outputDir = resolve(options['output-dir']);
const trackerText = readFileSync(resolve(inputDir, 'applications.md'), 'utf8');
const applyDatesPath = resolve(inputDir, 'apply-dates.json');
const applyDatesMissing = !existsSync(applyDatesPath);
const applyDates = applyDatesMissing ? {} : JSON.parse(readFileSync(applyDatesPath, 'utf8'));
const statusEventsPath = resolve(inputDir, 'status-events.tsv');
const statusEventsMissing = !existsSync(statusEventsPath);
const statusText = statusEventsMissing ? '' : readFileSync(statusEventsPath, 'utf8');
const outputFiles = readdirSync(outputDir, { withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => entry.name);
const definitionsVersion = options['definitions-version'] ?? 'v1';
const importedOn = localDate();
const ownerName = options['owner-name'] ?? getIdentity().fullName;

const store = openEventStore(dbPath);
let trackerReport;
let trackerComparison;
let applyReport;
let applyComparison;
let statusReport;
let statusComparison;
try {
  trackerReport = importTracker(store, trackerText, { definitionsVersion, importedOn });
  trackerComparison = compareTracker(trackerText, store);
  applyReport = importApplyEvidence(store, {
    applyDates,
    outputFiles,
    definitionsVersion,
    importedOn,
    ownerName,
  });
  applyComparison = compareApplyDates(applyDates, store);
  statusReport = importStatusHistory(store, statusText, { definitionsVersion, importedOn });
  statusComparison = compareStatusHistory(statusText, store);
} finally {
  store.close();
}

applyReport.counts.apply_dates_file_missing = applyDatesMissing;
statusReport.counts.status_events_file_missing = statusEventsMissing;
const report = {
  tracker: {
    ...trackerReport,
    match: trackerComparison.match,
    mismatches: trackerComparison.mismatches,
    rendered_identical: trackerComparison.rendered_identical,
    rendered_different: trackerComparison.rendered_different,
    rendered_different_positions: trackerComparison.rendered_different_positions,
  },
  apply: applyReport,
  apply_dates_match: applyComparison,
  status: {
    ...statusReport,
    comparison: statusComparison,
  },
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  tracker: {
    counts: trackerReport.counts,
    flags: flagCounts(trackerReport.flags),
    shared_postings: trackerReport.shared_postings.length,
    company_spellings: trackerReport.company_spellings.length,
    merge_candidates: trackerReport.merge_candidates.length,
    same_role_postings: trackerReport.same_role_postings.length,
    company_word_candidates: trackerReport.company_word_candidates.length,
  },
  apply: {
    counts: applyReport.counts,
    link_rules: applyReport.link_rules,
    evidence_used: applyReport.evidence_used,
    flags: flagCounts(applyReport.flags),
  },
  status: {
    counts: statusReport.counts,
    status_counts: statusReport.status_counts,
    flags: flagCounts(statusReport.flags),
  },
}, null, 2));
console.log(trackerComparison.match ? 'TRACKER MATCH' : 'TRACKER MISMATCH');
console.log(applyComparison.match ? 'APPLY DATES MATCH' : 'APPLY DATES MISMATCH');
console.log(statusComparison.match ? 'STATUS HISTORY MATCH' : 'STATUS HISTORY MISMATCH');
process.exit(trackerComparison.match && applyComparison.match && statusComparison.match ? 0 : 1);
