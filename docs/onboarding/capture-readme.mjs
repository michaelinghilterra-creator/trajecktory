/**
 * capture-readme.mjs — regenerate the README screenshots (docs/dashboard-*.png).
 *
 * Reuses installMocks + clickNav from capture-dashboard.mjs, so every data-bearing
 * endpoint is mocked with INVENTED data before anything is shot. Nothing real can
 * reach a PNG. Needs the dashboard running on :3333 (npm --prefix dashboard-web start).
 *
 *   node docs/onboarding/capture-readme.mjs
 */
import { chromium } from 'playwright';
import { installMocks, clickNav, setMode, BASE, VIEWPORT, SCALE } from './capture-dashboard.mjs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(__dirname, '..'); // docs/onboarding -> docs

// Invented Posts fixture so the Posts view shows example drafts, not the empty
// state and never a real post. Generic insights, no personal data.
const POSTS = {
  posts: [
    { id: 'p_ex1', source: 'claude', lane: 'professional', channel: 'linkedin',
      text: 'Pipeline inspection beats forecast theater. Most teams review the number; few review how the number was built. Here is the weekly cadence that changed that for a 30-seller org.',
      linkComment: '', status: 'draft', scheduledFor: null, createdAt: '2026-01-10T09:00:00Z', updatedAt: '2026-01-10T09:00:00Z', order: 2 },
    { id: 'p_ex2', source: 'user', lane: 'trajecktory', channel: 'x',
      text: 'Shipped bullet-level resume tailoring: it reorders your experience per posting, inside a page-break guard. No more one-size-fits-all resume.',
      linkComment: '', status: 'queued', scheduledFor: '2026-01-12T15:00:00.000Z', createdAt: '2026-01-09T12:00:00Z', updatedAt: '2026-01-09T12:00:00Z', order: 1 },
    { id: 'p_ex3', source: 'claude', lane: 'professional', channel: 'linkedin',
      text: 'The one question that turns a rejection into data: before we wrap, is there anything in my background that gives you pause?',
      linkComment: '', status: 'queued', scheduledFor: null, createdAt: '2026-01-08T10:00:00Z', updatedAt: '2026-01-08T10:00:00Z', order: 0 },
  ],
  activity: [
    { id: 'a1', ts: '2026-01-08T10:02:00Z', action: 'queued', postId: 'p_ex3', snippet: 'The one question that turns a rejection into data', lane: 'professional', channel: 'linkedin', detail: '' },
    { id: 'a2', ts: '2026-01-09T12:05:00Z', action: 'queued', postId: 'p_ex2', snippet: 'Shipped bullet-level resume tailoring', lane: 'trajecktory', channel: 'x', detail: 'for 2026-01-12' },
    { id: 'a3', ts: '2026-01-10T09:00:00Z', action: 'generated', postId: 'p_ex1', snippet: 'Pipeline inspection beats forecast theater.', lane: 'professional', channel: 'linkedin', detail: '' },
  ],
};

async function shotContent(page, name, capCss) {
  const el = page.locator('.content').first();
  const box = await el.boundingBox();
  const height = capCss ? Math.min(capCss, Math.ceil(box.height)) : Math.ceil(box.height);
  await page.screenshot({
    path: resolve(DOCS, `${name}.png`),
    clip: { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height },
  });
  console.log('  saved', name + '.png', `(${height}px)`);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
  const page = await ctx.newPage();
  setMode({ dataMode: 'populated', stateMode: 'ready', showTriage: false });
  await installMocks(page);
  // Posts endpoint is newer than installMocks; mock it here with invented drafts.
  await page.route('**/api/posts', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(POSTS) }));
  await page.route('**/api/posts/queue', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ queue: POSTS.posts.filter(p => p.status === 'queued') }) }));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  // Overview = the Pipeline tab's default weekly scorecard.
  await clickNav(page, 'Pipeline');
  await page.waitForTimeout(1100);
  await shotContent(page, 'dashboard-overview', 780);

  // Pipeline tracker (Active subtab: the scored rows).
  try { await page.locator('.subtab', { hasText: 'Active' }).first().click(); await page.waitForTimeout(800); } catch (e) { console.log('  active subtab skip:', e.message); }
  await shotContent(page, 'dashboard-pipeline', 640);

  // Insights.
  await clickNav(page, 'Insights');
  await page.waitForTimeout(1200);
  await shotContent(page, 'dashboard-insights', 700);

  // Follow-Ups.
  await clickNav(page, 'Follow-Ups');
  await page.waitForTimeout(1100);
  await shotContent(page, 'dashboard-followups', 640);

  // Recruiters.
  await clickNav(page, 'Recruiters');
  await page.waitForTimeout(1100);
  await shotContent(page, 'dashboard-recruiters', 660);

  // Posts (LinkedIn SSI -> Posts subtab).
  await clickNav(page, 'LinkedIn SSI');
  await page.waitForTimeout(900);
  try { await page.locator('.subtab', { hasText: 'Posts' }).first().click(); await page.waitForTimeout(900); } catch (e) { console.log('  posts subtab skip:', e.message); }
  await shotContent(page, 'dashboard-posts', 700);

  // Per-role drawer, opened from an invented row.
  await clickNav(page, 'Pipeline');
  await page.waitForTimeout(700);
  try { await page.locator('.subtab', { hasText: 'Active' }).first().click(); await page.waitForTimeout(600); } catch {}
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')].filter(r => getComputedStyle(r).cursor === 'pointer');
    const row = rows.find(r => /Northwind/.test(r.textContent)) || rows[0];
    if (row) row.click();
  });
  try {
    const drawer = page.locator('.pl-drawer.open').first();
    await drawer.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1500);
    await drawer.screenshot({ path: resolve(DOCS, 'dashboard-drawer.png') });
    console.log('  saved dashboard-drawer.png');
  } catch (e) { console.log('  drawer skip:', e.message); }

  await browser.close();
  console.log('Done. README screenshots in', DOCS);
}

main().catch((e) => { console.error('readme capture failed:', e); process.exit(1); });
