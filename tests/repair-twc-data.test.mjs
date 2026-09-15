#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('repair-twc-data');
process.env.TJK_DATA_DIR = sandbox;

const { TRACKER_HEADER, TRACKER_SEPARATOR, formatTrackerLine, parseTrackerLine } =
  await import('../lib/tracker.mjs');
const { runRepair, deriveInterviewStage } = await import('../repair-twc-data.mjs');
const { buildActivities } = await import('../dashboard-web/server/lib/twc.mjs');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed += 1;
  } else {
    console.log(`  ❌ ${message}`);
    failed += 1;
  }
}

function row(num, company, role, status) {
  return formatTrackerLine({
    num, date: '2026-08-15', company, role, score: '4.0/5', status,
    pdf: 'no', resume: null, report: null, notes: `fixture ${num}`,
    url: `https://jobs.example.test/${num}`,
  });
}

function ledgerRow(fields) {
  return {
    date: '2026-09-01', kind: 'followup', activity: 'Follow-up email',
    employer: '', role: '', contact: '', method: 'Email', result: 'Other',
    status: 'VERIFIED', evidence: 'invented evidence', include: 'yes', ...fields,
  };
}

console.log('repair-twc-data.test.mjs');

const files = {
  tracker: path.join(sandbox, 'applications.md'),
  dates: path.join(sandbox, 'apply-dates.json'),
  events: path.join(sandbox, 'status-events.tsv'),
  followups: path.join(sandbox, 'follow-ups.md'),
  overrides: path.join(sandbox, 'twc-overrides.json'),
  ledger: path.join(sandbox, 'ledger.json'),
  dryPlan: path.join(sandbox, 'dry-plan.md'),
  applyPlan: path.join(sandbox, 'apply-plan.md'),
  secondPlan: path.join(sandbox, 'second-plan.md'),
  failureLedger: path.join(sandbox, 'failure-ledger.json'),
  failurePlan: path.join(sandbox, 'failure-plan.md'),
};

const trackerLines = [
  '# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR,
  row(1, 'Quartz Finch Works', 'Signal Planner', 'Rejected'),
  row(2, 'Cedar Comet Studio', 'Route Analyst', 'Closed'),
  row(3, 'Velvet Orbit Labs', 'Research Lead', 'Evaluated'),
  row(4, 'Copper Willow Group', 'Program Lead', 'Discarded'),
  row(5, 'Marble Kestrel Works', 'Systems Lead', 'Applied'),
  row(6, 'Harbor Lantern Services', 'Technology Lead', 'Applied'),
  row(7, 'Paradox Meadow Group', 'Program Director', 'Applied'),
  row(8, 'Twin Harbor Works', 'Operations Director', 'Applied'),
  row(9, 'Existing Peak Studio', 'Planning Lead', 'Applied'),
  row(10, 'Duplicate Kite Office', 'Analyst', 'Closed'),
  row(11, 'Pending Fern House', 'Manager', 'Closed'),
  row(12, 'Tracked Ember Bureau', 'Lead', 'Applied'),
  row(13, 'Migrating Lark Systems', 'Signals Lead', 'Applied'),
  row(14, 'Steady Horizon Studio', 'Research Lead', 'Applied'),
  row(15, 'Excluded River Office', 'Operations Lead', 'Applied'),
  row(16, 'Restored Elm Bureau', 'Recovery Lead', 'Applied'),
  row(17, 'Shared Borealis Labs', 'Platform Lead', 'Applied'),
  row(18, 'Shared Borealis Labs', 'Research Lead', 'Applied'),
  row(19, 'Repeat Willow Group', 'Program Lead', 'Applied'),
  row(90, 'Paper Moon Bureau', 'Control Role', 'Applied'),
  '',
];
fs.writeFileSync(files.tracker, trackerLines.join('\n'));
fs.writeFileSync(files.dates, `${JSON.stringify({
  1: '2026-09-02', 5: '2026-08-15', 6: '2026-08-15', 7: '2026-08-15',
  8: '2026-08-15', 9: '2026-08-15', 12: '2026-08-15', 13: '2026-05-12',
  14: '2026-07-01', 15: '2026-07-02', 16: '2026-08-03', 17: '2026-08-04',
  18: '2026-08-04', 19: '2026-08-05', 90: '2026-08-01',
}, null, 2)}\n`);
fs.writeFileSync(files.events,
  'app#\tdate\tstatus\tcompany\tlogged\n'
  + '5\t2026-08-20\tPhone Screen\tMarble Kestrel Works\t2026-08-20\n'
  + '5\t2026-08-21\t2nd Interview\tMarble Kestrel Works\t2026-08-21\n'
  + '6\t2026-08-22\tPhone Screen\tHarbor Lantern Services\t2026-08-22\n'
  + '9\t2026-09-04\t1st Interview\tExisting Peak Studio\t2026-09-04\n');
