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
} finally {
  store.close();
}

applyReport.counts.apply_dates_file_missing = applyDatesMissing;
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
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  tracker: {
    counts: trackerReport.counts,
    flags: flagCounts(trackerReport.flags),
  },
  apply: {
    counts: applyReport.counts,
    link_rules: applyReport.link_rules,
    evidence_used: applyReport.evidence_used,
    flags: flagCounts(applyReport.flags),
  },
}, null, 2));
console.log(trackerComparison.match ? 'TRACKER MATCH' : 'TRACKER MISMATCH');
console.log(applyComparison.match ? 'APPLY DATES MATCH' : 'APPLY DATES MISMATCH');
process.exit(trackerComparison.match && applyComparison.match ? 0 : 1);
