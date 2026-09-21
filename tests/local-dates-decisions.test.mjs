#!/usr/bin/env node
// Cadence dates must be the user's own calendar date, never the UTC date. A US evening send used to be
// recorded as tomorrow (UTC), pushing every later step a day out, and date arithmetic must not drift in
// either direction of UTC or across a daylight-saving change.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('local-dates-decisions');
process.env.TJK_DATA_DIR = sandbox;
process.env.TZ = 'America/Chicago';

const talentRow = id => `| ${id} | Example Works | Contact${id} | Test | Mx. | Recruiter | Austin | TX | 78701 | | test${id}@example.test | linkedin.com/in/test-${id} | Not Contacted | | | |`;
fs.writeFileSync(path.join(sandbox, 'target-talent.md'),
  '# Target Talent\n\n' +
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n' +
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n' + talentRow(900001) + '\n' + talentRow(900002) + '\n',
  'utf8');

const REFERENCE_INSTANT = new Date('2030-03-02T03:30:00Z');

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};

console.log('local-dates-decisions.test.mjs');

// 1. local-date.mjs: localToday and localStamp must use the local calendar date.
{
  const { localToday, localStamp } = await import('../lib/local-date.mjs');

  check(localToday(new Date(2030, 2, 5, 4, 7)) === '2030-03-05', 'localToday returns the local date for a plain date');
  check(localStamp(new Date(2030, 2, 5, 4, 7)) === '2030-03-05 04:07', 'localStamp returns the local date and time for a plain date');
  check(localToday(REFERENCE_INSTANT) === '2030-03-01', 'localToday returns the local date, not the UTC date');
  check(localStamp(REFERENCE_INSTANT) === '2030-03-01 21:30', 'localStamp returns the local date and time, not UTC');
}

// 2. outreach-policy.mjs: canContact must respect the local date for gap rules.
{
  const { canContact } = await import('../dashboard-web/server/lib/outreach-policy.mjs');

  const policy = { minDaysBetweenTouches: 1, minDaysBetweenTouchesAnyChannel: 0, awaitingReplyHold: 0 };
  const timeline = [{ direction: 'Sent', channel: 'Email', subject: 'Invented outreach', timestamp: '2030-03-01 20:00' }];

  const result1 = canContact({
    now: REFERENCE_INSTANT,
    channel: 'email',
    source: 'ta',
    policy,
    timeline,
  });

  check(result1.allowed === false, 'canContact returns allowed false when sent on the same local day');
  check(result1.blocks.some(b => b.rule === 'minDaysBetweenTouches'), 'canContact block has rule minDaysBetweenTouches');
  check(result1.blocks.some(b => b.rule === 'minDaysBetweenTouches' && b.until === '2030-03-02'), 'canContact block until is the next local day');
  check(result1.blocks.some(b => b.rule === 'minDaysBetweenTouches' && b.reason.includes('today')), 'canContact block reason contains today');

  const result2 = canContact({
    now: new Date('2030-03-03T15:00:00Z'),
    channel: 'email',
    source: 'ta',
    policy,
    timeline,
  });

  check(result2.allowed === true, 'canContact returns allowed true when enough days have passed');
  check(result2.blocks.length === 0, 'canContact has no blocks when allowed');
}

// 3. activity.mjs: actionSeries must use the local date for start/end and point dates.
{
  fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), JSON.stringify({ '900001': '2030-03-01', '900002': '2030-02-28' }), 'utf8');

  const { actionSeries } = await import('../dashboard-web/server/lib/activity.mjs');

  const result = actionSeries({ days: 2, today: REFERENCE_INSTANT });

  check(result.end === '2030-03-01', 'actionSeries end is the local date, not the UTC date');
  check(result.start === '2030-02-28', 'actionSeries start is the correct local date');

  const applications = result.series.find((s) => s.key === 'applications');
  check(applications !== undefined, 'applications series exists');
  check(applications.points.length === 2, 'applications has 2 points');
  check(applications.points[0].date === '2030-02-28' && applications.points[1].date === '2030-03-01', 'applications point dates are in order');
  check(applications.points[0].value === 1 && applications.points[1].value === 1, 'applications point values are [1, 1]');
}

console.log(`\nlocal-dates-decisions: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