fs.writeFileSync(files.followups, [
  '# Follow-Ups', '',
  '| # | app# | date | company | role | channel | contact | notes |',
  '|---|------|------|---------|------|---------|---------|-------|',
  '| 1 | 5 | 2026-09-05 | Marble Kestrel Works | Systems Lead | LinkedIn | Lira Quill | LinkedIn message |',
  '| 2 | 5 | 2026-09-06 | Marble Kestrel Works | Systems Lead | Email | Iven Roe | email copy |',
  '| 3 | 5 | 2026-09-07 | Marble Kestrel Works | Systems Lead | Email | Taro Wren | unverified touch |',
  '| 4 | 5 | 2026-09-08 | Marble Kestrel Works | Systems Lead | Cross-ref | Ledger Link | internal cross reference |',
  '| 5 | 5 | 2026-09-09 | Marble Kestrel Works | Systems Lead | Form | Forma Lane | submitted contact form |',
  '| 6 | 5 | 2026-09-10 | Marble Kestrel Works | Systems Lead | Email | Ambi Lane | first channel |',
  '| 7 | 5 | 2026-09-10 | Marble Kestrel Works | Systems Lead | Form | Ambi Lane | second channel |',
  '| 8 | 5 | 2026-09-12 | Moved Maple Studio | Signals Lead | Email | Mova Reed | tracker date is one day late |',
  '| 9 | 5 | 2026-09-13 | Dual Pine Office | Research Lead | Email | Dula Moss | valid old-date touch |',
  '',
].join('\n'));

const originalOverrides = {
  version: 7,
  custom: { keep: 'survives' },
  applications: {
    16: { include: false, note: 'stale exclusion', marker: 'preserve me' },
    999: { include: true, note: 'existing application entry' },
  },
  interviews: [
    { appId: '90', stage: 'Phone Screen', date: '2026-03-03', note: 'keep interview' },
  ],
  exclude: [
    { date: '2026-08-01', kind: 'followup', contact: 'Una Pike', company: 'Paper Moon Bureau', note: 'keep exclusion' },
  ],
  add: [
    { date: '2026-08-02', kind: 'event', activity: 'Job club', company: 'Paper Moon Bureau',
      role: '', contact: 'Una Pike', method: 'Online', result: 'Other', note: 'keep addition' },
  ],
};
fs.writeFileSync(files.overrides, `${JSON.stringify(originalOverrides, null, 2)}\n`);

