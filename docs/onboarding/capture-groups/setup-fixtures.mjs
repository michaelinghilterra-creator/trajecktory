/**
 * setup-fixtures.mjs: every invented value the Setup group serves.
 *
 * Persona: Jordan Avery, RevOps leader, Austin TX. Every employer is a
 * well-known fictional or placeholder name, every person is invented, every
 * address and phone is example-shaped. Shapes were copied from the real code:
 *   - setupComputeState()  dashboard-web/server/lib/setup.mjs
 *   - modelsState()        dashboard-web/server/lib/pricing.mjs (called for real)
 *   - rollupByDay()        dashboard-web/server/lib/agent-log.mjs (called for real)
 *   - analyzeCadence() / analyzeStyle()  server/lib/text-hygiene.mjs (called for real)
 *   - handoff prompts      setupHandoffPrompt() (called for real, static text)
 */
import { modelsState } from '../../../dashboard-web/server/lib/pricing.mjs';
import { rollupByDay, sumRollup } from '../../../dashboard-web/server/lib/agent-log.mjs';
import { analyzeCadence, analyzeStyle } from '../../../dashboard-web/server/lib/text-hygiene.mjs';
import { setupHandoffPrompt } from '../../../dashboard-web/server/lib/setup.mjs';

export { setupHandoffPrompt };

// ---------------------------------------------------------------------------
// Setup state (what GET /api/setup/state returns)
// ---------------------------------------------------------------------------
const SECTION_IDS = ['cv', 'identity', 'roles', 'edge', 'comp', 'location', 'evaluation', 'companies', 'outputs'];
function sections(status, overrides = {}) {
  const o = { preflight: { kind: 'action' }, firstEval: { kind: 'action', status: 'empty' }, health: { kind: 'action' } };
  for (const id of SECTION_IDS) o[id] = { status: overrides[id] || status };
  return o;
}
const meta = (exists) => ({ exists, mtimeMs: exists ? 1784700000000 : 0, size: exists ? 4096 : 0 });
const DEFAULT_OUT = {
  resume_dir: 'C:\\Users\\you\\Documents\\trajecktory resumes',
  interview_prep_dir: 'C:\\Users\\you\\Documents\\trajecktory interview prep',
};
// A fresh install already has the starter scanner keywords (portals.yml is created from the template).
const STARTER_KEYWORDS = ['operations manager', 'business operations', 'program manager', 'project manager', 'strategy manager', 'business analyst', 'data analyst', 'chief of staff', 'account manager'];
const EMPTY_CONFIGURED = {
  goal: { role: '', comp: '', by: '' },
  targetRoles: [], scannerTitles: STARTER_KEYWORDS.length, scannerKeywords: STARTER_KEYWORDS, locationPolicy: false, evalTuning: false,
  archetypes: [], edge: null, location: null, evaluation: null, companies: null,
};

export const STATE_FIRSTRUN = {
  firstRun: true, demo: false,
  files: { cv: meta(false), profile: meta(false), portals: meta(true), modeProfile: meta(false), cvMaster: meta(false), pipeline: meta(false) },
  sections: sections('empty'),
  values: {
    candidate: { full_name: '', email: '', phone: '', location: '', linkedin: '', portfolio_url: '', github: '', twitter: '' },
    compensation: { target_range: '', minimum: '', currency: '' },
    location: { country: '', city: '', timezone: '', visa_status: '' },
    outputs: { ...DEFAULT_OUT },
    configured: { ...EMPTY_CONFIGURED },
  },
};

// Resume in, nothing else done. The only state that renders the green
// "You are ready to use trajecktory." banner and the "N/8 sharpened" meter.
export const STATE_STARTED = {
  firstRun: false, demo: false,
  files: { cv: meta(true), profile: meta(true), portals: meta(true), modeProfile: meta(true), cvMaster: meta(true), pipeline: meta(false) },
  sections: sections('empty', { cv: 'complete' }),
  values: {
    candidate: { full_name: '', email: '', phone: '', location: '', linkedin: '', portfolio_url: '', github: '', twitter: '' },
    compensation: { target_range: '', minimum: '', currency: '' },
    location: { country: '', city: '', timezone: '', visa_status: '' },
    outputs: { ...DEFAULT_OUT },
    configured: { ...EMPTY_CONFIGURED },
  },
};

