#!/usr/bin/env node
/**
 * capture-readme-gallery.mjs: regenerate the README gallery in docs/screenshots.
 *
 * Same zero-PII setup as capture-guide.mjs (read its header first): run from a data-free
 * checkout against a scratch dashboard on port 3399, every /api/** request that no mock
 * claims fails the run, and every on-screen value comes from the invented fixtures in
 * capture-groups/. Each shot is a whole 1440x1000 window at 2x (2880x2000), taken in its
 * own browser session so mocks from one view can never leak into another.
 *
 * Usage: node docs/onboarding/capture-readme-gallery.mjs [--only 01,09]
 *
 * The filenames are the ones the README already links, so nothing in the README has to
 * be re-pointed. Some names predate the current tabs (02-pipeline-active is the Roles
 * sub-tab, 25-crm-overview is Network, Referrals); docs/screenshots/captions.txt says so.
 */
import { launch, assertClean, gotoApp, clickNav, clickSub, openRowDrawer, state, closeBrowser, VIEWPORT } from './capture-lib.mjs';
import { installShell } from './capture-shell.mjs';
import { pathToFileURL, fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'screenshots');
/** The live follow-up feed only holds talent contacts, so the README shows that honest state. */
const taOnlyQueue = async () => { const m = await group('network'); m.S.queue = 'ta'; };
const group = (name) => import(pathToFileURL(resolve(__dirname, 'capture-groups', `${name}.mjs`)).href);

/** Hide the floating chat button so it never sits over the picture. */
async function hideFloaters(page) {
  const n = await page.evaluate(() => {
    let hidden = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (getComputedStyle(el).position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.width < 90 && r.height < 90 && r.right > window.innerWidth - 120 && r.bottom > window.innerHeight - 140) { el.style.display = 'none'; hidden++; }
    }
    return hidden;
  });
  if (n === 0) throw new Error('hideFloaters: no floating button found (selector drift?)');
}
const park = (page) => page.mouse.move(60, 700);
const scrollTo = (page, selector) => page.evaluate((s) => {
  const el = document.querySelector(s) || [...document.querySelectorAll('h2,h3')].find((x) => x.textContent.trim() === s);
  if (el) el.scrollIntoView({ block: 'start' });
}, selector);

async function drawerTab(page, label) {
  const t = page.locator('.pl-drawer.open .dr-tab').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) });
  if (await t.count() !== 1) throw new Error(`drawer tab "${label}" not found exactly once`);
  await t.click();
  await page.waitForTimeout(800);
}
async function openNorthwind(page) {
  await clickNav(page, 'Pipeline');
  await clickSub(page, 'Roles', { exact: true });
  await openRowDrawer(page, 'Northwind Analytics');
}
async function hideQuote(page) {
  await page.evaluate(() => {
    const q = [...document.querySelectorAll('.content div')].find((n) => n.children.length === 2 && n.firstElementChild.style.fontStyle === 'italic');
    if (!q) throw new Error('daily quote card not found');
    q.style.display = 'none';
  });
}

