#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';
import { TRACKER_SEPARATOR } from '../lib/tracker.mjs';

const tmp = makeSandbox('response-progress');
process.env.TJK_DATA_DIR = tmp;

fs.writeFileSync(path.join(tmp, 'applications.md'), [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  TRACKER_SEPARATOR,
  '| 1 | 2026-01-01 | Northwind | Systems Lead | 4.0/5 | Rejected | No | None | None | sent | https://example.test/1 |',
  '',
].join('\n'));
fs.writeFileSync(path.join(tmp, 'apply-dates.json'), JSON.stringify({ 1: '2026-01-05' }));
fs.writeFileSync(path.join(tmp, 'status-events.tsv'), [
  'app#\tdate\tstatus\tcompany\tlogged',
  '1\t2026-01-10\tApplied\tNorthwind\t2026-01-10',
  '1\t2026-01-15\tRejected\tNorthwind\t2026-01-15',
  '',
].join('\n'));

const { rejectionTimingStats, parseApplicationsMd } = await import('../dashboard-web/server/lib/applications.mjs');
const { responseProgressStats, readResponseProgressStats } = await import('../dashboard-web/server/lib/response-timing.mjs');
const { makeApplyAnchor } = await import('../dashboard-web/server/lib/statuses.mjs');
const { readApplyDates, parseStatusEvents } = await import('../dashboard-web/server/lib/sidecars.mjs');

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) {
    console.log(`  PASS ${message}`);
    passed++;
  } else {
    console.log(`  FAIL ${message}`);
    failed++;
  }
};
const app = (id, date, status = 'Applied', extra = {}) => ({ id, date, status, notes: '', ...extra });
const event = (id, date, status) => ({ app: String(id), date, status });
const stats = (apps, applyDates = {}, events = [], today = '2026-07-10') => responseProgressStats({
  apps, applyDates, events, today,
});

console.log('response-progress.test.mjs');

const anchor = makeApplyAnchor({
  applyDates: { 1: '2026-06-10' },
  events: [event(1, '2026-06-05', 'Applied')],
});
check(JSON.stringify(anchor(app(1, '2026-06-01'))) === JSON.stringify({ date: '2026-06-05', source: 'both' }),
  'the minimum sidecar date wins and reports both sources');

const fallback = makeApplyAnchor({ applyDates: {}, events: [] });
check(JSON.stringify(fallback(app(2, '2026-06-02'))) === JSON.stringify({ date: '2026-06-02', source: 'row-date' }),
  'the tracker date is used only when neither sidecar resolves');

const noAnchor = stats([app(3, null)]);
check(noAnchor.population.n === 0 && noAnchor.population.noAnchor === 1,
  'an application without an anchor is outside the population');

const closed = stats([app(4, '2026-05-01', 'Closed')], { 4: '2026-05-02' });
check(closed.population.n === 0 && closed.population.closedExcluded === 1
  && closed.silence['14'].eligible === 0 && closed.fastDecision.eligible === 0,
  'Closed is reported and excluded from every denominator');

const young = stats([app(5, '2026-07-08')], { 5: '2026-07-08' });
check(young.silence['14'].eligible === 0 && young.silence['14'].pct === null,
  'applications younger than 14 days are censored, with a null empty rate');

const day15 = stats(
  [app(6, '2026-06-01', 'Rejected')],
  { 6: '2026-06-01' },
  [event(6, '2026-06-16', 'Rejected')],
);
check(day15.silence['14'].silent === 1 && day15.silence['30'].silent === 0,
  'a day 15 decision is silent at 14 days and decided at 30 days');

const day14 = stats(
  [app(7, '2026-06-01', 'Rejected')],
  { 7: '2026-06-01' },
  [event(7, '2026-06-15', 'Rejected')],
);
check(day14.silence['14'].eligible === 1 && day14.silence['14'].silent === 0,
  'a decision exactly on day 14 is inside the window');

const preAnchor = stats(
  [app(8, '2026-06-10', 'Rejected')],
  { 8: '2026-06-10' },
  [event(8, '2026-06-09', 'Rejected')],
);
check(preAnchor.population.preAnchorDropped === 1 && preAnchor.fastDecision.decided === 0,
  'a pre-anchor decision is dropped and never becomes negative elapsed time');