const SCANNER_KEYWORDS = [
  'revenue operations', 'revops', 'sales operations', 'sales ops', 'gtm operations', 'go-to-market operations',
  'revenue strategy', 'revenue analytics', 'sales strategy', 'business operations', 'commercial operations',
  'revenue enablement', 'sales analytics', 'gtm strategy', 'gtm analytics', 'head of revenue', 'vp revenue',
  'director revenue', 'chief of staff revenue', 'customer operations', 'revenue systems', 'gtm systems', 'sales planning',
];

export const STATE_READY = {
  firstRun: false, demo: false,
  files: { cv: meta(true), profile: meta(true), portals: meta(true), modeProfile: meta(true), cvMaster: meta(true), pipeline: meta(true) },
  sections: { ...sections('complete'), firstEval: { kind: 'action', status: 'complete' } },
  values: {
    candidate: {
      full_name: 'Jordan Avery', email: 'jordan.avery@example.com', phone: '(555) 010-4477', location: 'Austin, TX',
      linkedin: 'example.com/in/jordan-avery', portfolio_url: 'https://example.com/jordan-avery', github: '', twitter: '',
    },
    compensation: { target_range: '$160K-210K', minimum: '$140K', currency: 'USD' },
    location: { country: 'United States', city: 'Austin, TX', timezone: 'Central (CT)', visa_status: 'U.S. Citizen' },
    outputs: { ...DEFAULT_OUT },
    configured: {
      goal: { role: 'VP, Revenue Operations', comp: '$200K', by: 'October 2026' },
      targetRoles: ['VP, Revenue Operations', 'Head of Revenue Operations', 'Director, Revenue Operations', 'Director, GTM Operations'],
      scannerTitles: SCANNER_KEYWORDS.length,
      scannerKeywords: SCANNER_KEYWORDS,
      locationPolicy: true, evalTuning: true,
      archetypes: ['RevOps', 'SalesOps', 'Analytics', 'Strategy'],
      edge: { headline: 'RevOps leader who turns a messy funnel into one number the board trusts', superpowers: 3, proofPoints: 4 },
      location: {
        home: 'austin', radiusMiles: 35,
        allow: ['austin', 'round rock', 'cedar park', 'georgetown', 'san marcos'],
        hybridRemoteOnly: ['dallas', 'houston', 'san antonio'],
        hardNo: ['phoenix', 'denver', 'chicago'],
      },
      evaluation: {
        priorities: ['Owns the revenue data and the forecast', 'Reports to a CRO or CEO', 'Team of five or more', 'Remote or Austin hybrid'],
        dealBreakers: ['Pure reporting role with no ownership of the process', 'Fewer than 50 employees', 'On-site outside the Austin area'],
      },
      companies: { count: 44, names: ['Northwind Analytics', 'Globex Health', 'Contoso Freight', 'Initech Cloud', 'Acme Robotics', 'Umbra Logistics', 'Fabrikam Freight', 'Vertex Foods'] },
    },
  },
};

// ---------------------------------------------------------------------------
// Preflight (doctor.mjs --json, passed straight through; labels are doctor's own)
// ---------------------------------------------------------------------------
const chk = (label, pass = true, extra = {}) => ({ label, pass, warn: false, blocking: true, fix: [], ...extra });
const NO_KEY = chk('No ANTHROPIC_API_KEY detected', true, { warn: true, blocking: true, fix: [
  'The main /trajecktory pipeline runs on your Claude Code login and needs no key.',
  'ANTHROPIC_API_KEY (dashboard-web/.env) powers the dashboard draft endpoints (cover letters, outreach).',
] });
const ENGINE = [
  chk('Node.js >= 24.21 (v24.21.0)'),
  chk('Dependencies installed'),
  chk('Playwright chromium installed'),
];
const FOLDERS = [
  chk('Fonts directory ready'),
  chk('data/ directory ready'),
  chk('output/ directory ready'),
  chk('reports/ directory ready'),
];
export const PREFLIGHT_FIRSTRUN = {
  ok: false, engineOk: true, failures: 2, warnings: 1, checks: [
    ...ENGINE,
    chk('cv.md not found', false, { blocking: false, fix: ['Add your resume in the step below and this turns green.'] }),
    chk('config/profile.yml not found', false, { blocking: false, fix: ['Created for you as you work through the steps below.'] }),
    chk('portals.yml created from the starter template', true, { blocking: false }),
    NO_KEY, ...FOLDERS,
    chk('No evaluations on disk yet', true, { blocking: false }),
    chk('No unused legacy data files', true, { blocking: false }),
  ],
};
export const PREFLIGHT_STARTED = {
  ok: true, engineOk: true, failures: 0, warnings: 1, checks: [
    ...ENGINE,
    chk('cv.md found', true, { blocking: false }),
    chk('config/profile.yml found', true, { blocking: false }),
    chk('portals.yml found', true, { blocking: false }),
    NO_KEY, ...FOLDERS,
    chk('No evaluations on disk yet', true, { blocking: false }),
    chk('No unused legacy data files', true, { blocking: false }),
  ],
};
export const PREFLIGHT_READY = {
  ok: true, engineOk: true, failures: 0, warnings: 0, checks: [
    ...ENGINE,
    chk('cv.md found', true, { blocking: false }),
    chk('config/profile.yml found', true, { blocking: false }),
    chk('portals.yml found', true, { blocking: false }),
    chk('API keys detected (ANTHROPIC_API_KEY, BRAVE_API_KEY); optional not set: OBSIDIAN_API_KEY', true, { warn: true }),
    ...FOLDERS,
    chk('All 30 evaluations are on the tracker or archived', true, { blocking: false }),
    chk('No unused legacy data files', true, { blocking: false }),
  ],
};

