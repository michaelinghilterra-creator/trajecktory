import {
  rate, daysBetween, applicationOutcomes, segments, scoreBands, outreachReplyRate, computeCoreMetrics,
} from '../lib/metrics/core.mjs';
import { METRICS, metricDef, DEFINITIONS_VERSION } from '../lib/metrics/dictionary.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Item 1: rate(0, 0)
check(eq(rate(0, 0), { k: 0, n: 0, pct: null, lo: null, hi: null, sufficient: false }), 'rate(0, 0) equals expected');

// Item 2: rate(3, 12)
check(eq(rate(3, 12), { k: 3, n: 12, pct: 25, lo: 9, hi: 53, sufficient: true }), 'rate(3, 12) equals expected');

// Item 3: rate(1, 4)
check(eq(rate(1, 4), { k: 1, n: 4, pct: 25, lo: 5, hi: 70, sufficient: false }), 'rate(1, 4) equals expected');
check(rate(0, 10).sufficient === true, 'rate(0, 10).sufficient is true');
check(rate(0, 10).pct === 0, 'rate(0, 10).pct is 0');
check(rate(9, 9, 10).sufficient === false, 'rate(9, 9, 10).sufficient is false');

// Item 4: daysBetween
check(daysBetween('2030-02-27', '2030-03-01') === 2, 'daysBetween 2030-02-27 to 2030-03-01 is 2');
check(daysBetween('2030-03-10', '2030-03-03') === -7, 'daysBetween 2030-03-10 to 2030-03-03 is -7');

// Item 5: applicationOutcomes filtering
const activities5 = [
  { kind: 'application', date: '2030-03-02', appId: 900001 },
  { kind: 'application', date: '2030-03-02', appId: 900001 },
  { kind: 'application', date: 'bad', appId: 900009 },
  { kind: 'followup', date: '2030-03-02', appId: 900001 },
];
const apps5 = [{ id: 900001, status: 'Applied', reached: 'Applied' }];
const out5 = applicationOutcomes({ activities: activities5, apps: apps5 });
check(out5.length === 1, 'applicationOutcomes returns 1 row');
check(eq(out5[0], { appId: '900001', date: '2030-03-02', level: 0, positive: false, warm: false, referral: false, archetype: 'Unclassified', source: 'Unknown' }), 'applicationOutcomes row matches expected');

// Item 6: Outcome levels
// 6a: neutral reply
const replies6a = { '900001': [{ sent_on: '2030-03-04', sentiment: 'neutral' }] };
const apps6a = [{ id: 900001, status: 'Applied', reached: 'Applied' }];
const out6a = applicationOutcomes({ activities: [{ kind: 'application', date: '2030-03-02', appId: 900001 }], apps: apps6a, replies: replies6a });
check(out6a[0].level === 1, 'neutral reply gives level 1');
check(out6a[0].positive === false, 'neutral reply gives positive false');

// 6b: positive reply
const replies6b = { '900001': [{ sent_on: '2030-03-04', sentiment: 'positive' }] };
const out6b = applicationOutcomes({ activities: [{ kind: 'application', date: '2030-03-02', appId: 900001 }], apps: apps6a, replies: replies6b });
check(out6b[0].level === 1, 'positive reply gives level 1');
check(out6b[0].positive === true, 'positive reply gives positive true');

// 6c: Rejected status
const apps6c = [{ id: 900001, status: 'Rejected', reached: 'Applied' }];
const out6c = applicationOutcomes({ activities: [{ kind: 'application', date: '2030-03-02', appId: 900001 }], apps: apps6c });
check(out6c[0].level === 1, 'Rejected status gives level 1');
check(out6c[0].positive === false, 'Rejected status gives positive false');

// 6d: Phone Screen reached
const apps6d = [{ id: 900001, status: 'Applied', reached: 'Phone Screen' }];
const out6d = applicationOutcomes({ activities: [{ kind: 'application', date: '2030-03-02', appId: 900001 }], apps: apps6d });
check(out6d[0].level === 1, 'Phone Screen reached gives level 1');
check(out6d[0].positive === true, 'Phone Screen reached gives positive true');

// 6e: scheduled interview
const interviews6e = [{ appId: 900001, stage: 'Phone Screen', state: 'scheduled' }];
const out6e = applicationOutcomes({ activities: [{ kind: 'application', date: '2030-03-02', appId: 900001 }], apps: apps6a, interviews: interviews6e });
check(out6e[0].level === 1, 'scheduled interview gives level 1');
check(out6e[0].positive === true, 'scheduled interview gives positive true');

