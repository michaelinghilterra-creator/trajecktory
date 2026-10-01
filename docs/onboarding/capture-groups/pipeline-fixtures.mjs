/**
 * pipeline-fixtures.mjs: invented data for the Pipeline sub-tab captures
 * (Overview, Roles, Discovery, Analytics).
 *
 * Everything here derives from the single invented tracker in capture-apps.mjs
 * so the numbers tie out with /api/metrics/core. The response-progress payload
 * is computed below with the same rule the server uses
 * (dashboard-web/server/lib/response-timing.mjs): the apply date is the anchor,
 * the first employer decision is a Rejected or a screen-or-later status event,
 * silence is "no employer decision inside the window", and only applications
 * old enough to judge are counted.
 */
import { APPS, APPLIED_IDS, TODAY } from '../capture-apps.mjs';
import { FIXTURES as F } from '../capture-dashboard.mjs';
import { computeCoreMetrics } from '../../../lib/metrics/core.mjs';
import { METRICS } from '../../../lib/metrics/dictionary.mjs';
import { reconcileCore, reconcileSummary } from '../../../lib/metrics/reconcile.mjs';

// == Setup state: a saved compensation profile so the Analytics comp card draws bands.
export const STATE_READY_WITH_COMP = {
  ...F.STATE_READY,
  values: {
    ...F.STATE_READY.values,
    compensation: { minimum: '$130,000', target_range: '$160,000 - $200,000' },
  },
};

// == Status events: the dated decisions behind the response-progress card.
// [appId, status, date]. One first employer decision per row where one exists.
// Dates are when the employer's answer arrived (the booking or notice date).
const EVENTS = [
  [303, 'Rejected',      '2026-07-02'], // Wayne Logistics: no, 14 days after applying
  [306, 'Phone Screen',  '2026-06-25'], // Oscorp Health: 3 days
  [309, 'Phone Screen',  '2026-06-28'], // Tyrell Robotics: 3 days
  [318, 'Rejected',      '2026-07-03'], // Aperture Labs: 3 days
  [327, 'Phone Screen',  '2026-07-10'], // Gringotts Capital: 5 days
  [386, 'Phone Screen',  '2026-07-01'], // Vertex Foods: 7 days, rejected later
  [386, 'Rejected',      '2026-07-08'],
  [405, 'Phone Screen',  '2026-07-10'], // Contoso Freight: 2 days
  [408, 'Phone Screen',  '2026-07-20'], // Globex Health: 14 days
  [412, 'Phone Screen',  '2026-07-07'], // Northwind Analytics: 5 days
];

const DAY = 86400000;
const ms = (ymd) => Date.parse(`${ymd}T00:00:00Z`);
const daysBetween = (a, b) => Math.round((ms(b) - ms(a)) / DAY);
const pct = (k, n) => (n ? Math.round((k / n) * 1000) / 10 : null);
const fmtYmd = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
// Weeks start on Sunday, matching the metrics payload.
const weekStart = (ymd) => {
  const d = new Date(ms(ymd));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return fmtYmd(d);
};

