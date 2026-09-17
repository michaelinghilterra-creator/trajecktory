#!/usr/bin/env node

import {
  existsSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIdentity } from '../dashboard-web/server/lib/profile.mjs';
import { openEventStore } from '../lib/event-store.mjs';
import {
  LEGACY_JSON_FILES,
  LEGACY_TABLE_FILES,
  listLegacyFiles,
  renderLegacyFile,
  splitLegacyLines,
} from '../lib/legacy-files.mjs';
import { importDataFolder } from '../lib/import/import-data-folder.mjs';

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

function byteComparison(original, rendered) {
  const originalLines = original === null ? [] : splitLegacyLines(original);
  const renderedLines = rendered === null ? [] : splitLegacyLines(rendered);
  const length = Math.max(originalLines.length, renderedLines.length);
  let firstDifferingLine = null;
  let lineEndingsDiffer = false;
  for (let index = 0; index < length; index++) {
    const left = originalLines[index];
    const right = renderedLines[index];
    if (left?.eol !== right?.eol) lineEndingsDiffer = true;
    if (firstDifferingLine === null
      && (!left || !right || left.text !== right.text || left.eol !== right.eol)) {
      firstDifferingLine = index + 1;
    }
  }
  return {
    match: original === rendered,
    original_lines: originalLines.length,
    rendered_lines: renderedLines.length,
    first_differing_line: firstDifferingLine,
    line_endings_differ: lineEndingsDiffer,
  };
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
let bytesReport;
try {
  imported = importDataFolder(store, {
    dataDir: inputDir, outputDir, ownerName, definitionsVersion, importedOn,
  });
  const tables = Object.fromEntries(LEGACY_TABLE_FILES.map(file => [
    file,
    byteComparison(imported.texts[file], renderLegacyFile(store, file)),
  ]));
  const json = Object.fromEntries(LEGACY_JSON_FILES.map(file => {
    const original = imported.texts[file];
    const rendered = renderLegacyFile(store, file);
    return [file, {
      match: original === rendered,
      absent: original === null,
      original_bytes: original === null ? 0 : Buffer.byteLength(original, 'utf8'),
      rendered_bytes: rendered === null ? 0 : Buffer.byteLength(rendered, 'utf8'),
    }];
  }));
  const correspondence = {};
  for (const [dir, input] of Object.entries(imported.reports.correspondenceInputs)) {
    const known = new Set([
      ...Object.keys(input).map(file => `${dir}/${file}`),
      ...listLegacyFiles(store).filter(file => file.startsWith(`${dir}/`)),
    ]);
    const comparisons = [...known].sort().map(file => byteComparison(
      input[file.slice(dir.length + 1)] ?? null,
      renderLegacyFile(store, file),
    ));
    correspondence[dir] = {
      files: known.size,
      differing_files: comparisons.filter(result => !result.match).length,
      original_lines: comparisons.reduce((sum, result) => sum + result.original_lines, 0),
      rendered_lines: comparisons.reduce((sum, result) => sum + result.rendered_lines, 0),
      first_differing_line: comparisons.find(result => !result.match)?.first_differing_line ?? null,
      line_endings_differ: comparisons.some(result => result.line_endings_differ),
    };
  }
  bytesReport = { tables, correspondence, json };
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
  bytes: bytesReport,
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
console.log(trackerComparison.match ? 'TRACKER MATCH' : 'TRACKER MISMATCH');
console.log(applyComparison.match ? 'APPLY DATES MATCH' : 'APPLY DATES MISMATCH');
console.log(statusComparison.match ? 'STATUS HISTORY MATCH' : 'STATUS HISTORY MISMATCH');
console.log(peopleComparison.match ? 'PEOPLE MATCH' : 'PEOPLE MISMATCH');
console.log(followupsComparison.match ? 'FOLLOWUPS MATCH' : 'FOLLOWUPS MISMATCH');
console.log(correspondenceComparison.match ? 'CORRESPONDENCE MATCH' : 'CORRESPONDENCE MISMATCH');
console.log(linkedinComparison.match ? 'LINKEDIN MATCH' : 'LINKEDIN MISMATCH');
console.log(twcComparison.match ? 'TWC MATCH' : 'TWC MISMATCH');
for (const file of LEGACY_TABLE_FILES) {
  const result = bytesReport.tables[file];
  console.log(result.match
    ? `BYTES MATCH ${file}`
    : `BYTES DIFFER ${file} (original_lines=${result.original_lines} rendered_lines=${result.rendered_lines} first_differing_line=${result.first_differing_line} line_endings_differ=${result.line_endings_differ})`);
}
for (const dir of ['target-talent-correspondence', 'referral-correspondence']) {
  const result = bytesReport.correspondence[dir];
  console.log(result.differing_files === 0
    ? `BYTES MATCH ${dir} (${result.files} files)`
    : `BYTES DIFFER ${dir} (${result.differing_files} of ${result.files} files; original_lines=${result.original_lines} rendered_lines=${result.rendered_lines} first_differing_line=${result.first_differing_line} line_endings_differ=${result.line_endings_differ})`);
}
for (const file of LEGACY_JSON_FILES) {
  const result = bytesReport.json[file];
  console.log(result.match
    ? `BYTES MATCH ${file}${result.absent ? ' (absent)' : ''}`
    : `BYTES DIFFER ${file} (original_bytes=${result.original_bytes} rendered_bytes=${result.rendered_bytes})`);
}
const bytesMatch = Object.values(bytesReport.tables).every(result => result.match)
  && Object.values(bytesReport.correspondence).every(result => result.differing_files === 0)
  && Object.values(bytesReport.json).every(result => result.match);
process.exit(trackerComparison.match && applyComparison.match && statusComparison.match
  && peopleComparison.match && followupsComparison.match && correspondenceComparison.match
  && linkedinComparison.match && twcComparison.match && bytesMatch ? 0 : 1);
