/**
 * drawer-fixtures.mjs: everything the per-role report drawer reads, all invented.
 *
 * Shapes follow the current code, not the older fixtures in capture-dashboard.mjs:
 *   - cheat sheet: server/v1-loader.mjs v1ToCheatsheet() and the tabs in
 *     dashboard-web/src/pipeline.jsx (PipelineDrawer). The headline score and the
 *     scoreBasis block are produced by the app's own deriveScore() (lib/score.mjs),
 *     so the breakdown always adds up to the number shown.
 *   - legitimacy is one of the three canonical tiers, 'High Confidence' /
 *     'Proceed with Caution' / 'Suspicious' (the older fixture said 'Verified').
 *   - customization items carry a `section`, STAR stories carry a `req`.
 *   - notes are an ARRAY of { timestamp, text } (the older fixture was an object).
 *   - identity is the real getIdentity() shape (fullName, portfolioUrl, ...).
 *
 * Persona: Jordan Avery. Employers are the fictional names already in
 * capture-apps.mjs.
 */
import { APPS } from '../capture-apps.mjs';
import { deriveScore, DEFAULT_WEIGHTS, DEFAULT_RED_FLAG_PENALTY } from '../../../lib/score.mjs';

// ---- identity (feeds the Quick copy bar) -------------------------------------
export const IDENTITY = {
  fullName: 'Jordan Avery', firstName: 'Jordan', lastName: 'Avery',
  email: 'jordan.avery@example.com', phone: '(555) 010-4477', phoneDisplay: '(555) 010-4477',
  location: 'Austin, TX',
  linkedin: 'https://example.com/in/jordan-avery', linkedinDisplay: 'example.com/in/jordan-avery',
  portfolioUrl: 'https://example.com/jordan', portfolioHost: 'example.com/jordan',
  github: 'https://example.com/jordan-avery-code',
  certifications: ['Certified RevOps Professional'],
  certificationEntries: [{ name: 'Certified RevOps Professional', number: 'EX-10492', expires: '2028-03-31' }],
  headline: 'RevOps leader | GTM systems',
  trajecktoryUrl: 'example.com/jordan/trajecktory',
};

// The profile target band the drawer compares posted pay with (setup/state values).
export const COMPENSATION = { minimum: '$130,000', target_range: '$145,000 to $200,000' };

// ---- tracker rows -------------------------------------------------------------
// Same rows as every other group, plus what the real /api/applications adds from
// the report header (legitimacy) and the tracker notes.
const NOTES_BY_ID = {
  412: 'Applied on the careers page. Recruiter screen held 07-07, first interview 07-14, second interview booked 07-24.',
  408: 'Applied through the recruiter. Phone screen held 07-21.',
  405: 'Referred in. Verbal offer received, written offer due this week.',
  401: 'Applied on the careers page. No reply yet.',
};
const LEGIT_BY_ID = { 397: 'Proceed with Caution' };
export const APP_ROWS = APPS.map((a) => {
  const row = { ...a, legitimacy: LEGIT_BY_ID[a.id] || 'High Confidence', notes: NOTES_BY_ID[a.id] || '' };
  // The real tracker now writes Passed with a reason; one row carries it so the
  // Re-evaluate button (Passed, discarded for a low score, 3.0 to 3.5) can be shown.
  if (a.company === 'Vandelay Industries') { row.status = 'Passed'; row.passedReason = 'low_score'; row.score = 3.3; }
  return row;
});
export const idOf = (company) => APP_ROWS.find((a) => a.company === company).id;