export function responseProgress() {
  const applied = APPS.filter(a => APPLIED_IDS.has(String(a.id)));
  const records = applied.map(a => {
    const evs = EVENTS.filter(e => e[0] === a.id).sort((x, y) => (x[2] < y[2] ? -1 : 1));
    const first = evs[0] ? { days: daysBetween(a.date, evs[0][2]), status: evs[0][1] } : null;
    return {
      app: a,
      age: daysBetween(a.date, TODAY),
      decision: first && first.days >= 0 ? first : null,
      bucket: first ? (first.status === 'Rejected' ? 'employerNo' : 'advance') : null,
      week: weekStart(a.date),
    };
  });

  const silence = {};
  for (const w of [14, 30]) {
    const eligible = records.filter(r => r.age >= w);
    const silent = eligible.filter(r => !r.decision || r.decision.days > w);
    silence[String(w)] = { eligible: eligible.length, silent: silent.length, pct: pct(silent.length, eligible.length), undated: 0 };
  }

  const fastDays = 3;
  const fastPool = records.filter(r => r.age >= fastDays);
  const fast = fastPool.filter(r => r.decision && r.decision.days <= fastDays);
  const composition = { employerNo: 0, advance: 0, candidateSide: 0 };
  for (const r of fast) composition[r.bucket]++;

  const byWeek = new Map();
  for (const r of records) {
    const c = byWeek.get(r.week) || { week: r.week, sent: 0, silent14: 0, silent30: 0, decidedFast: 0, undated: 0, e14: 0, e30: 0, eFast: 0 };
    c.sent++;
    if (r.age >= 14) { c.e14++; if (!r.decision || r.decision.days > 14) c.silent14++; }
    if (r.age >= 30) { c.e30++; if (!r.decision || r.decision.days > 30) c.silent30++; }
    if (r.age >= fastDays) { c.eFast++; if (r.decision && r.decision.days <= fastDays) c.decidedFast++; }
    byWeek.set(r.week, c);
  }
  const cohorts = [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week)).map(c => ({
    week: c.week, sent: c.sent, silent14: c.silent14, silent30: c.silent30, decidedFast: c.decidedFast, undated: 0,
    silent14Pct: pct(c.silent14, c.e14), silent30Pct: pct(c.silent30, c.e30), decidedFastPct: pct(c.decidedFast, c.eFast),
  }));

  return {
    today: TODAY,
    fastDays,
    population: { n: records.length, closedExcluded: 0, noAnchor: 0, preAnchorDropped: 0 },
    candidateDecided: 0,
    silence,
    fastDecision: { eligible: fastPool.length, decided: fast.length, pct: pct(fast.length, fastPool.length), undated: 0, composition },
    cohorts,
    anchorSources: { both: 0, event: 0, applyDate: records.length, rowDate: 0, twc: 0 },
  };
}

/** Days from applying to a Rejected event, the same shape /api/insights/rejection-timing returns. */
export function rejectionTiming() {
  const days = [];
  for (const [id, status, date] of EVENTS) {
    if (status !== 'Rejected') continue;
    const a = APPS.find(x => x.id === id);
    days.push(daysBetween(a.date, date));
  }
  days.sort((x, y) => x - y);
  const mid = Math.floor(days.length / 2);
  const median = days.length % 2 ? days[mid] : (days[mid - 1] + days[mid]) / 2;
  const avg = Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10;
  return { n: days.length, avgDays: avg, medianDays: median, excluded: 0 };
}

// == Discovery inbox: what a scan found but has not evaluated yet.
// Counts mirror the sidebar's "7 pending" so the two surfaces agree.
// Rows with a local: url have a saved JD snapshot (the "readable" hint).
const pend = (dateAdded, company, title, url, readable = false) => ({
  url: readable ? `local:jds/${url}.md` : `https://jobs.example.com/${url}`, company, title, readable, dateAdded,
});
const dead = (dateAdded, company, title, url, reason) => ({
  url: `https://jobs.example.com/${url}`, company, title, reason, dateAdded,
});

