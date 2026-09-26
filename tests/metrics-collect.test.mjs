#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';
import { TRACKER_SEPARATOR } from '../lib/tracker.mjs';

const sandbox = makeSandbox('metrics-collect');
process.env.TJK_DATA_DIR = sandbox;

const tracker = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  TRACKER_SEPARATOR,
  '| 900001 | 2030-03-01 | Zorblax Widgetry | Widget Engineer | 4.1/5 | Applied | | | | | https://jobs.example.test/900001 |',
  '| 900002 | 2030-03-02 | Quennox Ratchet Works | Ratchet Engineer | 4.2/5 | Applied | | | | | https://jobs.example.test/900002 |',
  '| 900003 | 2030-03-03 | Zorblax Widgetry | Widget Lead | 4.3/5 | Applied | | | | | https://jobs.example.test/900003 |',
  '| 900004 | 2030-03-04 | Quennox Ratchet Works | Ratchet Lead | 4.4/5 | Passed | | | | | https://jobs.example.test/900004 |',
  '',
].join('\n');
fs.writeFileSync(path.join(sandbox, 'applications.md'), tracker, 'utf8');
fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), JSON.stringify({
  900001: '2030-03-01',
  900002: '2030-03-02',
  900003: '2030-03-03',
  900004: '2030-03-04',
}), 'utf8');
fs.writeFileSync(path.join(sandbox, 'status-events.tsv'), [
  'app#\tdate\tstatus\tcompany\tlogged',
  '900001\t2030-03-01\tApplied\tZorblax Widgetry\t2030-03-01',
  '900002\t2030-03-02\tApplied\tQuennox Ratchet Works\t2030-03-02',
  '900003\t2030-03-03\tApplied\tZorblax Widgetry\t2030-03-03',
  '900003\t2030-03-05\tResponded\tZorblax Widgetry\t2030-03-05',
  '900004\t2030-03-04\tApplied\tQuennox Ratchet Works\t2030-03-04',
  '900004\t2030-03-04\tPassed\tQuennox Ratchet Works\t2030-03-04',
  '',
].join('\n'), 'utf8');
fs.writeFileSync(path.join(sandbox, 'app-notes.json'), JSON.stringify({
  900001: [{
    timestamp: '2030-03-04T15:00:00.000Z',
    text: '### Reply logged (2030-03-04)\nexample.personone@example.test: Thank you for applying to Zorblax Widgetry [neutral]\n\nWe have received your application.',
  }],
  900002: [{
    timestamp: '2030-03-05T15:00:00.000Z',
    text: '### Reply logged (2030-03-05)\nexample.personone@example.test: Re: application [positive]\n\nThanks, let us schedule a conversation.',
  }, {
    timestamp: '2030-03-10T04:30:00.000Z',
    text: '### Debrief: Phone Screen\nObjection: none',
  }],
}, null, 2), 'utf8');

fs.writeFileSync(path.join(sandbox, 'target-talent.md'), [
  '# Target Talent',
  '',
  '| # | company | last | first | salute | title | city | state | zip | phone | email | linkedin | status | lastTouch | notes | website |',
  '| 900010 | Zorblax Widgetry | Personone | Example | Example | Recruiter | | | | | first@example.test [v:bounced:probe:2030-03-01:0] | | Bounced | 2030-03-05 | | |',
  '| 900011 | Quennox Ratchet Works | Persontwo | Example | Example | Recruiter | | | | | second@example.test [v:ok:probe:2030-03-01:90] | | Replied | 2030-03-06 | | |',
  '',
].join('\n'), 'utf8');
const correspondence = path.join(sandbox, 'target-talent-correspondence');
fs.mkdirSync(correspondence, { recursive: true });
fs.writeFileSync(path.join(correspondence, '900010.md'),
  '## 2030-03-05 09:00 | Sent | Email | Application note\n\nInvented body\n', 'utf8');
fs.writeFileSync(path.join(correspondence, '900011.md'), [
  '## 2030-03-05 09:00 | Sent | Email | Application note',
  '',
  'Invented body',
  '',
  '## 2030-03-06 09:00 | Received | Email | Re: Application note',
  '',
  'Thanks for writing.',
  '',
].join('\n'), 'utf8');
fs.writeFileSync(path.join(sandbox, 'referrals.md'), [
  '# Referral tracker',
  '',
  '| # | Name | How you know them | Where they are now | Target company/role | Status | Last Touch | Notes | LinkedIn | Email |',
  '| 900012 | Example Personthree | Conference | Zorblax Widgetry | Widget Engineer | Asked | 2030-03-06 | | | personthree@example.test |',
  '| 900013 | Example Personfour | Colleague | Zorblax Widgetry | Zorblax Widgetry | Applied w/ Referral | 2030-03-07 | | | personfour@example.test |',
  '',
].join('\n'), 'utf8');
const referralCorrespondence = path.join(sandbox, 'referral-correspondence');
fs.mkdirSync(referralCorrespondence, { recursive: true });
fs.writeFileSync(path.join(referralCorrespondence, '900012.md'),
  '## 2030-03-06 10:00 | Sent | Email | Referral note\n\nInvented referral body.\n', 'utf8');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const { collectCoreMetrics, referralApplicationIds } = await import('../dashboard-web/server/lib/metrics-collect.mjs');
