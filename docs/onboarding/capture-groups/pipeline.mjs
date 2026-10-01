// Pipeline group: the four Pipeline sub-tabs (Overview, Roles, Discovery, Analytics).
// The report drawer is owned by another group.
import { json, gotoApp, clickNav, clickSub, shotTight, shotEl, shotClip, VIEWPORT } from '../capture-lib.mjs';
import { STATE_READY_WITH_COMP, INBOX, APPS_PL, corePayloadPl, responseProgress, rejectionTiming } from './pipeline-fixtures.mjs';

export const meta = { name: 'pipeline', summary: 'Pipeline: Overview, Roles, Discovery, Analytics' };

export async function install(page) {
  // A saved compensation profile, so Analytics draws the Comp Positioning bands.
  await page.route('**/api/setup/state', (r) => json(r, STATE_READY_WITH_COMP));
  // Same tracker as the shell, with how-it-was-found Source labels (see pipeline-fixtures.mjs).
  await page.route('**/api/applications', (r) => json(r, APPS_PL));
  await page.route('**/api/metrics/core', (r) => json(r, corePayloadPl()));
  await page.route('**/api/pipeline/inbox', (r) => json(r, INBOX));
  await page.route('**/api/insights/response-progress', (r) => json(r, responseProgress()));
  await page.route('**/api/insights/rejection-timing', (r) => json(r, rejectionTiming()));
}

/** Union of several elements' boxes (plus padding), clipped to the viewport. For tooltip shots. */
async function shotUnion(page, name, selectors, pad = 12) {
  let box = null;
  for (const sel of selectors) {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`shotUnion: ${sel} has no box`);
    box = box
      ? { x1: Math.min(box.x1, b.x), y1: Math.min(box.y1, b.y), x2: Math.max(box.x2, b.x + b.width), y2: Math.max(box.y2, b.y + b.height) }
      : { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height };
  }
  const x = Math.max(0, Math.floor(box.x1 - pad)), y = Math.max(0, Math.floor(box.y1 - pad));
  const clip = {
    x, y,
    width: Math.min(VIEWPORT.width - x, Math.ceil(box.x2 + pad - x)),
    height: Math.min(VIEWPORT.height - y, Math.ceil(box.y2 + pad - y)),
  };
  await shotClip(page, name, clip);
}

/** Hide the floating chat button (bottom right) so it never sits over a crop. */
async function hideFloaters(page) {
  const n = await page.evaluate(() => {
    let hidden = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (getComputedStyle(el).position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.width < 90 && r.height < 90 && r.right > window.innerWidth - 120 && r.bottom > window.innerHeight - 140) {
        el.style.display = 'none';
        hidden++;
      }
    }
    return hidden;
  });
  if (n === 0) throw new Error('hideFloaters: no floating button found (selector drift?)');
}

/** Park the pointer over the sidebar so no tooltip is open while content scrolls under it. */
const park = (page) => page.mouse.move(60, 600);

/** Size the Roles scroll area to show exactly n whole rows, so no row is cut at the bottom edge. */
async function fitRows(page, n) {
  await page.evaluate((n) => {
    const wrap = document.querySelector('.content .tbl-wrap');
    const head = wrap.querySelector('thead').getBoundingClientRect().height;
    const rows = [...wrap.querySelectorAll('tbody tr')].slice(0, n);
    wrap.style.maxHeight = Math.ceil(head + rows.reduce((s, r) => s + r.getBoundingClientRect().height, 0) + 2) + 'px';
  }, n);
}

/** The Roles sub-tab from the sub-tab strip to the bottom of the Roles card (rows scrolled out of the table are not counted). */
async function shotRolesFrame(page, name) {
  await page.waitForTimeout(400);
  const c = await page.locator('.content').boundingBox();
  const r = await page.locator('.content .card:has(.card-title:text-is("Roles"))').boundingBox();
  await shotClip(page, name, { x: Math.floor(c.x), y: Math.floor(c.y), width: Math.ceil(c.width), height: Math.ceil(r.y + r.height + 14 - c.y) });
}

const section = (heading) => `.content div:has(> h3:has-text("${heading}"))`;
const card = (title) => `.content .card:has(.card-title:text-is("${title}"))`;

