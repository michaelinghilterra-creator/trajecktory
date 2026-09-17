#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { performance } from 'node:perf_hooks';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('people-import');
process.env.TJK_DATA_DIR = join(sandbox, 'reader-data');

const { openEventStore } = await import('../lib/event-store.mjs');
const {
  findPersonByAlias,
  resolvePersonId,
  wereKeptSeparate,
} = await import('../lib/identity-store.mjs');
const {
  compareGroupingWithResolvePeople,
  comparePeople,
  importPeople,
} = await import('../lib/import/people-import.mjs');
const {
  parseTargetTalentMd,
  parseTargetTalentText,
} = await import('../dashboard-web/server/lib/target-talent.mjs');
const {
  parseReferralsMd,
  parseReferralsText,
} = await import('../dashboard-web/server/lib/referrals.mjs');
const { TRACKER_HEADER, TRACKER_SEPARATOR } = await import('../lib/tracker.mjs');

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

function ta(id, company, last, first, email = '', linkedin = '', notes = '') {
  return `| ${id} | ${company} | ${last} | ${first} |  | Example Title |  |  |  |  | ${email} | ${linkedin} | Not Contacted |  | ${notes} |  |`;
}

function referral(id, name, where, notes = '', linkedin = '', email = '') {
  return `| ${id} | ${name} | Example connection | ${where} | Example Target | Not Asked |  | ${notes} | ${linkedin} | ${email} |`;
}

const sharedLinkedin = 'https://www.linkedin.com/in/example-person-shared';
const aloneLinkedin = 'https://www.linkedin.com/in/example-person-alone';
const bridgeLinkedin = 'https://www.linkedin.com/in/example-person-bridge';
const targetLines = [
  '# Invented target talent',
  ta(900001, 'Zorblax Widgetry', 'Personone', 'Example', '', sharedLinkedin),
  ta(900002, 'Quennox Ratchet Works', 'Persontwo', 'Sample', 'CASE.PERSON@example.test'),
  ta(900003, 'Quennox Ratchet Works', 'Persontwo', 'Sample', 'case.person@example.test'),
  ta(900004, 'Zorblax Widgetry', 'Emailowner', 'Bridge', 'bridge.person@example.test'),
  ta(900005, 'Zorblax Widgetry', 'Linkedinowner', 'Bridge', '', bridgeLinkedin),
  ta(900006, 'Zorblax Widgetry', 'Joiner', 'Bridge', 'bridge.person@example.test', bridgeLinkedin),
  ta(900007, 'Quennox Ratchet Works', 'Firstdup', 'Example', '', 'https://www.linkedin.com/in/example-person-firstdup'),
  ta(900007, 'Quennox Ratchet Works', 'Seconddup', 'Example', '', 'https://www.linkedin.com/in/example-person-seconddup'),
  ta(900008, 'Quennox Ratchet Works', 'Noidentifier', 'Example'),
  ta(900009, 'Quennox Ratchet Works', 'Bademail', 'Example', 'not-an-email', 'https://www.linkedin.com/in/example-person-bademail'),
  ta(900010, 'Quennox Ratchet Works', 'Badlinkedin', 'Example', 'valid.person@example.test', 'not-a-profile'),
  ta(900011, 'Zorblax Widgetry', 'Pinleft', 'Example', '', 'https://www.linkedin.com/in/example-person-pinleft'),
  ta(900012, 'Zorblax Widgetry', 'Aloneleft', 'Example', '', aloneLinkedin),
  ta(900013, 'Zorblax Widgetry', 'Backtarget', 'Example', '', 'https://www.linkedin.com/in/example-person-backtarget'),
  ta(900014, 'Zorblax Widgetry', 'Duplicate', 'Matching', 'matching.one@example.test'),
  ta(900015, 'Zorblax Widgetry', 'Duplicate', 'Matching', 'matching.two@example.test'),
  ta(900016, 'Zorblax Widgetry', 'Duplicate', 'Related', 'related.one@example.test'),
  ta(900017, 'Zorblax Widgetry.io', 'Duplicate', 'Related', 'related.two@example.test'),
  ta(900018, 'Zorblax Widgetry', 'Duplicate', 'Elsewhere', 'elsewhere.one@example.test'),
  ta(900019, 'Quennox Ratchet Works', 'Duplicate', 'Elsewhere', 'elsewhere.two@example.test'),
  ta(900020, 'Zorblax Widgetry', '', '', '', 'https://www.linkedin.com/in/example-person-emptyname'),
  ta(900021, '!!!', 'Nocompany', 'Example', '', 'https://www.linkedin.com/in/example-person-nocompany'),
];
const referralLines = [
  '# Invented referrals',
  referral(900001, 'Example Personone', 'Zorblax Widgetry', '', sharedLinkedin),
  referral(900011, 'Example Pinright', 'Quennox Ratchet Works', '', 'https://www.linkedin.com/in/example-person-pinright'),
  referral(900012, 'Example Aloneright', 'Zorblax Widgetry', '', aloneLinkedin),
  referral(900013, 'Example Backsource', 'Quennox Ratchet Works', 'from TA Outreach #900013', 'https://www.linkedin.com/in/example-person-backsource'),
];
const targetTalentText = targetLines.join('\n');
const referralsText = referralLines.join('\n');
const pins = {
  'ta:900011': {
    with: 'referral:900011',
    by: 'Example Reviewer',
    at: '2030-05-01',
    note: 'must not enter the event',
  },
  'ta:999999': { with: 'ta:900001', by: 'Example Reviewer', at: '2030-05-02' },
  'ta:900012': { alone: true, by: 'Example Reviewer', at: '2030-05-03' },
  'ta:900014': { mystery: true },
  'referral:900013': { with: 'ta:999998' },
  'referral:900012': { with: 'ta:900012' },
};
const settings = {
  targetTalentText,
  referralsText,
  pins,
  definitionsVersion: 'fixture-v1',
  importedOn: '2030-12-31',
};

