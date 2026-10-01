/**
 * social group: the Social tab (nav label "Social", source dashboard-web/src/
 * linkedin-ssi.jsx, posts.jsx, content.jsx).
 *
 * Sub-tabs: Posts, Content, Influencers, Activity Log. Content has four inner
 * sub-tabs: Publish, Tracker, Reply to a comment, What works.
 *
 * Everything on screen comes from social-fixtures.mjs (invented). Buffer is a
 * mock driven by state.buffer. Nothing here sends, saves or deletes anything: the
 * mutating endpoints that the shots exercise (push preview, metrics sync, reply
 * draft) are mocks that return canned, invented results.
 */
import { json, state, gotoApp, clickNav, clickSub, shotTight, shotClip, VIEWPORT } from '../capture-lib.mjs';
import {
  ALL_POSTS, COMPOSE_POSTS, ACTIVITY, X_HISTORY_POST, BUFFER_CHANNELS, BUFFER_NOT_CONNECTED_ERROR,
  INFLUENCERS, ENGAGEMENT_LOG, REPLY_SAMPLE_COMMENT, REPLY_SAMPLE_TEXT,
} from './social-fixtures.mjs';

export const meta = { name: 'social', summary: 'Social tab: Posts, Content (Publish/Tracker/Reply/What works), Influencers, Activity Log' };

// Switches the mocks read at request time.
const mode = { posts: 'full', xHistory: false };

const currentPosts = () => {
  const base = mode.posts === 'compose' ? COMPOSE_POSTS : ALL_POSTS;
  return mode.xHistory ? [...base, X_HISTORY_POST] : base;
};

export async function install(page) {
  // Only GET is mocked on the collection route. Anything else falls through to the
  // catch-all (and fails the run), so a stray save cannot go unnoticed.
  await page.route('**/api/posts', (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    return json(r, { posts: currentPosts(), activity: ACTIVITY });
  });

  await page.route('**/api/buffer/channels', (r) => {
    if (state.buffer === 'connected') return json(r, BUFFER_CHANNELS);
    return json(r, { error: BUFFER_NOT_CONNECTED_ERROR }, 400);
  });
  await page.route('**/api/buffer/status', (r) =>
    json(r, state.buffer === 'connected' ? { connected: true, hint: '••••7f3a', connectedAt: '2026-07-10T15:00:00.000Z' } : { connected: false }));

  // Preview (dry run) of the push. Mirrors the real route's dry-run result shape.
  await page.route('**/api/posts/push-to-buffer', async (r) => {
    const body = r.request().postDataJSON() || {};
    const ids = body.ids || [];
    const byId = Object.fromEntries(ALL_POSTS.map((p) => [p.id, p]));
    const results = ids.map((id) => {
      const p = byId[id];
      const dueAt = new Date(p.scheduledFor).toISOString();
      const extras = p.linkComment ? ' (first comment)' : '';
      return { id, title: p.title, channel: p.channel, ok: true, status: 'ready', dueAt, message: `Ready: schedules for ${dueAt}${extras}.` };
    });
    await json(r, { ok: true, dryRun: !!body.dryRun, scheduled: results.length, already: 0, waiting: 0, failed: 0, missing: 0, results });
  });

  // "Sync from Buffer": seven sent posts report metrics, two are still scheduled.
  await page.route('**/api/posts/pull-metrics', (r) =>
    json(r, { ok: true, synced: 7, pending: 2, failed: 0, results: [] }));

  // "Generate reply": a canned, invented draft.
  await page.route('**/api/posts/reply', (r) => json(r, { ok: true, reply: REPLY_SAMPLE_TEXT }));

  await page.route('**/api/linkedin-ssi/summary', (r) => json(r, { currentSsi: null, targetSsi: 60, weeks: [] }));
  await page.route('**/api/linkedin-ssi/influencers', (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    return json(r, INFLUENCERS);
  });
  await page.route('**/api/linkedin-ssi/engagement-log', (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    return json(r, ENGAGEMENT_LOG);
  });
}

// == local helpers ==

/** Scroll the .content pane so `sel` starts near its top edge. */
async function scrollTo(page, sel, offset = 10) {
  await page.evaluate(({ sel, offset }) => {
    const el = document.querySelector(sel);
    const c = document.querySelector('.content');
    if (!el || !c) throw new Error('scrollTo: missing ' + sel);
    const top = el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop;
    c.scrollTop = Math.max(0, top - offset);
  }, { sel, offset });
  await page.waitForTimeout(250);
}