// A fresh install has no tracker, no reports and nothing to verify. These are
// the three verify scripts' own messages in that state.
export const HEALTH_FRESH = {
  ok: true,
  output: '\n📊 No applications.md found. This is normal for a fresh setup.\n   The file will be created when you evaluate your first offer.\n\nNo reports/ directory yet — nothing to verify.\nAll checked entries are still live (no applications.md yet).\n',
};

// ---------------------------------------------------------------------------
// Staging files (data/setup/*.json) that the "split" sections render from
// ---------------------------------------------------------------------------
export const STAGE_STARTED = {
  roles: {
    seniority: ['Director', 'VP'],
    titles: ['Director of Revenue Operations', 'VP of Revenue Operations'],
    suggestions: [
      { title: 'Head of Revenue Operations', why: 'Same job, the title many mid-size companies use for it' },
      { title: 'Director of Sales Operations', why: 'One step sideways, with a bigger sales-process remit' },
      { title: 'Director, GTM Operations', why: 'How newer software companies word revenue operations' },
      { title: 'Senior Director, Revenue Strategy', why: 'Uses your forecasting and planning background' },
      { title: 'Head of Go-to-Market Systems', why: 'Matches your CRM and tooling consolidation work' },
      { title: 'Director of Revenue Analytics', why: 'Leans on the reporting and funnel-metrics side of your resume' },
      { title: 'Chief of Staff, Revenue', why: 'A route into a CRO or CEO office' },
    ],
  },
  companies: {
    radiusMiles: 50,
    picks: ['Acme Robotics'],
    suggestions: [
      { name: 'Northwind Analytics', kind: 'local', meta: 'Austin, TX · Greenhouse', api: true },
      { name: 'Contoso Freight', kind: 'local', meta: 'Round Rock, TX · Lever', api: true },
      { name: 'Wernham Group', kind: 'local', meta: 'Austin, TX · Website careers page', api: false },
      { name: 'Globex Health', kind: 'industry', meta: 'Health tech · Ashby', api: true },
      { name: 'Gringotts Capital', kind: 'industry', meta: 'Fintech · Greenhouse', api: true },
      { name: 'Initech Cloud', kind: 'industry', meta: 'Cloud software · Website careers page', api: false },
    ],
  },
  certs: {
    items: [],
    detected: [
      { name: 'Certified Revenue Operations Professional', issuer: 'Example Revenue Institute' },
      { name: 'Lean Six Sigma Green Belt', issuer: 'Example Quality Council' },
    ],
  },
};
export const STAGE_READY = {
  roles: { ...STAGE_STARTED.roles, titles: ['Director of Revenue Operations', 'VP of Revenue Operations', 'Head of Revenue Operations', 'Director, GTM Operations'] },
  companies: { ...STAGE_STARTED.companies, picks: ['Acme Robotics', 'Northwind Analytics', 'Contoso Freight'] },
  certs: {
    items: [{ name: 'Certified Revenue Operations Professional', org: 'Example Revenue Institute', number: 'EX-2041-77', issued: '03/2022', expires: '03/2027' }],
    detected: STAGE_STARTED.certs.detected,
  },
};