const ledger = {
  final: [
    ledgerRow({ date: '2026-09-03', kind: 'application', activity: 'Applied online', employer: 'Quartz Finch Works',
      role: 'Signal Planner', contact: '', method: 'Online', result: 'No reply', appId: '1', hasRej: false,
      receipt: 'mail one', evidence: 'receipt one' }),
    ledgerRow({ date: '2026-08-10', kind: 'application', activity: 'Applied online', employer: 'Cedar Comet Studio',
      role: 'Route Analyst', contact: '', method: 'Online', result: 'Not hired', appId: '2', hasRej: true,
      evidence: 'rejection notice' }),
    ledgerRow({ date: '2026-09-01', kind: 'application', activity: 'Applied online', employer: 'Velvet Orbit Labs',
      role: 'Research Lead', contact: '', method: 'Online', result: 'Submitted job application', appId: '3', hasRej: false }),
    ledgerRow({ date: '2026-08-01', kind: 'application', activity: 'Applied online', employer: 'Copper Willow Group',
      role: 'Program Lead', contact: '', method: 'Online', result: 'No reply', appId: '4', hasRej: false }),
    ledgerRow({ date: '2026-08-15', kind: 'application', activity: 'Applied online', employer: 'Duplicate Kite Office',
      role: 'Analyst', contact: '', method: 'Online', result: 'Other', status: 'DUPLICATE', include: 'no', appId: '10' }),
    ledgerRow({ date: '2026-08-15', kind: 'application', activity: 'Applied online', employer: 'Pending Fern House',
      role: 'Manager', contact: '', method: 'Online', result: 'Other', include: 'confirm', appId: '11' }),
    ledgerRow({ date: '2026-08-15', kind: 'application', activity: 'Applied online', employer: 'Tracked Ember Bureau',
      role: 'Lead', contact: '', method: 'Online', result: 'Submitted job application', source: 'added', appId: '12' }),
    ledgerRow({ date: '2026-09-10', kind: 'application', activity: 'Applied online', employer: 'Nimbus Acorn Cooperative',
      role: 'Forecast Lead', contact: '', method: 'Online', result: 'Submitted job application', source: 'added',
      receipt: 'mail two', evidence: 'receipt without tracker row' }),
    ledgerRow({ date: '2026-09-11', kind: 'application', activity: 'Applied online', employer: 'Synthetic Juniper Works',
      role: 'Evidence Lead', contact: '', method: 'Online', result: 'Submitted job application', source: 'added',
      appId: 'Gfixture001', receipt: 'mail three', evidence: 'receipt with synthetic id' }),
    ledgerRow({ date: '2026-06-15', kind: 'application', activity: 'Applied online', employer: 'Migrating Lark Systems',
      role: 'Signals Lead', contact: '', method: 'Online', result: 'Submitted job application', appId: '13',
      receipt: 'mail four', evidence: 'tracker application moved by receipt' }),
    ledgerRow({ date: '2026-05-12', kind: 'application', activity: 'Applied online', employer: 'Migrating Lark Systems',
      role: 'Signals Lead', contact: '', method: 'Online', result: 'Submitted job application', source: 'added',
      appId: 'GfixtureMoved', receipt: 'mail five', evidence: 'separate receipt on old tracker date' }),
    ledgerRow({ date: '2026-07-01', kind: 'application', activity: 'Applied online', employer: 'Steady Horizon Studio',
      role: 'Research Lead', contact: '', method: 'Online', result: 'Submitted job application', source: 'added',
      appId: 'R:SteadyHorizon', receipt: 'receipt alpha', evidence: 'same date as stable tracker row' }),
    ledgerRow({ date: '2026-07-02', kind: 'application', activity: 'Applied online', employer: 'Excluded River Office',
      role: 'Operations Lead', contact: '', method: 'Online', result: 'Other', status: 'DUPLICATE', include: 'no', appId: '15' }),
    ledgerRow({ date: '2026-07-02', kind: 'application', activity: 'Applied online', employer: 'Excluded River Office',
      role: 'Operations Lead', contact: '', method: 'Online', result: 'Submitted job application', source: 'added',
      appId: 'R:ExcludedRiver', receipt: 'receipt beta', evidence: 'valid receipt replaces excluded tracker row' }),
    ledgerRow({ date: '2026-08-03', kind: 'application', activity: 'Applied online', employer: 'Restored Elm Bureau',
      role: 'Recovery Lead', contact: '', method: 'Online', result: 'Submitted job application', appId: '16',
      evidence: 'included tracker application proves stale exclusion' }),
    ledgerRow({ date: '2026-08-08', kind: 'application', activity: 'Applied online', employer: 'Double Rowan Lab',
      role: 'Platform Lead', contact: '', method: 'Online', result: 'Submitted job application', source: 'added',
      appId: 'R:DoubleRowanPlatform', receipt: 'receipt gamma', evidence: 'first same-day role receipt' }),
    ledgerRow({ date: '2026-08-08', kind: 'application', activity: 'Applied online', employer: 'Double Rowan Lab',
      role: 'Research Lead', contact: '', method: 'Online', result: 'Submitted job application', source: 'added',
      appId: 'R:DoubleRowanResearch', receipt: 'receipt delta', evidence: 'second same-day role receipt' }),

    ledgerRow({ date: '2026-08-20', kind: 'interview', activity: 'Recruiter screen', employer: 'Marble Kestrel Works',
      role: 'Systems Lead', contact: 'Nila Frost', method: 'Phone', result: 'Interviewed', appId: '5' }),
    ledgerRow({ date: '2026-08-23', kind: 'interview', activity: 'Final phone interview',
      employer: 'Harbor Lantern Services Technology Group', role: 'Technology Lead', contact: 'Oren Birch',
      method: 'Phone', result: 'Interviewed', appId: '6' }),
    ledgerRow({ date: '2026-02-17', kind: 'interview', activity: 'Video interview', employer: 'Paradox Meadow Group',
      role: 'Program Director', contact: 'Sela Frost', method: 'Video', result: 'Interviewed', appId: '7' }),
    ledgerRow({ date: '2026-03-10', kind: 'interview', activity: 'Second phone interview', employer: 'Twin Harbor Works',
      role: 'Operations Director', contact: 'Vera Pine', method: 'Phone', result: 'Interviewed', appId: '8' }),
    ledgerRow({ date: '2026-03-11', kind: 'interview', activity: 'Final virtual interview', employer: 'Twin Harbor Works',
      role: 'Operations Director', contact: 'Vera Pine', method: 'Video', result: 'Interviewed', appId: '8' }),
    ledgerRow({ date: '2026-09-04', kind: 'interview', activity: 'Hiring manager interview', employer: 'Existing Peak Studio',
      role: 'Planning Lead', contact: 'Ira Stone', method: 'Video', result: 'Interviewed', appId: '9' }),
    ledgerRow({ date: '2026-03-03', kind: 'interview', activity: 'Phone screen', employer: 'Paper Moon Bureau',
      role: 'Control Role', contact: 'Una Pike', method: 'Phone', result: 'Interviewed', appId: '90' }),
    ledgerRow({ date: '2026-08-26', kind: 'interview', activity: 'Recruiter screen', employer: 'Shared Borealis Labs',
      role: 'Platform Lead', contact: 'Ari Lake', method: 'Phone', result: 'Interviewed', appId: '17',
      evidence: 'platform application interview' }),
    ledgerRow({ date: '2026-08-26', kind: 'interview', activity: 'Hiring manager interview', employer: 'Shared Borealis Labs',
      role: 'Research Lead', contact: 'Bea Lake', method: 'Video', result: 'Interviewed', appId: '18',
      evidence: 'research application interview' }),
    ledgerRow({ date: '2026-08-27', kind: 'interview', activity: 'Phone screen', employer: 'Repeat Willow Group',
      role: 'Program Lead', contact: 'Cora Glen', method: 'Phone', result: 'Interviewed', appId: '19',
      evidence: 'first phone screen evidence' }),
    ledgerRow({ date: '2026-08-28', kind: 'interview', activity: 'Recruiter screen', employer: 'Repeat Willow Group',
      role: 'Program Lead', contact: 'Dane Glen', method: 'Phone', result: 'Interviewed', appId: '19',
      evidence: 'second phone screen evidence' }),

    ledgerRow({ date: '2026-09-05', kind: 'outreach', activity: 'LinkedIn message', employer: 'Marble Kestrel Works',
      role: 'Systems Lead', contact: 'Lira Quill', method: 'LinkedIn', status: 'LINKEDIN_COPY', include: 'no' }),
    ledgerRow({ date: '2026-09-05', kind: 'outreach', activity: 'LinkedIn message', employer: 'Marble Kestrel Works',
      role: 'Systems Lead', contact: 'Lira Quill', method: 'LinkedIn', include: 'yes' }),
    ledgerRow({ date: '2026-09-06', kind: 'followup', activity: 'Follow-up email', employer: 'Marble Kestrel Works',
      role: 'Systems Lead', contact: 'Iven Roe', method: 'Email', status: 'DUPLICATE', include: 'no' }),
    ledgerRow({ date: '2026-09-06', kind: 'followup', activity: 'Follow-up email', employer: 'Marble Kestrel Works',
      role: 'Systems Lead', contact: 'Iven Roe', method: 'Email', include: 'yes' }),
    ledgerRow({ date: '2026-09-07', kind: 'followup', activity: 'Follow-up email', employer: 'Marble Kestrel Works',
      role: 'Systems Lead', contact: 'Taro Wren', method: 'Email', status: 'NOT_FOUND_IN_GMAIL', include: 'no' }),
    ledgerRow({ date: '2026-09-10', kind: 'followup', activity: 'Follow-up email', employer: 'Marble Kestrel Works',
      role: 'Systems Lead', contact: 'Ambi Lane', method: 'Email', status: 'DUPLICATE', include: 'no' }),
    ledgerRow({ date: '2026-09-11', kind: 'followup', activity: 'Follow-up email', employer: 'Saffron Echo House',
      role: 'Market Lead', contact: 'Mira Snow', method: 'Email', include: 'yes' }),
    ledgerRow({ date: '2026-09-12', kind: 'outreach', activity: 'LinkedIn message', employer: 'Opal Wren Works',
      role: 'Strategy Lead', contact: 'Rin Vale', method: 'LinkedIn', include: 'yes' }),
    ledgerRow({ date: '2026-09-13', trackerDate: '2026-09-12', kind: 'followup', activity: 'Follow-up email',
      employer: 'Moved Maple Studio', role: 'Signals Lead', contact: 'Mova Reed', method: 'Email', include: 'yes' }),
    ledgerRow({ date: '2026-09-14', trackerDate: '2026-09-13', kind: 'followup', activity: 'Follow-up email',
      employer: 'Dual Pine Office', role: 'Research Lead', contact: 'Dula Moss', method: 'Email', include: 'yes' }),
    ledgerRow({ date: '2026-09-13', kind: 'followup', activity: 'Follow-up email', employer: 'Dual Pine Office',
      role: 'Research Lead', contact: 'Dula Moss', method: 'Email', include: 'yes' }),
    ledgerRow({ date: '2026-09-09', kind: 'event', activity: 'Reemployment services orientation',
      employer: 'Civic Skills Guild', contact: 'Oren Birch', method: 'Online', status: 'VERIFIED',
      source: 'added', include: 'yes', evidence: 'calendar event alpha' }),
  ],
  stats: {}, wk: {},
};
fs.writeFileSync(files.ledger, `${JSON.stringify(ledger, null, 2)}\n`);

