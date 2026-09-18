#!/usr/bin/env node

import {
  existsSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIdentity } from '../dashboard-web/server/lib/profile.mjs';
import { openEventStore } from '../lib/event-store.mjs';
import { importDataFolder } from '../lib/import/import-data-folder.mjs';
import { printImportVerification, verifyImport } from '../lib/import/verify-import.mjs';

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
const definitionsVersion = options['definitions-version'] ?? 'v1';
const importedOn = localDate();
const ownerName = options['owner-name'] ?? getIdentity().fullName;

const store = openEventStore(dbPath);
let imported;
let verification;
try {
  imported = importDataFolder(store, {
    dataDir: inputDir, outputDir, ownerName, definitionsVersion, importedOn,
  });
  verification = verifyImport(store, imported, inputDir, outputDir);
} finally {
  store.close();
}

const {
  tracker: trackerReport,
  trackerComparison,
  apply: applyReport,
  applyComparison,
  status: statusReport,
  statusComparison,
  people: peopleReport,
  peopleComparison,
  groupingComparison,
  followups: followupsReport,
  followupsComparison,
  correspondence: correspondenceReport,
  correspondenceComparison,
  linkedin: linkedinReport,
  linkedinComparison,
  twc: twcReport,
  twcComparison,
} = imported.reports;
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
  people: {
    ...peopleReport,
    comparison: peopleComparison,
    grouping_comparison: groupingComparison,
  },
  followups: {
    ...followupsReport,
    comparison: followupsComparison,
  },
  correspondence: {
    ...correspondenceReport,
    comparison: correspondenceComparison,
  },
  linkedin: {
    ...linkedinReport,
    comparison: linkedinComparison,
  },
  twc: {
    ...twcReport,
    comparison: twcComparison,
  },
  bytes: verification.bytes,
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const {
  by_us_only_pairs: _ignoredByUsPairs,
  by_them_only_pairs: _ignoredByThemPairs,
  ...groupingCounts
} = groupingComparison;

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
  people: {
    counts: peopleReport.counts,
    flags: flagCounts(peopleReport.flags),
    possible_duplicate_people: peopleReport.possible_duplicate_people.length,
    same_name_other_company: peopleReport.same_name_other_company.length,
    grouping_comparison: groupingCounts,
  },
  followups: {
    counts: followupsReport.counts,
    direct_by_channel: followupsReport.direct_by_channel,
    flags: flagCounts(followupsReport.flags),
  },
  correspondence: {
    counts: correspondenceReport.counts,
    by_channel: correspondenceReport.by_channel,
    flags: flagCounts(correspondenceReport.flags),
  },
  linkedin: {
    counts: linkedinReport.counts,
    accepted_after_request: linkedinReport.accepted_after_request,
    flags: flagCounts(linkedinReport.flags),
  },
  twc: {
    counts: twcReport.counts,
    flags: flagCounts(twcReport.flags),
  },
}, null, 2));
printImportVerification(verification);
process.exit(verification.ok ? 0 : 1);
