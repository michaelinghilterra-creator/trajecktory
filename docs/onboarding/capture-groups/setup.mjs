/**
 * Group: setup. The Launchpad / Setup tab and every one of its sub-tabs, in the
 * three states a user passes through: first run, "started" (resume in, nothing
 * else) and ready (every refinement done).
 *
 * state.setup drives /api/setup/state (and everything that should differ by
 * state). Mocks here are registered after the shell's, so they win. A mock is
 * matched on pathname (not a glob) so query strings never slip past it.
 */
import {
  state, json, gotoApp, clickSub, clickButton,
  shotWindow, shotTight, shotEl, shotClip,
} from '../capture-lib.mjs';
import * as X from './setup-fixtures.mjs';

export const meta = { name: 'setup', summary: 'Launchpad (first run, started, ready) and every Setup sub-tab and booster' };

// ---- mutable mock switches -------------------------------------------------
const sw = {
  keys: { anthropic: false, brave: false, muse: false, hunter: false, mv: false },
  billing: 'plan',           // 'plan' | 'key' (only matters when a key is saved)
  activation: 'off',         // 'off' | 'on'
  eventStoreRan: false,
  gmail: 'none',             // read by capture, mirrored into state.google
};

const BLANK_IDENTITY = { name: '', email: '', phone: '', location: '', linkedin: '', portfolio: '', github: '', certifications: [] };
const byState = (a, b, c) => (state.setup === 'firstrun' ? a : state.setup === 'started' ? b : c);

export async function install(page) {
  const on = (path, handler) => page.route((u) => u.pathname === path, handler);
  const get = (path, body) => on(path, (r) => (r.request().method() === 'GET' ? json(r, typeof body === 'function' ? body() : body) : json(r, { ok: true })));

  await on('/api/identity', (r) => json(r, byState(BLANK_IDENTITY, BLANK_IDENTITY, {
    name: 'Jordan Avery', email: 'jordan.avery@example.com', phone: '(555) 010-4477', location: 'Austin, TX',
    linkedin: 'https://example.com/in/jordan-avery', portfolio: 'https://example.com/jordan-avery', github: '', certifications: [],
  })));

  // Setup state and the actions around it
  await get('/api/setup/state', () => byState(X.STATE_FIRSTRUN, X.STATE_STARTED, X.STATE_READY));
  await on('/api/setup/preflight', (r) => json(r, byState(X.PREFLIGHT_FIRSTRUN, X.PREFLIGHT_STARTED, X.PREFLIGHT_READY)));
  await on('/api/setup/healthcheck', (r) => json(r, X.HEALTH_FRESH));
  await on('/api/setup/pitch', (r) => json(r, byState({ pitch: '', tweaks: null, generated_at: null }, X.PITCH, X.PITCH)));
  await on('/api/setup/pitch/generate', (r) => json(r, X.PITCH));
  await on('/api/setup/pitch/save', (r) => json(r, { ok: true }));
  await page.route((u) => u.pathname.startsWith('/api/setup/stage/'), (r) => {
    if (r.request().method() !== 'GET') return json(r, { ok: true });
    const key = new URL(r.request().url()).pathname.split('/').pop();
    return json(r, byState({}, X.STAGE_STARTED, X.STAGE_READY)[key] || {});
  });
  await page.route((u) => u.pathname.startsWith('/api/setup/handoff/'), (r) => {
    const key = new URL(r.request().url()).pathname.split('/').pop();
    return json(r, { prompt: X.setupHandoffPrompt(key) });
  });
  await page.route((u) => u.pathname.startsWith('/api/setup/save/') || u.pathname.startsWith('/api/setup/reset/'),
    (r) => json(r, { ok: true, changed: 0, state: byState(X.STATE_FIRSTRUN, X.STATE_STARTED, X.STATE_READY) }));

  // Companies step
  await get('/api/setup/companies', () => ({ companies: byState([], X.TRACKED_STARTED, X.TRACKED_COMPANIES) }));
  await get('/api/setup/portals-backups', { backups: [] });

  // Keys
  await get('/api/setup/anthropic-key', () => ({ hasKey: sw.keys.anthropic }));
  await get('/api/setup/discovery-keys', () => ({ brave: sw.keys.brave, muse: sw.keys.muse }));
  await get('/api/setup/verify-keys', () => ({ hunter: sw.keys.hunter, millionverifier: sw.keys.mv }));
  await get('/api/buffer/status', () => (state.buffer === 'connected' ? { connected: true, hint: '...x9f2' } : { connected: false }));

  // Models and cost
  await get('/api/setup/models', () => X.modelsFor({ keyPresent: sw.keys.anthropic, billing: sw.billing }));
  await on('/api/agent/cost-history', (r) => {
    const q = new URL(r.request().url()).searchParams;
    const ready = state.setup === 'ready';
    if (q.get('groupBy') === 'day') {
      return json(r, ready ? X.costRollup() : { days: [], total: { cost: 0, machineTimeMs: 0, machineTimeApiMs: 0, runs: 0, byMode: {} }, from: null, to: null });
    }
    return json(r, ready ? X.COST_HISTORY : []);
  });

  // Help improve setup
  await on('/api/setup/activation', (r) => json(r, sw.activation === 'on' ? X.ACTIVATION_ON : X.ACTIVATION_OFF));
  await on('/api/setup/activation/event', (r) => json(r, { recorded: false }));

  // Resume cards (CV step)
  await on('/api/resume/cadence', (r) => (state.setup === 'firstrun'
    ? json(r, { error: 'No cv.md yet. Add your resume in Setup to run a rhythm check.' }, 404) : json(r, X.resumeCadence())));
  await on('/api/resume/style', (r) => (state.setup === 'firstrun'
    ? json(r, { error: 'No cv.md yet. Add your resume in Setup to run a plain-language check.' }, 404) : json(r, X.resumeStyle())));

  // Sub-tabs
  await get('/api/setup/customize', X.CUSTOMIZE);
  await get('/api/setup/changelog', X.CHANGELOG);
  await get('/api/setup/twc', X.TWC);
  await get('/api/setup/twc/gate', X.TWC_GATE);
  await get('/api/setup/twc/events', X.TWC_EVENTS);
  await get('/api/setup/weekly-review', X.WEEKLY_REVIEW);
  await get('/api/setup/event-store/status', X.EVENT_STORE_STATUS);
  await on('/api/setup/event-store/preview', (r) => json(r, X.EVENT_STORE_REPORT));
}