// The tracked companies list (portals.yml tracked_companies). All fictional.
const POOL = [
  'Northwind Analytics', 'Globex Health', 'Contoso Freight', 'Initech Cloud', 'Acme Robotics', 'Umbra Logistics',
  'Fabrikam Freight', 'Vertex Foods', 'Soylent Systems', 'Stark Freight', 'Hooli Systems', 'Wayne Logistics',
  'Oscorp Health', 'Tyrell Robotics', 'Cyberdyne Cloud', 'Massive Dynamic', 'Aperture Labs', 'Dunder Paper Co',
  'Wernham Group', 'Gringotts Capital', 'Vandelay Industries', 'Bluth Company', 'Sterling Analytics', 'Pendant Publishing',
  'Prestige Worldwide', 'Duff Beverages', 'Rekall Travel', 'Monsters Energy', 'Planet Express', 'Los Alamos Ventures',
  'Wonka Foods', 'Umbrella Health', 'Weyland Systems', 'Nakatomi Trading', 'Pied Piper Data', 'Spacely Sprockets',
  'Cogswell Cogs', 'Oceanic Airways', 'Dharma Initiative', 'Virtucon', 'Buy n Large', 'Wallace Corp',
  'Bluesun Corporation', 'Kwik-E Foods',
];
const OFF = new Map([
  ['Stark Freight', 'turned off in the dashboard'],
  ['Vandelay Industries', 'auto-disabled: no matching roles'],
  ['Los Alamos Ventures', 'turned off in the dashboard'],
  ['Spacely Sprockets', 'auto-disabled: board returned 404'],
]);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const TRACKED_COMPANIES = POOL.map(name => ({
  name, careers_url: `https://example.com/careers/${slug(name)}`, enabled: !OFF.has(name), note: OFF.get(name) || null,
}));
// In the started state the user has not merged any picks yet, so the three
// suggested names are not on the list.
export const TRACKED_STARTED = TRACKED_COMPANIES.filter(c => !['Northwind Analytics', 'Contoso Freight', 'Globex Health', 'Wernham Group', 'Gringotts Capital', 'Initech Cloud'].includes(c.name));

// ---------------------------------------------------------------------------
// Resume cards (real analyzers over an invented resume)
// ---------------------------------------------------------------------------
const RESUME_BULLETS = [
  'Rebuilt the forecasting model for a 40-person sales org, cutting forecast error from 22% to 9% in two quarters.',
  'Led a territory and quota redesign across three regions, which lifted attainment from 61% to 78% of reps.',
  'Consolidated four overlapping CRM instances into one, saving about $310K a year in licences and admin time.',
  'Stood up a deal-desk process that cut average quote turnaround from five days to under one.',
  'Hired and coached a team of eight analysts and admins; two were promoted to manager within 18 months.',
  'Defined the single pipeline-coverage metric the board now reviews every month.',
  'Partnered with finance to tie commissions to booked, collected revenue, ending a long-running dispute over crediting.',
  'Introduced weekly funnel reviews with sales, marketing and success leaders. Win rate in the mid-market segment rose six points.',
  'Cut month-end close reporting from nine working days to three by automating the revenue data pipeline.',
  'Ran the vendor evaluation for a new revenue intelligence platform, then led a 90-day rollout to 120 users.',
];
const RESUME_SUMMARY = 'Revenue operations leader with ten years turning scattered go-to-market data into a plan a sales team will act on. I leverage robust processes and spearhead cross-functional initiatives to drive seamless growth.';
export function resumeCadence() {
  const r = analyzeCadence(RESUME_BULLETS.join('\n'));
  const verdict = r.score >= 70 ? 'varied' : r.score >= 45 ? 'somewhat uniform' : 'monotonous';
  return { score: r.score, verdict, insufficient: r.insufficient, units: r.units, bulletCount: RESUME_BULLETS.length, flags: r.flags, metrics: r.metrics };
}
export function resumeStyle() {
  const r = analyzeStyle([RESUME_SUMMARY, ...RESUME_BULLETS].join('\n'), { expectBullets: true });
  const verdict = r.score >= 75 ? 'plain' : r.score >= 50 ? 'somewhat AI-flavored' : 'reads as AI-written';
  return { score: r.score, verdict, insufficient: r.insufficient, words: r.words, flags: r.flags, counts: r.counts };
}