export async function capture({ page }) {
  await gotoApp(page);
  await clickNav(page, 'Pipeline');
  await clickSub(page, 'Overview', { exact: true });
  await page.waitForSelector('text=numbers on this page tie out');
  await hideFloaters(page);
  await page.waitForTimeout(500);

  // == Overview ==
  // Hide the daily quote card. The app picks its text from a fixed list of public
  // quotes with a named author; it carries no information a guide needs, and no
  // named person should appear in a guide figure.
  await page.evaluate(() => {
    const q = [...document.querySelectorAll('.content div')]
      .find(n => n.children.length === 2 && n.firstElementChild.style.fontStyle === 'italic');
    if (!q) throw new Error('daily quote card not found');
    q.style.display = 'none';
  });
  // The top of the page, down to the end of the Results tiles.
  const resultsBottom = await page.evaluate(() => {
    const h = [...document.querySelectorAll('.content h3')].find(n => n.textContent.includes('Results'));
    return h.parentElement.getBoundingClientRect().bottom - document.querySelector('.content').getBoundingClientRect().top;
  });
  await park(page);
  await shotTight(page, 'pl-overview', Math.ceil(resultsBottom) + 16);
  await shotEl(page, section('This week'), 'pl-overview-week');
  await shotEl(page, section('Results'), 'pl-overview-results');
  await park(page);
  await shotEl(page, card('Weekly applications and results'), 'pl-overview-trend');
  await park(page);
  await shotEl(page, card('Application funnel'), 'pl-overview-funnel');
  await park(page);
  await shotEl(page, card('Score vs apply decision'), 'pl-overview-scorevsapply');

  // Hover states.
  await park(page);
  const tieBtn = 'button[aria-label="About the page tie-out"]';
  await page.locator(tieBtn).scrollIntoViewIfNeeded();
  await page.locator(tieBtn).hover();
  await page.waitForSelector('#overview-reconcile-tip');
  await shotUnion(page, 'pl-overview-tieout', [tieBtn, '#overview-reconcile-tip'], 16);
  await park(page);

  const firstTile = `${section('This week')} .metric-kpi`;
  await page.locator(firstTile).first().scrollIntoViewIfNeeded();
  await page.locator(firstTile).first().hover();
  await page.waitForSelector('.metric-tip');
  await shotUnion(page, 'pl-overview-tooltip', [firstTile, '.metric-tip'], 16);
  await park(page);

  // == Roles ==
  await clickSub(page, 'Roles', { exact: true });
  await page.waitForSelector('.pl-tbl tbody tr');
  await park(page);
  await fitRows(page, 15);
  await shotRolesFrame(page, 'pl-roles');
  // Export CSV region: the card header plus the status chips and filter row.
  await shotEl(page, card('Roles'), 'pl-roles-export', { maxH: 190 });

  // Filtered: the Applied chip, plus a minimum score.
  await page.locator('.stat-chip', { hasText: /^Applied/ }).first().click();
  await page.locator('.score-seg button', { hasText: '≥3.5' }).click();
  await page.waitForTimeout(500);
  await park(page);
  await shotRolesFrame(page, 'pl-roles-filtered');

  // Clear, then sort by Score (first click on a new key sorts high to low).
  await page.locator('button.btn.ghost.sm', { hasText: 'Clear' }).click();
  await page.waitForTimeout(400);
  await page.locator('th', { hasText: 'Score' }).first().click();
  await page.waitForTimeout(500);
  await park(page);
  await shotRolesFrame(page, 'pl-roles-sorted');

  // == Discovery ==
  await clickSub(page, 'Discovery', { exact: true });
  await page.waitForSelector('text=pending eval');
  await page.waitForSelector('.pl-tbl tbody tr');
  await park(page);
  await shotTight(page, 'pl-discovery', 1000);

  // == Analytics ==
  await clickSub(page, 'Analytics', { exact: true });
  await page.waitForSelector('text=Pipeline Analytics');
  await page.waitForSelector('text=What converts');
  await page.waitForSelector('.content .atbl tbody tr');
  await page.waitForTimeout(600);
  await park(page);
  await shotTight(page, 'pl-analytics', 1000);
  await shotEl(page, '.content .grid.cols-4:has(.metric-kpi)', 'pl-analytics-kpis');
  await shotEl(page, '.content .metric-kpi:has(.kpi-label:text-is("Silence Rate (14d)"))', 'pl-analytics-silence');
  await shotEl(page, card('Response Progress'), 'pl-analytics-response');
  await shotEl(page, card('Comp Positioning'), 'pl-analytics-comp');
  await shotEl(page, card('What converts'), 'pl-analytics-segments');
  // Everything below the Response Progress card, in one frame (the full sub-tab is taller than one screen).
  await page.locator(card('Comp Positioning')).scrollIntoViewIfNeeded();
  await park(page);
  const lo = await page.locator(card('Comp Positioning')).boundingBox();
  const hi = await page.locator(card('What converts')).boundingBox();
  const top = Math.max(0, Math.floor(lo.y - 14));
  await shotClip(page, 'pl-analytics-lower', { x: Math.floor(lo.x - 14), y: top, width: Math.ceil(lo.width + 28), height: Math.ceil(hi.y + hi.height + 14 - top) });
}