const dataFiles = [files.tracker, files.dates, files.events, files.followups, files.overrides];
const beforeDryRun = new Map(dataFiles.map(file => [file, fs.readFileSync(file, 'utf8')]));
const fixedNow = new Date(2026, 8, 14, 12, 0, 0, 0);

check(deriveInterviewStage('Phone call') === 'Phone Screen'
  && deriveInterviewStage('Recruiter introduction') === 'Phone Screen'
  && deriveInterviewStage('Intro call') === 'Phone Screen'
  && deriveInterviewStage('Initial screen') === 'Phone Screen',
  'phone, recruiter, intro call, and screen map to Phone Screen');
check(deriveInterviewStage('Second phone interview') === '2nd Interview'
  && deriveInterviewStage('Round 2 discussion') === '2nd Interview',
  'an explicit second round wins over the phone channel word');
check(deriveInterviewStage('Final phone interview') === '3rd Interview'
  && deriveInterviewStage('Third virtual interview') === '3rd Interview',
  'an explicit final or third round wins over the phone channel word');
check(deriveInterviewStage('Hiring manager conversation') === '1st Interview'
  && deriveInterviewStage('Hiring leader meeting') === '1st Interview'
  && deriveInterviewStage('First interview') === '1st Interview'
  && deriveInterviewStage('Video interview') === '1st Interview'
  && deriveInterviewStage('Virtual meeting') === '1st Interview'
  && deriveInterviewStage('Conversation') === '1st Interview',
  'manager, leader, first, video, virtual, and fallback cases map to 1st Interview');