// ---------------------------------------------------------------------------
// Models and cost (real modelsState, plus an invented per-day run history)
// ---------------------------------------------------------------------------
export function modelsFor({ keyPresent, billing }) {
  const prev = process.env.TJK_BILLING_MODE;
  process.env.TJK_BILLING_MODE = billing;
  try { return modelsState({ keyPresent }); }
  finally { if (prev === undefined) delete process.env.TJK_BILLING_MODE; else process.env.TJK_BILLING_MODE = prev; }
}
const RUN = (ts, mode, cost, durationMs, durationApiMs) => ({ ts, mode, cost, durationMs, durationApiMs, model: mode === 'scan' ? 'haiku' : 'sonnet' });
export const AGENT_RUNS = [
  RUN('2026-07-16T14:05:00.000Z', 'scan', 0.27, 191000, 160000),
  RUN('2026-07-16T14:20:00.000Z', 'pipeline', 1.12, 1380000, 1110000),
  RUN('2026-07-17T15:10:00.000Z', 'pipeline', 1.34, 1620000, 1330000),
  RUN('2026-07-20T13:40:00.000Z', 'scan', 0.31, 205000, 171000),
  RUN('2026-07-20T13:55:00.000Z', 'pipeline', 0.98, 1210000, 990000),
  RUN('2026-07-20T16:30:00.000Z', 'deep', 0.74, 540000, 470000),
  RUN('2026-07-21T14:15:00.000Z', 'pipeline', 1.21, 1475000, 1202000),
  RUN('2026-07-22T13:10:00.000Z', 'scan', 0.29, 198000, 166000),
  RUN('2026-07-22T13:25:00.000Z', 'pipeline', 1.05, 1290000, 1050000),
];
export function costRollup() {
  const days = rollupByDay(AGENT_RUNS);
  return { days, total: sumRollup(days), from: null, to: null };
}
export const COST_HISTORY = AGENT_RUNS.slice().reverse().map(r => ({ ts: r.ts, mode: r.mode, cost: r.cost, model: r.model, billedTo: 'plan', turns: 18, durationMs: r.durationMs }));

// ---------------------------------------------------------------------------
// Tell Me About Yourself
// ---------------------------------------------------------------------------
export const PITCH = {
  pitch: "I'm a revenue operations leader with about ten years of turning scattered go-to-market data into a plan a sales team will actually follow. Most recently, as Director of Revenue Operations at a mid-market software company, I rebuilt the forecasting model, cut forecast error from twenty-two percent to nine, and consolidated four CRM instances into one. What I enjoy most is the seam between the numbers and the people who have to hit them: territory design, deal desk, and a weekly funnel review that leaders attend because it saves them time. I'm looking for a VP or Head of Revenue Operations role where I can own that whole system end to end.",
  generated_at: '2026-07-21T15:04:00.000Z',
  tweaks: { seniority: 'Director', interviewStage: 'Recruiter screen', length: '90s', industry: '' },
};

// ---------------------------------------------------------------------------
// Customize (labels and descriptions copied from routes/setup-modules.mjs)
// ---------------------------------------------------------------------------
const SEC = (id, order, group, label, desc, files, status) => ({ id, order, group, label, desc, files, status });
export const CUSTOMIZE = (() => {
  const sectionsList = [
    SEC('scoring', 1, 'core', 'Scoring Priorities & Deal-Breakers', 'Which evaluation dimensions matter most. What roles to auto-reject.', ['config/profile.yml (scoring.weights)', 'modes/_profile.md (Evaluation Tuning)'], 'configured'),
    SEC('outreach-stakeholders', 2, 'core', 'Outreach Stakeholders & Messaging', 'Who you reach out to and how your messages sound.', ['templates/outreach-sequences.json', 'modes/_profile.md (Negotiation Scripts)'], 'configured'),
    SEC('voice', 3, 'core', 'Voice & Achievement Framing', 'Tone, power verbs, prohibited phrases, per-archetype proof points.', ['modes/_profile.md (Adaptive Framing)'], 'default'),
    SEC('narrative', 4, 'core', 'Narrative & Branding', 'Professional headline, superpowers, exit story, proof points.', ['config/profile.yml (narrative)'], 'configured'),
    SEC('exit', 5, 'core', 'Exit Narrative & Sensitive Framing', 'How short tenures, career gaps, and your transition are framed.', ['modes/_profile.md (Exit Narrative, Cross-cutting Advantage)'], 'default'),
    SEC('stories', 6, 'core', 'Interview Themes & Story Bank', 'STAR+R stories for behavioral interviews and cheat sheets.', ['interview-prep/story-bank.md'], 'configured'),
    SEC('search-queries', 7, 'enhance', 'Search Queries', 'Web search queries for discovering job postings beyond your portals.', ['portals.yml (search_queries)'], 'configured'),
    SEC('geo', 8, 'enhance', 'Geo Pre-Filter', 'Home coordinates, commute radius, approved metro areas.', ['portals.yml (location_policy)', 'config/profile.yml (location)'], 'configured'),
    SEC('social', 9, 'enhance', 'Social & Content Strategy', 'LinkedIn presence, content themes, and social proof.', ['modes/_profile.md (Social & Content Strategy)'], 'default'),
    SEC('cadence', 10, 'enhance', 'Outreach Cadence', 'Follow-up frequency, spacing, and cold-outreach caps.', ['config/profile.yml (outreach)'], 'default'),
    SEC('portfolio', 11, 'enhance', 'Article Digest / Portfolio', 'Proof points from published work, case studies, and projects.', ['article-digest.md'], 'default'),
  ];
  return { sections: sectionsList, total: sectionsList.length, configured: sectionsList.filter(s => s.status === 'configured').length };
})();

