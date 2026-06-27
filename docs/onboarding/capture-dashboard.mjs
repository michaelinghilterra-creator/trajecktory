#!/usr/bin/env node
/**
 * capture-dashboard.mjs — auto-capture the trajecktory dashboard + Launchpad for
 * the onboarding guide (Guide 2). PII-safe by construction:
 *
 *   - Tour tabs (Overview / Pipeline / Insights) are captured against the
 *     server running in DEMO mode, so they show the synthetic "Jordan Avery"
 *     data set, never the user's real applications.
 *   - The Launchpad reads the user's REAL config/profile.yml even in DEMO mode
 *     (server-side setupComputeState uses the repo root). So we never trust the
 *     live setup state: we intercept /api/setup/** in the browser and serve a
 *     pristine, synthetic first-run state. Nothing is written to disk.
 *
 * Prereq: the dashboard is running in DEMO mode on http://localhost:3333
 *   (cd dashboard-web && npm run dev:demo)
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
const VIEWPORT = { width: 1500, height: 1000 };
const SCALE = 2;

// ---- synthetic setup state (zero real PII) ---------------------------------
const SECTION_IDS = ['cv', 'identity', 'roles', 'edge', 'comp', 'location', 'evaluation', 'companies', 'outputs'];
function sectionsObj(status) {
  const o = {
    preflight: { kind: 'action' },
    firstEval: { kind: 'action' },
    health: { kind: 'action' },
  };
  for (const id of SECTION_IDS) o[id] = { kind: id === 'identity' || id === 'comp' || id === 'location' || id === 'outputs' ? 'form' : 'gen', status };
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
// engineOk:true so every setup step is available immediately. The engine checks
// pass (green); missing cv/profile show as friendly, non-blocking to-dos.
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

let stateMode = 'firstrun'; // 'firstrun' | 'ready'

async function installSetupMocks(page) {
  await page.route('**/api/setup/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();
    const json = (obj) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(obj) });

    if (p.endsWith('/api/setup/state')) return json(stateMode === 'ready' ? STATE_READY : STATE_FIRSTRUN);
    if (p.endsWith('/api/setup/preflight')) return json(PREFLIGHT_OK);
    if (p.endsWith('/api/setup/healthcheck')) return json(HEALTH_OK);
    if (p.includes('/api/setup/stage/')) {
      if (method === 'GET') {
        const key = p.split('/').pop();
        return json(STAGE[key] || {});
      }
      return json({ ok: true }); // swallow POST writes
    }
    if (p.includes('/api/setup/first-eval')) {
      return json({ ok: true, prompt: 'Evaluate this job posting end to end (score, report, tracker): https://jobs.example.com/senior-revenue-operations-manager . IMPORTANT: only edit config files; never modify data/applications.md, reports/, or scan history.' });
    }
    if (p.includes('/api/setup/save/') || p.includes('/api/setup/reset/')) return json({ ok: true, state: STATE_FIRSTRUN });
    // handoff prompts are static, read-only text — let them hit the server for authenticity
    return route.continue();
  });
}

async function shotContent(page, name) {
  const el = page.locator('.content');
  await el.first().waitFor({ state: 'visible' });
  await page.waitForTimeout(350);
  await el.first().screenshot({ path: resolve(OUT, `${name}.png`) });
  console.log('  saved', name + '.png');
}