// ---- score derivation -----------------------------------------------------------
const DIM_LABELS = {
  fit: 'Fit / CV Match', northStar: 'North Star Alignment', level: 'Level Match',
  comp: 'Comp', location: 'Location / Logistics', buildDepth: 'Build Depth', redFlags: 'Red flags',
};
function makeScore(dims) {
  const globalScore = dims.map(([key, val, evidence, note]) => {
    const d = { key, dim: DIM_LABELS[key], val, max: 5, evidence };
    if (note) d.note = note;
    return d;
  });
  const out = deriveScore(globalScore, { weights: DEFAULT_WEIGHTS, redFlagPenalty: DEFAULT_RED_FLAG_PENALTY });
  const weightedAverage = Math.round(out.contributions.reduce((s, c) => s + c.points, 0) * 100) / 100;
  return {
    score: out.score,
    globalScore,
    scoreSource: 'derived',
    scoreBasis: {
      weights: { ...DEFAULT_WEIGHTS }, contributions: out.contributions, penalty: out.penalty,
      weightedAverage, uncapped: out.uncapped, ceiling: null, ceilingApplied: false,
    },
  };
}
// Dimensions that derive to exactly `score` (checked below), with plausible spread.
function dimsFor(score, { comp = 4, build = 4 } = {}) {
  for (const fit of [score + 0.2, score + 0.3, score + 0.1, score + 0.4, score]) {
    const f = Math.min(5, Math.round(fit * 10) / 10);
    const dims = [
      ['fit', f, 'Resume lines up with the posted mandate'],
      ['northStar', Math.max(1, Math.round((score - 0.2) * 10) / 10), 'Matches the stated target archetype'],
      ['level', Math.round(score * 10) / 10, 'Title and scope are in range'],
      ['comp', comp, 'Rated against your band, not counted', 'rated, weighted 0'],
      ['location', Math.round(score * 10) / 10, 'Location and remote policy as stated'],
      ['buildDepth', build, 'Hands-on build content is claimable from the resume', 'rated, weighted 0'],
      ['redFlags', 5, 'Clean posting'],
    ];
    if (makeScore(dims).score === score) return dims;
  }
  throw new Error(`no dimension set derives to ${score}`);
}

// ---- the full report for Northwind Analytics (id 412) -----------------------------
const NORTHWIND_DIMS = [
  ['fit', 4.6, 'Ran RevOps for a 200-person logistics business and merged two CRM orgs after an acquisition'],
  ['northStar', 4.4, 'RevOps leadership is the stated target', 'RevOps leadership, your stated target'],
  ['level', 4.5, 'True VP scope, a stretch in the right direction', 'true VP scope'],
  ['comp', 4.6, 'Posted band sits above the target range', 'rated, weighted 0'],
  ['location', 5.0, 'Fully remote within the US', 'fully remote'],
  ['buildDepth', 4.0, 'Light dashboard and SQL building follows patterns already on the resume', 'rated, weighted 0'],
  ['redFlags', 5.0, 'Clean: named hiring manager, disclosed comp, funded', 'clean posting'],
];
const NW = makeScore(NORTHWIND_DIMS);