console.log('people-import.test.mjs');

const store = openEventStore(join(sandbox, 'people.db'));
const report = importPeople(store, settings);
const comparison = comparePeople({ targetTalentText, referralsText }, store);
check(comparison.match
  && comparison.target_talent.original_rows === 22
  && comparison.target_talent.rebuilt_rows === 22
  && comparison.target_talent.mismatches === 0
  && comparison.referrals.original_rows === 4
  && comparison.referrals.rebuilt_rows === 4
  && comparison.referrals.mismatches === 0,
'contact rows rebuild exactly for both files');

const flagsByType = Object.fromEntries(Object.entries(Object.groupBy(report.flags, item => item.type))
  .map(([type, items]) => [type, items.map(item => item.ref)]));
const expectedFlags = {
  duplicate_person_row: ['ta:900003', 'referral:900001'],
  identity_bridge: ['ta:900006'],
  duplicate_id: ['ta:900007'],
  no_identifier: ['ta:900008'],
  invalid_email: ['ta:900009'],
  unparseable_linkedin: ['ta:900010'],
  no_name: ['ta:900020'],
  no_company: ['ta:900021'],
  pin_missing_ref: ['ta:999999', 'referral:900013'],
  pin_alone_conflict: ['ta:900012'],
  pin_unrecognized: ['ta:900014'],
  pin_skipped_alone: ['referral:900012'],
};
check(Object.keys(flagsByType).length === Object.keys(expectedFlags).length
  && Object.entries(expectedFlags).every(([type, refs]) => (
    JSON.stringify(flagsByType[type]) === JSON.stringify(refs)
  )), 'every expected flag fires only on its intended row');

const expectedCounts = {
  target_talent_rows: 22,
  referral_rows: 4,
  people_created: 23,
  aliases_attached: 25,
  identifiers_added: 21,
  pin_merges: 1,
  pin_already_same: 0,
  backref_merges: 1,
  backref_already_same: 0,
  companies_created: 3,
  companies_reused: 22,
  person_roots: 21,
};
check(JSON.stringify(report.counts) === JSON.stringify(expectedCounts), 'people import counts are exact');