const { collectWeeklyMetrics } = await import('../dashboard-web/server/lib/weekly-collect.mjs');
const { FLOORS } = await import('../dashboard-web/server/lib/review-thresholds.mjs');

console.log('metrics-collect.test.mjs');
try {
  const result = collectCoreMetrics({ today: '2030-03-10' });
  check(JSON.stringify(Object.keys(result)) === JSON.stringify([
    'version', 'today', 'week', 'thisWeek', 'results', 'funnel', 'weeks', 'scoreBands', 'segments',
  ]), 'the core response has the stable top level keys');
  check(result.funnel[0].n === 3, 'a same day application void is not an application');
  check(result.results.response.all.k === 2 && result.results.response.all.n === 3,
    'an application receipt is excluded while a human reply is counted');
  check(result.results.referral.all.k === 2 && result.results.referral.all.n === 3,
    'applied referral rows join tracker applications by normalized company');
  check(result.results.response.warm.n === 2,
    'applications joined to an applied referral are warm');
  check(result.funnel.find(row => row.id === 'responded')?.n === 2,
    'a Responded status event counts as heard back');
  check(result.thisWeek.unserviced.available === false && result.thisWeek.unserviced.count === null,
    'missing follow up data makes unserviced unavailable');
  check(result.results.outreach.email.n === 2 && result.results.outreach.email.k === 1,
    'a bounced email contact leaves the email denominator');
  const lateSaturday = collectWeeklyMetrics(new Date(2030, 2, 9, 23, 30));
  check(lateSaturday.metrics.objectionsLogged.value === 1,
    'a debrief timestamp uses its local Saturday calendar date');

  const express = (await import('express')).default;
  const { router } = await import('../dashboard-web/server/routes/review.mjs');
  const app = express();
  app.use(router);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const coreResponse = await fetch(`${base}/api/metrics/core`).then(response => response.json());
    check(Array.isArray(coreResponse.dictionary) && coreResponse.dictionary.length > 0,
      'the core route includes the metrics dictionary');
    const weeklyResponse = await fetch(`${base}/api/metrics/weekly`).then(response => response.json());
    check(weeklyResponse.metrics?.deliveredReplyRatePct?.value === 50,
      'weekly collection reads target talent and referral correspondence');
    check(JSON.stringify(weeklyResponse.floorValues) === JSON.stringify({
      verifiedTouches: FLOORS.verifiedTouches,
      linkedinConnects: FLOORS.linkedinConnects,
      cadencePct: FLOORS.cadencePct,
    }), 'the weekly route exposes the shared floor values');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

{
  const applied = 'Applied w/ Referral';
  const apps = [
    { id: 900101, company: 'Quennox Ratchet Works', role: 'Director, Revenue Operations' },
    { id: 900102, company: 'Quennox Ratchet Works', role: 'Senior Widget Engineer' },
    { id: 900103, company: 'Zorblax Widgetry', role: 'Widget Engineer' },
  ];
  const ids = rows => [...referralApplicationIds(rows, apps)].sort();
  check(JSON.stringify(ids([{ status: applied, where: 'Quennox Ratchet Works', target: 'Quennox Ratchet Works Director, Revenue Operations' }])) === JSON.stringify(['900101']),
    'a referral naming a role matches only that role at the company');
  check(JSON.stringify(ids([{ status: applied, where: 'Quennox Ratchet Works', target: 'Quennox Ratchet Works' }])) === JSON.stringify(['900101', '900102']),
    'a company only referral matches every application at the company');
  check(JSON.stringify(ids([{ status: applied, where: 'Zorblax Widgetry', target: 'Some Unlisted Role' }])) === JSON.stringify(['900103']),
    'an unmatched role falls back to the only application at the company');
  check(ids([{ status: applied, where: 'Quennox Ratchet Works', target: 'Some Unlisted Role' }]).length === 0,
    'an unmatched role with several applications at the company matches none');
  check(ids([{ status: 'Asked', where: 'Zorblax Widgetry', target: 'Zorblax Widgetry' }]).length === 0,
    'only rows applied with referral count');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