export const NORTHWIND = {
  url: 'https://jobs.example.com/northwind-vp-revops',
  legitimacy: 'High Confidence',
  legitimacyConclusion: 'High Confidence. Real company, named hiring manager, disclosed comp, and a posting consistent with their funding stage.',
  legitimacySignals: [
    { signal: 'Company registered and trading', finding: 'Founded 2016, active', good: true },
    { signal: 'Compensation disclosed', finding: 'Full band in the posting', good: true },
    { signal: 'Named hiring manager', finding: 'Reports to the CRO', good: true },
    { signal: 'Posting age', finding: 'Reposted once in six weeks', good: false },
  ],
  batchId: null, pdf: null, docx: null,
  archetypeDetected: 'RevOps', domain: 'Logistics', function: 'Revenue Operations',
  seniority: 'VP', remote: 'Remote', teamSize: '6', compStated: '$190,000 - $230,000',
  tldr: 'A genuine step up: first senior RevOps hire under a new CRO, with the systems mess to prove the mandate is real. Comp clears your target. The risk is scope creep into pure analytics.',
  companyBrief: 'Northwind Analytics sells supply-chain visibility to mid-market shippers. Two acquisitions in eighteen months have left three overlapping CRM instances, which is why this role exists. The RevOps function is new, so you would be defining it rather than inheriting it.',
  globalScore: NW.globalScore, scoreSource: NW.scoreSource, scoreBasis: NW.scoreBasis,
  recommendation: 'Apply. Lead with the carrier scorecard rebuild and frame it as consolidation, which is the problem they are actually hiring against.',
  keywords: ['RevOps', 'CRM consolidation', 'forecasting', 'net revenue retention', 'GTM systems', 'post-merger integration'],
  cvMatch: [
    { req: 'Own revenue operations end to end', evidence: 'Ran RevOps for a 200-person logistics business', strength: 'strong' },
    { req: 'Consolidate overlapping CRM instances', evidence: 'Merged two Salesforce orgs after an acquisition', strength: 'strong' },
    { req: 'Build forecasting the exec team trusts', evidence: 'Rebuilt the forecast model; variance fell to single digits', strength: 'strong' },
    { req: 'Manage a team of six', evidence: 'Led four directly, plus two contractors', strength: 'moderate', note: 'slightly smaller team' },
    { req: 'Public-company reporting experience', evidence: 'Private-company only so far', strength: 'weak' },
  ],
  gaps: [
    { gap: 'No public-company reporting', blocker: 'No', mitigation: 'They are private and pre-IPO. Name it before they ask, and point at audit-grade reporting you already built.' },
    { gap: 'Team of four, not six', blocker: 'No', mitigation: 'Talk about span of influence rather than headcount: the scorecard rollout touched thirty people.' },
  ],
  levelMatch: { jdLevel: 'VP', naturalLevel: 'Director / VP', verdict: 'A genuine stretch, in the right direction. Their scope is real VP work, so do not apologise for the title jump.' },
  sellSenior: [
    { claim: 'You have already done the consolidation they are about to attempt', proof: 'Two CRM orgs merged with no reporting downtime', phrase: 'I have run the messy half of this before, and I know where it breaks.' },
    { claim: 'You define functions rather than inherit them', proof: 'Built RevOps from a spreadsheet to a team of four', phrase: 'The first ninety days is deciding what RevOps is here, not tooling.' },
  ],
  downlevelPlan: 'If they offer Senior Director, take it only with a written path to VP inside twelve months and the same base band.',
  comp: {
    stated: '$190K - $230K', score: 4.6, walkaway: 130,
    sources: [
      { src: 'Job posting', data: '$190,000 - $230,000 base', note: 'disclosed, no equity detail' },
      { src: 'Market range, VP RevOps, remote US', data: '$185,000 - $240,000', note: 'mid-market logistics' },
    ],
    verdict: 'Clears your target range at the midpoint and clears your walk-away comfortably. Equity is unstated, so ask early.',
    market: 'Remote VP RevOps roles at this stage cluster tightly. The top of their band is competitive rather than generous.',
  },
  customizationCV: [
    { section: 'Title line', current: 'Director of Revenue Operations', change: 'VP, Revenue Operations (target title)', why: 'Their screen filters on title. You are applying at the level they posted.' },
    { section: 'Professional summary', current: 'Summary leads with analytics', change: 'Lead with systems consolidation', why: 'Consolidation is the actual mandate. Analytics is the thing they already have.' },
  ],
  customizationLI: [
    { section: 'Headline', current: 'Headline says "Analytics leader"', change: '"RevOps leader | GTM systems"', why: 'Recruiters at this level search on RevOps, not analytics.' },
  ],
  leadStory: {
    title: 'The carrier scorecard rebuild',
    reason: 'It is consolidation, measurement and adoption in one story, which is the whole job description.',
    script: 'Carrier performance was reported three different ways by three teams. I built one scorecard on a single definition of on-time delivery, then made the planners own it rather than my team. Claims recovery improved by roughly a fifth within two quarters.',
  },
  starStories: [
    { title: 'Merging two CRM orgs', req: 'Consolidate overlapping CRM instances', S: 'An acquisition left two Salesforce instances and duplicate accounts.', T: 'Consolidate without losing a quarter of reporting.', A: 'Froze schema changes, mapped both to one object model, migrated in three waves.', R: 'One org, no reporting downtime, and a forecast the CFO signed off.', Reflection: 'I under-communicated the freeze in week one, and paid for it in escalations.' },
    { title: 'The forecast nobody believed', req: 'Build forecasting the exec team trusts', S: 'Sales forecast missed by 30% two quarters running.', T: 'Make the number trustworthy.', A: 'Rebuilt the stage definitions with the reps, not for them.', R: 'Variance fell to under 8% and stayed there.' },
  ],
  redFlagQs: [
    { q: 'Why are you leaving?', behind: 'They want to know if you were pushed, and whether you will leave them too.', a: 'The scope stopped growing once the systems work was done. I want the version of this problem that is still open.' },
    { q: 'You have not worked at a public company.', behind: 'Checking whether you can handle audit-grade rigour.', a: 'True. The reporting I built was audited annually, so the discipline is the same even if the filing is not.' },
  ],
};

