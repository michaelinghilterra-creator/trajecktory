/**
 * capture-lib.mjs: shared Playwright plumbing for the day-to-day guide captures.
 *
 * PII safety is structural, not procedural:
 *   - A catch-all route sends every /api/** request that no mock claims to an
 *     HTTP 500 and records it. A capture run that touches an unmocked endpoint
 *     throws at the end (assertClean), so nothing can fall through to a server.
 *   - Pages run against a scratch server whose data dir and profile are empty
 *     (see capture-guide.mjs header). Every on-screen value comes from the
 *     fixtures, which are invented.
 *   - The browser clock is frozen so "today", overdue badges and weekday
 *     blocks match the invented July 2026 search no matter when this runs.
 *
 * Playwright route precedence: the most recently registered route wins. The
 * catch-all is registered FIRST, in launch(), so every mock registered later
 * beats it.
 */
import { chromium } from 'playwright';
import { dirname, resolve } from 'path';
import { mkdirSync, appendFileSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const OUT = resolve(__dirname, 'captures');
mkdirSync(OUT, { recursive: true });

export const BASE = process.env.TRAJECKTORY_URL || 'http://localhost:3399';
export const VIEWPORT = { width: 1440, height: 1000 };
export const SCALE = 2;
// Wednesday, mid-search. Fixture dates are built around this instant.
export const FROZEN_NOW = '2026-07-22T10:30:00-05:00';

/** Mutable switches the mocks read at request time. */
export const state = {
  setup: 'ready',      // 'firstrun' | 'started' | 'ready'
  data: 'populated',   // 'empty' | 'populated'
  google: 'disconnected', // 'disconnected' | 'connected'
  buffer: 'disconnected', // 'disconnected' | 'connected'
  insights: 'none',    // 'none' | 'generated'
  review: 'idle',      // 'idle' | 'ran'
};

export const json = (route, obj, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) });

/**
 * Open a browser + page with the catch-all net installed. Returns
 * { browser, ctx, page, unmocked }. Register mocks AFTER this returns.
 */
export async function launch({ viewport = VIEWPORT, scale = SCALE, now = FROZEN_NOW } = {}) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: scale, reducedMotion: 'reduce',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  if (now) await ctx.clock.setFixedTime(new Date(now));
  const unmocked = new Set();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message.slice(0, 200)));
  await page.route('**/api/**', (route) => {
    const u = new URL(route.request().url());
    unmocked.add(`${route.request().method()} ${u.pathname}`);
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"unmocked capture endpoint"}' });
  });
  return { browser, ctx, page, unmocked };
}

/** Throw if any request reached the catch-all net. Call after every group. */
export function assertClean(unmocked, label = '') {
  if (unmocked.size) {
    throw new Error(`Unmocked endpoint(s)${label ? ' in ' + label : ''}: ${[...unmocked].join(', ')}`);
  }
}

// ---- manifest ---------------------------------------------------------------
// Append-only JSON lines: several group runs may write at once.
const MANIFEST = resolve(OUT, 'manifest.jsonl');
export function record(name, extra = {}) {
  appendFileSync(MANIFEST, JSON.stringify({ name, at: FROZEN_NOW, ...extra }) + '\n');
}

// ---- navigation -------------------------------------------------------------
export async function gotoApp(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
}
export async function clickNav(page, label) {
  await page.locator('.nav-item', { hasText: label }).first().click();
  await page.waitForTimeout(700);
}
export async function clickSub(page, label, { exact = false } = {}) {
  const loc = exact
    ? page.locator('.subtab').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first()
    : page.locator('.subtab', { hasText: label }).first();
  await loc.click();
  await page.waitForTimeout(700);
}
/** Click the deepest element whose trimmed text equals `label`, optionally inside `root`. */
export async function clickText(page, label, root = 'body') {
  const ok = await page.evaluate(({ want, root }) => {
    const r = document.querySelector(root);
    if (!r) return false;
    const nodes = [...r.querySelectorAll('*')].filter(n => n.textContent.trim() === want);
    const t = nodes[nodes.length - 1];
    if (!t) return false;
    t.scrollIntoView({ block: 'nearest', inline: 'center' });
    t.click();
    return true;
  }, { want: label, root });
  if (!ok) throw new Error(`clickText: "${label}" not found in ${root}`);
  await page.waitForTimeout(600);
}
export async function clickButton(page, re, root = 'body') {
  const ok = await page.evaluate(({ src, flags, root }) => {
    const r = document.querySelector(root);
    if (!r) return false;
    const rx = new RegExp(src, flags);
    const b = [...r.querySelectorAll('button')].find(x => rx.test(x.textContent));
    if (!b) return false;
    b.scrollIntoView({ block: 'center' });
    b.click();
    return true;
  }, { src: re.source, flags: re.flags, root });
  if (!ok) throw new Error(`clickButton: ${re} not found in ${root}`);
  await page.waitForTimeout(600);
}
export async function openRowDrawer(page, company) {
  await page.evaluate((c) => {
    const rows = [...document.querySelectorAll('tbody tr')].filter(r => getComputedStyle(r).cursor === 'pointer');
    const row = rows.find(r => r.textContent.includes(c)) || rows[0];
    if (row) row.click();
  }, company);
  const drawer = page.locator('.pl-drawer.open').first();
  await drawer.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1200);
  return drawer;
}

// ---- shots ------------------------------------------------------------------
async function save(page, name, opts, extra) {
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot({ path, ...opts });
  record(name, extra);
  console.log('  saved', name + '.png');
}
/** Whole viewport (sidebar + topbar + content), optionally cropped to the top `maxH` css px. */
export async function shotWindow(page, name, maxH = null) {
  await page.waitForTimeout(400);
  const clip = { x: 0, y: 0, width: VIEWPORT.width, height: maxH ? Math.min(maxH, VIEWPORT.height) : VIEWPORT.height };
  await save(page, name, { clip }, { kind: 'window' });
}
/** The .content region at its natural size. */
export async function shotContent(page, name) {
  const el = page.locator('.content').first();
  await el.waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  const path = resolve(OUT, `${name}.png`);
  await el.screenshot({ path });
  record(name, { kind: 'content' });
  console.log('  saved', name + '.png');
}
/** .content trimmed to where its content ends (and optionally capped). */
export async function shotTight(page, name, maxCss = null, pad = 14) {
  const el = page.locator('.content').first();
  await el.waitFor({ state: 'visible' });
  await page.waitForTimeout(450);
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
  await save(page, name, { clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.width, height } }, { kind: 'tight', h: Math.round(height) });
}
/** Any element by selector. */
export async function shotEl(page, selector, name, { maxH = null } = {}) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  if (!maxH) {
    await el.screenshot({ path: resolve(OUT, `${name}.png`) });
    record(name, { kind: 'el', selector });
    console.log('  saved', name + '.png');
    return;
  }
  const b = await el.boundingBox();
  await save(page, name, { clip: { x: Math.floor(b.x), y: Math.floor(b.y), width: Math.ceil(b.width), height: Math.min(Math.ceil(b.height), maxH) } }, { kind: 'el', selector });
}
/** The open report drawer. */
export const shotDrawer = (page, name, opts) => shotEl(page, '.pl-drawer.open', name, opts);
/** A viewport-relative clip in css px. */
export async function shotClip(page, name, clip) {
  await page.waitForTimeout(300);
  await save(page, name, { clip }, { kind: 'clip' });
}

export async function closeBrowser(h) { try { await h.browser.close(); } catch {} }
