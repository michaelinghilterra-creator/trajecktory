#!/usr/bin/env node
/**
 * capture-dashboard.mjs — auto-capture the trajecktory dashboard + Launchpad for
 * the onboarding guide (Guide 2). PII-safe by construction:
 *
 *   - Demo mode was removed (2026-06-29), so there is no synthetic data set to
 *     boot into. Instead every data-bearing endpoint the captured views touch is
 *     intercepted in the browser and served a pristine, synthetic response. The
 *     server's REAL config/profile.yml, tracker, and reports are never read into
 *     a screenshot and nothing is written to disk.
 *   - Captured views: the sidebar Workflow (default Claude-plan flow), the Setup
 *     Launchpad in all three states (first-run, resume-in, ready), the Models &
 *     cost booster, the Tell Me About Yourself pitch builder, the Today and
 *     Interview tabs, and the Guide 3 set (Pipeline, the report drawer including
 *     the Posting tab and the score explainer, and the outreach tabs).
 *
 * A note on adding captures: every data-bearing endpoint a new view touches must
 * be mocked in installMocks BEFORE it is captured. Routing is opt-in, so an
 * endpoint nobody thought about falls through to the live server and lands real
 * data in a PNG. captures/ is gitignored, so neither verify-no-pii.mjs nor
 * tests/no-real-postings.test.mjs will catch it; the PDF reader would be first.
 *
 * Prereq: the dashboard is running on http://localhost:3333
 *   (cd dashboard-web && npm start)  — builds the UI then serves live data.
 *
 * Usage: node docs/onboarding/capture-dashboard.mjs
 */
import { chromium } from 'playwright';
import { dirname, resolve } from 'path';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, 'captures');
mkdirSync(OUT, { recursive: true });

const BASE = process.env.TRAJECKTORY_URL || 'http://localhost:3333';
const VIEWPORT = { width: 1300, height: 1000 };
const SCALE = 2;

// ---- synthetic setup state (zero real PII) ---------------------------------
const SECTION_IDS = ['cv', 'identity', 'roles', 'edge', 'comp', 'location', 'evaluation', 'companies', 'outputs'];
function sectionsObj(status, overrides = {}) {
  const o = { preflight: { status: 'complete' }, health: { status: status === 'complete' ? 'complete' : 'empty' } };
  for (const id of SECTION_IDS) o[id] = { status: overrides[id] || status };
  return o;
}
const STATE_FIRSTRUN = {
  firstRun: true, demo: false,
  files: { cv: { exists: false }, profile: { exists: false }, portals: { exists: false }, modeProfile: { exists: false }, cvMaster: { exists: false }, pipeline: { exists: false } },
  sections: sectionsObj('empty'),
  values: { candidate: {}, compensation: {}, location: {}, outputs: { resume_dir: 'Documents\\trajecktory resumes', interview_prep_dir: 'Documents\\trajecktory interview prep' } },
};
const STATE_READY = {
  firstRun: false, demo: false,
  files: { cv: { exists: true }, profile: { exists: true }, portals: { exists: true }, modeProfile: { exists: true }, cvMaster: { exists: true }, pipeline: { exists: true } },
  sections: sectionsObj('complete'),
  values: { candidate: {}, compensation: {}, location: {}, outputs: {} },
};
// Resume in, nothing else done. This is the ONLY state that renders the green
// "You are ready to use trajecktory." banner and the "N/8 sharpened" meter,
// because both are gated on canStart && !allReady (launchpad.jsx). Guide 2's
// whole time-to-value argument rests on that screen, and neither of the two
// states above can produce it: firstrun has no resume, ready has nothing left
// to sharpen.
const STATE_STARTED = {
  firstRun: false, demo: false,
  files: { cv: { exists: true }, profile: { exists: true }, portals: { exists: true }, modeProfile: { exists: true }, cvMaster: { exists: true }, pipeline: { exists: false } },
  sections: sectionsObj('empty', { cv: 'complete' }),
  values: { candidate: {}, compensation: {}, location: {}, outputs: { resume_dir: 'Documents\\trajecktory resumes', interview_prep_dir: 'Documents\\trajecktory interview prep' } },
};
// Preflight passes doctor.mjs --json straight through, so these labels have to be
// doctor's own words. They previously were not: this fixture invented friendlier
// ones ("Your CV (cv.md)"), which put text in the guide that appears nowhere in
// the app. Order and wording follow gatherChecks() in doctor.mjs, in the state a
// fresh install is actually in: engine ready, config files not written yet, and
// portals.yml created by preflight itself.
const PREFLIGHT_OK = {
  ok: false, engineOk: true, failures: 2, warnings: 1, checks: [
    { label: 'Node.js >= 18 (v20.19.0)', pass: true, warn: false, blocking: true, fix: [] },
    { label: 'Dependencies installed', pass: true, warn: false, blocking: true, fix: [] },
    { label: 'Playwright chromium installed', pass: true, warn: false, blocking: true, fix: [] },
    { label: 'cv.md not found', pass: false, warn: false, blocking: false, fix: ['Add your resume in the step below and this turns green.'] },
    { label: 'config/profile.yml not found', pass: false, warn: false, blocking: false, fix: ['Created for you as you work through the steps below.'] },
    { label: 'portals.yml created from the starter template', pass: true, warn: false, blocking: false, fix: [] },
    { label: 'No ANTHROPIC_API_KEY detected', pass: true, warn: true, blocking: false, fix: ['The main /trajecktory pipeline runs on your Claude Code login and needs no key.'] },
    { label: 'Fonts directory ready', pass: true, warn: false, blocking: true, fix: [] },
    { label: 'data/ directory ready', pass: true, warn: false, blocking: true, fix: [] },
    { label: 'output/ directory ready', pass: true, warn: false, blocking: true, fix: [] },
    { label: 'reports/ directory ready', pass: true, warn: false, blocking: true, fix: [] },
    { label: 'No evaluations on disk yet', pass: true, warn: false, blocking: false, fix: [] },
    { label: 'No unused legacy data files', pass: true, warn: false, blocking: false, fix: [] },
  ],
};
const HEALTH_OK = { ok: true, output: '✓ verify-pipeline passed\n✓ verify-reports passed\n✓ verify-actionable passed\nAll checks green.' };
const STAGE = {
  roles: { seniority: ['Director'], titles: ['Director of Revenue Operations'], suggestions: [
    { title: 'VP of Revenue Operations', why: 'Natural step up from your director scope' },
    { title: 'Head of Go-to-Market Systems', why: 'Matches your RevOps plus tooling background' },
  ] },
  companies: { radiusMiles: 50, picks: ['Acme Robotics'], suggestions: [
    { name: 'Northwind Analytics', kind: 'local', meta: 'Austin, TX · Greenhouse', api: true },
    { name: 'Globex Health', kind: 'industry', meta: 'Health tech · Ashby', api: true },
    { name: 'Initech Cloud', kind: 'industry', meta: 'Website careers page', api: false },
  ] },
  certs: { items: [], detected: [
    { name: 'AWS Certified Cloud Practitioner', issuer: 'Amazon Web Services' },
    { name: 'Certified Scrum Product Owner', issuer: 'Scrum Alliance' },
  ] },
};