// ---- helpers ---------------------------------------------------------------
async function waitRail(page) {
  await page.waitForSelector('text=Optional boosters');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => /Your resume/.test(b.textContent) && !b.disabled));
  await page.waitForTimeout(500);
}
async function load(page, mode, data) {
  state.setup = mode; state.data = data;
  await gotoApp(page);
  // The floating Ask the Coach button sits over the bottom-right of tall crops.
  await page.addStyleTag({ content: 'button[aria-label="Ask the Coach"]{visibility:hidden !important}' });
}
async function openSetup(page) {
  const nav = page.locator('.nav-item').filter({ hasText: /^\s*◇?\s*(Launchpad|Setup)/ }).first();
  await nav.click();
  await page.waitForTimeout(700);
  await waitRail(page);
}
// The Launchpad reads Gmail health, key status and the activation log once, when it
// mounts. Leave the sub-tab and come back to make it read them again.
async function remount(page) {
  await clickSub(page, 'Customize', { exact: true });
  await clickSub(page, 'Launchpad', { exact: true });
  await waitRail(page);
}
async function rail(page, label) {
  await page.locator('button', { hasText: label }).first().click();
  await page.waitForTimeout(650);
}
const PANEL = '.card.padded-lg';
// A scrolling .content cannot be photographed past the viewport, so give tall
// shots a taller viewport for the moment and cap the image at 1000 css px
// (2000 px at 2x), then put the viewport back.
async function tall(page, fn) {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.waitForTimeout(300);
  try { await fn(); } finally {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(200);
  }
}
const shotPanel = (page, name, maxH = 1000) => tall(page, async () => {
  await page.locator(PANEL).first().evaluate(el => el.scrollIntoView({ block: 'start' }));
  await shotEl(page, PANEL, name, { maxH });
});
const shotAll = (page, name, cap = 1000) => tall(page, async () => {
  await page.locator('.content').first().evaluate(el => { el.scrollTop = 0; });
  await shotTight(page, name, cap);
});
const field = (page, label) => page.locator('.field').filter({ has: page.locator('label').filter({ hasText: new RegExp('^' + label) }) });
async function fill(page, label, value) { await field(page, label).locator('input').fill(value); }
async function pick(page, label, value) { await field(page, label).locator('select').selectOption(value); }
const sectionOf = (heading) => `xpath=//h4[normalize-space()="${heading}"]/..`;