// ---------------------------------------------------------------------------
// Change Log (invented release notes in the house prose style)
// ---------------------------------------------------------------------------
const P = (text) => ({ type: 'prose', text });
const B = (text) => ({ type: 'bullet', text });
export const CHANGELOG = {
  version: '5.5.6',
  source: 'release-notes',
  entries: [
    { version: '5.5.6', date: '2026-07-21', sections: [
      { heading: 'What changed', items: [
        P('Every step on the Setup page now ends with a button for the next step, named, so you are never left on a finished screen wondering what comes after it.'),
        B('Weekly review lets you mark an item as looked at, with a reason, and undo that later.'),
        B('The Models & cost panel now shows a per-day total for cost and machine time once you have run a scan or an evaluation.'),
      ] },
    ] },
    { version: '5.5.5', date: '2026-07-14', sections: [
      { heading: 'Fixed', items: [
        P('Follow-up reminders now count from the day you actually sent the message, not the day you logged it. If you caught up on a weekend, a Monday reminder no longer shows as three days overdue.'),
        B('The Contacts list no longer shows the same person twice when their name is spelled two ways.'),
        B('The interview run sheet keeps your place when you switch tabs and come back.'),
      ] },
    ] },
    { version: '5.5.4', date: '2026-07-07', sections: [
      { heading: 'What changed', items: [
        P('The Activity Tracker now lets you log things that are not applications: a job club, a workshop, a networking meetup. They show up in the weekly counts and in the CSV you download.'),
        B('The CSV now includes a Method column for every row.'),
        B('Dates in the Activity Tracker follow the date format your computer uses.'),
      ] },
    ] },
    { version: '5.5.0', date: '2026-06-23', sections: [
      { heading: 'New', items: [
        P('Setup now tells you, in plain words, which steps change your score and which only change what you see. Look for the small badge at the top of each step.'),
      ] },
      { heading: 'Also in this release', items: [
        B('The Today tab shows a gentle count of follow-ups that are due, not an alarm.'),
        B('Setup remembers which step you were on when you come back after a restart.'),
      ] },
    ] },
    { version: '5.4.3', date: '2026-06-16', sections: [
      { heading: 'Fixed', items: [
        P('Tailored resumes no longer lose the line spacing from your Word master. If your resume came out a little tighter than the original, this is the fix.'),
      ] },
    ] },
    { version: '5.4.0', date: '2026-06-02', sections: [
      { heading: 'New', items: [
        P('The Weekly review in Setup lists, one week at a time, the few things worth a second look before you hand your work-search log to anyone: interviews with no proof they happened, calls that are booked but not held, and replies that do not match the status you set.'),
        B('Nothing on that page changes your records.'),
      ] },
    ] },
  ],
};