const SHOTS = [
  { id: '01', file: '01-pipeline-overview', groups: ['pipeline'], run: async (p) => {
    await clickNav(p, 'Pipeline'); await clickSub(p, 'Overview', { exact: true });
    await p.waitForSelector('text=numbers on this page tie out'); await hideQuote(p); } },
  { id: '02', file: '02-pipeline-active', groups: ['pipeline'], run: async (p) => {
    await clickNav(p, 'Pipeline'); await clickSub(p, 'Roles', { exact: true }); await p.waitForSelector('text=30 of 30'); } },
  { id: '04', file: '04-pipeline-analytics', groups: ['pipeline'], run: async (p) => {
    await clickNav(p, 'Pipeline'); await clickSub(p, 'Analytics', { exact: true }); await p.waitForSelector('text=Response Progress'); } },
  { id: '11', file: '11-drawer-overview', groups: ['drawer'], run: async (p) => { await openNorthwind(p); await drawerTab(p, 'Overview'); } },
  { id: '12', file: '12-drawer-cvmatch', groups: ['drawer'], run: async (p) => { await openNorthwind(p); await drawerTab(p, 'Resume Match'); } },
  { id: '13', file: '13-drawer-comp', groups: ['drawer'], run: async (p) => { await openNorthwind(p); await drawerTab(p, 'Comp'); } },
  { id: '14', file: '14-drawer-interview', groups: ['drawer'], run: async (p) => { await openNorthwind(p); await drawerTab(p, 'Interview'); } },
  { id: '05', file: '05-followups', groups: ['network'], pre: () => taOnlyQueue(), run: async (p) => {
    await clickNav(p, 'Network'); await p.waitForSelector('h2:has-text("Follow-ups")'); await scrollTo(p, 'Follow-ups'); } },
  { id: '21', file: '21-outreach-composer', groups: ['network'], pre: () => taOnlyQueue(), run: async (p) => {
    await clickNav(p, 'Network'); await p.waitForSelector('h2:has-text("Follow-ups")');
    const card = p.locator('.card[style*="border-left"]').filter({ hasText: 'Desmond Aldaine' }).first();
    await card.getByRole('button', { name: 'Draft note' }).click(); await p.waitForTimeout(700);
    await card.getByRole('button', { name: 'Draft email' }).click(); await p.waitForTimeout(700);
    await card.evaluate((el) => el.scrollIntoView({ block: 'start' })); } },
  { id: '25', file: '25-crm-overview', groups: ['network'], run: async (p) => {
    await clickNav(p, 'Network'); await clickSub(p, 'Referrals', { exact: true }); await p.waitForSelector('text=Stage 1'); } },
  { id: '09', file: '09-insights', groups: ['insights'], pre: () => { state.insights = 'generated'; state.google = 'connected'; }, run: async (p) => {
    await clickNav(p, 'Insights'); await clickSub(p, 'Insights', { exact: true }); await p.waitForSelector("text=This week's focus"); } },
  { id: '24', file: '24-gmail-capture', groups: ['insights'], pre: () => { state.google = 'connected'; state.review = 'idle'; }, init: true, run: async (p) => {
    await clickNav(p, 'Insights'); await p.getByText('Weekly review', { exact: true }).first().waitFor();
    await p.locator('button:has-text("Check email")').click();
    await p.getByText('Replies since June').first().waitFor(); await p.waitForTimeout(700);
    await p.evaluate(() => { const c = [...document.querySelectorAll('.card')].find((x) => x.textContent.includes('Gmail sync')); if (c) c.scrollIntoView({ block: 'start' }); }); } },
  { id: '27', file: '27-today-tab', groups: ['shell'], run: async (p) => { await clickNav(p, 'Today'); await p.waitForSelector('text=To-do list', { state: 'attached' }).catch(() => {}); } },
];

async function main() {
  const oi = process.argv.indexOf('--only');
  const only = oi >= 0 ? process.argv[oi + 1].split(',') : null;
  const todo = SHOTS.filter((s) => !only || only.includes(s.id));
  for (const s of todo) {
    Object.assign(state, { setup: 'ready', data: 'populated', google: 'disconnected', buffer: 'disconnected', insights: 'none', review: 'idle' });
    if (s.pre) await s.pre();
    const h = await launch();
    try {
      if (s.init) await h.page.addInitScript(() => { try { localStorage.setItem('tjk_gmail_autoscan_at', String(Date.now())); } catch { /* ignore */ } });
      await installShell(h.page);
      for (const g of s.groups) await (await group(g)).install(h.page);
      await gotoApp(h.page);
      await s.run(h.page);
      await hideFloaters(h.page);
      await park(h.page);
      await h.page.waitForTimeout(500);
      await h.page.screenshot({ path: resolve(OUT, `${s.file}.png`), clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height } });
      assertClean(h.unmocked, s.file);
      console.log('  saved', s.file + '.png');
    } finally { await closeBrowser(h); }
  }
  console.log('Done.');
}
main().catch((e) => { console.error('gallery capture failed:', e.message); process.exit(1); });