// Models & cost: keyPresent so the billing toggle renders, billed to 'plan' so
// hasKey is false (the sidebar shows the default plan flow, and $ figures stay
// hidden behind tier labels). Mirrors pricing.mjs SECTIONS.
const MODELS_STATE = {
  hasKey: false, keyPresent: true, billingMode: 'plan',
  sections: [
    { key: 'triage', label: 'Triage', hint: 'Cheap first-pass scoring of the pipeline top.', options: ['haiku', 'sonnet'], default: 'haiku', warn: { sonnet: 'Sonnet costs more; Haiku is calibrated faithful for triage.' }, unitLabel: 'role', unitsPerRun: 15, current: 'haiku', costs: { haiku: 0.02, sonnet: 0.05 } },
    { key: 'scan', label: 'Agent Scan', hint: 'Widens the pipeline via Claude web search.', options: ['haiku', 'sonnet', 'opus'], default: 'haiku', warn: {}, unitLabel: 'role found', unitsPerRun: 10, current: 'haiku', costs: { haiku: 0.03, sonnet: 0.08, opus: 0.14 } },
    { key: 'eval', label: 'Evaluate (batch)', hint: 'Full A-G reports. The cost driver.', options: ['sonnet', 'opus', 'haiku'], default: 'sonnet', warn: { haiku: 'Scoring rubric is NOT validated at Haiku (quality may drop).' }, unitLabel: 'eval', unitsPerRun: 5, current: 'sonnet', costs: { sonnet: 0.19, opus: 0.32, haiku: 0.06 } },
    { key: 'insights', label: 'Insights', hint: 'On-demand strategy narrative over pre-computed metrics.', options: ['sonnet', 'opus'], default: 'sonnet', warn: {}, unitLabel: 'run', unitsPerRun: 1, current: 'sonnet', costs: { sonnet: 0.05, opus: 0.09 } },
    { key: 'draft', label: 'Drafts & Outreach', hint: 'Cover letters, CV tailor, recruiter / TA / LinkedIn / follow-up.', options: ['haiku', 'sonnet'], default: 'haiku', warn: {}, unitLabel: 'action', unitsPerRun: 1, current: 'haiku', costs: { haiku: 0.004, sonnet: 0.01 } },
  ],
  batch: [
    { key: 'batch_plan', label: 'Batch size (plan)', min: 1, max: 15, current: 5 },
    { key: 'batch_key', label: 'Batch size (key)', min: 1, max: 15, current: 10 },
  ],
  pricing: { haiku: { in: 1, out: 5 }, sonnet: { in: 3, out: 15 }, opus: { in: 5, out: 25 } },
  totalPerRun: 0.21,
  // Verbatim from pricing.mjs (billingMode 'plan'), so the screenshot matches the
  // shipped app rather than paraphrasing it.
  note: 'Billing set to your Claude plan: your saved API key is not charged. $ figures are estimates of what the API-key path would cost, not real charges.',
};

// Synthetic Haiku-triage cards for the sidebar plan flow (scored list under the steps).
const TRIAGE = { cards: [
  { url: 'https://jobs.example.com/1', score: 4.6, company: 'Northwind Analytics', title: 'VP, Revenue Operations', rationale: 'Strong title + comp match; remote-friendly.' },
  { url: 'https://jobs.example.com/2', score: 4.1, company: 'Globex Health', title: 'Director of GTM Systems', rationale: 'Adjacent role, good industry fit.' },
  { url: 'https://jobs.example.com/3', score: 3.4, company: 'Initech Cloud', title: 'Sr. Manager, Sales Ops', rationale: 'A notch junior; worth a look.' },
] };

const PITCH = {
  pitch: "I'm a supply-chain analytics leader with about ten years turning scattered carrier data into a performance picture an operations team will actually act on. Most recently, as Director of Analytics at a mid-market logistics company, I rebuilt carrier scorecarding and lane costing so claims recovery improved by roughly a fifth. What I love is the seam between the measurement and the planners who live under it. I'm looking for a Director or VP role where I can own that end to end.",
  generated_at: '2026-07-06T15:00:00.000Z',
  tweaks: { seniority: 'Director', interviewStage: 'Recruiter screen', length: '90s', industry: '' },
};

// ---- Today tab (cadence + to-dos + streak) ---------------------------------
// Bare array, exactly as GET /api/cadence/today returns it (server/lib/cadence.mjs
// deriveToday). Blocks are the shipped starter template, renamed to read like a
// real week without naming anything real.
const CADENCE_TODAY = [
  { id: 't_seed_deepwork', label: 'Deep work block',         days: [1, 3, 5], start: '09:00', durationMin: 50, pomodoros: 2, notes: '', order: 0, archived: false, done: true,  pomodorosDone: 2 },
  { id: 't_seed_outreach', label: 'Applications & outreach', days: [1, 3, 5], start: '11:00', durationMin: 50, pomodoros: 2, notes: '', order: 1, archived: false, done: false, pomodorosDone: 1 },
  { id: 't_seed_network',  label: 'Networking / LinkedIn',   days: [1, 3, 5], start: '14:00', durationMin: 25, pomodoros: 1, notes: '', order: 2, archived: false, done: false, pomodorosDone: 0 },
];
const CADENCE_TEMPLATE = {
  version: 1,
  tasks: [
    { id: 't_seed_deepwork', label: 'Deep work block',         days: [1, 3, 5], start: '09:00', durationMin: 50, pomodoros: 2, notes: '', order: 0, archived: false },
    { id: 't_seed_outreach', label: 'Applications & outreach', days: [1, 3, 5], start: '11:00', durationMin: 50, pomodoros: 2, notes: '', order: 1, archived: false },
    { id: 't_seed_network',  label: 'Networking / LinkedIn',   days: [2, 4],    start: '10:00', durationMin: 25, pomodoros: 1, notes: '', order: 2, archived: false },
    { id: 't_seed_skill',    label: 'Skill building',          days: [2, 4],    start: '14:00', durationMin: 50, pomodoros: 2, notes: '', order: 3, archived: false },
  ],
};
// last7 is oldest -> newest, exactly 7 entries; pct null iff rest.
const CADENCE_STREAK = {
  current: 4, best: 9,
  last7: [
    { date: '2026-07-13', pct: 100, rest: false },
    { date: '2026-07-14', pct: 100, rest: false },
    { date: '2026-07-15', pct: 67,  rest: false },
    { date: '2026-07-16', pct: 100, rest: false },
    { date: '2026-07-17', pct: 100, rest: false },
    { date: '2026-07-18', pct: null, rest: true },
    { date: '2026-07-19', pct: 33,  rest: false },
  ],
};
const TODOS = { todos: [
  { id: 'd_1a2b3c4d', text: 'Prep for Northwind Analytics screen', notes: '', done: false, priority: 'high', createdAt: '2026-07-17T14:02:00.000Z', dueDate: '2026-07-21', completedAt: null, order: 0, source: 'app',    appId: 412, company: 'Northwind Analytics' },
  { id: 'd_2b3c4d5e', text: 'Send thank-you note to Globex Health', notes: '', done: false, priority: 'med',  createdAt: '2026-07-16T09:20:00.000Z', dueDate: '2026-07-15', completedAt: null, order: 1, source: 'app',    appId: 408, company: 'Globex Health' },
  { id: 'd_3c4d5e6f', text: 'Refresh portfolio case study',        notes: '', done: false, priority: 'low',  createdAt: '2026-07-15T11:45:00.000Z', dueDate: null,        completedAt: null, order: 2, source: 'manual', appId: null, company: null },
  { id: 'd_4d5e6f70', text: 'Ask Dana for a referral intro',       notes: '', done: true,  createdAt: '2026-07-14T08:10:00.000Z', priority: 'med', dueDate: null, completedAt: '2026-07-16T17:30:00.000Z', order: 3, source: 'manual', appId: null, company: null },
] };

// ---- Interview tab ---------------------------------------------------------
// NOTE prepDir/prepPath/runPath are REAL absolute paths in the live response and
// therefore carry the user's Windows account name. They are replaced here with a
// generic "you" path: the tab renders no path, but a screenshot must not depend
// on that staying true.
const IPREP = 'C:\\Users\\you\\Documents\\trajecktory interview prep';
const INTERVIEW_SESSIONS = {
  active: [
    {
      id: 'northwind-analytics', company: 'Northwind Analytics', role: 'VP, Revenue Operations',
      status: '2nd Interview', round: 2, prepDir: `${IPREP}\\Northwind Analytics`, appId: 412,
      rounds: [
        { round: 1, stage: 'Phone Screen',   descriptor: 'recruiter-screen', prepPath: `${IPREP}\\Northwind Analytics\\northwind-analytics-round-1-recruiter-screen.md`, runPath: `${IPREP}\\Northwind Analytics\\northwind-analytics-round-1-recruiter-screen.run.md`, hasBoard: true },
        { round: 2, stage: '2nd Interview',  descriptor: 'hiring-manager',   prepPath: `${IPREP}\\Northwind Analytics\\northwind-analytics-round-2-hiring-manager.md`,   runPath: null, hasBoard: false },
      ],
      docs: [{ key: 'northwind-analytics-vp-revenue-operations', kind: 'intel', label: 'Company intel', name: 'Vp Revenue Operations', title: 'Northwind Analytics: company intel', path: `${IPREP}\\Northwind Analytics\\northwind-analytics-vp-revenue-operations.md` }],
    },
    {
      id: 'globex-health', company: 'Globex Health', role: 'Director of GTM Systems',
      status: 'Phone Screen', round: 1, prepDir: `${IPREP}\\Globex Health`, appId: 408,
      rounds: [
        { round: 1, stage: 'Phone Screen', descriptor: 'recruiter-screen', prepPath: `${IPREP}\\Globex Health\\globex-health-round-1-recruiter-screen.md`, runPath: null, hasBoard: false },
      ],
      docs: [],
    },
  ],
  archive: [
    {
      id: 'initech-cloud', company: 'Initech Cloud', role: 'Sr. Manager, Sales Ops',
      status: 'Rejected', round: 1, prepDir: `${IPREP}\\Initech Cloud`, appId: 377,
      rounds: [{ round: 1, stage: null, descriptor: 'panel', prepPath: `${IPREP}\\Initech Cloud\\initech-cloud-round-1-panel.md`, runPath: null, hasBoard: false }],
      docs: [],
    },
  ],
};