const undated = stats([app(9, '2026-06-01', 'Rejected')], { 9: '2026-06-01' });
check(undated.silence['14'].eligible === 0 && undated.silence['14'].undated === 1
  && undated.fastDecision.eligible === 0 && undated.fastDecision.undated === 1,
  'an undated decision is disclosed and excluded from numerator and denominator');

const duplicate = stats(
  [app(10, '2026-06-01', 'Rejected')],
  { 10: '2026-06-01' },
  [event(10, '2026-06-02', 'Rejected'), event(10, '2026-06-03', 'Rejected')],
);
check(duplicate.fastDecision.decided === 1 && duplicate.fastDecision.composition.employerNo === 1,
  'duplicate rejection events count as one application decision');

const candidateSide = stats(
  [app(11, '2026-06-01', 'Not a Fit'), app(12, '2026-06-01', 'SKIP')],
  { 11: '2026-06-01', 12: '2026-06-01' },
  [event(11, '2026-06-02', 'Not a Fit'), event(12, '2026-06-02', 'SKIP')],
);
check(candidateSide.fastDecision.composition.candidateSide === 2
  && candidateSide.fastDecision.composition.employerNo === 0,
  'Not a Fit and SKIP are candidate-side decisions, never employer noes');

const advanced = stats(
  [app(13, '2026-06-01', 'Phone Screen')],
  { 13: '2026-06-01' },
  [event(13, '2026-06-03', 'Phone Screen')],
);
check(advanced.fastDecision.composition.advance === 1,
  'Phone Screen counts as an advance without a prior Responded event');

const cohort = stats(
  [app(14, '2026-06-21'), app(15, '2026-07-10')],
  { 14: '2026-06-21', 15: '2026-07-10' },
);
const sundayCohort = cohort.cohorts.find(row => row.week === '2026-06-15');
const emptyCohort = cohort.cohorts.find(row => row.week === '2026-07-06');
check(sundayCohort?.sent === 1, 'cohorts parse Sunday in UTC and key it to the prior Monday');
check(emptyCohort?.silent14Pct === null && emptyCohort?.silent30Pct === null
  && emptyCohort?.decidedFastPct === null,
  'an immature cohort reports null rates instead of zero percent');

const timing = rejectionTimingStats();
check(timing.n === 1 && timing.avgDays === 10 && timing.medianDays === 10,
  'rejection timing now uses the earlier apply-date sidecar anchor');

const read = readResponseProgressStats();
const pure = responseProgressStats({
  apps: parseApplicationsMd(),
  applyDates: readApplyDates(),
  events: parseStatusEvents(),
  today: read.today,
});
check(JSON.stringify(read) === JSON.stringify(pure)
  && read.population && read.silence && read.fastDecision && read.cohorts && read.anchorSources,
  'the reader consumes the tracker and both sidecars and returns the pure shape');

// ── the ghosted-candidate list shares the one anchor rule ───────────────────
// That list gates a bulk destructive "archive to No Response" write, and it used
// to carry its own strict-priority copy of the anchor (apply-date, else event,
// else row date) which returned the apply-date even when the event was earlier.
// It now uses makeApplyAnchor like everything else. The shape below is exactly
// what separates the two rules: an apply-date LATER than its own Applied event.
{
  const gApplyDates = { 7301: '2026-03-20' };
  const gEvents = [{ app: '7301', date: '2026-03-04', status: 'Applied' }];
  const g = makeApplyAnchor({ applyDates: gApplyDates, events: gEvents })({ id: 7301, date: '2026-02-01' });
  check(g.date === '2026-03-04',
    `ghost anchor takes the earlier event over a later apply-date (got ${g.date})`);
  check(g.source === 'both', `both sidecars present is reported as such (got ${g.source})`);
  // The retired rule would have returned 2026-03-20, making the row look 16 days
  // younger than it is and delaying a real archive by that long.
  check(gApplyDates['7301'] !== g.date,
    'the retired priority rule and the shared rule genuinely differ on this shape');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