// Screenshot just the active Launchpad panel (the right-hand card). Narrower than
// the full .content, so in-screenshot text stays legible when fit to a PDF page.
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
  const btn = page.locator('button', { hasText: label }).first();
  await btn.click();
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

  // ---- Phase A: tour tabs (demo data, no setup interception) --------------
  console.log('Phase A — tour tabs (demo data)');
  // Force the "Sign in to Claude" call-to-action (this dev machine is already
  // signed in, which would otherwise render the "Signed in" state).
  await page.route('**/api/claude-status', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedIn: false }) }));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  // full-window hero with the sidebar, so users recognize the app shell
  await page.screenshot({ path: resolve(OUT, 'dash-overview-full.png') });
  console.log('  saved dash-overview-full.png');
  await shotContent(page, 'dash-overview');
  // sidebar Workflow panel (renamed from "Morning Workflow"; holds the Sign in
  // to Claude control + the 8 individual steps).
  try {
    const wf = page.locator('.workflow-panel').first();
    await wf.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await wf.screenshot({ path: resolve(OUT, 'sidebar-workflow.png') });
    console.log('  saved sidebar-workflow.png');
  } catch (e) { console.log('  workflow panel skip:', e.message); }
  try { await clickNav(page, 'Pipeline'); await shotContent(page, 'dash-pipeline'); } catch (e) { console.log('  pipeline skip:', e.message); }
  try { await clickNav(page, 'Insights'); await shotContent(page, 'dash-insights'); } catch (e) { console.log('  insights skip:', e.message); }

  // ---- Phase B: pristine first-run Launchpad (intercepted) ----------------
  // Narrower viewport so the panel content is wider relative to its pixels,
  // which keeps in-screenshot text readable once placed in the PDF.
  console.log('Phase B — Launchpad first-run (synthetic)');
  await page.setViewportSize({ width: 1300, height: 1000 });
  await installSetupMocks(page);
  stateMode = 'firstrun';
  await page.goto(BASE, { waitUntil: 'networkidle' });   // firstRun:true -> opens Launchpad
  await page.waitForSelector('text=Launchpad');
  await waitRailEnabled(page, 'Your CV');
  await page.waitForTimeout(600);

  // hero / preflight (header + readiness + rail + green preflight checks)
  await shotContent(page, 'lp-preflight');

  await clickRail(page, 'Your CV');          await shotPanel(page, 'lp-cv');
  await clickRail(page, 'Identity & links'); await shotPanel(page, 'lp-identity');
  await clickRail(page, 'Roles & seniority');await shotPanel(page, 'lp-roles');

  // edge: also capture the handoff "copied prompt" state
  await clickRail(page, 'Your edge');        await shotPanel(page, 'lp-edge');
  try {
    await page.locator('button', { hasText: 'Hand off to my Claude Code' }).first().click();
    await page.waitForTimeout(600);
    await shotPanel(page, 'lp-edge-handoff');
  } catch (e) { console.log('  edge handoff skip:', e.message); }

  await clickRail(page, 'Compensation');     await shotPanel(page, 'lp-comp');
  await clickRail(page, 'Location & policy');await shotPanel(page, 'lp-location');
  await clickRail(page, 'Evaluation tuning');await shotPanel(page, 'lp-evaluation');
  await clickRail(page, 'Companies to track');await shotPanel(page, 'lp-companies');
  await clickRail(page, 'Output locations'); await shotPanel(page, 'lp-outputs');

  // (the "First evaluation" Launchpad step was removed in v1.7.5+; evaluation now
  // lives in the sidebar Workflow, not in Setup.)

  // health check: reload fresh, navigate via a precise DOM click (the rail item
  // uniquely contains both "Health check" and its "Verify" sublabel), then run.
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

  // web discovery keys booster (optional boosters: Brave + Muse fields)
  try {
    await page.locator('button', { hasText: 'Web discovery keys' }).first().click();
    await page.waitForTimeout(500);
    await shotPanel(page, 'lp-discovery');
  } catch (e) { console.log('  discovery skip:', e.message); }

  // ---- Phase C: the "you are ready" finale --------------------------------
  console.log('Phase C — ready state');
  stateMode = 'ready';
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  // firstRun:false keeps the app on Overview, so open the Setup/Launchpad tab.
  try { await clickNav(page, 'Setup'); } catch { try { await clickNav(page, 'Launchpad'); } catch {} }
  await page.waitForSelector('text=Setup complete', { timeout: 8000 }).catch(() => {});
  await waitRailEnabled(page, 'Your CV');
  await page.waitForTimeout(600);
  await shotContent(page, 'lp-ready');

  await browser.close();
  console.log('Done. Screenshots in', OUT);
}

main().catch((e) => { console.error('capture failed:', e); process.exit(1); });