// The Prep pane renders server-produced HTML. parsePrepDoc() splits it on <h2>
// boundaries and reads a "§N" / "N)" marker, so the headings below are what make
// the Sections rail (and the Cram sheet print option) appear.
const INTERVIEW_PREP_HTML = `
<h2>§0a Say first</h2>
<p>Ten years turning scattered revenue data into a picture an operations team will act on. Most recently
rebuilt carrier scorecarding and lane costing end to end.</p>
<ul><li>Lead with the rebuild, not the tooling.</li><li>Name the business outcome inside 30 seconds.</li></ul>
<h2>§1 Their world</h2>
<p>Northwind Analytics sells supply-chain visibility to mid-market shippers. The RevOps function is new: this
role is the first senior hire under the CRO, so expect "what would you do in the first 90 days".</p>
<ul><li>Two acquisitions in the last 18 months, so systems consolidation is live.</li>
<li>Their pricing page implies a land-and-expand motion, so net revenue retention will matter.</li></ul>
<h2>§2 Hero story</h2>
<p><b>Situation.</b> Carrier performance was reported three different ways by three teams.</p>
<p><b>Action.</b> Built one scorecard on a single definition of on-time delivery, then made the planners own it.</p>
<p><b>Result.</b> Claims recovery improved by roughly a fifth within two quarters.</p>
<h2>§3 Do not</h2>
<ul><li>Do not relitigate the old stack. They know it was messy.</li>
<li>Do not quote a comp number first. Let them anchor.</li></ul>
<h2>§4 Ask them</h2>
<ul><li>Who owns the forecast today, and who do you want owning it in a year?</li>
<li>What has to be true 90 days in for this hire to have been obviously right?</li></ul>
`;

// Identity feeds the drawer's Quick copy bar and signature helpers. The live
// response is the user's real name, email, phone and links.
const IDENTITY = {
  name: 'Jordan Avery', email: 'jordan.avery@example.com', phone: '(555) 010-4477',
  location: 'Austin, TX', linkedin: 'https://linkedin.com/in/example',
  portfolio: 'https://example.com', github: '', certifications: [],
};

// ---- Guide 3: one invented search, used by every data-bearing screen ---------
// Pipeline, Insights, Follow-Ups and Analytics are all derived from the tracker,
// so there is exactly ONE application fixture and every page renders from it.
// That is what makes the guide read as a single continuous story rather than a
// pile of unrelated screenshots.
//
// Company names are deliberately the well-known fictional placeholders. A
// plausible but real employer name would read as a real evaluation of a real
// company, which is not something to publish.
const APPS = [
  { id: 412, date: '2026-07-02', company: 'Northwind Analytics', role: 'VP, Revenue Operations',     score: 4.6, status: '2nd Interview', archetype: 'RevOps',    sector: 'Logistics',  source: 'Greenhouse', compStated: '$190,000 - $230,000', url: 'https://jobs.example.com/northwind-vp-revops',  report: 'reports/412-northwind-analytics-2026-07-02.md', resume: 'trajecktory', seniority: 'VP',       remote: 'Remote' },
  { id: 408, date: '2026-07-06', company: 'Globex Health',       role: 'Director of GTM Systems',    score: 4.1, status: 'Phone Screen',  archetype: 'RevOps',    sector: 'Health tech', source: 'Ashby',     compStated: '$170,000 - $200,000', url: 'https://jobs.example.com/globex-dir-gtm',       report: 'reports/408-globex-health-2026-07-06.md',       resume: 'trajecktory', seniority: 'Director', remote: 'Hybrid' },
  { id: 405, date: '2026-07-08', company: 'Contoso Freight',     role: 'Director, Revenue Operations', score: 4.4, status: 'Offer',       archetype: 'RevOps',    sector: 'Logistics',  source: 'Lever',      compStated: '$180,000 - $210,000', url: 'https://jobs.example.com/contoso-dir-revops',   report: 'reports/405-contoso-freight-2026-07-08.md',    resume: 'trajecktory', seniority: 'Director', remote: 'Remote' },
  { id: 401, date: '2026-07-09', company: 'Acme Robotics',       role: 'Head of Revenue Operations', score: 4.3, status: 'Applied',       archetype: 'RevOps',    sector: 'Robotics',   source: 'Greenhouse', compStated: '$185,000 - $215,000', url: 'https://jobs.example.com/acme-head-revops',     report: 'reports/401-acme-robotics-2026-07-09.md',      resume: 'trajecktory', seniority: 'Director', remote: 'Remote' },
  { id: 397, date: '2026-07-11', company: 'Fabrikam Freight',    role: 'Manager, Sales Operations',  score: 3.6, status: 'Applied',       archetype: 'SalesOps',  sector: 'Logistics',  source: 'Ashby',      compStated: 'Not Stated',          url: 'https://jobs.example.com/fabrikam-mgr-salesops', report: 'reports/397-fabrikam-freight-2026-07-11.md',  resume: 'trajecktory', seniority: 'Manager',  remote: 'Onsite' },
  { id: 394, date: '2026-07-14', company: 'Initech Cloud',       role: 'Sr. Manager, Sales Ops',     score: 3.4, status: 'Evaluated',     archetype: 'SalesOps',  sector: 'SaaS',       source: 'Website',    compStated: '$150,000 - $170,000', url: 'https://jobs.example.com/initech-sr-mgr-salesops', report: 'reports/394-initech-cloud-2026-07-14.md',   resume: '',            seniority: 'Manager',  remote: 'Hybrid' },
  { id: 391, date: '2026-07-15', company: 'Umbra Logistics',     role: 'Director of Analytics',      score: 4.2, status: 'Evaluated',     archetype: 'Analytics', sector: 'Logistics',  source: 'Greenhouse', compStated: '$165,000 - $195,000', url: 'https://jobs.example.com/umbra-dir-analytics',  report: 'reports/391-umbra-logistics-2026-07-15.md',    resume: '',            seniority: 'Director', remote: 'Remote' },
  { id: 386, date: '2026-06-24', company: 'Vertex Foods',        role: 'RevOps Manager',             score: 3.1, status: 'Rejected',      archetype: 'RevOps',    sector: 'CPG',        source: 'Lever',      compStated: '$130,000 - $150,000', url: 'https://jobs.example.com/vertex-revops-mgr',    report: 'reports/386-vertex-foods-2026-06-24.md',       resume: 'trajecktory', seniority: 'Manager',  remote: 'Onsite' },
  { id: 383, date: '2026-06-19', company: 'Soylent Systems',     role: 'Director, Sales Strategy',   score: 3.9, status: 'No Response',   archetype: 'Strategy',  sector: 'SaaS',       source: 'Ashby',      compStated: 'Not Stated',          url: 'https://jobs.example.com/soylent-dir-strategy', report: 'reports/383-soylent-systems-2026-06-19.md',    resume: 'trajecktory', seniority: 'Director', remote: 'Remote' },
  { id: 379, date: '2026-06-15', company: 'Stark Freight',       role: 'Revenue Operations Lead',    score: 2.8, status: 'Not a Fit',     archetype: 'RevOps',    sector: 'Logistics',  source: 'Website',    compStated: '$115,000 - $135,000', url: 'https://jobs.example.com/stark-revops-lead',    report: 'reports/379-stark-freight-2026-06-15.md',      resume: '',            seniority: 'Manager',  remote: 'Onsite' },
];