// ---- lighter reports for the other roles the drawer is opened on ----------------
// The mock serves a report per id so a drawer never pairs one company's write-up
// with another company's title. These are shorter than Northwind's but real in shape.
const STORY = {
  391: { tldr: 'Analytics-led role with a clear mandate to unify carrier reporting. Strong fit on scope, and the comp band sits comfortably inside your target.', rec: 'Apply. Tailor the resume toward measurement and adoption, and keep the CRM story short.', brief: 'Umbra Logistics runs regional freight lanes and is building its first central analytics team. The Director owns carrier scorecards, lane costing and the planning dashboards.', kw: ['carrier scorecards', 'lane costing', 'SQL', 'forecasting', 'stakeholder reporting'], remote: 'Remote', seniority: 'Director', stated: '$165K - $195K' },
  401: { tldr: 'The most direct match on the board: a Head of RevOps role at a growth-stage robotics company, remote, with comp above your target.', rec: 'Applied. Follow up once the first week has passed.', brief: 'Acme Robotics ships warehouse robots and has doubled its sales team in a year. RevOps is a team of two today and the Head would build the rest.', kw: ['RevOps', 'pipeline hygiene', 'CPQ', 'territory design', 'headcount planning'], remote: 'Remote', seniority: 'Director', stated: '$185K - $215K' },
  405: { tldr: 'A solid Director role with a written offer on the way. Base sits at the low end of your target range, so the conversation is about scope and equity.', rec: 'Negotiate. Hold the title, ask for a review at six months, and ask about equity.', brief: 'Contoso Freight moves mid-market freight across North America. RevOps reports to the COO and owns the forecast, comp plans and the CRM.', kw: ['RevOps', 'comp plans', 'forecasting', 'CRM', 'COO partnership'], remote: 'Remote', seniority: 'Director', stated: '$141K - $158K' },
  379: { tldr: 'A lead-level role posted with a band that sits below your walk-away. Scope is narrower than the title suggests.', rec: 'Pass. The band is under your floor and the scope is a step down.', brief: 'Stark Freight is a regional carrier with a small operations team. The RevOps lead is an individual contributor role inside sales.', kw: ['RevOps', 'reporting', 'Salesforce admin'], remote: 'Onsite', seniority: 'Manager', stated: '$115K - $135K' },
  408: { tldr: 'A Director of GTM Operations role at a health tech company. The phone screen went well and the next step is a call with the VP.', rec: 'Continue. Prepare the consolidation story and a view on their territory model.', brief: 'Globex Health sells scheduling software to clinics. GTM Operations sits between sales, marketing and customer success.', kw: ['GTM operations', 'territory design', 'lead routing', 'marketing ops', 'forecasting'], remote: 'Hybrid', seniority: 'Director', stated: '$170K - $200K' },
  303: { tldr: 'A Senior Manager role that reached the phone screen before the company closed the search.', rec: 'Closed. Note what the screen asked about forecasting for the next application.', brief: 'Wayne Logistics runs last-mile delivery in three metros.', kw: ['RevOps', 'forecasting', 'last-mile'], remote: 'Hybrid', seniority: 'Manager', stated: '$135K - $160K' },
  330: { tldr: 'A manager-level role that scored just under the apply line, so the pipeline set it aside.', rec: 'Passed on score. Re-evaluate only if the posting changes.', brief: 'Vandelay Industries imports and exports specialty goods.', kw: ['RevOps', 'import and export', 'reporting'], remote: 'Onsite', seniority: 'Manager', stated: '$105K - $125K' },
};