const dry = runRepair({ ledgerPath: files.ledger, planPath: files.dryPlan, now: fixedNow });
check(dataFiles.every(file => fs.readFileSync(file, 'utf8') === beforeDryRun.get(file)),
  'dry run leaves every sandbox data file byte-for-byte unchanged');
check(fs.existsSync(files.dryPlan), 'dry run writes the requested plan file');
const dryPlanText = fs.readFileSync(files.dryPlan, 'utf8');
check(dry.totalChanges === 43 && dry.needsTrackerRows.length === 7,
  `dry run plans 43 data changes and seven tracker-row needs, got ${dry.totalChanges} and ${dry.needsTrackerRows.length}`);
check(dry.pendingConfirmations.length === 1
  && dryPlanText.includes('Pending your confirmation (counted by the tracker, not by the ledger)'),
  'confirm applications are listed without being changed');
check(dry.ambiguousExclusions.length === 1 && dryPlanText.includes('Ambiguous exclusions, needs review'),
  'a multi-match exclusion is listed as ambiguous instead of being written');
check(dryPlanText.includes('Export activity by kind') && dryPlanText.includes('before') && dryPlanText.includes('after'),
  'the plan reports per-kind export counts before and after the repair');
check(dry.manualInterviews.length === 1
  && dryPlanText.includes('Interviews needing a manual entry (same application and stage on two dates)')
  && dryPlanText.includes('2026-08-27 and 2026-08-28'),
  'a repeated same-stage interview is listed for manual entry with both dates');

const plannedExcludes = dry.files.overrides.exclude;
check(!plannedExcludes.some(item => item.contact === 'Lira Quill'),
  'an excluded LinkedIn copy with an included twin writes no exclusion');
check(!plannedExcludes.some(item => item.contact === 'Iven Roe'),
  'a duplicate email row with an included twin writes no exclusion');
check(plannedExcludes.some(item => item.contact === 'Taro Wren'),
  'a Gmail-missing follow-up with no included twin writes an exclusion');
check(plannedExcludes.some(item => item.contact === 'Ledger Link'),
  'a non-contact Cross-ref row writes an exclusion');
check(!plannedExcludes.some(item => item.contact === 'Forma Lane'),
  'Form is treated as a supported contact channel');
check(!plannedExcludes.some(item => item.contact === 'Ambi Lane'),
  'an ambiguous automatic exclusion is not written');
check(plannedExcludes.some(item => item.date === '2026-09-12' && item.kind === 'followup'
  && item.contact === 'Mova Reed' && item.note === 'Moved to 2026-09-13 by evidence ledger'),
  'a moved-date follow-up writes an exclusion for the tracker date with the evidence note');
check(!plannedExcludes.some(item => item.date === '2026-09-13' && item.kind === 'followup'
  && item.contact === 'Dula Moss'),
  'a moved-date follow-up does not exclude a separately included touch on the tracker date');

const plannedAdds = dry.files.overrides.add;
check(plannedAdds.some(item => item.kind === 'event' && item.activity === 'Reemployment services orientation'),
  'a verified event with source added becomes an addition');
check(plannedAdds.some(item => item.kind === 'followup' && item.contact === 'Mira Snow')
  && plannedAdds.some(item => item.kind === 'outreach' && item.contact === 'Rin Vale'),
  'missing included follow-up and outreach rows are added without added flags');
check(!plannedAdds.some(item => item.kind === 'application' && item.company === 'Tracked Ember Bureau')
  && plannedAdds.some(item => item.kind === 'application' && item.company === 'Nimbus Acorn Cooperative')
  && plannedAdds.filter(item => item.kind === 'application' && item.company === 'Synthetic Juniper Works').length === 1,
  'a tracked application gets no add while applications without tracker rows are each added once');