// The evaluation report behind app 412, as GET /api/cheatsheets/:id returns it.
// Field names follow v1ToCheatsheet in dashboard-web/server/v1-loader.mjs; the
// nested item shapes follow what the drawer actually reads.
const CHEATSHEET = {
  url: 'https://jobs.example.com/northwind-vp-revops',
  legitimacy: 'Verified', archetypeDetected: 'RevOps', domain: 'Logistics',
  seniority: 'VP', remote: 'Remote', teamSize: '6', compStated: '$190,000 - $230,000',
  tldr: 'A genuine step up: first senior RevOps hire under a new CRO, with the systems mess to prove the mandate is real. Comp clears your target. The risk is scope creep into pure analytics.',
  companyBrief: 'Northwind Analytics sells supply-chain visibility to mid-market shippers. Two acquisitions in eighteen months have left three overlapping CRM instances, which is why this role exists. The RevOps function is new, so you would be defining it rather than inheriting it.',
  globalScore: [
    { dim: 'Role fit', val: 4.8, max: 5 },
    { dim: 'Seniority', val: 4.5, max: 5, note: 'true VP scope' },
    { dim: 'Compensation', val: 4.6, max: 5 },
    { dim: 'Domain', val: 4.7, max: 5, note: 'logistics, your home turf' },
    { dim: 'Location', val: 5.0, max: 5, note: 'fully remote' },
    { dim: 'Stability', val: 3.9, max: 5, note: 'post-acquisition churn' },
  ],
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
  comp: {
    stated: '$190,000 - $230,000', score: 4.6, walkaway: false,
    sources: [
      { src: 'Job posting', data: '$190,000 - $230,000 base', note: 'disclosed, no equity detail' },
      { src: 'Market range, VP RevOps, remote US', data: '$185,000 - $240,000', note: 'mid-market logistics' },
    ],
    verdict: 'Clears your target of $180,000 at the midpoint and clears your walk-away comfortably. Equity is unstated, so ask early.',
    market: 'Remote VP RevOps roles at this stage cluster tightly. The top of their band is competitive rather than generous.',
  },
  customizationCV: [
    { current: 'Director of Revenue Operations', change: 'VP, Revenue Operations (target title)', why: 'Their screen filters on title. You are applying at the level they posted.' },
    { current: 'Summary leads with analytics', change: 'Lead with systems consolidation', why: 'Consolidation is the actual mandate. Analytics is the thing they already have.' },
  ],
  customizationLI: [
    { current: 'Headline says "Analytics leader"', change: '"Revenue Operations leader | GTM systems"', why: 'Recruiters at this level search on RevOps, not analytics.' },
  ],
  leadStory: {
    title: 'The carrier scorecard rebuild',
    reason: 'It is consolidation, measurement and adoption in one story, which is the whole job description.',
    script: 'Carrier performance was reported three different ways by three teams. I built one scorecard on a single definition of on-time delivery, then made the planners own it rather than my team. Claims recovery improved by roughly a fifth within two quarters.',
  },
  starStories: [
    { title: 'Merging two CRM orgs', S: 'An acquisition left two Salesforce instances and duplicate accounts.', T: 'Consolidate without losing a quarter of reporting.', A: 'Froze schema changes, mapped both to one object model, migrated in three waves.', R: 'One org, no reporting downtime, and a forecast the CFO signed off.', Reflection: 'I under-communicated the freeze in week one, and paid for it in escalations.' },
    { title: 'The forecast nobody believed', S: 'Sales forecast missed by 30% two quarters running.', T: 'Make the number trustworthy.', A: 'Rebuilt the stage definitions with the reps, not for them.', R: 'Variance fell to under 8% and stayed there.' },
  ],
  redFlagQs: [
    { q: 'Why are you leaving?', behind: 'They want to know if you were pushed, and whether you will leave them too.', a: 'The scope stopped growing once the systems work was done. I want the version of this problem that is still open.' },
    { q: 'You have not worked at a public company.', behind: 'Checking whether you can handle audit-grade rigour.', a: 'True. The reporting I built was audited annually, so the discipline is the same even if the filing is not.' },
  ],
  legitimacyConclusion: 'Verified. Real company, named hiring manager, disclosed comp, and a posting consistent with their funding stage.',
  legitimacySignals: [
    { signal: 'Company registered and trading', finding: 'Founded 2016, active', good: true },
    { signal: 'Compensation disclosed', finding: 'Full band in the posting', good: true },
    { signal: 'Named hiring manager', finding: 'Reports to the CRO', good: true },
    { signal: 'Posting age', finding: 'Reposted once in six weeks', good: false },
  ],
};

const NOTES = { notes: [
  { id: 'n1', text: 'Recruiter screen went well. They pushed hard on CRM consolidation, which is the whole mandate. Next round is with the CRO.', createdAt: '2026-07-14T16:20:00.000Z' },
  { id: 'n2', text: 'Asked about equity. Answer was vague, so revisit before any offer conversation.', createdAt: '2026-07-10T09:05:00.000Z' },
] };