function variant(app) {
  const s = STORY[app.id] || {
    tldr: `A ${app.role} role at ${app.company}.`, rec: 'Review the fit before you apply.',
    brief: `${app.company} is a fictional employer in the ${app.sector || 'general'} sector.`,
    kw: ['RevOps', 'forecasting'], remote: app.remote, seniority: app.seniority, stated: app.compStated,
  };
  const dims = dimsFor(app.score);
  const sc = makeScore(dims);
  return {
    url: app.url,
    legitimacy: app.legitimacy || 'High Confidence',
    legitimacyConclusion: 'High Confidence. Registered company, named hiring contact and a posted band.',
    legitimacySignals: [
      { signal: 'Company registered and trading', finding: 'Active', good: true },
      { signal: 'Compensation disclosed', finding: app.compStated === 'Not Stated' ? 'Not in the posting' : 'Band in the posting', good: app.compStated !== 'Not Stated' },
    ],
    archetypeDetected: app.archetype, domain: app.sector, function: 'Revenue Operations',
    seniority: s.seniority, remote: s.remote, teamSize: '4', compStated: s.stated,
    tldr: s.tldr, companyBrief: s.brief,
    globalScore: sc.globalScore, scoreSource: sc.scoreSource, scoreBasis: sc.scoreBasis,
    recommendation: s.rec, keywords: s.kw,
    cvMatch: [
      { req: 'Own revenue operations', evidence: 'Ran RevOps for a 200-person logistics business', strength: 'strong' },
      { req: 'Build reporting leadership trusts', evidence: 'Rebuilt the forecast model; variance fell to single digits', strength: 'strong' },
      { req: 'Public-company experience', evidence: 'Private-company only so far', strength: 'weak' },
    ],
    gaps: [{ gap: 'No public-company reporting', blocker: 'No', mitigation: 'Point at audit-grade reporting already built.' }],
    levelMatch: { jdLevel: s.seniority, naturalLevel: 'Director', verdict: 'In range for the title and scope.' },
    sellSenior: [{ claim: 'You have run this function before', proof: 'Built RevOps from a spreadsheet to a team of four', phrase: 'I know where this breaks, and I fix it early.' }],
    comp: {
      stated: s.stated.replace('Not Stated', ''), score: 4, walkaway: 130,
      sources: [{ src: 'Job posting', data: s.stated, note: 'as posted' }],
      verdict: 'Compared with your target range in the Posted vs target tile above.', market: 'Typical for the sector and level.',
    },
    customizationCV: [{ section: 'Professional summary', current: 'Leads with analytics', change: 'Lead with the function this role owns', why: 'Match the mandate in the posting.' }],
    customizationLI: [{ section: 'Headline', current: 'Analytics leader', change: 'RevOps leader | GTM systems', why: 'Match how recruiters search.' }],
    leadStory: { title: 'The carrier scorecard rebuild', reason: 'Measurement and adoption in one story.', script: 'Carrier performance was reported three different ways by three teams. I built one scorecard and made the planners own it.' },
    starStories: [{ title: 'Merging two CRM orgs', req: 'Consolidate systems', S: 'An acquisition left two CRM instances.', T: 'Consolidate without losing reporting.', A: 'Mapped both to one object model and migrated in waves.', R: 'One org, no downtime.' }],
    redFlagQs: [{ q: 'Why are you leaving?', behind: 'They want to know if you were pushed.', a: 'The scope stopped growing. I want the version of this problem that is still open.' }],
  };
}

/** The cheat sheet for a tracker id: Northwind's full report, a lighter one for the rest. */
export function cheatsheetFor(id) {
  if (id === 412) return NORTHWIND;
  const app = APP_ROWS.find((a) => a.id === id);
  return app ? variant(app) : null;
}

// ---- notes, posting, files, contacts, follow-ups ---------------------------------
export const NOTES_412 = [
  { timestamp: '2026-07-07T17:10:00.000Z', text: 'Recruiter screen with Alex Kim. Role is the first senior RevOps hire under the new CRO. Comp band confirmed at the posted range; equity still unstated.' },
  { timestamp: '2026-07-14T20:45:00.000Z', text: 'First interview with the CRO. Pushed hard on CRM consolidation sequencing and how I would handle the two acquired teams. Next round is a working session on forecasting.' },
  { timestamp: '2026-07-21T15:30:00.000Z', text: 'Prep for the 2nd interview on 07-24: bring the three-wave migration plan and the forecast variance chart.' },
];