// ---------------------------------------------------------------------------
// Activity Tracker (Texas Workforce Commission work-search log)
// ---------------------------------------------------------------------------
const fmtYmd = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
const wkStart = (ymd) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return fmtYmd(d); };
const HQ = {
  'Duff Beverages': ['410 Example Plaza, Austin, TX 78701', '(555) 010-2210'],
  'Planet Express': ['88 Sample Street, Round Rock, TX 78664', '(555) 010-3318'],
  'Fabrikam Freight': ['2200 Placeholder Parkway, Austin, TX 78758', '(555) 010-5504'],
  'Sterling Analytics': ['15 Demo Drive, Austin, TX 78702', '(555) 010-7721'],
  'Acme Robotics': ['970 Test Loop, Cedar Park, TX 78613', '(555) 010-6102'],
  'Globex Health': ['300 Fixture Way, Austin, TX 78705', '(555) 010-8845'],
  'Contoso Freight': ['61 Mockingbird Court, Round Rock, TX 78681', '(555) 010-9930'],
};
const act = (o) => {
  const hq = HQ[o.company];
  return {
    kind: 'application', dateApprox: false, activity: 'Applied online for a job', role: '', company: '',
    employerAddress: hq ? hq[0] : '', employerWebPage: '', employerPhone: hq ? hq[1] : '',
    contact: '', method: 'Online application', result: 'Submitted job application', note: '', ...o,
    week: wkStart(o.date),
  };
};
const ACTIVITIES = [
  act({ date: '2026-07-09', company: 'Acme Robotics', role: 'Head of Revenue Operations' }),
  act({ date: '2026-07-10', company: 'Sterling Analytics', role: 'VP, Revenue Operations' }),
  act({ date: '2026-07-11', company: 'Fabrikam Freight', role: 'Manager, Sales Operations' }),
  act({ date: '2026-07-14', kind: 'interview', activity: 'Interview: 1st Interview', company: 'Northwind Analytics', role: 'VP, Revenue Operations', method: '', result: 'Interviewed', employerAddress: '', employerPhone: '' }),
  act({ date: '2026-07-15', kind: 'interview', activity: 'Interview: 1st Interview', company: 'Contoso Freight', role: 'Director, Revenue Operations', method: '', result: 'Interviewed' }),
  act({ date: '2026-07-16', kind: 'event', activity: 'Networking event or job club', company: 'Example RevOps Meetup', role: '', contact: 'Priya Raman', method: 'In person', result: 'Other', note: 'Monthly meetup, panel on forecasting' }),
  act({ date: '2026-07-17', kind: 'followup', activity: 'Follow-up (Email)', company: 'Contoso Freight', role: 'Director, Revenue Operations', contact: 'Marcus Webb', method: 'Email', result: 'Other', note: 'Sent follow-up' }),
  act({ date: '2026-07-20', company: 'Planet Express', role: 'VP, Customer Operations' }),
  act({ date: '2026-07-20', kind: 'outreach', activity: 'Networking, LinkedIn connection request', company: 'Globex Health', role: 'Director, GTM Operations', contact: 'Elena Torres', method: 'LinkedIn', result: 'Other', note: 'Sent connection request' }),
  act({ date: '2026-07-21', company: 'Duff Beverages', role: 'Director of Sales Operations' }),
  act({ date: '2026-07-21', kind: 'interview', activity: 'Interview: Phone Screen', company: 'Globex Health', role: 'Director, GTM Operations', method: '', result: 'Interviewed' }),
  act({ date: '2026-07-22', kind: 'outreach', activity: 'Networking, LinkedIn connection request', company: 'Sterling Analytics', role: 'VP, Revenue Operations', contact: 'Dana Whitfield', method: 'LinkedIn', result: 'Other', note: 'Sent connection request' }),
];
export const TWC = (() => {
  const weeksMap = new Map();
  for (const a of ACTIVITIES) {
    if (!weeksMap.has(a.week)) weeksMap.set(a.week, { week: a.week, count: 0, byKind: { application: 0, interview: 0, followup: 0, outreach: 0, event: 0 } });
    const w = weeksMap.get(a.week); w.count++; w.byKind[a.kind]++;
  }
  const seen = new Set(); const employers = [];
  for (const a of ACTIVITIES) {
    if (seen.has(a.company)) continue; seen.add(a.company);
    employers.push({ company: a.company, cached: !!HQ[a.company] });
  }
  return { from: '2026-07-09', to: '2026-07-22', count: ACTIVITIES.length, activities: ACTIVITIES, weeks: [...weeksMap.values()].sort((a, b) => a.week.localeCompare(b.week)), employers, overrideWarnings: 0 };
})();
export const TWC_GATE = {
  from: '2026-07-09', to: '2026-07-22', today: '2026-07-22', blocking: false, warn_only: true, count: 2, other_replies_in_range: 1,
  warnings: [
    { type: 'unconfirmed_interview', id: 405, stage: '1st Interview', date: '2026-07-15', company: 'Contoso Freight', role: 'Director, Revenue Operations' },
    { type: 'status_mismatch', id: 321, mismatch_type: 'rejection_after_no_response', company: 'Dunder Paper Co', role: 'Manager, Sales Operations' },
  ],
};
export const TWC_EVENTS = {
  events: [
    { id: 'evt-demo-001', date: '2026-07-16', type: 'Networking event or job club', organizer: 'Example RevOps Meetup', contact: 'Priya Raman', method: 'In person', notes: 'Monthly meetup, panel on forecasting' },
  ],
};

