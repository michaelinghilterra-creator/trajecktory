import { computeCoreMetrics } from '../lib/metrics/core.mjs';
import { reconcileCore, reconcileSummary } from '../lib/metrics/reconcile.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
const clone = (x) => JSON.parse(JSON.stringify(x));

const ids = [
  'funnel_top_is_rated',
  'rates_share_denominator',
  'funnel_heard_back_is_response',
  'funnel_screen_is_interview_rate',
  'funnel_never_grows',
  'funnel_conversions',
  'positive_within_response',
  'mature_within_all',
  'warm_split_adds_up',
  'rates_are_consistent',
  'this_week_is_last_week_bar',
  'cohorts_are_subsets',
  'score_bands_within_rated',
  'segments_add_up',
];

const core = computeCoreMetrics({
  today: '2030-03-13',
  activities: [
    { kind: 'application', appId: 900001, date: '2030-03-10' },
    { kind: 'application', appId: 900002, date: '2030-02-01' },
    { kind: 'application', appId: 900003, date: '2030-02-03' },
    { kind: 'application', appId: 900004, date: '2030-03-11' },
    { kind: 'application', date: '2030-03-12' },
    { kind: 'followup', date: '2030-03-11' },
    { kind: 'outreach', date: '2030-03-12' },
  ],
  apps: [
    { id: 900001, status: 'Applied', reached: 'Applied', score: 4.2, warm: true },
    { id: 900002, status: 'Rejected', reached: 'Applied', score: 3.1 },
    { id: 900003, status: 'Applied', reached: 'Phone Screen', score: 3.8, archetype: 'Ops', source: 'API Scan' },
    { id: 900004, status: 'Applied', reached: 'Applied', score: 2.4, referral: true },
  ],
  replies: { '900004': [{ sent_on: '2030-03-12', sentiment: 'neutral' }] },
  interviews: [{ appId: 900003, stage: 'Phone Screen', state: 'counted', held_on: '2030-02-20' }],
  unserviced: { available: true, count: 2 },
  contacts: [
    { channel: 'email', touched: true, replied: true },
    { channel: 'linkedin', touched: true, replied: false },
  ],
});

check(core.ratedApplications === 4 && core.unlinkedApplications === 1 && core.funnel[1].n === 3 && core.thisWeek.applications === 3, 'the fixture really holds four rated applications, one unlinked, three heard back');
const results = reconcileCore(core);
check(results.every(result => result.ok), 'the realistic fixture passes every reconciliation');
check(results.length === 14, 'there are exactly 14 reconciliation results');
check(JSON.stringify(results.map(result => result.id)) === JSON.stringify(ids), 'the reconciliation ids are in the required order');
check(JSON.stringify(reconcileSummary(results)) === JSON.stringify({ ok: true, total: 14, failed: [] }), 'the passing summary has the expected shape');

const emptyResults = reconcileCore(computeCoreMetrics({ today: '2030-03-13' }));
check(emptyResults.every(result => result.ok), 'an empty computed core reconciles');

function tamper(id, change) {
  const value = clone(core);
  change(value);
  const summary = reconcileSummary(reconcileCore(value));
  check(summary.failed.includes(id) && summary.ok === false, `${id} detects its tamper`);
}

tamper('funnel_top_is_rated', value => { value.funnel[0].n += 1; });
tamper('rates_share_denominator', value => { value.results.positive.all.n += 1; });
tamper('funnel_heard_back_is_response', value => { value.funnel[1].n -= 1; });
tamper('funnel_screen_is_interview_rate', value => { value.funnel[2].n += 1; });
tamper('funnel_never_grows', value => { value.funnel[3].n = value.funnel[2].n + 5; });
tamper('funnel_conversions', value => { value.funnel[1].ofPrev += 1; });
tamper('positive_within_response', value => { value.results.positive.all.k = value.results.response.all.k + 1; });
tamper('mature_within_all', value => { value.results.response.mature.n = value.results.response.all.n + 1; });
tamper('warm_split_adds_up', value => { value.results.response.warm.n += 1; });
tamper('rates_are_consistent', value => { value.results.referral.all.pct += 1; });
tamper('this_week_is_last_week_bar', value => { value.thisWeek.followups += 1; });
tamper('cohorts_are_subsets', value => {
  const cohort = value.weeks[value.weeks.length - 1].cohort;
  cohort.screened = cohort.responded + 1;
});
tamper('score_bands_within_rated', value => { value.scoreBands.bands[0].applied = value.scoreBands.bands[0].total + 1; });
tamper('segments_add_up', value => { value.segments.source.small.n += 1; });

const missingFunnel = clone(core);
delete missingFunnel.funnel;
const missingResult = reconcileCore(missingFunnel).find(result => result.id === 'funnel_top_is_rated');
check(missingResult.ok === false && missingResult.detail === 'missing', 'a missing funnel is reported without throwing');
const nullResults = reconcileCore(null);
check(nullResults.length === 14 && nullResults.every(result => !result.ok), 'a null core returns 14 failed results without throwing');
const objectResults = reconcileCore({});
check(objectResults.length === 14 && objectResults.every(result => !result.ok), 'an empty object returns 14 failed results without throwing');

console.log(`metrics-reconcile: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
