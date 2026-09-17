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
import {
  compareGroupingWithResolvePeople,
  comparePeople,
  importPeople,
} from '../lib/import/people-import.mjs';
import {
  compareFollowups,
  importFollowups,
} from '../lib/import/followups-import.mjs';
import {
  compareCorrespondence,
  importCorrespondence,
} from '../lib/import/correspondence-import.mjs';
import {
  compareLinkedIn,
  importLinkedIn,
} from '../lib/import/linkedin-import.mjs';

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

function readContactLinks(path, missing) {
  if (missing) return { document: {}, unreadable: false };
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { document: {}, unreadable: true };
    }
    return { document: value, unreadable: false };
  } catch {
    return { document: {}, unreadable: true };
  }
}

function readCorrespondenceDirectory(inputDir, name) {
  const path = resolve(inputDir, name);
  const missing = !existsSync(path);
  if (missing) return { files: {}, missing };
  const files = {};
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    files[entry.name] = readFileSync(resolve(path, entry.name), 'utf8');
  }
  return { files, missing };
}

function readOptionalText(inputDir, name) {
  const path = resolve(inputDir, name);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
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
const targetTalentPath = resolve(inputDir, 'target-talent.md');
const targetTalentMissing = !existsSync(targetTalentPath);
const targetTalentText = targetTalentMissing ? '' : readFileSync(targetTalentPath, 'utf8');
const referralsPath = resolve(inputDir, 'referrals.md');
const referralsMissing = !existsSync(referralsPath);
const referralsText = referralsMissing ? '' : readFileSync(referralsPath, 'utf8');
const contactLinksPath = resolve(inputDir, 'contact-links.json');
const contactLinksMissing = !existsSync(contactLinksPath);
const contactLinksRead = readContactLinks(contactLinksPath, contactLinksMissing);
const contactLinks = contactLinksRead.document;
const contactPins = contactLinks.pins && typeof contactLinks.pins === 'object'
  && !Array.isArray(contactLinks.pins) ? contactLinks.pins : {};
const followupsPath = resolve(inputDir, 'follow-ups.md');
const followupsMissing = !existsSync(followupsPath);
const followupsText = followupsMissing ? '' : readFileSync(followupsPath, 'utf8');
const targetTalentCorrespondence = readCorrespondenceDirectory(
  inputDir,
  'target-talent-correspondence',
);
const referralCorrespondence = readCorrespondenceDirectory(
  inputDir,
  'referral-correspondence',
);
const linkedinFiles = {
  connectsText: readOptionalText(inputDir, 'linkedin-connects.json'),
  sidecarText: readOptionalText(inputDir, 'tt-linkedin.json'),
  connectionsText: readOptionalText(inputDir, 'linkedin-connections.json'),
};
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
let peopleReport;
let peopleComparison;
let groupingComparison;
let followupsReport;
let followupsComparison;
let correspondenceReport;
let correspondenceComparison;
let linkedinReport;
let linkedinComparison;
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
  peopleReport = importPeople(store, {
    targetTalentText,
    referralsText,
    pins: contactPins,
    definitionsVersion,
    importedOn,
  });
  peopleComparison = comparePeople({ targetTalentText, referralsText }, store);
  groupingComparison = compareGroupingWithResolvePeople(store, {
    targetTalentText,
    referralsText,
    pins: contactPins,
  });
  followupsReport = importFollowups(store, followupsText, { definitionsVersion, importedOn });
  followupsComparison = compareFollowups(followupsText, store);
  correspondenceReport = importCorrespondence(store, {
    targetTalentFiles: targetTalentCorrespondence.files,
    referralFiles: referralCorrespondence.files,
    definitionsVersion,
    importedOn,
  });
  correspondenceComparison = compareCorrespondence({
    targetTalentFiles: targetTalentCorrespondence.files,
    referralFiles: referralCorrespondence.files,
  }, store);
  linkedinReport = importLinkedIn(store, {
    ...linkedinFiles,
    definitionsVersion,
    importedOn,
  });
  linkedinComparison = compareLinkedIn(linkedinFiles, store);
} finally {
  store.close();
}

applyReport.counts.apply_dates_file_missing = applyDatesMissing;
statusReport.counts.status_events_file_missing = statusEventsMissing;
peopleReport.counts.target_talent_file_missing = targetTalentMissing;
peopleReport.counts.referrals_file_missing = referralsMissing;
peopleReport.counts.contact_links_file_missing = contactLinksMissing;
peopleReport.counts.pins_file_unreadable = contactLinksRead.unreadable;
followupsReport.counts.followups_file_missing = followupsMissing;
correspondenceReport.counts.target_talent_dir_missing = targetTalentCorrespondence.missing;
correspondenceReport.counts.referral_dir_missing = referralCorrespondence.missing;
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
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const {
  by_us_only_pairs: ignoredByUsPairs,
  by_them_only_pairs: ignoredByThemPairs,
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
}, null, 2));
console.log(trackerComparison.match ? 'TRACKER MATCH' : 'TRACKER MISMATCH');
console.log(applyComparison.match ? 'APPLY DATES MATCH' : 'APPLY DATES MISMATCH');
console.log(statusComparison.match ? 'STATUS HISTORY MATCH' : 'STATUS HISTORY MISMATCH');
console.log(peopleComparison.match ? 'PEOPLE MATCH' : 'PEOPLE MISMATCH');
console.log(followupsComparison.match ? 'FOLLOWUPS MATCH' : 'FOLLOWUPS MISMATCH');
console.log(correspondenceComparison.match ? 'CORRESPONDENCE MATCH' : 'CORRESPONDENCE MISMATCH');
console.log(linkedinComparison.match ? 'LINKEDIN MATCH' : 'LINKEDIN MISMATCH');
process.exit(trackerComparison.match && applyComparison.match && statusComparison.match
  && peopleComparison.match && followupsComparison.match && correspondenceComparison.match
  && linkedinComparison.match ? 0 : 1);