// The Posting tab, as GET /api/jd/:id returns it. Written to match app 412 so the
// tab and the report beside it describe the same job. Deliberately short: the
// guide figure only needs to show that the saved text is there and readable.
const POSTING = {
  path: 'jds/412-northwind-analytics.txt',
  text: [
    'VP, Revenue Operations',
    'Northwind Analytics  ·  Remote (United States)',
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

// The "Files for this application" row. Filenames follow the shipped convention,
// with the invented persona's name rather than the real one.
const ARTIFACTS = {
  resume: 'Jordan_Avery_Resume_Northwind_07-02-2026.docx',
  cover: 'Jordan_Avery_Cover_Northwind_07-02-2026.docx',
};

// ---- Block D: the outreach + follow-up tabs ---------------------------------
// Same invented search as APPS, seen from each tab's angle. Follow-Ups in
// particular MUST stay mocked: the real endpoint derives from the user's own
// tracker, so an unmocked capture here would put real companies in the guide.
const FOLLOWUPS_STALE = {
  warm: [
    { id: 401, company: 'Acme Robotics', role: 'Head of Revenue Operations', score: 4.3, status: 'Applied', applyDate: '2026-07-09', lastTouchDate: '2026-07-09', daysSinceLastTouch: 8, daysSinceApply: 8, fuCount: 0, cap: 3, coachVerdict: '8d since application sent. 1st follow-up is overdue.', coachLevel: 'overdue', channel: 'email', muted: false, klass: 'warm', sector: 'Robotics', url: 'https://jobs.example.com/acme-head-revops', notes: '', followups: [] },
    { id: 408, company: 'Globex Health', role: 'Director of GTM Systems', score: 4.1, status: 'Phone Screen', applyDate: '2026-07-06', lastTouchDate: '2026-07-12', daysSinceLastTouch: 5, daysSinceApply: 11, fuCount: 1, cap: 3, coachVerdict: '5d since last follow-up. 2nd follow-up due now.', coachLevel: 'overdue', channel: 'email', muted: false, klass: 'warm', sector: 'Health tech', url: 'https://jobs.example.com/globex-dir-gtm', notes: '', followups: [{ date: '2026-07-12', channel: 'email' }] },
  ],
  cold: [
    { id: 397, company: 'Fabrikam Freight', role: 'Manager, Sales Operations', score: 3.6, status: 'Applied', applyDate: '2026-07-11', lastTouchDate: '2026-07-11', daysSinceLastTouch: 6, daysSinceApply: 6, fuCount: 0, cap: 3, coachVerdict: '6d since application sent. 1st follow-up is overdue.', coachLevel: 'overdue', channel: 'none', muted: false, klass: 'cold', sector: 'Logistics', url: 'https://jobs.example.com/fabrikam-mgr-salesops', notes: '', followups: [] },
  ],
  snoozed: [],
};

const RECRUITERS = [
  { id: 1, firm: 'Meridian Search', first: 'Dana', last: 'Whitfield', title: 'Principal, GTM Practice', city: 'Austin', state: 'TX', phone: '', email: 'dana@example.com', status: 'Replied', lastTouch: '2026-07-14', notes: '', linkedin: 'https://example.com/in/example', website: 'https://example.com' },
  { id: 2, firm: 'Meridian Search', first: 'Owen', last: 'Castellanos', title: 'Associate', city: 'Austin', state: 'TX', phone: '', email: 'owen@example.com', status: 'Sent', lastTouch: '2026-07-12', notes: '', linkedin: '', website: 'https://example.com' },
  { id: 3, firm: 'Bluepeak Partners', first: 'Priya', last: 'Raghunathan', title: 'Managing Director', city: 'Denver', state: 'CO', phone: '', email: 'priya@example.com', status: 'Meeting Scheduled', lastTouch: '2026-07-15', notes: '', linkedin: '', website: 'https://example.com' },
  { id: 4, firm: 'Bluepeak Partners', first: 'Marcus', last: 'Feld', title: 'Consultant', city: 'Remote', state: '', phone: '', email: '', status: 'Not Contacted', lastTouch: '', notes: '', linkedin: '', website: '' },
  { id: 5, firm: 'Harborline Talent', first: 'Ingrid', last: 'Solberg', title: 'Partner, Operations', city: 'Chicago', state: 'IL', phone: '', email: 'ingrid@example.com', status: 'Drafted', lastTouch: '', notes: '', linkedin: '', website: 'https://example.com' },
];

const TARGET_TALENT = [
  { id: 1, company: 'Northwind Analytics', first: 'Alex', last: 'Kim', title: 'Talent Acquisition Lead', city: 'Austin', state: 'TX', phone: '', email: 'alex.kim@example.com', linkedin: 'https://example.com/in/example', status: 'Replied', lastTouch: '2026-07-14', notes: '', website: 'https://example.com' },
  { id: 2, company: 'Globex Health', first: 'Rosa', last: 'Delgado', title: 'Senior Technical Recruiter', city: 'Boston', state: 'MA', phone: '', email: 'rosa.delgado@example.com', linkedin: '', status: 'Sent', lastTouch: '2026-07-12', notes: '', website: 'https://example.com' },
  { id: 3, company: 'Acme Robotics', first: 'Tomas', last: 'Brandt', title: 'Head of Talent', city: 'Remote', state: '', phone: '', email: 'tomas.brandt@example.com', linkedin: '', status: 'Not Contacted', lastTouch: '', notes: '', website: 'https://example.com' },
  { id: 4, company: 'Contoso Freight', first: 'Yuki', last: 'Nakamura', title: 'Recruiting Manager', city: 'Seattle', state: 'WA', phone: '', email: 'yuki.n@example.com', linkedin: '', status: 'Meeting Scheduled', lastTouch: '2026-07-16', notes: '', website: 'https://example.com' },
];

const SSI_SUMMARY = {
  currentSsi: 52, targetSsi: 60,
  weeks: [
    { weekNum: 1, weekOf: '2026-06-29', brand: 11, findPeople: 10, engageInsights: 12, relationships: 9,  notes: '' },
    { weekNum: 2, weekOf: '2026-07-06', brand: 12, findPeople: 11, engageInsights: 13, relationships: 10, notes: '' },
    { weekNum: 3, weekOf: '2026-07-13', brand: 13, findPeople: 12, engageInsights: 14, relationships: 13, notes: 'Commented daily, three replies.' },
  ],
};
const SSI_INFLUENCERS = [
  { id: 1, name: 'Jane Rivera',  role: 'VP of Revenue Operations', track: 'revops',    tier: 'national', location: 'Austin, TX',  linkedinUrl: 'https://example.com/in/example', whyFollow: 'Posts weekly on GTM systems consolidation.', engagementTip: 'Comment on her pipeline-hygiene threads.', following: true,  connected: true,  engaged: true,  lastEngagement: '2026-07-16', engagementCount: 6, notes: '' },
  { id: 2, name: 'Marcus Ellery', role: 'Head of GTM Systems',      track: 'revops',    tier: 'local',    location: 'Austin, TX',  linkedinUrl: 'https://example.com/in/example', whyFollow: 'Runs the local RevOps meetup.', engagementTip: 'Ask about tooling migrations.', following: true,  connected: true,  engaged: false, lastEngagement: '2026-07-11', engagementCount: 2, notes: '' },
  { id: 3, name: 'Priya Anand',   role: 'CRO',                      track: 'exec',      tier: 'national', location: 'Remote',      linkedinUrl: 'https://example.com/in/example', whyFollow: 'Writes about forecast discipline.', engagementTip: 'Add a data point, never just praise.', following: true,  connected: false, engaged: false, lastEngagement: '', engagementCount: 0, notes: '' },
  { id: 4, name: 'Sam Okoro',     role: 'Director of Analytics',    track: 'analytics', tier: 'local',    location: 'Dallas, TX',  linkedinUrl: 'https://example.com/in/example', whyFollow: 'Adjacent field, shares hiring posts.', engagementTip: 'Engage on his hiring threads.', following: false, connected: false, engaged: false, lastEngagement: '', engagementCount: 0, notes: '' },
];
const SSI_LOG = [
  { date: '2026-07-16', influencer: 'Jane Rivera',  actionType: 'Commented', topic: 'Forecast hygiene', message: 'Added our stage-definition approach.', responseReceived: 'Yes', connectionMade: 'Connected', notes: '', loggedAt: '2026-07-16T15:02:00.000Z' },
  { date: '2026-07-15', influencer: 'Marcus Ellery', actionType: 'Reposted', topic: 'RevOps meetup',   message: '', responseReceived: 'No', connectionMade: 'Connected', notes: '', loggedAt: '2026-07-15T11:20:00.000Z' },
  { date: '2026-07-14', influencer: 'Jane Rivera',  actionType: 'Messaged',  topic: 'Intro',           message: 'Short note after her post.', responseReceived: 'Yes', connectionMade: 'Connected', notes: '', loggedAt: '2026-07-14T09:41:00.000Z' },
];

let stateMode = 'firstrun'; // 'firstrun' | 'started' | 'ready'
// 'empty'      → a genuinely fresh install: no triage results, no to-dos, no
//                cadence, so no sidebar badges. This is what the first-run
//                screenshot must show, because the guide says "it starts empty".
// 'populated'  → the Today / Interview tabs, where content is the whole point.
let dataMode = 'empty';
// Triage rows are provisional and sort to the top of the Pipeline tables, which
// is correct behaviour but crowds out the real rows in a teaching screenshot.
// The guide has its own page for triage, so it is served only where it is the
// subject.
let showTriage = true;
const EMPTY_STREAK = { current: 0, best: 0, last7: Array.from({ length: 7 }, (_, i) => ({ date: `2026-07-${13 + i}`, pct: null, rest: true })) };

async function installMocks(page) {
  const json = (route, obj) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
  await page.route('**/api/setup/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const method = req.method();
    if (p.endsWith('/api/setup/state')) {
      return json(route, stateMode === 'ready' ? STATE_READY : stateMode === 'started' ? STATE_STARTED : STATE_FIRSTRUN);
    }
    if (p.endsWith('/api/setup/preflight')) return json(route, PREFLIGHT_OK);
    if (p.endsWith('/api/setup/healthcheck')) return json(route, HEALTH_OK);
    if (p.endsWith('/api/setup/models')) return json(route, MODELS_STATE);
    if (p.endsWith('/api/setup/pitch')) return json(route, PITCH);
    if (p.includes('/api/setup/pitch/')) return json(route, PITCH);
    if (p.includes('/api/setup/stage/')) {
      if (method === 'GET') return json(route, STAGE[p.split('/').pop()] || {});
      return json(route, { ok: true });
    }
    if (p.includes('/api/setup/save/') || p.includes('/api/setup/reset/')) return json(route, { ok: true, state: STATE_FIRSTRUN });
    // handoff prompt text is static + read-only; let it hit the server for authenticity
    return route.continue();
  });
  await page.route('**/api/system/version', route => json(route, { version: '1.24.0' }));
  await page.route('**/api/claude-status', route => json(route, { signedIn: false }));
  await page.route('**/api/triage/results', route => json(route, (dataMode === 'empty' || !showTriage) ? { cards: [] } : TRIAGE));
  await page.route('**/api/agent/cost-history', route => json(route, []));
  await page.route('**/api/agent/active', route => json(route, {}));
  // Pin the updater to "current". A fresh install has nothing to update, and an
  // update banner across the top of the first-run screenshot would be a lie.
  await page.route('**/api/system/update-check', route => json(route, { status: 'up-to-date' }));

  // App shell: these three are fetched on every page load, and all three read
  // real user data. /api/identity is the user's name, email and phone outright.
  // Empty on first run, the invented search everywhere else.
  await page.route('**/api/applications', route => json(route, dataMode === 'empty' ? [] : APPS));
  await page.route('**/api/identity', route => json(route, IDENTITY));
  await page.route('**/api/cheatsheets/**', route => json(route, CHEATSHEET));
  await page.route('**/api/notes/**', route => json(route, NOTES));
  // The Posting tab and the "Files for this application" row. Both are newer than
  // this script and were falling through to the live server, which on a real
  // install serves a genuine job advert and filenames carrying a real employer
  // and the Windows account name. captures/ is gitignored, so neither
  // verify-no-pii.mjs nor tests/no-real-postings.test.mjs would ever have seen
  // it — the leak's first reader would have been whoever opened the PDF.
  await page.route('**/api/jd/**', route => json(route, POSTING));
  await page.route('**/api/artifacts/**', route => json(route, ARTIFACTS));
  await page.route('**/api/target-talent/by-company/**', route => json(route, []));
  await page.route('**/api/followups/stale', route =>
    json(route, dataMode === 'empty' ? { warm: [], cold: [], snoozed: [] } : FOLLOWUPS_STALE));
  await page.route('**/api/followups', route => json(route, []));
  await page.route('**/api/recruiters', route => json(route, dataMode === 'empty' ? [] : RECRUITERS));
  await page.route('**/api/recruiters/*', route => json(route, { ...RECRUITERS[0], correspondence: [] }));
  await page.route('**/api/target-talent', route => json(route, dataMode === 'empty' ? [] : TARGET_TALENT));
  await page.route('**/api/linkedin-ssi/summary', route => json(route, SSI_SUMMARY));
  await page.route('**/api/linkedin-ssi/influencers', route => json(route, SSI_INFLUENCERS));
  await page.route('**/api/linkedin-ssi/engagement-log', route => json(route, SSI_LOG));
  // Insights is left unmocked-but-empty on purpose: a new user genuinely sees
  // "No analysis yet" until they run it, and that is the honest screenshot.
  await page.route('**/api/insights/latest', route => json(route, { generated_at: null }));
  // These two fire on Pipeline mount and are captured in g3-pipeline-analytics.
  // Neither returns a company or a role, so neither leaks a name — but both are
  // computed from the real tracker, so unmocked they would print the maintainer's
  // genuine search statistics next to ten invented rows that cannot produce them.
  // Derived from APPS instead: 3 terminal rows (Vertex rejected, Soylent no
  // response, Stark not a fit), which is what the funnel beside them shows.
  await page.route('**/api/insights/rejection-timing', route =>
    json(route, { n: 3, avgDays: 21.3, medianDays: 19, excluded: 0 }));
  await page.route('**/api/insights/stage-funnel', route => json(route, {
    funnelOrder: ['Applied', 'Responded', 'Phone Screen', '1st Interview', '2nd Interview', 'Offer'],
    interviewStages: ['Phone Screen', '1st Interview', '2nd Interview', '3rd Interview', '4th Interview'],
    reached: { Applied: 8, Responded: 5, 'Phone Screen': 4, '1st Interview': 3, '2nd Interview': 2, Offer: 1 },
    conversion: [
      { from: 'Applied', to: 'Responded', fromN: 8, toN: 5, rate: 63 },
      { from: 'Responded', to: 'Phone Screen', fromN: 5, toN: 4, rate: 80 },
      { from: 'Phone Screen', to: '1st Interview', fromN: 4, toN: 3, rate: 75 },
      { from: '1st Interview', to: '2nd Interview', fromN: 3, toN: 2, rate: 67 },
      { from: '2nd Interview', to: 'Offer', fromN: 2, toN: 1, rate: 50 },
    ],
    rejections: {
      byStage: { 'Phone Screen': 1, '1st Interview': 1, '2nd Interview': 0, '3rd Interview': 0, '4th Interview': 0 },
      preInterview: 1, unknownStage: 0, total: 3,
    },
    eventsTracked: 26,
  }));

  // Today tab. Order matters: '/api/cadence/today' and '/api/cadence/streak' are
  // matched before the bare '/api/cadence' template route.
  await page.route('**/api/cadence/today', route => json(route, dataMode === 'empty' ? [] : CADENCE_TODAY));
  await page.route('**/api/cadence/streak', route => json(route, dataMode === 'empty' ? EMPTY_STREAK : CADENCE_STREAK));
  await page.route('**/api/cadence/log', route => json(route, {}));
  await page.route('**/api/cadence', route => json(route, CADENCE_TEMPLATE));
  await page.route('**/api/todos', route => json(route, dataMode === 'empty' ? { todos: [] } : TODOS));
  await page.route('**/api/todos/*', route => json(route, { ok: true }));

  // Interview tab. The prep/runsheet/doc routes are per-round, hence the globs.
  await page.route('**/api/interview/sessions', route => json(route, INTERVIEW_SESSIONS));
  await page.route('**/api/interview/prep/**', route => json(route, { markdown: '', html: INTERVIEW_PREP_HTML }));
  // No board is mocked: "Prep only" and the no-board empty state are the honest
  // first-run experience, and a fabricated run sheet would have to satisfy the
  // whole runsheet-v1 schema to render truthfully.
  await page.route('**/api/interview/runsheet/**', route =>
    route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'No run sheet for this round.' }) }));
  await page.route('**/api/interview/doc/**', route => json(route, { markdown: '', html: INTERVIEW_PREP_HTML, label: 'Company intel', title: 'Company intel' }));
}