// 6f: counted phone screen
const interviews6f = [{ appId: 900001, stage: 'Phone Screen', state: 'counted', held_on: '2030-03-05' }];
const out6f = applicationOutcomes({ activities: [{ kind: 'application', date: '2030-03-02', appId: 900001 }], apps: apps6a, interviews: interviews6f });
check(out6f[0].level === 2, 'counted phone screen gives level 2');

// 6g: counted later interview
const interviews6g = [{ appId: 900001, stage: '1st Interview', state: 'counted', held_on: '2030-03-05' }];
const out6g = applicationOutcomes({ activities: [{ kind: 'application', date: '2030-03-02', appId: 900001 }], apps: apps6a, interviews: interviews6g });
check(out6g[0].level === 3, 'counted later interview gives level 3');

// 6h: unconfirmed later interview
const interviews6h = [{ appId: 900001, stage: '1st Interview', state: 'unconfirmed' }];
const out6h = applicationOutcomes({ activities: [{ kind: 'application', date: '2030-03-02', appId: 900001 }], apps: apps6a, interviews: interviews6h });
check(out6h[0].level === 1, 'unconfirmed later interview gives level 1');

// 6i: Offer
const apps6i = [{ id: 900001, status: 'Applied', reached: 'Offer' }];
const out6i = applicationOutcomes({ activities: [{ kind: 'application', date: '2030-03-02', appId: 900001 }], apps: apps6i });
check(out6i[0].level === 4, 'Offer gives level 4');

// 6j: warm/referral carried
const apps6j = [{ id: 900001, status: 'Applied', reached: 'Applied', warm: true, referral: true, archetype: 'Ops', source: 'Referral' }];
const out6j = applicationOutcomes({ activities: [{ kind: 'application', date: '2030-03-02', appId: 900001 }], apps: apps6j });
check(out6j[0].warm === true, 'warm is carried');
check(out6j[0].referral === true, 'referral is carried');
check(out6j[0].archetype === 'Ops', 'archetype is carried');
check(out6j[0].source === 'Referral', 'source is carried');

// Item 7: segments
const rows7 = [];
for (let i = 0; i < 3; i++) rows7.push({ archetype: 'A', level: 2 });
for (let i = 0; i < 5; i++) rows7.push({ archetype: 'A', level: 1 });
for (let i = 0; i < 4; i++) rows7.push({ archetype: 'A', level: 0 });
for (let i = 0; i < 4; i++) rows7.push({ archetype: 'B', level: 0 });
const seg7 = segments(rows7, 'archetype');
check(seg7.rows.length === 1, 'segments returns 1 row');
check(seg7.rows[0].key === 'A', 'segments key is A');
check(seg7.rows[0].n === 12, 'segments n is 12');
check(seg7.rows[0].response.k === 8, 'segments response.k is 8');
check(seg7.rows[0].interview.k === 3, 'segments interview.k is 3');
check(eq(seg7.small, { groups: 1, n: 4 }), 'segments small is correct');
const seg7b = segments(rows7, 'archetype', 3);
check(seg7b.rows.length === 2, 'segments with minN 3 returns 2 rows');
check(seg7b.rows[0].n >= seg7b.rows[1].n, 'segments larger first');

// Item 8: scoreBands
const apps8 = [
  { id: 1, score: 5 },
  { id: 2, score: 1 },
  { id: 3, score: 4.49 },
  { id: 4, score: 0.5 },
  { id: 5, score: '' },
  { id: 6, score: '3.2' },
];
const appliedIds8 = new Set(['1', '6']);
const sb8 = scoreBands(apps8, appliedIds8);
check(sb8.bands.length === 8, 'scoreBands has 8 bands');
check(sb8.bands[0].lo === 1, 'scoreBands first lo is 1');
check(sb8.bands[7].lo === 4.5, 'scoreBands last lo is 4.5');
check(eq(sb8.bands.map(b => b.total), [1, 0, 0, 0, 1, 0, 1, 1]), 'scoreBands totals correct');
check(eq(sb8.bands.map(b => b.applied), [0, 0, 0, 0, 1, 0, 0, 1]), 'scoreBands applied correct');
check(sb8.unscored === 2, 'scoreBands unscored is 2');
check(eq(sb8.appliedAvg, { value: 4.1, n: 2, version: null }), 'scoreBands appliedAvg correct');

// scoreBands with scorerVersion
const apps8b = [
  { id: 1, score: 4, scorerVersion: 'v2' },
  { id: 2, score: 3, scorerVersion: 'v2' },
  { id: 3, score: 5, scorerVersion: 'v1' },
];
const appliedIds8b = new Set(['1', '2', '3']);
const sb8b = scoreBands(apps8b, appliedIds8b);
check(eq(sb8b.appliedAvg, { value: 3.5, n: 2, version: 'v2' }), 'scoreBands appliedAvg with version correct');