const root = ref => findPersonByAlias(store, ref.startsWith('ta:') ? 'target_talent' : 'referral', ref.split(':')[1]);
check(root('ta:900001') === root('referral:900001')
  && root('ta:900002') === root('ta:900003'),
'shared LinkedIn and case folded email rows resolve to one person');
check(root('ta:900004') === root('ta:900006')
  && root('ta:900005') !== root('ta:900006'),
'bridge row attaches to the email owner only');
check(root('ta:900011') === root('referral:900011')
  && root('ta:900013') === root('referral:900013'),
'valid pin and invalid-pin back-reference fallback resolve to one root');
const aloneConflict = report.flags.find(item => item.type === 'pin_alone_conflict');
check(root('ta:900012') !== root('referral:900012')
  && wereKeptSeparate(store, 'person', root('ta:900012'), root('referral:900012'))
  && aloneConflict?.person_id === root('ta:900012')
  && JSON.stringify(aloneConflict?.owners) === JSON.stringify([root('referral:900012')])
  && JSON.stringify(aloneConflict?.withheld_identifier_kinds) === JSON.stringify(['linkedin']),
'alone pin creates a distinct person, records separation, and reports only withheld kinds');
check(report.possible_duplicate_people.length === 2
  && report.possible_duplicate_people.map(item => item.reason).sort().join(',') === 'related_company,same_company'
  && report.same_name_other_company.length === 1
  && root('ta:900014') !== root('ta:900015')
  && root('ta:900016') !== root('ta:900017')
  && root('ta:900018') !== root('ta:900019'),
'suspected same-name duplicates are reported and never merged');

const privateValues = [
  'Example Personone',
  'case.person@example.test',
  'example-person-shared',
  'Zorblax Widgetry',
  targetLines[1],
];
check(privateValues.every(value => !JSON.stringify(report).includes(value)),
'people report contains no fixture personal or raw values');

const grouping = compareGroupingWithResolvePeople(store, { targetTalentText, referralsText, pins });
check(grouping.pairs_grouped_by_us_only > 0
  && grouping.by_us_only_reasons.email >= 1
  && ![...grouping.by_us_only_pairs, ...grouping.by_them_only_pairs]
    .some(pair => pair.includes('ta:900012') && pair.includes('referral:900012')),
'grouping comparison retains email differences but agrees on the standalone pin');

const eventsBeforeRepeat = store.db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
let repeatError = null;
try { importPeople(store, settings); } catch (error) { repeatError = error; }
const eventsAfterRepeat = store.db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
check(/dedupe key/.test(String(repeatError?.message)) && eventsAfterRepeat === eventsBeforeRepeat,
'second import is refused by a dedupe key and writes nothing');

mkdirSync(process.env.TJK_DATA_DIR, { recursive: true });
writeFileSync(join(process.env.TJK_DATA_DIR, 'target-talent.md'), targetTalentText, 'utf8');
writeFileSync(join(process.env.TJK_DATA_DIR, 'referrals.md'), referralsText, 'utf8');
check(JSON.stringify(parseTargetTalentText(targetTalentText)) === JSON.stringify(parseTargetTalentMd())
  && JSON.stringify(parseReferralsText(referralsText)) === JSON.stringify(parseReferralsMd()),
'text parsers return the same rows as file readers');

const duplicatePerson = report.flags.find(item => item.type === 'duplicate_person_row');
check(duplicatePerson?.person_id === resolvePersonId(store, root('ta:900003'))
  && duplicatePerson.matched_by === 'email',
'duplicate person flag identifies its root and match method');
store.close();

const aloneBackrefStore = openEventStore(join(sandbox, 'alone-backref.db'));
const aloneBackrefTarget = ta(920001, 'Invented Works', 'Target', 'Alone', '', 'https://www.linkedin.com/in/invented-alone-target');
const aloneBackrefReferral = referral(
  920002,
  'Invented Referral',
  'Invented Works',
  'from TA Outreach #920001',
  'https://www.linkedin.com/in/invented-alone-referral',
);
const aloneBackrefReport = importPeople(aloneBackrefStore, {
  targetTalentText: aloneBackrefTarget,
  referralsText: aloneBackrefReferral,
  pins: { 'ta:920001': { alone: true } },
  definitionsVersion: 'fixture-v1',
  importedOn: '2030-12-31',
});
check(findPersonByAlias(aloneBackrefStore, 'target_talent', '920001')
  !== findPersonByAlias(aloneBackrefStore, 'referral', '920002')
  && aloneBackrefReport.flags.some(item => item.type === 'pin_skipped_alone'
    && item.ref === 'referral:920002'),
'back-reference touching an alone-pinned ref is skipped and flagged');
aloneBackrefStore.close();