export async function capture({ page }) {
  // ===========================================================================
  // 1. FIRST RUN: nothing exists yet
  // ===========================================================================
  console.log('-- first run');
  sw.keys = { anthropic: false, brave: false, muse: false, hunter: false, mv: false };
  state.google = 'disconnected'; state.buffer = 'disconnected';
  await load(page, 'firstrun', 'empty');   // firstRun true: the app opens Setup by itself
  await waitRail(page);
  await shotWindow(page, 'dash-firstrun-full', 640);
  await shotAll(page, 'lp-preflight');
  await rail(page, 'Your resume');
  await shotPanel(page, 'lp-cv');

  // ===========================================================================
  // 2. STARTED: resume in, nothing else
  // ===========================================================================
  console.log('-- started');
  await load(page, 'started', 'empty');
  await openSetup(page);
  await shotTight(page, 'lp-started', 300);

  await rail(page, 'Your resume');
  await shotPanel(page, 'lp-cv-done');       // extra: rhythm and plain-language cards once a resume is in

  await rail(page, 'Identity & Links');
  await fill(page, 'Full name', 'Jordan Avery');
  await fill(page, 'Email', 'jordan.avery@example.com');
  await fill(page, 'Phone', '(555) 010-4477');
  await fill(page, 'Home base', 'Austin, TX');
  await page.getByLabel('https://yourname.com').fill('https://example.com/jordan-avery');
  await page.getByLabel('linkedin.com/in/…').fill('example.com/in/jordan-avery');
  await shotPanel(page, 'lp-identity', 725);

  await rail(page, 'Roles & Seniority');
  await shotPanel(page, 'lp-roles');

  await rail(page, 'Your edge');
  await shotPanel(page, 'lp-edge');
  await clickButton(page, /(Set up with|Hand off to) my Claude Code/);
  await page.waitForTimeout(500);
  await shotPanel(page, 'lp-edge-handoff');

  await rail(page, 'Compensation');
  await pick(page, 'Target minimum', '$160K');
  await pick(page, 'Target maximum', '$210K');
  await pick(page, 'Walk-away', '$140K');
  await fill(page, 'Currency', 'USD');
  await shotPanel(page, 'lp-comp');

  await rail(page, 'Location & Policy');
  await fill(page, 'City', 'Austin, TX');
  await pick(page, 'Country', 'United States');
  await pick(page, 'Timezone', 'Central (CT)');
  await pick(page, 'Visa status', 'U.S. Citizen');
  await page.locator('button', { hasText: 'Hybrid' }).filter({ hasText: 'Some days in the office' }).click();
  await page.locator('button', { hasText: 'Remote' }).filter({ hasText: 'You work from home' }).click();
  await pick(page, 'Furthest you would commute', '1 hour');
  await pick(page, 'Where the employer can be', 'Anywhere in my country');
  await fill(page, 'Never work in', 'Phoenix, Denver');
  await shotPanel(page, 'lp-location', 820);

  await rail(page, 'Evaluation tuning');
  await shotPanel(page, 'lp-evaluation');

  await rail(page, 'Companies to track');
  await page.waitForTimeout(500);
  await shotPanel(page, 'lp-companies', 820);

  await rail(page, 'Output locations');
  await shotPanel(page, 'lp-outputs');

  await rail(page, 'Models & cost');
  await shotPanel(page, 'lp-models', 700);

  await rail(page, 'API keys');
  await shotPanel(page, 'lp-apikeys', 820);

  await rail(page, 'Health check');
  await page.getByRole('button', { name: /Run health check/i }).click();
  await page.waitForSelector('text=Everything looks good');
  await shotPanel(page, 'lp-health');

  await clickSub(page, 'Tell Me About Yourself', { exact: true });
  await shotAll(page, 'lp-pitch');

  // ===========================================================================
  // 3. READY: every refinement done
  // ===========================================================================
  console.log('-- ready');
  sw.keys = { anthropic: true, brave: true, muse: false, hunter: false, mv: false };
  sw.billing = 'plan';
  await load(page, 'ready', 'populated');
  console.log('  nav labels (ready):', await page.locator('.nav-item').allInnerTexts().then(a => a.map(t => t.replace(/s+/g, ' ').trim()).join(' | ')));
  await shotWindow(page, 'dash-ready-nav', 640);    // extra: the nav once setup is done (label is Setup)
  await openSetup(page);
  await shotAll(page, 'lp-ready');

  await rail(page, 'Roles & Seniority');
  await shotAll(page, 'set-launchpad');
  await rail(page, 'Your edge');
  await shotPanel(page, 'lp-ready-edge');
  await rail(page, 'Location & Policy');
  await shotPanel(page, 'lp-ready-location', 820);
  await rail(page, 'Evaluation tuning');
  await shotPanel(page, 'lp-ready-evaluation');
  await rail(page, 'Companies to track');
  await page.waitForTimeout(500);
  await shotPanel(page, 'lp-ready-companies', 820);

  // ---- every sub-tab ----
  await clickSub(page, 'Customize', { exact: true });
  await shotAll(page, 'set-customize');

  await clickSub(page, 'Day-to-day guide', { exact: true });
  await page.waitForSelector('.ib-navitem');
  await shotAll(page, 'set-guide');
  await page.locator('.ib-navitem', { hasText: 'Reading a report' }).click();
  await page.waitForTimeout(1500);
  await tall(page, () => shotTight(page, 'set-guide-chapter', 1000));

  await clickSub(page, 'Tell Me About Yourself', { exact: true });
  await shotAll(page, 'set-pitch');

  await clickSub(page, 'Activity Tracker', { exact: true });
  await page.waitForSelector('text=Activities per week');
  await shotAll(page, 'set-activity-tracker');

  await clickSub(page, 'Weekly review', { exact: true });
  await page.waitForSelector('text=open,');
  await shotAll(page, 'set-weekly-review');

  await clickSub(page, 'Data storage', { exact: true });
  await shotAll(page, 'set-data-storage');
  await page.getByRole('button', { name: /Check what would change/ }).click();
  await page.waitForSelector('text=Every check passes');
  await shotAll(page, 'set-data-storage-check');   // extra: the dry run report

  await clickSub(page, 'Change Log', { exact: true });
  await page.waitForSelector('text=current');
  await shotAll(page, 'set-changelog');

  await clickSub(page, 'About', { exact: true });
  await page.waitForSelector('text=FAQ');
  await shotAll(page, 'set-about');

  // ---- every optional booster ----
  await clickSub(page, 'Launchpad', { exact: true });
  await waitRail(page);

  await rail(page, 'Models & cost');
  await page.waitForSelector('text=Per-day totals');
  await shotPanel(page, 'set-boost-models-cost', 1000);
  await tall(page, async () => {            // extra: the per-day totals table lower in the same panel
    await page.getByText('Per-day totals').first().evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(300);
    const h = await page.getByText('Per-day totals').first().boundingBox();
    const t = await page.locator('table.mono').first().boundingBox();
    const note = await page.getByText('These runs are Agent Scan and Evaluate').first().boundingBox();
    const left = Math.floor(t.x - 26);
    await shotClip(page, 'set-boost-models-cost-perday', { x: left, y: Math.floor(h.y - 12), width: Math.ceil(t.width + 52), height: Math.ceil(note.y + note.height - h.y + 28) });
  });
  sw.billing = 'key';                       // extra: the same panel with the API key billing the workflow
  await rail(page, 'Email replies');
  await rail(page, 'Models & cost');
  await page.waitForSelector('text=API-key mode');
  await shotPanel(page, 'set-boost-models-cost-apikey', 1000);
  sw.billing = 'plan';

  await rail(page, 'API keys');
  await page.waitForSelector('text=Social posting');
  await shotPanel(page, 'set-boost-apikeys', 1000);
  await shotEl(page, sectionOf('Contact email checking'), 'set-boost-contact-email');
  await shotEl(page, sectionOf('Social posting'), 'set-boost-social-posting');

  await rail(page, 'Email replies');
  await page.waitForSelector('text=Not set up');
  await shotPanel(page, 'set-boost-email-replies', 1000);
  state.google = 'connected';               // extra: connected state
  await remount(page);
  await rail(page, 'Email replies');
  await page.waitForSelector('text=Connected as');
  await shotPanel(page, 'set-boost-email-replies-connected', 700);
  state.google = 'disconnected';

  await rail(page, 'Obsidian vault');
  await shotPanel(page, 'set-boost-obsidian');

  await rail(page, 'Market / language modes');
  await shotPanel(page, 'set-boost-modes');

  await rail(page, 'Search intensity');
  await shotPanel(page, 'set-boost-search-intensity');

  await rail(page, 'Help improve setup');
  await shotPanel(page, 'set-boost-help-improve-off');   // extra: off
  sw.activation = 'on';
  await remount(page);
  await rail(page, 'Help improve setup');
  await page.waitForSelector('text=So far');
  await shotPanel(page, 'set-boost-help-improve');
  sw.activation = 'off';

  await rail(page, 'Import past applications');
  await shotPanel(page, 'set-boost-import');
}
