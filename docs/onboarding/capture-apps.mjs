/**
 * capture-apps.mjs: the single invented tracker every guide figure renders from,
 * plus the Overview/Analytics payload computed from it by the app's OWN metrics
 * code (lib/metrics/core.mjs), so every number on screen ties out the way it
 * does in the product.
 *
 * Every company below is a well-known fictional or placeholder name. None is a
 * real employer from any search. Re-run the blind-spot check if you add names.
 */
import { FIXTURES as F } from './capture-dashboard.mjs';
import { computeCoreMetrics } from '../../lib/metrics/core.mjs';
import { METRICS } from '../../lib/metrics/dictionary.mjs';
import { reconcileCore, reconcileSummary } from '../../lib/metrics/reconcile.mjs';

export const TODAY = '2026-07-22'; // matches FROZEN_NOW in capture-lib.mjs

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// [company, role, score, status, reached, archetype, sector, source, comp, seniority, remote, date, applied]
const EXTRA = [
  ['Hooli Systems',       'Director, Revenue Operations',      4.0, 'Applied',       'Applied',       'RevOps',    'SaaS',          'Greenhouse', '$152,500 - $175,000', 'Director', 'Remote', '2026-06-17', true],
  ['Wayne Logistics',     'Senior Manager, RevOps',            3.8, 'Rejected',      'Phone Screen',  'RevOps',    'Logistics',     'Lever',      '$135,000 - $160,000', 'Manager',  'Hybrid', '2026-06-18', true],
  ['Oscorp Health',       'Head of GTM Analytics',             4.1, '1st Interview', '1st Interview', 'Analytics', 'Health tech',   'Ashby',      '$175,000 - $205,000', 'Director', 'Remote', '2026-06-22', true],
  ['Tyrell Robotics',     'VP, Sales Operations',              4.5, 'Phone Screen',  'Phone Screen',  'SalesOps',  'Robotics',      'Greenhouse', '$200,000 - $240,000', 'VP',       'Remote', '2026-06-25', true],
  ['Cyberdyne Cloud',     'Director, Revenue Enablement',      3.5, 'Applied',       'Applied',       'RevOps',    'SaaS',          'Website',    'Not Stated',          'Director', 'Hybrid', '2026-06-26', true],
  ['Massive Dynamic',     'Sr. Director, GTM Strategy',        4.2, 'Applied',       'Applied',       'Strategy',  'Industrial',    'Greenhouse', '$182,500 - $210,000', 'Director', 'Remote', '2026-06-29', true],
  ['Aperture Labs',       'Director of Analytics',             3.9, 'Rejected',      'Applied',       'Analytics', 'Research',      'Ashby',      '$160,000 - $185,000', 'Director', 'Onsite', '2026-06-30', true],
  ['Dunder Paper Co',     'Manager, Sales Operations',         3.3, 'No Response',   'Applied',       'SalesOps',  'Distribution',  'Lever',      '$110,000 - $130,000', 'Manager',  'Onsite', '2026-07-01', true],
  ['Wernham Group',       'Director, Business Operations',     3.7, 'Applied',       'Applied',       'Strategy',  'Services',      'Website',    '$145,000 - $170,000', 'Director', 'Hybrid', '2026-07-03', true],
  ['Gringotts Capital',   'Head of Revenue Operations',        4.3, 'Phone Screen',  'Phone Screen',  'RevOps',    'Fintech',       'Greenhouse', '$190,000 - $220,000', 'Director', 'Remote', '2026-07-05', true],
  ['Vandelay Industries', 'RevOps Manager',                    3.2, 'Not a Fit',     'Evaluated',     'RevOps',    'Import/Export', 'Lever',      '$105,000 - $125,000', 'Manager',  'Onsite', '2026-07-07', false],
  ['Bluth Company',       'Director, Sales Strategy',          3.6, 'Evaluated',     'Evaluated',     'Strategy',  'Real estate',   'Ashby',      '$140,000 - $165,000', 'Director', 'Hybrid', '2026-07-09', false],
  ['Sterling Analytics',  'VP, Revenue Operations',            4.4, 'Applied',       'Applied',       'RevOps',    'Media',         'Greenhouse', '$195,000 - $230,000', 'VP',       'Remote', '2026-07-15', true],
  ['Pendant Publishing',  'Sr. Manager, Sales Analytics',      3.4, 'Evaluated',     'Evaluated',     'Analytics', 'Media',         'Website',    'Not Stated',          'Manager',  'Remote', '2026-07-12', false],
  ['Prestige Worldwide',  'Director, GTM Operations',          4.0, 'Evaluated',     'Evaluated',     'RevOps',    'Logistics',     'Lever',      '$160,000 - $190,000', 'Director', 'Remote', '2026-07-13', false],
  ['Duff Beverages',      'Director of Sales Operations',      3.9, 'Applied',       'Applied',       'SalesOps',  'CPG',           'Greenhouse', '$152,500 - $182,500', 'Director', 'Hybrid', '2026-07-21', true],
  ['Rekall Travel',       'Head of Strategy and Operations',   3.1, 'Evaluated',     'Evaluated',     'Strategy',  'Travel',        'Ashby',      '$130,000 - $155,000', 'Director', 'Onsite', '2026-07-15', false],
  ['Monsters Energy',     'Director, Revenue Analytics',       4.1, 'Evaluated',     'Evaluated',     'Analytics', 'Energy',        'Greenhouse', '$170,000 - $200,000', 'Director', 'Remote', '2026-07-16', false],
  ['Planet Express',      'VP, Customer Operations',           3.8, 'Applied',       'Applied',       'Strategy',  'Logistics',     'Lever',      '$185,000 - $215,000', 'VP',       'Hybrid', '2026-07-20', true],
  ['Los Alamos Ventures', 'RevOps Lead',                       2.9, 'Not a Fit',     'Evaluated',     'RevOps',    'Venture',       'Website',    '$115,000 - $135,000', 'Manager',  'Onsite', '2026-07-18', false],
];