const cliData = join(sandbox, 'cli-input');
const cliOutput = join(sandbox, 'cli-output');
mkdirSync(cliData);
mkdirSync(cliOutput);
const tracker = [
  '# Invented tracker',
  TRACKER_HEADER,
  TRACKER_SEPARATOR,
].join('\n');
writeFileSync(join(cliData, 'applications.md'), tracker, 'utf8');
writeFileSync(join(cliData, 'target-talent.md'), targetTalentText, 'utf8');
writeFileSync(join(cliData, 'referrals.md'), referralsText, 'utf8');
writeFileSync(join(cliData, 'contact-links.json'), `${JSON.stringify({ pins })}\n`, 'utf8');
const cliPath = resolve(fileURLToPath(new URL('../scripts/import-dry-run.mjs', import.meta.url)));
const cliDb = join(sandbox, 'cli.db');
const cliReport = join(sandbox, 'cli-report.json');
const cli = spawnSync(process.execPath, [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', cliDb,
  '--report', cliReport,
  '--definitions-version', 'fixture-v1',
  '--owner-name', 'Example Owner',
], { encoding: 'utf8' });
const written = existsSync(cliReport) ? JSON.parse(readFileSync(cliReport, 'utf8')) : null;
check(cli.status === 0
  && /PEOPLE MATCH/.test(cli.stdout)
  && written?.people?.comparison?.match,
'dry-run CLI prints PEOPLE MATCH and exits zero');
check(privateValues.every(value => !cli.stdout.includes(value))
  && !cli.stdout.includes('bridge.person@example.test')
  && !cli.stdout.includes('example-person-bridge'),
'dry-run CLI prints no fixture personal values');

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
const prohibitedDb = resolve(fileURLToPath(new URL('../data/fixture-people.db', import.meta.url)));
const prohibitedReport = resolve(fileURLToPath(new URL('../data/fixture-people-report.json', import.meta.url)));
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
'dry-run CLI retains every existing refusal');

const unreadableCases = [
  ['', true],
  ['{broken', true],
  ['[]', true],
];
let unreadableCasesPass = true;
for (let index = 0; index < unreadableCases.length; index++) {
  const [contents, expected] = unreadableCases[index];
  writeFileSync(join(cliData, 'contact-links.json'), contents, 'utf8');
  const caseReport = join(sandbox, `contact-links-case-${index}.json`);
  const result = spawnSync(process.execPath, [
    cliPath,
    '--data-dir', cliData,
    '--output-dir', cliOutput,
    '--db', join(sandbox, `contact-links-case-${index}.db`),
    '--report', caseReport,
    '--owner-name', 'Example Owner',
  ], { encoding: 'utf8' });
  const parsed = result.status === 0 ? JSON.parse(readFileSync(caseReport, 'utf8')) : null;
  unreadableCasesPass &&= result.status === 0
    && parsed?.people?.counts?.pins_file_unreadable === expected;
}
unlinkSync(join(cliData, 'contact-links.json'));
const absentReportPath = join(sandbox, 'contact-links-absent.json');
const absent = spawnSync(process.execPath, [
  cliPath,
  '--data-dir', cliData,
  '--output-dir', cliOutput,
  '--db', join(sandbox, 'contact-links-absent.db'),
  '--report', absentReportPath,
  '--owner-name', 'Example Owner',
], { encoding: 'utf8' });
const absentReport = absent.status === 0 ? JSON.parse(readFileSync(absentReportPath, 'utf8')) : null;
check(unreadableCasesPass
  && absent.status === 0
  && absentReport?.people?.counts?.contact_links_file_missing === true
  && absentReport?.people?.counts?.pins_file_unreadable === false,
'dry-run CLI treats empty, corrupt, non-object, and absent contact-links as no pins');

const performanceStore = openEventStore(join(sandbox, 'performance.db'));
const performanceText = Array.from({ length: 2000 }, (_, index) => ta(
  930000 + index,
  'Invented Performance Works',
  `Person${index}`,
  'Example',
  `invented.person.${index}@example.test`,
)).join('\n');
const performanceStarted = performance.now();
importPeople(performanceStore, {
  targetTalentText: performanceText,
  definitionsVersion: 'fixture-v1',
  importedOn: '2030-12-31',
});
const performanceDuration = performance.now() - performanceStarted;
performanceStore.close();
check(performanceDuration < 20_000,
  `2,000-contact import completes within 20 seconds (${performanceDuration.toFixed(1)} ms)`);
console.log(`  TIMING 2,000 contacts: ${performanceDuration.toFixed(1)} ms`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