// ---------------------------------------------------------------------------
// Weekly review (same shape as buildReviewForData; weeks run Sunday to Saturday)
// ---------------------------------------------------------------------------
const item = (o) => ({ excluded: null, ...o });
export const WEEKLY_REVIEW = (() => {
  const weeks = [
    { from: '2026-06-28', to: '2026-07-04', unconfirmed_interviews: [], scheduled: [], newer_messages: [], unmatched_replies: [] },
    { from: '2026-07-05', to: '2026-07-11',
      unconfirmed_interviews: [item({ application_id: 405, stage: 'Phone Screen', date: '2026-07-10', company: 'Contoso Freight', role: 'Director, Revenue Operations', item_key: 'unconfirmed_interview|405|Phone Screen',
        excluded: { reason: 'Held by phone, the calendar invite is the evidence', on: '2026-07-21', event_id: 'evt-demo-501' } })],
      scheduled: [], newer_messages: [], unmatched_replies: [] },
    { from: '2026-07-12', to: '2026-07-18',
      unconfirmed_interviews: [item({ application_id: 405, stage: '1st Interview', date: '2026-07-15', company: 'Contoso Freight', role: 'Director, Revenue Operations', item_key: 'unconfirmed_interview|405|1st Interview' })],
      scheduled: [], newer_messages: [],
      unmatched_replies: [item({ application_id: 397, message_id: 'note:397:2026-07-16T15:00:00Z', dated_on: '2026-07-16', problem: 'filed_on_another_application', belongs_to: 345, company: 'Fabrikam Freight', role: 'Manager, Sales Operations', item_key: 'unmatched_reply|397|note:397:2026-07-16T15:00:00Z' })] },
    { from: '2026-07-19', to: '2026-07-25',
      unconfirmed_interviews: [],
      scheduled: [item({ application_id: 412, stage: '2nd Interview', date: '2026-07-24', company: 'Northwind Analytics', role: 'VP, Revenue Operations', item_key: 'scheduled|412|2nd Interview' })],
      newer_messages: [item({ application_id: 321, status: 'No Response', message_id: 'note:321:2026-07-20T15:02:00Z', dated_on: '2026-07-20', kind: 'rejection', company: 'Dunder Paper Co', role: 'Manager, Sales Operations', item_key: 'newer_message|321|note:321:2026-07-20T15:02:00Z' })],
      unmatched_replies: [] },
  ].map(w => {
    const all = [...w.unconfirmed_interviews, ...w.scheduled, ...w.newer_messages, ...w.unmatched_replies];
    const needs_review = all.length; const excluded = all.filter(i => i.excluded).length;
    return { ...w, needs_review, excluded, open: needs_review - excluded };
  });
  const needs_review = weeks.reduce((s, w) => s + w.needs_review, 0);
  const excluded = weeks.reduce((s, w) => s + w.excluded, 0);
  return { today: '2026-07-22', weeks, needs_review, excluded, open: needs_review - excluded };
})();

// ---------------------------------------------------------------------------
// Data storage (the event-store dry run)
// ---------------------------------------------------------------------------
export const EVENT_STORE_STATUS = { switch: 'off', flipped_at: null, database_present: false };
export const EVENT_STORE_REPORT = {
  command: 'flip', dry_run: true, ok: true, exit_code: 0, events: 1284,
  checks: ['Tracker', 'Apply dates', 'Status history', 'People', 'Followups', 'Correspondence', 'LinkedIn', 'TWC'].map(name => ({ name, match: true })),
  byte_checks: ['applications.md', 'follow-ups.md', 'apply-dates.json', 'status-history.json', 'twc-events.json', 'target-talent-correspondence', 'referral-correspondence'].map(file => ({ file, match: true })),
  messages: [], errors: [],
  will_add: ['trajecktory.db', 'event-store.json', 'a backup copy of the data folder'],
  will_not_change: ['Your data files are not rewritten by the flip. They are read, checked, and left exactly as they are.'],
};

// ---------------------------------------------------------------------------
// Help improve setup (activation log, summary only; nothing here has a name in it)
// ---------------------------------------------------------------------------
export const ACTIVATION_ON = {
  enabled: true,
  summary: { minutesToReady: 14, minutesToFirstUse: 22, minutesSpentAfterReady: 8, stepsCompleted: 9, handoffsStarted: 6, handoffsMissing: 1, previewsRun: 2, scansRun: 3, firstScanResults: 41, emptyScans: 0, appliesRun: 2, failedApplies: 0 },
};
export const ACTIVATION_OFF = { enabled: false, summary: null };