export const INBOX = {
  counts: { pending: 7, gated: 4, done: 38 },
  pending: [
    pend('2026-07-22', 'Pied Piper Data',      'Director, Revenue Operations',        'pied-piper-data-director-revenue-operations', true),
    pend('2026-07-22', 'Nakatomi Trading',     'Head of Sales Operations',            'nakatomi-trading-head-of-sales-operations', true),
    pend('2026-07-21', 'Weyland Systems',      'VP, GTM Strategy and Operations',     'weyland-systems-vp-gtm-strategy'),
    pend('2026-07-21', 'Wonka Industries',     'Senior Manager, Revenue Analytics',   'wonka-industries-sr-manager-revenue-analytics'),
    pend('2026-07-20', 'Spacely Sprockets',    'Director, Business Operations',       'spacely-sprockets-director-business-operations'),
    pend('2026-07-20', 'Initrode Software',    'RevOps Systems Lead',                 'initrode-software-revops-systems-lead'),
    pend('2026-07-19', 'Cogswell Cogs',        'Director of Sales Strategy',          'cogswell-cogs-director-sales-strategy'),
  ],
  gated: [
    dead('2026-07-21', 'Buy n Large',          'Director, Revenue Operations',        'buy-n-large-director-revenue-operations', 'gated: closed (posting removed)'),
    dead('2026-07-20', 'Zorblax Widgetry',     'Head of Revenue Operations',          'zorblax-widgetry-head-of-revenue-operations', 'gated: unsupported ATS platform'),
    dead('2026-07-18', 'Gekko and Partners',   'VP, Sales Operations',                'gekko-partners-vp-sales-operations', 'gated: JD unreadable (login wall)'),
    dead('2026-07-17', 'Dharma Logistics',     'Senior Director, GTM Operations',     'dharma-logistics-sr-director-gtm-operations', 'gated: expired posting (404)'),
  ],
};

// == Source labels ==
// The tracker's Source column holds how a role was found (the pills Self, Ref, CoWork,
// API, Agent), not which job board hosts it. The shared tracker carries board names, so
// this group relabels them for its own screens: enough roles share one source for the
// "What converts" Source table to rate a group, as it would in a real search.
const SOURCE_BY_BOARD = { Greenhouse: 'Self-sourced', Website: 'Self-sourced', Lever: 'API Scan', Ashby: 'Agent Scan' };
export const APPS_PL = APPS.map(a => ({ ...a, source: SOURCE_BY_BOARD[a.source] || a.source }));

/** Same inputs and the same metrics code as capture-apps.mjs corePayload(), with the relabelled sources. */
export function corePayloadPl() {
  const activities = APPS_PL.filter(a => APPLIED_IDS.has(String(a.id)))
    .map(a => ({ kind: 'application', date: a.date, appId: a.id }));
  for (const d of ['2026-07-20', '2026-07-21', '2026-07-22']) {
    activities.push({ kind: 'followup', date: d, appId: 401 });
    activities.push({ kind: 'outreach', date: d, appId: null });
  }
  const apps = APPS_PL.map(a => ({
    id: a.id, status: a.status, reached: a.reached, score: a.score,
    warm: a.inbound === true || a.outbound === true,
    referral: false, archetype: a.archetype, source: a.source,
  }));
  const interviews = [
    { appId: 412, stage: 'Phone Screen', state: 'counted', held_on: '2026-07-07', scheduled_for: '2026-07-07' },
    { appId: 412, stage: '1st Interview', state: 'counted', held_on: '2026-07-14', scheduled_for: '2026-07-14' },
    { appId: 412, stage: '2nd Interview', state: 'scheduled', held_on: null, scheduled_for: '2026-07-24' },
    { appId: 408, stage: 'Phone Screen', state: 'counted', held_on: '2026-07-21', scheduled_for: '2026-07-21' },
    { appId: 405, stage: 'Phone Screen', state: 'counted', held_on: '2026-07-10', scheduled_for: '2026-07-10' },
    { appId: 405, stage: '1st Interview', state: 'counted', held_on: '2026-07-15', scheduled_for: '2026-07-15' },
  ];
  const replies = {
    401: [{ sent_on: '2026-07-15', sentiment: 'neutral' }],
    397: [{ sent_on: '2026-07-18', sentiment: 'positive' }],
  };
  const contacts = [
    ...Array.from({ length: 12 }, (_, i) => ({ channel: 'linkedin', touched: true, replied: i < 4, bounced: false })),
    ...Array.from({ length: 10 }, (_, i) => ({ channel: 'email', touched: true, replied: i < 2, bounced: false })),
  ];
  const core = computeCoreMetrics({
    today: TODAY, activities, apps, replies, interviews,
    unserviced: { available: true, count: 6 }, contacts,
  });
  const checks = reconcileCore(core);
  return { ...core, dictionary: METRICS, reconcile: reconcileSummary(checks), reconcileChecks: checks };
}