async function shotContent(page, name) {
  const el = page.locator('.content').first();
  await el.waitFor({ state: 'visible' });
  await page.waitForTimeout(350);
  await el.screenshot({ path: resolve(OUT, `${name}.png`) });
  console.log('  saved', name + '.png');
}
// Like shotContent, but trimmed to where the content actually ends. `.content` is
// a full-height flex column, so a short screen (Today) otherwise yields a tall
// image that is mostly empty background and reduces to an unreadable strip once
// the guide scales it to page width. `maxCss` additionally caps a long screen
// (the Interview prep doc) to just its structural top.
async function shotContentTight(page, name, maxCss = null, pad = 14) {
  const el = page.locator('.content').first();
  await el.waitFor({ state: 'visible' });
  await page.waitForTimeout(350);
  const box = await el.boundingBox();
  const bottom = await page.evaluate(() => {
    const c = document.querySelector('.content');
    if (!c) return 0;
    let max = 0;
    for (const n of c.querySelectorAll('*')) {
      const r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) max = Math.max(max, r.bottom);
    }
    return max;
  });
  let height = Math.min(box.height, Math.max(140, bottom - box.y + pad));
  if (maxCss) height = Math.min(height, maxCss);
  await page.screenshot({ path: resolve(OUT, `${name}.png`),
    clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.width, height } });
  console.log('  saved', name + '.png (tight ' + Math.round(height) + 'px)');
}
async function shotPanel(page, name, maxCss = null) {
  const el = page.locator('.card.padded-lg').first();
  await el.waitFor({ state: 'visible' });
  await page.waitForTimeout(350);
  if (maxCss) {
    // Some panels (Models & cost) are taller than they are wide, which is over
    // seven inches at page width and overflows the page.
    const b = await el.boundingBox();
    const height = Math.min(Math.ceil(b.height), maxCss);
    await page.screenshot({ path: resolve(OUT, `${name}.png`),
      clip: { x: Math.floor(b.x), y: Math.floor(b.y), width: Math.ceil(b.width), height } });
    console.log(`  saved ${name}.png (panel, capped ${height}px)`);
    return;
  }
  await el.screenshot({ path: resolve(OUT, `${name}.png`) });
  console.log('  saved', name + '.png (panel)');
}
async function clickNav(page, label) {
  await page.locator('.nav-item', { hasText: label }).first().click();
  await page.waitForTimeout(500);
}
async function clickRail(page, label) {
  await page.locator('button', { hasText: label }).first().click();
  await page.waitForTimeout(400);
}
// Drawer tabs are plain elements carrying an icon plus a label, so a childless-node
// match misses them and a class-name match would couple this script to the drawer's
// markup. Take the DEEPEST element whose trimmed text is exactly the label and click
// it; the event bubbles to whichever ancestor holds the handler.
async function clickDrawerTab(page, label) {
  await page.evaluate((want) => {
    const d = document.querySelector('.pl-drawer.open');
    if (!d) return;
    const nodes = [...d.querySelectorAll('*')].filter(n => n.textContent.trim() === want);
    const t = nodes[nodes.length - 1];
    if (t) { t.scrollIntoView({ block: 'nearest', inline: 'center' }); t.click(); }
  }, label);
}
async function waitRailEnabled(page, label) {
  const btn = page.locator('button', { hasText: label }).first();
  for (let i = 0; i < 30; i++) {
    // The per-attempt timeout matters. Without it each isDisabled() inherits the
    // 20s page default, so a rail item that never appears costs 30 x 20s = ten
    // MINUTES of complete silence rather than failing in a few seconds. That has
    // now cost two debugging sessions: once when the rail was renamed CV ->
    // resume, and once when this was called on a screen showing no rail at all.
    try { if (!(await btn.isDisabled({ timeout: 300 }))) return; } catch {}
    await page.waitForTimeout(200);
  }
  console.log(`  note: rail item "${label}" never became enabled, continuing anyway`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  await installMocks(page);

  // ---- Phase A: first-run Launchpad + sidebar (synthetic, intercepted) -----
  console.log('Phase A — first-run Setup / Launchpad + sidebar');
  stateMode = 'firstrun';
  await page.goto(BASE, { waitUntil: 'networkidle' });   // firstRun -> opens Setup/Launchpad
  await page.waitForSelector('text=Launchpad');
  await waitRailEnabled(page, 'Your resume');
  await page.waitForTimeout(700);

  // The whole window exactly as a new user first sees it: sidebar (Launchpad
  // pinned to the top with its incomplete-count badge) plus the Launchpad itself.
  // Replaces the old dash-overview-full.png, which predated the demo-mode removal
  // and showed a sidebar that no longer matches the app.
  // Cropped to the top 640px: the full 1000px window is nearly square, and at
  // page width that leaves no room for the rest of the page (it overflowed).
  // 640px still carries the whole nav list, which is what this figure is for.
  await page.screenshot({ path: resolve(OUT, 'dash-firstrun-full.png'),
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: 640 } });
  console.log('  saved dash-firstrun-full.png (top 640px)');

  // sidebar Workflow — the default Claude-plan flow. Clip to the steps (drop the
  // triage cards + paste box below) so the image stays compact for the guide's
  // side-by-side layout; the guide text covers triage + Deep dive.
  try {
    const wf = page.locator('.workflow-panel').first();
    await wf.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const pb = await wf.boundingBox();
    const sb = await page.locator('.workflow-steps').first().boundingBox();
    if (pb && sb && sb.y >= pb.y) {
      const height = Math.min(Math.ceil(sb.y + sb.height - pb.y + 6), Math.ceil(VIEWPORT.height - pb.y));
      await page.screenshot({ path: resolve(OUT, 'sidebar-workflow.png'),
        clip: { x: Math.max(0, Math.floor(pb.x)), y: Math.max(0, Math.floor(pb.y)), width: Math.ceil(pb.width), height } });
    } else {
      await wf.screenshot({ path: resolve(OUT, 'sidebar-workflow.png') });
    }
    console.log('  saved sidebar-workflow.png');
  } catch (e) { console.log('  workflow panel skip:', e.message); }

  // Setup hero: sub-tab bar + readiness + rail (incl. Models & cost) + preflight panel.
  await shotContent(page, 'lp-preflight');

  // Per-step panels (unchanged layout, refreshed for consistency).
  // Rail labels are matched with Playwright's hasText, which is case-insensitive,
  // so the 2026-07 capitalisation pass ("Identity & links" -> "Identity & Links")
  // needs no change here. The CV -> resume RENAME did: it silently stalled this
  // script for ~10 minutes on the wait above, then threw on the click below.
  await clickRail(page, 'Your resume');      await shotPanel(page, 'lp-cv');
  await clickRail(page, 'Identity & links'); await shotPanel(page, 'lp-identity', 760);
  await clickRail(page, 'Roles & seniority');await shotPanel(page, 'lp-roles');
  await clickRail(page, 'Your edge');        await shotPanel(page, 'lp-edge');
  try {
    // The handoff button's label varies per section ("Set up with my Claude Code ⧉"
    // on some, "Hand off to my Claude Code" on others), so match either.
    await page.locator('button', { hasText: /(Set up with|Hand off to) my Claude Code/ }).first().click();
    await page.waitForTimeout(600);
    await shotPanel(page, 'lp-edge-handoff');
  } catch (e) { console.log('  edge handoff skip:', e.message); }
  await clickRail(page, 'Compensation');     await shotPanel(page, 'lp-comp');
  // Location grew a three-mode "How you are willing to work" block, each mode with
  // its own commute control, so the panel is now taller than the page can take.
  await clickRail(page, 'Location & policy');await shotPanel(page, 'lp-location', 820);
  await clickRail(page, 'Evaluation tuning');await shotPanel(page, 'lp-evaluation');
  await clickRail(page, 'Companies to track');await shotPanel(page, 'lp-companies', 820);
  await clickRail(page, 'Output locations'); await shotPanel(page, 'lp-outputs');

  // Models & cost booster (NEW in v1.11.0).
  try { await clickRail(page, 'Models & cost'); await shotPanel(page, 'lp-models', 700); }
  catch (e) { console.log('  models skip:', e.message); }

  // Web discovery keys booster.
  try { await clickRail(page, 'Web discovery keys'); await shotPanel(page, 'lp-discovery'); }
  catch (e) { console.log('  discovery skip:', e.message); }

  // Health check — reload fresh, DOM-click the rail item, run it.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Launchpad');
  await waitRailEnabled(page, 'Your resume');
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Health check/.test(x.textContent) && /Verify/.test(x.textContent));
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  try {
    const runBtn = page.getByRole('button', { name: /Run health check/i });
    await runBtn.waitFor({ state: 'visible', timeout: 6000 });
    await runBtn.click();
    await page.waitForTimeout(1000);
  } catch (e) { console.log('  health run note:', e.message); }
  await shotPanel(page, 'lp-health');

  // Tell Me About Yourself sub-tab (NEW in v1.8.0).
  try {
    await page.locator('.subtab', { hasText: 'Tell' }).first().click();
    await page.waitForTimeout(600);
    await shotContent(page, 'lp-pitch');
  } catch (e) { console.log('  pitch skip:', e.message); }

  // ---- Phase A2: resume in, nothing else done ------------------------------
  // The single most important screen in Guide 2. It is the moment the product
  // says "you can stop setting up and go get a score", and until now no capture
  // could reach it, because the two states above are all-empty and all-complete.
  // Shows the green "You are ready to use trajecktory." banner, the Start using
  // it button, and the meter reading N/8 sharpened under "Result quality
  // (optional)" rather than any count of required steps.
  console.log('Phase A2 — resume in, refinements outstanding');
  stateMode = 'started';
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  // firstRun is false in this state, so the app lands on the working tabs rather
  // than opening Setup for you. Navigate there explicitly, exactly as Phase B
  // does. Skipping this does not fail fast: the rail never renders, so
  // waitRailEnabled burns its full 30 x 20s retry budget and the run appears to
  // hang for ten minutes before doing anything.
  try { await clickNav(page, 'Setup'); } catch { try { await clickNav(page, 'Launchpad'); } catch {} }
  await waitRailEnabled(page, 'Your resume');
  await page.waitForTimeout(800);
  // Cropped to the header, the ready banner and the meter. The rail badges are
  // already carried by lp-preflight.png, and a full-height shot here is nearly
  // square, which shrinks to an unreadable strip once the guide fits it to a
  // page that also has to carry the text explaining it.
  await shotContentTight(page, 'lp-started', 300);

  // ---- Phase B: the "you are ready" finale --------------------------------
  console.log('Phase B — ready state');
  stateMode = 'ready';
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  try { await clickNav(page, 'Setup'); } catch { try { await clickNav(page, 'Launchpad'); } catch {} }
  await page.waitForSelector('text=Setup complete', { timeout: 8000 }).catch(() => {});
  await waitRailEnabled(page, 'Your resume');
  await page.waitForTimeout(600);
  await shotContent(page, 'lp-ready');

  // ---- Phase C: the two day-to-day tabs (Today, Interview) ----------------
  // Captured in the 'ready' state, which is where a user actually meets them.
  // Every endpoint behind both tabs is intercepted above, so nothing on screen
  // comes off disk.
  console.log('Phase C — Today + Interview');
  dataMode = 'populated';
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  // The sidebar workflow WITH its scored triage cards below the steps. This is
  // the plan-flow view; an API-key user never sees this panel at all.
  // Just the scored cards, not the whole workflow panel. The full panel is ~1480px
  // tall against 406px wide, which is over eight inches at page width and blew
  // straight through the bottom of the page.
  try {
    const wf = page.locator('.workflow-panel').first();
    await wf.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const box = await wf.boundingBox();
    const headTop = await page.evaluate(() => {
      const n = [...document.querySelectorAll('.workflow-panel *')]
        .find(x => /^TRIAGE\b/i.test(x.textContent.trim()) && x.children.length === 0);
      return n ? n.getBoundingClientRect().top : null;
    });
    const y = headTop != null ? Math.max(0, headTop - 8) : box.y + 560;
    const height = Math.min(660, Math.ceil(box.y + box.height - y));
    await page.screenshot({ path: resolve(OUT, 'g3-triage.png'),
      clip: { x: Math.floor(box.x), y: Math.floor(y), width: Math.ceil(box.width), height } });
    console.log(`  saved g3-triage.png (cards only, ${height}px)`);
  } catch (e) { console.log('  g3 triage skip:', e.message); }

  await page.waitForTimeout(900);

  try {
    await clickNav(page, 'Today');
    await page.waitForTimeout(800);
    await shotContentTight(page, 'today-tab');

    // Guide 3 page 1 is the map of the app, so it needs the whole window with the
    // sidebar and its badges, in the state a set-up user actually sees.
    await page.screenshot({ path: resolve(OUT, 'g3-map.png'),
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: 660 } });
    console.log('  saved g3-map.png (top 660px)');

    await page.locator('.subtab', { hasText: 'Schedule' }).first().click();
    await page.waitForTimeout(700);
    await shotContentTight(page, 'g3-today-schedule', 640);
  } catch (e) { console.log('  today skip:', e.message); }

  // ---- Guide 3 captures -----------------------------------------------------
  // Every one of these renders from the single APPS fixture above.
  try {
    showTriage = false;
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await clickNav(page, 'Pipeline');
    await page.waitForTimeout(900);
    await shotContentTight(page, 'g3-pipeline-overview', 900);
    await page.locator('.subtab', { hasText: 'Active' }).first().click();
    await page.waitForTimeout(700);
    await shotContentTight(page, 'g3-pipeline-active', 720);

    await page.locator('.subtab', { hasText: 'Analytics' }).first().click();
    await page.waitForTimeout(900);
    // Capped to the KPI rows. Below them, Source Effectiveness needs response
    // history the fixture does not have, so it renders as headers over empty
    // space, and a guide should not point at a panel that looks broken.
    await shotContentTight(page, 'g3-pipeline-analytics', 420);

    // The report drawer, opened from a real row. Two tabs get their own figure:
    // Overview (what a score is made of) and Notes (the only tab you type into).
    await page.locator('.subtab', { hasText: 'Active' }).first().click();
    await page.waitForTimeout(600);
    // Open the row the CHEATSHEET fixture actually describes. The mock serves the
    // same report for every id, so opening any other row would pair a VP RevOps
    // write-up with a different company and title, which a careful reader spots.
    // Triage rows are also non-interactive (cursor:default), so match on both.
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tbody tr')]
        .filter(r => getComputedStyle(r).cursor === 'pointer');
      const row = rows.find(r => /Northwind Analytics/.test(r.textContent)) || rows[0];
      if (row) row.click();
    });
    // The Pipeline drawer is .pl-drawer. (.drawer is the Recruiters one.)
    const drawer = page.locator('.pl-drawer.open').first();
    await drawer.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1400); // let the cheatsheet fetch settle + slide-in finish
    await drawer.screenshot({ path: resolve(OUT, 'g3-drawer-overview.png') });
    console.log('  saved g3-drawer-overview.png');
    try {
      await clickDrawerTab(page, 'Notes');
      await page.waitForTimeout(900);
      await drawer.screenshot({ path: resolve(OUT, 'g3-drawer-notes.png') });
      console.log('  saved g3-drawer-notes.png');
    } catch (e) { console.log('  drawer notes skip:', e.message); }

    // The Posting tab: the saved copy of the job advert. Served from POSTING, so
    // no real advert can reach the image.
    try {
      await clickDrawerTab(page, 'Posting');
      await page.waitForTimeout(900);
      await drawer.screenshot({ path: resolve(OUT, 'g3-drawer-posting.png') });
      console.log('  saved g3-drawer-posting.png');
    } catch (e) { console.log('  drawer posting skip:', e.message); }

    // "How is this scored?" — the panel that answers the question the whole
    // product rests on. Back to Overview first, since the button lives in the
    // Global Score Breakdown section head.
    try {
      await clickDrawerTab(page, 'Overview');
      await page.waitForTimeout(700);
      await page.evaluate(() => {
        const d = document.querySelector('.pl-drawer.open');
        if (!d) return;
        const b = [...d.querySelectorAll('button')].find(x => /How is this scored\?/i.test(x.textContent));
        if (b) { b.scrollIntoView({ block: 'center' }); b.click(); }
      });
      await page.waitForTimeout(800);
      // Cropped to the breakdown and the panel it opens. A whole-drawer shot is
      // half as tall again as it is wide, and shrinking that to fit a page which
      // also carries the explanation leaves the text unreadable.
      const bs = await drawer.boundingBox();
      const top = await page.evaluate(() => {
        const d = document.querySelector('.pl-drawer.open');
        const n = [...d.querySelectorAll('*')]
          .find(x => x.children.length === 0 && /^Global Score Breakdown$/.test(x.textContent.trim()));
        return n ? n.getBoundingClientRect().top : null;
      });
      const y = top != null ? Math.max(bs.y, top - 10) : bs.y + bs.height * 0.42;
      await page.screenshot({ path: resolve(OUT, 'g3-score-explainer.png'),
        clip: { x: Math.floor(bs.x), y: Math.floor(y),
                width: Math.ceil(bs.width),
                height: Math.min(560, Math.ceil(bs.y + bs.height - y - 60)) } });
      console.log('  saved g3-score-explainer.png (breakdown + panel)');
    } catch (e) { console.log('  score explainer skip:', e.message); }
    // The stage track, cropped out of the open drawer: the control that moves a
    // role along. Northwind sits at 2nd Interview, so it shows a part-filled
    // track with both Back and Advance available.
    try {
      const b = await drawer.boundingBox();
      await page.screenshot({ path: resolve(OUT, 'g3-stage-track.png'),
        clip: { x: Math.floor(b.x), y: Math.floor(b.y) + 138, width: Math.ceil(b.width), height: 130 } });
      console.log('  saved g3-stage-track.png');
    } catch (e) { console.log('  stage track skip:', e.message); }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // The apply buttons live ONLY on an Evaluated row, so this needs a different
    // role from the one above. Cropped to the drawer footer.
    try {
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll('tbody tr')]
          .filter(r => getComputedStyle(r).cursor === 'pointer');
        const row = rows.find(r => /Umbra Logistics/.test(r.textContent));
        if (row) row.click();
      });
      const d2 = page.locator('.pl-drawer.open').first();
      await d2.waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(1200);
      const b2 = await d2.boundingBox();
      await page.screenshot({ path: resolve(OUT, 'g3-apply-buttons.png'),
        clip: { x: Math.floor(b2.x), y: Math.floor(b2.y + b2.height) - 150, width: Math.ceil(b2.width), height: 145 } });
      console.log('  saved g3-apply-buttons.png');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    } catch (e) { console.log('  apply buttons skip:', e.message); }
  } catch (e) { console.log('  g3 pipeline skip:', e.message); }

  // Block D tabs. Each renders from the same invented search.
  for (const [nav, name, cap] of [
    ['Follow-Ups', 'g3-followups', 640],
    ['Recruiters', 'g3-recruiters', 660],
    ['TA Outreach', 'g3-ta-outreach', 620],
    ['LinkedIn SSI', 'g3-linkedin-ssi', 700],
    ['Insights', 'g3-insights', 520],
  ]) {
    try {
      await clickNav(page, nav);
      await page.waitForTimeout(1100);
      await shotContentTight(page, name, cap);
    } catch (e) { console.log(`  ${name} skip:`, e.message); }
  }

  try {
    await clickNav(page, 'Interview');
    await page.waitForTimeout(900);
    // Pick the first company. Its latest round auto-selects, which is what we
    // want: the chip strip then shows a "Live" round and a "Prep only" round side
    // by side, and the Prep pane has content rather than an empty state.
    try {
      await page.locator('.focus-task').first().click();
      await page.waitForTimeout(700);
    } catch (e) { console.log('  interview company skip:', e.message); }
    await page.waitForTimeout(400);
    // Capped: the page needs the company list, round chips and sub-tabs, not the
    // whole prep document, which the surrounding text describes instead.
    await shotContentTight(page, 'interview-prep', 560);
  } catch (e) { console.log('  interview skip:', e.message); }

  await browser.close();
  console.log('Done. Screenshots in', OUT);
}

main().catch((e) => { console.error('capture failed:', e); process.exit(1); });