check(plannedAdds.filter(item => item.kind === 'application'
  && item.company === 'Migrating Lark Systems' && item.date === '2026-05-12').length === 1,
  'a tracker application moved away from a date no longer blocks the non-tracker application there');
check(!plannedAdds.some(item => item.kind === 'application'
  && item.company === 'Steady Horizon Studio' && item.date === '2026-07-01'),
  'a tracker application that stays on a date blocks a same-company non-tracker application there');
check(plannedAdds.filter(item => item.kind === 'application'
  && item.company === 'Excluded River Office' && item.date === '2026-07-02').length === 1,
  'an excluded tracker application does not block the non-tracker application on that date');
check(plannedAdds.filter(item => item.kind === 'application'
  && item.company === 'Double Rowan Lab' && item.date === '2026-08-08').length === 2,
  'two verified non-tracker applications with different roles are both added');
check(!dry.changes.some(item => ['apply_date', 'tracker_status', 'tracker_status_event', 'application_exclusion'].includes(item.type)
  && (item.key === 'Gfixture001' || item.key.includes('Gfixture001'))),
  'a synthetic application id produces no tracker, date, status-event, or exclusion change');
check(dry.files.overrides.applications['10'].include === false
  && !dry.files.overrides.applications['11'],
  'an include-no duplicate application is excluded while a confirm application is untouched');
const restoreChange = dry.changes.find(item => item.type === 'application_restore' && item.key === '16');
check(restoreChange?.before.include === false && restoreChange.after.include === true
  && restoreChange.after.note === 'stale exclusion' && restoreChange.after.marker === 'preserve me',
  'an included tracked application restores a stale exclusion and preserves its other fields');

const plannedInterviews = dry.files.overrides.interviews;
check(plannedInterviews.some(item => item.appId === '8' && item.date === '2026-03-10' && item.stage === '2nd Interview')
  && plannedInterviews.some(item => item.appId === '8' && item.date === '2026-03-11' && item.stage === '3rd Interview'),
  'two ledger interviews for one app on different dates and stages both get overrides');
check(!dry.changes.some(item => item.type === 'interview_override' && item.key.includes('application 5,'))
  && !dry.changes.some(item => item.type === 'interview_override' && item.key.includes('application 9,')),
  'an interview already emitted for the same app and date adds no override');
check(plannedInterviews.some(item => item.appId === '17' && item.date === '2026-08-26')
  && plannedInterviews.some(item => item.appId === '18' && item.date === '2026-08-26'),
  'same-day interviews for separate applications at one company are both handled');
check(plannedInterviews.filter(item => item.appId === '19' && item.stage === 'Phone Screen').length === 1
  && plannedInterviews.some(item => item.appId === '19' && item.date === '2026-08-27')
  && !plannedInterviews.some(item => item.appId === '19' && item.date === '2026-08-28'),
  'a second same-stage interview for one application does not create an unusable override');
check(plannedExcludes.some(item => item.kind === 'interview' && item.date === '2026-08-21'
  && item.company === 'Marble Kestrel Works'),
  'an emitted status-change interview absent from the ledger is excluded');
check(plannedExcludes.some(item => item.kind === 'interview' && item.date === '2026-08-22'
  && item.company === 'Harbor Lantern Services'),
  'a misdated interview is excluded while prefix company matching protects only the ledger date');

const statusChanges = dry.changes.filter(item => item.type === 'tracker_status_event');
const statusDate = appId => statusChanges.find(item => item.after.app === appId)?.after.date;
check(statusDate('3') === '2026-09-01', 'a recovered Applied event uses the ledger application date');
check(statusDate('1') === '2026-09-14' && statusDate('2') === '2026-09-14' && statusDate('4') === '2026-09-14',
  'No Response and Rejected repair events use the repair date');

const collisionPath = `${files.dates}.bak-20260914-120000000-pre-twc-repair`;
fs.writeFileSync(collisionPath, 'existing backup');
let collisionError = null;
try {
  runRepair({ ledgerPath: files.ledger, planPath: files.applyPlan, apply: true, now: fixedNow });
} catch (error) {
  collisionError = error;
}
check(collisionError && /Backup already exists/.test(collisionError.message),
  'an existing collision-proof backup name makes apply fail');
check(dataFiles.every(file => fs.readFileSync(file, 'utf8') === beforeDryRun.get(file)),
  'backup collision failure occurs before any data write');
fs.rmSync(collisionPath);

const applied = runRepair({ ledgerPath: files.ledger, planPath: files.applyPlan, apply: true, now: fixedNow });
check(applied.backups.length === 4 && applied.backups.every(file => fs.existsSync(file)),
  'apply creates one timestamped backup for every touched data file');
check(applied.written.length === 4, 'apply writes exactly the four planned data files');
check(applied.backups.every(file => /\.bak-20260914-120000000-pre-twc-repair$/.test(file)),
  'backup names include seconds and milliseconds');
