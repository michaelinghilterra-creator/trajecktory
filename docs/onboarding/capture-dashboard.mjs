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
 *     Launchpad (first-run + ready), the Models & cost booster, and the Tell Me
 *     About Yourself pitch builder. The populated Overview/Pipeline/Insights
 *     "tour" tabs are NOT captured here (they need real data); the existing
 *     dash-overview-full.png is kept.
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
function sectionsObj(status) {
  const o = { preflight: { status: 'complete' }, health: { status: status === 'complete' ? 'complete' : 'empty' } };
  for (const id of SECTION_IDS) o[id] = { status };
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
const PREFLIGHT_OK = {
  ok: false, engineOk: true, failures: 0, checks: [
    { label: 'Node.js 20 or newer is installed', pass: true, blocking: true },
    { label: 'Dashboard dependencies installed', pass: true, blocking: true },
    { label: 'Playwright Chromium is available', pass: true, blocking: true },
    { label: 'Data and reports folders are present', pass: true, blocking: true },
    { label: 'Your CV (cv.md)', pass: false, blocking: false },
    { label: 'Your profile (config/profile.yml)', pass: false, blocking: false },
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
  note: 'Billing set to your Claude plan: your saved API key is not charged. Flip back to bill the key. $ figures show what the API-key path would cost.',
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

let stateMode = 'firstrun'; // 'firstrun' | 'ready'
// 'empty'      → a genuinely fresh install: no triage results, no to-dos, no
//                cadence, so no sidebar badges. This is what the first-run
//                screenshot must show, because the guide says "it starts empty".
// 'populated'  → the Today / Interview tabs, where content is the whole point.
let dataMode = 'empty';
const EMPTY_STREAK = { current: 0, best: 0, last7: Array.from({ length: 7 }, (_, i) => ({ date: `2026-07-${13 + i}`, pct: null, rest: true })) };

async function installMocks(page) {
  const json = (route, obj) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });
  await page.route('**/api/setup/**', async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const method = req.method();
    if (p.endsWith('/api/setup/state')) return json(route, stateMode === 'ready' ? STATE_READY : STATE_FIRSTRUN);
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
  await page.route('**/api/system/version', route => json(route, { version: '1.16.1' }));
  await page.route('**/api/claude-status', route => json(route, { signedIn: false }));
  await page.route('**/api/triage/results', route => json(route, dataMode === 'empty' ? { cards: [] } : TRIAGE));
  await page.route('**/api/agent/cost-history', route => json(route, []));
  await page.route('**/api/agent/active', route => json(route, {}));
  // Pin the updater to "current". A fresh install has nothing to update, and an
  // update banner across the top of the first-run screenshot would be a lie.
  await page.route('**/api/system/update-check', route => json(route, { status: 'up-to-date' }));

  // App shell: these three are fetched on every page load, and all three read
  // real user data. /api/identity is the user's name, email and phone outright.
  await page.route('**/api/applications', route => json(route, []));
  await page.route('**/api/identity', route => json(route, IDENTITY));
  await page.route('**/api/followups/stale', route => json(route, { warm: [], cold: [] }));

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
async function shotPanel(page, name) {
  const el = page.locator('.card.padded-lg').first();
  await el.waitFor({ state: 'visible' });
  await page.waitForTimeout(350);
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
async function waitRailEnabled(page, label) {
  const btn = page.locator('button', { hasText: label }).first();
  for (let i = 0; i < 30; i++) {
    try { if (!(await btn.isDisabled())) return; } catch {}
    await page.waitForTimeout(250);
  }
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
  await waitRailEnabled(page, 'Your CV');
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
  await clickRail(page, 'Your CV');          await shotPanel(page, 'lp-cv');
  await clickRail(page, 'Identity & links'); await shotPanel(page, 'lp-identity');
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
  await clickRail(page, 'Location & policy');await shotPanel(page, 'lp-location');
  await clickRail(page, 'Evaluation tuning');await shotPanel(page, 'lp-evaluation');
  await clickRail(page, 'Companies to track');await shotPanel(page, 'lp-companies');
  await clickRail(page, 'Output locations'); await shotPanel(page, 'lp-outputs');

  // Models & cost booster (NEW in v1.11.0).
  try { await clickRail(page, 'Models & cost'); await shotPanel(page, 'lp-models'); }
  catch (e) { console.log('  models skip:', e.message); }

  // Web discovery keys booster.
  try { await clickRail(page, 'Web discovery keys'); await shotPanel(page, 'lp-discovery'); }
  catch (e) { console.log('  discovery skip:', e.message); }

  // Health check — reload fresh, DOM-click the rail item, run it.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForSelector('text=Launchpad');
  await waitRailEnabled(page, 'Your CV');
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

  // ---- Phase B: the "you are ready" finale --------------------------------
  console.log('Phase B — ready state');
  stateMode = 'ready';
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  try { await clickNav(page, 'Setup'); } catch { try { await clickNav(page, 'Launchpad'); } catch {} }
  await page.waitForSelector('text=Setup complete', { timeout: 8000 }).catch(() => {});
  await waitRailEnabled(page, 'Your CV');
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

  try {
    await clickNav(page, 'Today');
    await page.waitForTimeout(800);
    await shotContentTight(page, 'today-tab');
  } catch (e) { console.log('  today skip:', e.message); }

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