// Item 9: outreachReplyRate
const contacts9 = [
  { channel: 'email', touched: true, replied: true },
  { channel: 'email', touched: true, bounced: true, replied: true },
  { channel: 'email', touched: false, replied: true },
  { channel: 'linkedin', touched: true, bounced: true, replied: false },
];
const orr9 = outreachReplyRate(contacts9);
check(orr9.email.k === 1, 'outreachReplyRate email.k is 1');
check(orr9.email.n === 1, 'outreachReplyRate email.n is 1');
check(orr9.linkedin.k === 0, 'outreachReplyRate linkedin.k is 0');
check(orr9.linkedin.n === 1, 'outreachReplyRate linkedin.n is 1');
const orr9b = outreachReplyRate([]);
check(orr9b.email.pct === null, 'outreachReplyRate empty email pct is null');
check(orr9b.linkedin.pct === null, 'outreachReplyRate empty linkedin pct is null');

// Item 10: computeCoreMetrics throws TypeError
try {
  computeCoreMetrics({ today: 'bad-date' });
  check(false, 'computeCoreMetrics should throw TypeError');
} catch (e) {
  check(e instanceof TypeError, 'computeCoreMetrics throws TypeError');
}

// Item 11: computeCoreMetrics full test
const today11 = '2030-03-13';
const activities11 = [
  { kind: 'application', date: '2030-03-10', appId: 900001 },
  { kind: 'application', date: '2030-02-01', appId: 900002 },
  { kind: 'followup', date: '2030-03-09' },
  { kind: 'outreach', date: '2030-03-08' },
  { kind: 'outreach', date: '2030-03-14' },
];
const apps11 = [
  { id: 900001, status: 'Applied', reached: 'Applied', score: 4.2 },
  { id: 900002, status: 'Rejected', reached: 'Applied', score: 3.1, warm: true },
  { id: 900003, status: 'Evaluated', score: null },
];
const interviews11 = [{ appId: 900001, stage: 'Phone Screen', state: 'counted', held_on: '2030-03-12' }];
const unserviced11 = { available: true, count: 3 };
const metrics11 = computeCoreMetrics({ today: today11, activities: activities11, apps: apps11, interviews: interviews11, unserviced: unserviced11 });

check(eq(metrics11.week, { from: '2030-03-10', to: '2030-03-16' }), 'computeCoreMetrics week correct');
check(metrics11.version === DEFINITIONS_VERSION, 'computeCoreMetrics version correct');
check(eq(metrics11.thisWeek, { applications: 1, followups: 0, linkedin: 1, screensHeld: 1, screensUnconfirmed: 0, unserviced: { available: true, count: 3 } }), 'computeCoreMetrics thisWeek correct');
check(eq(metrics11.funnel.map(f => f.id), ['applications', 'responded', 'screen_held', 'interview_held', 'offer']), 'computeCoreMetrics funnel ids correct');
check(eq(metrics11.funnel.map(f => f.n), [2, 2, 1, 0, 0]), 'computeCoreMetrics funnel n correct');
check(eq(metrics11.funnel.map(f => f.ofPrev), [null, 100, 50, 0, null]), 'computeCoreMetrics funnel ofPrev correct');
check(metrics11.results.response.all.k === 2, 'computeCoreMetrics response.all.k is 2');
check(metrics11.results.response.all.n === 2, 'computeCoreMetrics response.all.n is 2');
check(metrics11.results.response.mature.n === 1, 'computeCoreMetrics response.mature.n is 1');
check(metrics11.results.response.warm.n === 1, 'computeCoreMetrics response.warm.n is 1');
check(metrics11.results.interview.all.k === 1, 'computeCoreMetrics interview.all.k is 1');
check(metrics11.weeks.length === 8, 'computeCoreMetrics weeks length is 8');
const lastWeek11 = metrics11.weeks[7];
check(lastWeek11.from === '2030-03-10', 'computeCoreMetrics last week from correct');
check(lastWeek11.applications === 1, 'computeCoreMetrics last week applications is 1');
check(lastWeek11.screensHeld === 1, 'computeCoreMetrics last week screensHeld is 1');
check(eq(lastWeek11.cohort, { n: 1, responded: 1, screened: 1, ageDays: 0, mature: false }), 'computeCoreMetrics last week cohort correct');
check(metrics11.scoreBands.unscored === 1, 'computeCoreMetrics scoreBands unscored is 1');