check(applied.backups.every(file => {
  const original = file.replace(/\.bak-20260914-120000000-pre-twc-repair$/, '');
  return fs.readFileSync(file, 'utf8') === beforeDryRun.get(original);
}), 'each backup is an exact copy of its pre-repair file');

const trackerAfterText = fs.readFileSync(files.tracker, 'utf8');
const trackerAfter = trackerAfterText.split(/\r?\n/).map(parseTrackerLine).filter(Boolean);
const byId = new Map(trackerAfter.map(item => [String(item.num), item]));
const datesAfter = JSON.parse(fs.readFileSync(files.dates, 'utf8'));
check(datesAfter['1'] === '2026-09-03' && datesAfter['13'] === '2026-06-15'
  && datesAfter['5'] === '2026-08-15' && datesAfter['14'] === '2026-07-01',
  'receipt-backed incorrect apply dates are corrected while unchanged dates remain stable');
check(byId.get('1').status === 'No Response' && byId.get('2').status === 'Rejected'
  && byId.get('3').status === 'Applied' && byId.get('4').status === 'No Response',
  'silent close and missing-application status rules produce the expected statuses');
check(byId.get('11').status === 'Closed', 'the confirmation-pending tracker row remains unchanged');
check(trackerAfter.every(item => parseTrackerLine(item.raw)), 'every tracker data row still parses after the edit');
const changedIds = trackerLines.map((line, index) => ({ before: line, after: trackerAfterText.split(/\r?\n/)[index] }))
  .filter(pair => pair.before !== pair.after)
  .map(pair => String(parseTrackerLine(pair.after)?.num || ''));
check(JSON.stringify(changedIds) === JSON.stringify(['1', '2', '3', '4']),
  'no tracker rows other than the four planned status edits changed');
check(!trackerAfter.some(item => item.company === 'Nimbus Acorn Cooperative'),
  'the application without an app id is added only to overrides, not the tracker');
check(!trackerAfter.some(item => item.company === 'Synthetic Juniper Works'),
  'the application with a synthetic id is added only to overrides, not the tracker');

const eventsAfter = fs.readFileSync(files.events, 'utf8').trim().split('\n').slice(1).map(line => line.split('\t'));
const eventDate = (appId, status) => eventsAfter.find(parts => parts[0] === appId && parts[2] === status)?.[1];
check(eventDate('3', 'Applied') === '2026-09-01'
  && eventDate('2', 'Rejected') === '2026-09-14'
  && eventDate('1', 'No Response') === '2026-09-14',
  'written status events preserve the planned event-date semantics');

const exportAfter = buildActivities();
const countAfter = Object.fromEntries(['application', 'interview', 'followup', 'outreach', 'event']
  .map(kind => [kind, exportAfter.filter(item => item.kind === kind).length]));
check(JSON.stringify(countAfter) === JSON.stringify(applied.exportAfter),
  'the in-memory after summary matches the rebuilt export after apply');
check(exportAfter.some(item => item.kind === 'outreach' && item.contact === 'Lira Quill')
  && exportAfter.some(item => item.kind === 'followup' && item.contact === 'Iven Roe'),
  'the included LinkedIn and email twins survive the repaired export');
check(!exportAfter.some(item => item.kind === 'followup' && item.contact === 'Taro Wren'),
  'the Gmail-missing follow-up disappears from the repaired export');
check(exportAfter.filter(item => item.kind === 'event'
  && item.activity === 'Reemployment services orientation').length === 1,
  'the evidence-added event appears exactly once');
check(exportAfter.some(item => item.kind === 'followup' && item.contact === 'Forma Lane'),
  'the supported Form touch remains in the repaired export');
const movedTouches = exportAfter.filter(item => item.kind === 'followup' && item.contact === 'Mova Reed');
check(movedTouches.length === 1 && movedTouches[0].date === '2026-09-13',
  'a moved-date follow-up appears exactly once on the ledger date');
check(exportAfter.some(item => item.kind === 'followup' && item.contact === 'Dula Moss'
  && item.date === '2026-09-13')
  && exportAfter.some(item => item.kind === 'followup' && item.contact === 'Dula Moss'
  && item.date === '2026-09-14'),
  'a separately included tracker-date touch survives beside the moved follow-up');
check(exportAfter.filter(item => item.kind === 'application'
  && item.company === 'Synthetic Juniper Works' && item.date === '2026-09-11').length === 1,
  'the synthetic-id application appears exactly once in the repaired export');
check(exportAfter.filter(item => item.kind === 'application'
  && item.company === 'Migrating Lark Systems' && item.date === '2026-05-12').length === 1
  && exportAfter.some(item => item.kind === 'application' && String(item.appId) === '13'
    && item.date === '2026-06-15'),
  'the moved tracker application and the non-tracker application both appear on their final dates');