export const POSTING_412 = {
  path: 'jds/412-northwind-analytics.md',
  source: 'report',
  text: [
    'VP, Revenue Operations',
    'Northwind Analytics  |  Remote (United States)',
    '',
    'About the role',
    'Northwind Analytics helps mid-market shippers see where their freight actually',
    'is. Two acquisitions in the last eighteen months have left us with three CRM',
    'instances and a reporting layer nobody trusts. We are hiring our first VP of',
    'Revenue Operations to fix that and to build the function around it.',
    '',
    'What you will do',
    '  - Consolidate three CRM instances onto one, and retire the other two',
    '  - Own forecasting end to end, from pipeline hygiene to the board deck',
    '  - Build and lead a team of six across systems, analytics and enablement',
    '  - Partner with the CRO on territory design and quota setting',
    '',
    'What we are looking for',
    '  - Eight or more years in revenue or sales operations, some of it in logistics',
    '  - You have run a CRM consolidation before and can talk about what went wrong',
    '  - Comfortable being the first senior hire in a function you have to define',
    '',
    'Compensation: $190,000 - $230,000 plus equity. Fully remote within the US.',
  ].join('\n'),
};

// Files the apply flow produced, by id. Evaluated and closed roles have none.
export const ARTIFACTS = {
  412: { resume: 'Jordan_Avery_Resume_Northwind_07-02-2026.docx', cover: 'Jordan_Avery_Cover_Northwind_07-02-2026.docx', others: [] },
  408: { resume: 'Jordan_Avery_Resume_Globex_07-06-2026.docx', cover: null, others: [] },
  405: { resume: 'Jordan_Avery_Resume_Contoso_07-08-2026.docx', cover: 'Jordan_Avery_Cover_Contoso_07-08-2026.docx', others: [] },
  401: { resume: 'Jordan_Avery_Resume_Acme_07-09-2026.docx', cover: null, others: [] },
};

// People at Northwind. Invented names, example.com addresses.
export const TA_CONTACTS_412 = [
  { id: 1, company: 'Northwind Analytics', first: 'Alex', last: 'Kim', title: 'Talent Acquisition Lead', city: 'Austin', state: 'TX', phone: '', email: 'alex.kim@example.com', linkedin: 'https://example.com/in/alex-kim', status: 'Replied', lastTouch: '2026-07-14', notes: '', website: 'https://example.com', isHighValue: false },
  { id: 9, company: 'Northwind Analytics', first: 'Tessa', last: 'Morrow', title: 'Recruiting Coordinator', city: 'Remote', state: '', phone: '', email: 'tessa.morrow@example.com', linkedin: '', status: 'Not Contacted', lastTouch: '', notes: '', website: 'https://example.com', isHighValue: false },
];

// /api/followups rows for this role.
export const TOUCHES = [
  { n: 1, appNum: 412, date: '2026-07-16', company: 'Northwind Analytics', role: 'VP, Revenue Operations', channel: 'Email', contact: 'Alex Kim', notes: 'Sent a thank-you after the first interview and asked about the timeline for the CRO round.' },
];

// Added to the stale list so the Coach card shows on the Follow-up tab.
export const COACH_ITEM_412 = {
  id: 412, source: 'app', company: 'Northwind Analytics', role: 'VP, Revenue Operations', score: 4.6, status: '2nd Interview',
  applyDate: '2026-07-02', lastTouchDate: '2026-07-16', daysSinceLastTouch: 6, daysSinceApply: 20, fuCount: 1, cap: 2,
  coachVerdict: '6d since last follow-up. 2nd follow-up is due now.', coachLevel: 'overdue', channel: 'email', muted: false, klass: 'warm',
  sector: 'Logistics', url: 'https://jobs.example.com/northwind-vp-revops', notes: '', followups: [{ date: '2026-07-16', channel: 'email' }],
};