// The Source column records how a role was found, not the job board it sits on:
// self-sourced, API Scan or Agent Scan. Map the board names once, here, so every
// figure agrees.
const SOURCE_BY_BOARD = { Greenhouse: 'Self-sourced', Website: 'Self-sourced', Lever: 'API Scan', Ashby: 'Agent Scan' };

const RAW_APPS = [
  ...F.APPS,
  ...EXTRA.map((r, i) => {
    const [company, role, score, status, reached, archetype, sector, source, compStated, seniority, remote, date, applied] = r;
    const id = 300 + i * 3;
    return {
      id, date, company, role, score, status, archetype, sector, source, compStated,
      url: `https://jobs.example.com/${slug(company)}-${slug(role)}`,
      report: `reports/${id}-${slug(company)}-${date}.md`,
      resume: applied ? 'trajecktory' : '', seniority, remote, reached,
    };
  }),
];
export const APPS = RAW_APPS
  .map(a => ({ ...a, source: SOURCE_BY_BOARD[a.source] || a.source }))
  .sort((a, b) => (a.date < b.date ? 1 : -1));

export const APPLIED_IDS = new Set(APPS.filter(a => a.reached !== 'Evaluated').map(a => String(a.id)));

export function corePayload() {
  const activities = APPS.filter(a => APPLIED_IDS.has(String(a.id)))
    .map(a => ({ kind: 'application', date: a.date, appId: a.id }));
  // A few follow-ups and outreach actions this week so the "This week" tiles are non-zero.
  for (const d of ['2026-07-20', '2026-07-21', '2026-07-22']) {
    activities.push({ kind: 'followup', date: d, appId: 401 });
    activities.push({ kind: 'outreach', date: d, appId: null });
  }
  const apps = APPS.map(a => ({
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
  const reconcileChecks = reconcileCore(core);
  return { ...core, dictionary: METRICS, reconcile: reconcileSummary(reconcileChecks), reconcileChecks };
}