check(exportAfter.filter(item => item.kind === 'application'
  && item.company === 'Steady Horizon Studio' && item.date === '2026-07-01').length === 1,
  'the stable tracker application remains the only same-company application on its date');
check(exportAfter.filter(item => item.kind === 'application'
  && item.company === 'Excluded River Office' && item.date === '2026-07-02').length === 1
  && !exportAfter.some(item => item.kind === 'application' && String(item.appId) === '15'),
  'the non-tracker application replaces the excluded tracker application in the export');
check(exportAfter.some(item => item.kind === 'application' && String(item.appId) === '16'
  && item.date === '2026-08-03'),
  'the restored tracked application appears in the repaired export');
check(exportAfter.filter(item => item.kind === 'application'
  && item.company === 'Double Rowan Lab' && item.date === '2026-08-08').length === 2,
  'both same-day application additions with different roles appear in the repaired export');
check(exportAfter.some(item => item.kind === 'interview' && String(item.appId) === '8'
  && item.date === '2026-03-10' && item.activity === 'Interview: 2nd Interview')
  && exportAfter.some(item => item.kind === 'interview' && String(item.appId) === '8'
  && item.date === '2026-03-11' && item.activity === 'Interview: 3rd Interview'),
  'both different-stage interviews for one app appear in the repaired export');
check(exportAfter.some(item => item.kind === 'interview' && String(item.appId) === '17'
  && item.date === '2026-08-26')
  && exportAfter.some(item => item.kind === 'interview' && String(item.appId) === '18'
  && item.date === '2026-08-26'),
  'both same-company same-day interviews for separate applications appear in the export');
check(exportAfter.filter(item => item.kind === 'interview' && String(item.appId) === '19'
  && item.activity === 'Interview: Phone Screen').length === 1
  && exportAfter.some(item => item.kind === 'interview' && String(item.appId) === '19'
    && item.date === '2026-08-27'),
  'the repeated same-stage interview emits only the representable first date');
check(!exportAfter.some(item => item.kind === 'interview' && item.date === '2026-08-21'
  && item.company === 'Marble Kestrel Works'),
  'the stale status-change interview is absent from the repaired export');
check(exportAfter.some(item => item.kind === 'interview' && item.date === '2026-02-17'
  && item.company === 'Paradox Meadow Group'),
  'the missing video interview appears as a first interview');

const overridesAfter = JSON.parse(fs.readFileSync(files.overrides, 'utf8'));
check(overridesAfter.version === 7 && overridesAfter.custom.keep === 'survives'
  && overridesAfter.applications['999'].note === 'existing application entry'
  && overridesAfter.applications['16'].include === true
  && overridesAfter.applications['16'].marker === 'preserve me',
  'unknown fields and existing application overrides survive the merge');
check(overridesAfter.interviews.some(item => String(item.appId) === '90' && item.note === 'keep interview')
  && overridesAfter.exclude.some(item => item.contact === 'Una Pike')
  && overridesAfter.add.some(item => item.contact === 'Una Pike'),
  'existing interview, exclusion, and addition entries survive the merge');

const second = runRepair({ ledgerPath: files.ledger, planPath: files.secondPlan, apply: true, now: fixedNow });
check(second.totalChanges === 0 && second.backups.length === 0 && second.written.length === 0,
  'a second apply plans zero changes, creates no backups, and writes no data files');
check(second.pendingConfirmations.length === 1 && second.ambiguousExclusions.length === 1
  && second.manualInterviews.length === 1,
  'pending confirmations, ambiguous exclusions, and manual interviews remain visible without counting as changes');

fs.appendFileSync(files.tracker, `${row(20, 'Failure Cypress Works', 'Failure Lead', 'Closed')}\n`);
fs.writeFileSync(files.failureLedger, `${JSON.stringify({
  final: [ledgerRow({
    date: '2026-09-14', kind: 'application', activity: 'Applied online', employer: 'Failure Cypress Works',
    role: 'Failure Lead', contact: '', method: 'Online', result: 'Submitted job application', appId: '20',
    evidence: 'status change whose event logger is intentionally disabled',
  })],
}, null, 2)}\n`);
let statusWriteError = null;
try {
  runRepair({
    ledgerPath: files.failureLedger, planPath: files.failurePlan, apply: true,
    now: new Date(2026, 8, 14, 12, 0, 1, 0), statusEventLogger: () => {},
  });
} catch (error) {
  statusWriteError = error;
}
check(statusWriteError
  && /Status events failed verification/.test(statusWriteError.message)
  && /application 20, status Applied, date 2026-09-14/.test(statusWriteError.message),
  'a missing status-event append makes apply fail with the exact event in the error');

const repairSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'repair-twc-data.mjs'), 'utf8');
check(!repairSource.includes('FIXED_VOID_IDS') && /const preActivities = buildActivities\(\)/.test(repairSource),
  'the system script has no user-specific void ids and builds the export with default identity');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
