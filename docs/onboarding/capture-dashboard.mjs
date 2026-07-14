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
  pitch: "I'm a revenue operations leader with about ten years turning messy go-to-market data into pipeline the whole team trusts. Most recently, as Director of RevOps at a Series C SaaS company, I rebuilt our forecasting and lead routing so sales cycles dropped by roughly a fifth. What I love is the seam between the data and the humans who act on it. I'm looking for a Director or VP role where I can own that end to end.",
  generated_at: '2026-07-06T15:00:00.000Z',
  tweaks: { seniority: 'Director', interviewStage: 'Recruiter screen', length: '90s', industry: '' },
};

let stateMode = 'firstrun'; // 'firstrun' | 'ready'

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
  await page.route('**/api/system/version', route => json(route, { version: '1.14.0' }));
  await page.route('**/api/claude-status', route => json(route, { signedIn: false }));
  await page.route('**/api/triage/results', route => json(route, TRIAGE));
  await page.route('**/api/agent/cost-history', route => json(route, []));
}

async function shotContent(page, name) {
  const el = page.locator('.content').first();
  await el.waitFor({ state: 'visible' });
  await page.waitForTimeout(350);
  await el.screenshot({ path: resolve(OUT, `${name}.png`) });
  console.log('  saved', name + '.png');
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
    await page.locator('button', { hasText: 'Set up with my Claude Code' }).first().click();
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

  await browser.close();
  console.log('Done. Screenshots in', OUT);
}

main().catch((e) => { console.error('capture failed:', e); process.exit(1); });