/** Tag the Nth child of `parentSel` with data-cap so later steps can address it. */
async function tag(page, parentSel, index, name) {
  await page.evaluate(({ parentSel, index, name }) => {
    const p = document.querySelector(parentSel);
    if (!p) throw new Error('tag: missing parent ' + parentSel);
    const kids = [...p.children];
    const k = index < 0 ? kids[kids.length + index] : kids[index];
    if (!k) throw new Error(`tag: no child ${index} under ${parentSel}`);
    k.setAttribute('data-cap', name);
  }, { parentSel, index, name });
}

/**
 * Crop the union of one or more elements. The pane is scrolled so the first
 * element starts at the top of the content area; the crop is clamped to the
 * viewport (maxH caps the height in css px).
 */
async function shotSel(page, sels, name, { maxH = null, maxW = null, pad = 4, scroll = true, top = 10 } = {}) {
  const list = Array.isArray(sels) ? sels : [sels];
  if (scroll) await scrollTo(page, list[0], top);
  const r = await page.evaluate((list) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of list) {
      const el = document.querySelector(s);
      if (!el) throw new Error('shotSel: missing ' + s);
      const b = el.getBoundingClientRect();
      x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top); x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom);
    }
    return { x0, y0, x1, y1 };
  }, list);
  const x = Math.max(0, Math.floor(r.x0 - pad));
  const y = Math.max(0, Math.floor(r.y0 - pad));
  const w = Math.min(VIEWPORT.width - x, Math.ceil(r.x1 - r.x0 + pad * 2));
  let h = Math.ceil(r.y1 - r.y0 + pad * 2);
  const wFinal = maxW ? Math.min(w, maxW) : w;
  if (maxH) h = Math.min(h, maxH);
  h = Math.min(h, VIEWPORT.height - y);
  await shotClip(page, name, { x, y, width: wFinal, height: h });
}

/**
 * Like shotTight, but never cuts a card in half: the crop runs from the top of the
 * .content pane to the bottom of the last top-level card that fits inside the limit (css px from the viewport top), or the end of the content,
 * whichever comes first.
 */
async function shotFit(page, name, { limit = 992, pad = 12 } = {}) {
  await page.waitForTimeout(450);
  const box = await page.locator('.content').first().boundingBox();
  const bottom = await page.evaluate((limit) => {
    const c = document.querySelector('.content');
    let max = 0;
    for (const n of c.querySelectorAll('.card, .tbl-wrap')) {
      if (n.parentElement.closest('.card, .tbl-wrap')) continue; // nested: its parent card decides
      const r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.bottom <= limit) max = Math.max(max, r.bottom);
    }
    return max;
  }, limit);
  if (!bottom) throw new Error('shotFit: no card fits for ' + name);
  const height = Math.min(VIEWPORT.height - box.y, bottom - box.y + pad);
  await shotClip(page, name, { x: Math.max(0, box.x), y: Math.max(0, box.y), width: box.width, height });
}

async function toTop(page) {
  await page.evaluate(() => { const c = document.querySelector('.content'); if (c) c.scrollTop = 0; });
  await page.waitForTimeout(250);
}

/** Hide the round floating chat button (bottom-right corner) so it never covers a crop. */
async function hideFloatingChat(page) {
  const n = await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '[data-cap-hide]{display:none !important}';
    document.head.appendChild(st);
    let hidden = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed') continue;
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.width < 90 && b.height < 90 && b.right > 1300 && b.bottom > 880) { el.setAttribute('data-cap-hide', '1'); hidden++; }
    }
    return hidden;
  });
  if (n === 0) throw new Error('floating chat button not found');
}

const subExact = (page, label) => clickSub(page, label, { exact: true });

// == capture ==