// Item 12: unserviced omitted or false
const metrics12a = computeCoreMetrics({ today: '2030-03-13', activities: [], apps: [], interviews: [] });
check(eq(metrics12a.thisWeek.unserviced, { available: false, count: null }), 'computeCoreMetrics unserviced omitted correct');
const metrics12b = computeCoreMetrics({ today: '2030-03-13', activities: [], apps: [], interviews: [], unserviced: { available: false, count: 7 } });
check(eq(metrics12b.thisWeek.unserviced, { available: false, count: null }), 'computeCoreMetrics unserviced false correct');

// Item 13: unconfirmed interviews
const interviews13a = [{ appId: 900001, stage: 'Phone Screen', state: 'unconfirmed', held_on: '2030-03-11' }];
const metrics13a = computeCoreMetrics({ today: '2030-03-13', activities: [], apps: [], interviews: interviews13a });
check(metrics13a.thisWeek.screensUnconfirmed === 1, 'computeCoreMetrics unconfirmed screensUnconfirmed is 1');
check(metrics13a.thisWeek.screensHeld === 0, 'computeCoreMetrics unconfirmed screensHeld is 0');
const interviews13b = [{ appId: 900001, stage: 'Phone Screen', state: 'unconfirmed', scheduled_for: '2030-03-15' }];
const metrics13b = computeCoreMetrics({ today: '2030-03-13', activities: [], apps: [], interviews: interviews13b });
check(metrics13b.thisWeek.screensUnconfirmed === 1, 'computeCoreMetrics scheduled unconfirmed screensUnconfirmed is 1');

// Item 14: weeks array length and cohort ageDays
const metrics14a = computeCoreMetrics({ today: '2030-03-13', activities: [], apps: [], interviews: [], weeks: 3 });
check(metrics14a.weeks.length === 3, 'computeCoreMetrics weeks length is 3');
check(metrics14a.weeks[0].from === '2030-02-24', 'computeCoreMetrics first week from is 2030-02-24');
const metrics14b = computeCoreMetrics({ today: '2030-03-13', activities: [], apps: [], interviews: [] });
const weekFeb17 = metrics14b.weeks.find(w => w.from === '2030-02-17');
check(weekFeb17.cohort.ageDays === 18, 'computeCoreMetrics 2030-02-17 cohort ageDays is 18');
check(weekFeb17.cohort.mature === true, 'computeCoreMetrics 2030-02-17 cohort mature is true');
const weekMar03 = metrics14b.weeks.find(w => w.from === '2030-03-03');
check(weekMar03.cohort.ageDays === 4, 'computeCoreMetrics 2030-03-03 cohort ageDays is 4');
check(weekMar03.cohort.mature === false, 'computeCoreMetrics 2030-03-03 cohort mature is false');
check(weekMar03.cohort.n === 0, 'computeCoreMetrics 2030-03-03 cohort n is 0');

// Item 15: Dictionary checks
check(METRICS.length > 0, 'METRICS has entries');
const ids = new Set();
for (const m of METRICS) {
  check(typeof m.id === 'string' && m.id.length > 0, `METRICS ${m.id} id is non-empty string`);
  check(typeof m.label === 'string' && m.label.length > 0, `METRICS ${m.id} label is non-empty string`);
  check(typeof m.definition === 'string' && m.definition.length > 0, `METRICS ${m.id} definition is non-empty string`);
  check(typeof m.formula === 'string' && m.formula.length > 0, `METRICS ${m.id} formula is non-empty string`);
  check(typeof m.window === 'string' && m.window.length > 0, `METRICS ${m.id} window is non-empty string`);
  check(typeof m.why === 'string' && m.why.length > 0, `METRICS ${m.id} why is non-empty string`);
  check(typeof m.do === 'string' && m.do.length > 0, `METRICS ${m.id} do is non-empty string`);
  check(!ids.has(m.id), `METRICS ${m.id} id is unique`);
  ids.add(m.id);
}
check(metricDef('interview_rate').benchmark.source === 'Huntr', 'metricDef interview_rate benchmark source is Huntr');
check(metricDef('nope') === undefined, 'metricDef nope is undefined');
check(metricDef('followups_week').floor === 13, 'metricDef followups_week floor is 13');
check(metricDef('linkedin_week').floor === 50, 'metricDef linkedin_week floor is 50');
check(metricDef('unserviced').limit === 20, 'metricDef unserviced limit is 20');

const requiredIds = ['applications_week', 'followups_week', 'linkedin_week', 'screens_held_week', 'unserviced', 'response_rate', 'positive_rate', 'interview_rate', 'referral_rate', 'outreach_reply_rate', 'funnel', 'weekly_trend', 'score_vs_apply', 'segments'];
for (const id of requiredIds) {
  check(metricDef(id) !== undefined, `metricDef ${id} is defined`);
}

console.log(`metrics-core: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);