export async function capture({ page }) {
  state.buffer = 'disconnected';
  mode.posts = 'compose';
  mode.xHistory = false;

  await gotoApp(page);
  await hideFloatingChat(page);
  await clickNav(page, 'Social');
  await page.waitForSelector('.posts-tab');

  // == Posts ==
  // Children of .posts-tab: h2, p, details, composer, grid.
  await tag(page, '.posts-tab', 3, 'composer');

  // Lanes: Professional active (default), then trajecktory active. Crop = chips + text area.
  await shotLanes(page, 'soc-posts-lanes');
  await page.locator('[data-cap="composer"] .chip', { hasText: 'trajecktory' }).click();
  await page.waitForTimeout(300);
  await shotLanes(page, 'soc-posts-lanes-trajecktory');
  await page.locator('[data-cap="composer"] .chip', { hasText: 'Professional' }).click();
  await page.waitForTimeout(300);

  // Composer in use: a draft in progress, a first-comment link, and a topic for Claude.
  const ta = page.locator('[data-cap="composer"] textarea');
  await ta.fill('Handoffs fail at the seam between marketing and sales, and the seam is usually a field nobody owns.\n\nStart by naming one owner for every field that crosses the line.');
  await page.locator('[data-cap="composer"] input[placeholder="Link for the first comment (optional)"]').fill('https://example.com/jordan/handoff-owners');
  await page.locator('[data-cap="composer"] input[placeholder="Optional: what should Claude write about?"]').fill('Marketing to sales handoffs');
  await toTop(page);
  await shotFit(page, 'soc-posts');
  await shotSel(page, '[data-cap="composer"]', 'soc-posts-composer', { top: 14 });

  // The collapsed "First time? Connect Buffer to publish" callout, opened.
  await page.locator('.posts-tab > details > summary').click();
  await page.waitForTimeout(300);
  await tag(page, '.posts-tab', 2, 'callout');
  await toTop(page);
  await shotSel(page, '[data-cap="callout"]', 'soc-posts-buffer-callout', { top: 14 });
  await page.locator('.posts-tab > details > summary').click();
  await page.waitForTimeout(200);

  // Queue and drafts: the grid's left column. Children: Queue, hint, Scheduled / posted, Drafts.
  await tag(page, '.posts-tab > div:last-child', 0, 'col-left');
  const kids = await page.evaluate(() => [...document.querySelector('[data-cap="col-left"]').children].length);
  if (kids !== 4) throw new Error(`expected 4 children in the Posts left column, found ${kids}`);
  await tag(page, '[data-cap="col-left"]', 0, 'sec-queue');
  await tag(page, '[data-cap="col-left"]', 1, 'sec-queue-hint');
  await tag(page, '[data-cap="col-left"]', 2, 'sec-done');
  await tag(page, '[data-cap="col-left"]', 3, 'sec-drafts');
  await shotSel(page, ['[data-cap="sec-queue"]', '[data-cap="sec-queue-hint"]'], 'soc-posts-queue', { maxH: 960, top: 14 });
  await shotSel(page, '[data-cap="sec-done"]', 'soc-posts-done', { maxH: 960, top: 14 });
  await shotSel(page, '[data-cap="sec-drafts"]', 'soc-posts-drafts', { maxH: 960, top: 14 });
  // The Activity feed on the right.
  await tag(page, '.posts-tab > div:last-child', 1, 'col-right');
  await shotSel(page, '[data-cap="col-right"]', 'soc-posts-activity', { maxH: 960, top: 14 });
  await toTop(page);

  // == Content: Publish (Buffer not connected, then connected) ==
  mode.posts = 'full';
  await clickSub(page, 'Content', { exact: true });
  await page.getByText('Buffer isn\'t connected.').waitFor();
  await shotTight(page, 'soc-content-publish-disconnected', 520);

  // Connect (the key is entered in Setup, outside this tab), then "Check again".
  state.buffer = 'connected';
  await page.getByRole('button', { name: 'Check again' }).click();
  await page.getByText('Publishing through Buffer to:').waitFor();
  await page.waitForTimeout(500);
  await shotFit(page, 'soc-content-publish-idle');

  await page.getByRole('button', { name: 'Select all' }).click();
  await page.waitForTimeout(300);
  // Expand the first review row to show the post text and the first comment.
  await page.getByRole('button', { name: 'Review', exact: true }).nth(1).click();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const strips = document.querySelectorAll('.content .subtabs');
    strips[strips.length - 1].setAttribute('data-cap', 'pub-subtabs');
    const card = [...document.querySelectorAll('.content .card')].find((n) => /Already scheduled on Buffer/.test(n.textContent) && n.querySelectorAll('.card').length === 0);
    card.previousElementSibling.setAttribute('data-cap', 'pub-last-row');
  });
  await shotSel(page, ['[data-cap="pub-subtabs"]', '[data-cap="pub-last-row"]'], 'soc-content-publish', { maxH: 980, top: 6 });

  await page.getByRole('button', { name: 'Preview (dry run)' }).click();
  await page.getByText('Preview', { exact: true }).waitFor();
  await page.waitForTimeout(400);
  await page.evaluate(() => { const c = document.querySelector('.content'); c.scrollTop = 0; });
  await shotFit(page, 'soc-content-publish-preview');
  await page.getByRole('button', { name: 'Dismiss' }).click();

  // The "Already scheduled on Buffer" card at the bottom of the tab.
  await page.evaluate(() => {
    const c = document.querySelector('.content');
    const cards = [...document.querySelectorAll('.content .card')];
    const t = cards.find((n) => /Already scheduled on Buffer/.test(n.textContent) && n.querySelectorAll('.card').length === 0);
    if (!t) throw new Error('on-Buffer card not found');
    t.setAttribute('data-cap', 'on-buffer');
  });
  await shotSel(page, '[data-cap="on-buffer"]', 'soc-content-publish-onbuffer', { top: 14 });
  await toTop(page);

  // == Content: Tracker ==
  await subExact(page, 'Tracker');
  await page.getByRole('button', { name: 'Sync from Buffer' }).click();
  await page.getByText(/7 synced, 2 not published yet/).waitFor();
  await page.waitForTimeout(3200); // let the toast clear
  await shotFit(page, 'soc-content-tracker');
  // First card's metrics editor.
  await page.getByRole('button', { name: 'Metrics', exact: true }).first().click();
  await page.waitForTimeout(400);
  const card0 = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.content button')].find((x) => x.textContent.trim() === 'Hide');
    const card = b && b.closest('.card');
    if (!card) throw new Error('open metrics card not found');
    card.setAttribute('data-cap', 'metrics-card');
    return true;
  });
  await shotSel(page, '[data-cap="metrics-card"]', 'soc-content-tracker-metrics', { maxH: 960, top: 14 });
  await toTop(page);

  // == Content: Reply to a comment ==
  await subExact(page, 'Reply to a comment');
  const sel = page.locator('.content select').first();
  const optVal = await sel.evaluate((s) => {
    const o = [...s.options].find((x) => /Three questions before adding a CRM field/.test(x.textContent));
    if (!o) throw new Error('reply post option not found');
    return o.value;
  });
  await sel.selectOption(optVal);
  await page.locator('.content textarea[placeholder="Paste the exact comment here…"]').fill(REPLY_SAMPLE_COMMENT);
  await page.locator('.content input[type="text"]').first().fill('friendly, a little dry');
  await page.getByRole('button', { name: 'Generate reply' }).click();
  await page.getByText('Suggested reply').waitFor();
  await page.waitForTimeout(500);
  await shotFit(page, 'soc-content-reply');

  // == Content: What works ==
  await subExact(page, 'What works');
  await page.waitForSelector('.content table');
  await shotFit(page, 'soc-content-whatworks');

  // == X history variant: what the UI shows for a post kept from the stood-down X channel ==
  mode.xHistory = true;
  await clickSub(page, 'Posts', { exact: true });
  await page.waitForSelector('.posts-tab');
  await clickSub(page, 'Content', { exact: true });
  await subExact(page, 'Tracker');
  await page.waitForTimeout(400);
  await shotFit(page, 'soc-content-tracker-x-history');
  await subExact(page, 'Publish');
  await page.getByText('Publishing through Buffer to:').waitFor();
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.content .card')];
    const t = cards.find((n) => /Already scheduled on Buffer/.test(n.textContent) && n.querySelectorAll('.card').length === 0);
    if (!t) throw new Error('on-Buffer card not found (x history)');
    t.setAttribute('data-cap', 'on-buffer-x');
  });
  await shotSel(page, '[data-cap="on-buffer-x"]', 'soc-content-publish-onbuffer-x-history', { top: 14 });
  mode.xHistory = false;

  // == Influencers ==
  await clickSub(page, 'Influencers', { exact: true });
  await page.waitForSelector('.ssi-tbl');
  await shotFit(page, 'soc-influencers');

  // Add / import controls: the card header with "+ Add influencer" opened and a row filled in.
  await page.getByRole('button', { name: '+ Add influencer' }).click();
  await page.waitForTimeout(300);
  await page.locator('input[aria-label="Contact name"]').fill('Evander Thackeray');
  await page.locator('input[aria-label="Role"]').fill('Director of Revenue Operations');
  await page.locator('input[aria-label="Track"]').fill('revops');
  await page.locator('input[aria-label="Tier"]').fill('Tier 2');
  await page.locator('input[aria-label="Location"]').fill('Dallas, TX');
  await page.locator('input[aria-label="LinkedIn profile URL"]').fill('https://example.com/in/evander-thackeray');
  await page.locator('input[aria-label="Why follow them"]').fill('Writes about CRM data quality, with worked examples from his own team.');
  await page.evaluate(() => {
    const card = document.querySelector('.card.padded-lg');
    card.setAttribute('data-cap', 'infl-card');
    const form = card.querySelector('.card');
    form.setAttribute('data-cap', 'infl-form');
    const head = card.querySelector('.card-head');
    head.setAttribute('data-cap', 'infl-head');
  });
  await shotSel(page, ['[data-cap="infl-head"]', '[data-cap="infl-form"]'], 'soc-influencers-add', { top: 14, pad: 8 });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(300);

  // Tracks and tiers: tier filter chips, sorted by Tier so each tier groups together.
  await page.locator('th', { hasText: /^Tier/ }).click();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const chips = document.querySelector('.card.padded-lg .chips');
    chips.parentElement.setAttribute('data-cap', 'infl-chips');
    document.querySelector('.card.padded-lg .tbl-wrap').setAttribute('data-cap', 'infl-table');
  });
  await shotSel(page, ['[data-cap="infl-chips"]', '[data-cap="infl-table"]'], 'soc-influencers-tracks', { maxH: 960, top: 14 });
  // The Tier 1 filter, to show what the chips do.
  await page.locator('.chips .chip', { hasText: 'Tier 1' }).click();
  await page.waitForTimeout(300);
  await shotSel(page, ['[data-cap="infl-chips"]', '[data-cap="infl-table"]'], 'soc-influencers-tier1', { maxH: 960, top: 14 });
  await page.locator('.chips .chip', { hasText: 'All' }).click();
  await page.waitForTimeout(300);

  // The influencer drawer (click a row). Overview tab.
  await page.locator('.ssi-tbl tbody tr', { hasText: 'Odalys Brennecke' }).click();
  await page.waitForSelector('.drawer.wide.open');
  await page.waitForTimeout(900);
  await shotSel(page, '.drawer.wide.open', 'soc-influencers-drawer', { scroll: false, pad: 0, maxH: 780 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // == Activity Log ==
  await clickSub(page, 'Activity Log', { exact: true });
  await page.waitForSelector('text=Log New Activity');
  // Fill the form partly, the way a person would before clicking "+ Log Activity".
  const infl = page.locator('.content select.sel').first();
  const val = await infl.evaluate((s) => {
    const o = [...s.options].find((x) => x.textContent === 'Odalys Brennecke');
    if (!o) throw new Error('influencer option not found');
    return o.value;
  });
  await infl.selectOption(val);
  await page.locator('.chips .chip', { hasText: 'Commented' }).click();
  await page.locator('input[aria-label="Topic"]').fill('Forecast error by stage');
  await page.locator('textarea[aria-label="Your message"]').fill('The split by stage is the useful cut. We found most of our error sat in one stage, and fixing its definition did more than any model change.');
  await page.locator('input[aria-label="Follow-up notes"]').fill('Send her the stage sentences next week.');
  await toTop(page);
  await shotFit(page, 'soc-activity-log');
  await shotSel(page, '.content .grid.fade-up > .card:first-child', 'soc-activity-log-form', { top: 14, maxH: 960 });

  // == Buffer connect card (the card Setup -> API keys -> Social posting renders) ==
  await clickSub(page, 'Content', { exact: true });
  await subExact(page, 'Publish');
  for (const [name, value] of [['soc-buffer-connect', 'disconnected'], ['soc-buffer-connected', 'connected']]) {
    state.buffer = value;
    await mountBufferConnect(page);
    await shotSel(page, '#cap-buffer-connect', name, { scroll: false, pad: 0 });
    await page.evaluate(() => document.getElementById('cap-buffer-connect')?.remove());
  }
  state.buffer = 'connected';
}

/** Crop for the lane chips: the chip row and the text area under it. */
async function shotLanes(page, name) {
  await toTop(page);
  await page.evaluate(() => {
    const comp = document.querySelector('[data-cap="composer"]');
    const row = comp.children[0];
    row.setAttribute('data-cap', 'lane-row');
    comp.children[1].setAttribute('data-cap', 'lane-ta');
  });
  await shotSel(page, ['[data-cap="lane-row"]', '[data-cap="lane-ta"]'], name, { top: 14, pad: 10, maxW: 760 });
}

/**
 * Render the app's own BufferConnect card (window.BufferConnect, the component the
 * Setup tab embeds) in a fixed-position holder, so the connect card can be shot
 * without driving the whole Setup tab. The card fetches /api/buffer/status.
 */
async function mountBufferConnect(page) {
  await page.evaluate(async () => {
    const holder = document.createElement('div');
    holder.id = 'cap-buffer-connect';
    holder.style.cssText = 'position:fixed;left:300px;top:200px;width:760px;z-index:9999;background:var(--bg);padding:10px;border-radius:0';
    document.body.appendChild(holder);
    const root = window.ReactDOM.createRoot(holder);
    root.render(window.React.createElement(window.BufferConnect, { toast: () => {} }));
  });
  await page.waitForTimeout(700);
}
