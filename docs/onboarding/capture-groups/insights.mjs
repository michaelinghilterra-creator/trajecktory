/**
 * Capture group: the Insights tab. Two outer sub-tabs, Review and Insights.
 * Review reads /api/metrics/weekly, /api/review/status, /api/build-floor,
 * /api/interview/debriefs/pending and the /api/google/* sweep. Insights reads
 * /api/insights/latest and POSTs /api/insights/generate.
 *
 * Everything is invented (see insights-fixtures.mjs). The switches in
 * capture-lib `state` (google, insights, review) are read at request time.
 */
import { resolve } from 'path';
import { state, json, gotoApp, clickNav, clickSub, shotTight, OUT, record } from '../capture-lib.mjs';
import {
  weeklyPayload, STATUS_IDLE, STATUS_RAN, RUN_RESPONSE, BUILD_FLOOR, DEBRIEFS, HEALTH,
  SCAN_BOUNCES, REPLIES, UNMATCHED, insightsPayload,
} from './insights-fixtures.mjs';

export const meta = { name: 'insights', summary: 'Insights tab: Review (floors, Gmail, debriefs) and Insights (generated analysis)' };

// Local switches this group owns on top of capture-lib `state`.
const mode = { health: null, connectsLogged: true, stale: false };

export async function install(page) {
  const path = (p) => (url) => url.pathname === p;

  // Review feeds
  await page.route(path('/api/metrics/weekly'), (r) => json(r, weeklyPayload({ connectsLogged: mode.connectsLogged })));
  await page.route(path('/api/review/status'), (r) => json(r, state.review === 'ran' ? STATUS_RAN : STATUS_IDLE));
  await page.route(path('/api/review/run'), (r) => { state.review = 'ran'; return json(r, RUN_RESPONSE); });
  await page.route(path('/api/build-floor'), (r) => json(r, BUILD_FLOOR));
  await page.route(path('/api/interview/debriefs/pending'), (r) => json(r, DEBRIEFS));
  await page.route(/\/api\/interview\/debriefs\/\d+$/, (r) => json(r, { ok: true }));
  await page.route(path('/api/linkedin/connects'), (r) =>
    r.request().method() === 'POST' ? json(r, { ok: true, total: 32 }) : json(r, { connects: [] }));

  // Gmail. The shell serves /api/google/health from state.google; this overrides
  // it so the not-connected and expired states can be shown too.
  await page.route(path('/api/google/health'), (r) => json(r, HEALTH[mode.health || (state.google === 'connected' ? 'connected' : 'notset')]));
  await page.route(path('/api/google/scan-bounces'), (r) => json(r, SCAN_BOUNCES));
  await page.route(path('/api/google/replies'), (r) => json(r, REPLIES));
  await page.route(path('/api/google/replies/unmatched'), (r) => json(r, UNMATCHED));
  await page.route(/\/api\/google\/replies\/[^/]+\/[^/]+$/, (r) => {
    const action = new URL(r.request().url()).pathname.split('/').pop();
    return json(r, { ok: true, statusFlip: action === 'rejected' ? 'Rejected' : null });
  });

  // Insights analysis
  await page.route(path('/api/insights/latest'), (r) =>
    json(r, state.insights === 'generated' ? insightsPayload({ stale: mode.stale }) : { generated_at: null }));
  await page.route(path('/api/insights/generate'), async (r) => {
    await new Promise((res) => setTimeout(res, 2500)); // long enough to photograph the working state
    state.insights = 'generated';
    return json(r, insightsPayload({ stale: false }));
  });
}

// ---- helpers ----------------------------------------------------------------
const TALL = { width: 1440, height: 2800 };
const WIDE = { width: 1440, height: 1000 };

/** Crop the union of several elements' boxes (plus padding), optionally widened to another element's x range. */
async function regionShot(page, name, locators, { pad = 12, padBottom = pad, xOf = null } = {}) {
  await page.waitForTimeout(450);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const loc of locators) {
    await loc.first().waitFor({ state: 'visible' });
    const b = await loc.first().boundingBox();
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
  }
  if (xOf) {
    const b = await xOf.first().boundingBox();
    x0 = b.x; x1 = b.x + b.width;
  }
  const clip = {
    x: Math.max(0, Math.floor(x0 - pad)), y: Math.max(0, Math.floor(y0 - pad)),
    width: Math.ceil(x1 - x0 + 2 * pad), height: Math.ceil(y1 - y0 + pad + padBottom),
  };
  await page.screenshot({ path: resolve(OUT, `${name}.png`), clip });
  record(name, { kind: 'region', h: clip.height });
  console.log('  saved', name + '.png');
}

/** Hide the Gmail card and rolling-floor card so a crop can run header to Week over week without them. */
async function setBetweenHidden(page, hidden) {
  await page.evaluate((hide) => {
    const cards = [...document.querySelectorAll('.card')].filter(c => /Gmail sync|Build cap/.test(c.textContent) && !c.querySelector('.card'));
    const note = [...document.querySelectorAll('p')].find(p => /When behind, improvement work is locked/.test(p.textContent));
    for (const el of [...cards, note]) if (el) el.style.display = hide ? 'none' : '';
  }, hidden);
  await page.waitForTimeout(300);
}

/** The toast the app raises after an action. */
async function toastShot(page, name, text) {
  const t = page.locator('.toast', { hasText: text }).first();
  await t.waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
  await t.screenshot({ path: resolve(OUT, name + '.png') });
  record(name, { kind: 'toast' });
  console.log('  saved', name + '.png');
}

async function openInsightsTab(page) {
  await gotoApp(page);
  await clickNav(page, 'Insights');
  await page.waitForTimeout(900);
}

async function openInsightsSection(page) {
  await page.locator('.subtab').filter({ hasText: /^\s*Insights\s*$/ }).first().click();
  await page.waitForTimeout(700);
}

export async function capture({ page }) {
  // The Gmail panel auto-runs its read-only sweep when Review opens (at most once
  // per 5 minutes, tracked in localStorage). Stamp the key so the first shots show
  // the panel at rest; "Check email" is clicked explicitly for the sweep shots.
  await page.addInitScript(() => {
    try { localStorage.setItem('tjk_gmail_autoscan_at', String(Date.now())); } catch (e) { /* ignore */ }
  });

  // ============================ REVIEW, Gmail connected ========================
  state.google = 'connected';
  state.review = 'idle';
  await page.setViewportSize(TALL);
  await openInsightsTab(page);
  await page.getByText('Weekly review', { exact: true }).first().waitFor();
  await page.getByText('Week over week').first().waitFor();
  await page.getByText('Debriefs due').first().waitFor();
  await page.waitForTimeout(600);

  await shotTight(page, 'ins-review', null, 16);

  const floorsGrid = page.locator('div:has(> .kpi)');
  const header = page.locator('div:has(> h2:has-text("Weekly review"))');
  const wowRow = page.locator('div:has(> div > h3:has-text("Week over week"))');
  await setBetweenHidden(page, true);
  await regionShot(page, 'ins-review-weekly', [header, floorsGrid, wowRow], { padBottom: 4 });
  await setBetweenHidden(page, false);
  await setBetweenHidden(page, true);
  await regionShot(page, 'ins-review-floors', [header, floorsGrid]);
  await setBetweenHidden(page, false);
  await regionShot(page, 'ins-review-wow', [page.locator('div:has(> h3:has-text("Week over week"))')]);
  await regionShot(page, 'ins-review-leading', [page.locator('div:has(> h3:has-text("Leading indicators"))')]);

  const rollingCard = page.locator('.card:has-text("Build cap")');
  const rollingNote = page.locator('p:has-text("When behind, improvement work is locked")');
  await regionShot(page, 'ins-review-rolling', [rollingCard, rollingNote]);
  await regionShot(page, 'ins-build-floor', [rollingCard]);

  await regionShot(page, 'ins-review-debriefs', [page.locator('h3:has-text("Debriefs due")'), page.locator('h3:has-text("Debriefs due") ~ .card')]);

  // Log a LinkedIn connect: type a note, shoot the form, then press the button.
  const connectNote = page.locator('input[placeholder="Name or note (optional)"]');
  await connectNote.fill('Rosa Delgado, Globex Health');
  await regionShot(page, 'ins-review-connects', [page.locator('h3:has-text("Log a LinkedIn connect")'), page.locator('h3:has-text("Log a LinkedIn connect") ~ div').first()]);
  await page.locator('button:has-text("+ Log connect")').click();
  await toastShot(page, 'ins-review-connect-logged', 'Connect logged');

  // Debrief modal behind "Add debrief".
  await page.locator('button:has-text("Add debrief")').first().click();
  await page.waitForTimeout(600);
  await page.locator('.card:has(h3:has-text("Debrief:"))').first().screenshot({ path: resolve(OUT, 'ins-review-debrief-modal.png') });
  record('ins-review-debrief-modal', { kind: 'el' });
  console.log('  saved ins-review-debrief-modal.png');
  await page.locator('button:has-text("Skip for now")').click();
  await page.waitForTimeout(400);

  // Gmail sweep: "Check email" runs the read-only preview (bounces + replies).
  await page.locator('button:has-text("Check email")').click();
  await page.getByText('Replies since June').first().waitFor();
  await page.getByText('Unmatched (2)').first().waitFor();
  await page.waitForTimeout(700);
  const gmailCard = page.locator('.card:has-text("Gmail sync")');
  await regionShot(page, 'ins-review-gmail', [gmailCard]);
  await regionShot(page, 'ins-review-bounce', [
    page.locator('span:has-text("Bounces:")'),
    page.locator('button:has-text("Mark bounced")').last(),
  ], { xOf: gmailCard, pad: 14, padBottom: 2 });

  // One reply logged: the row turns into a green confirmation.
  await page.locator('button:has-text("Log")').filter({ hasNotText: 'Log connect' }).nth(0).click();
  await page.waitForTimeout(700);
  await regionShot(page, 'ins-review-gmail-logged', [gmailCard]);

  // Whole-page context shot with the sweep open.
  await shotTight(page, 'ins-review-swept', null, 16);

  // ============================ Run weekly review ==============================
  await openInsightsTab(page);
  await page.getByText('Week over week').first().waitFor();
  await page.locator('button:has-text("Run weekly review")').click();
  await toastShot(page, 'ins-review-ran-toast', 'Weekly review logged');
  await page.waitForTimeout(900);
  await setBetweenHidden(page, true);
  await regionShot(page, 'ins-review-ran', [header, floorsGrid, wowRow], { padBottom: 4 });
  await setBetweenHidden(page, false);
  state.review = 'idle';

  // A floor that has no data: the connects log has never been written.
  mode.connectsLogged = false;
  await openInsightsTab(page);
  await page.getByText('Week over week').first().waitFor();
  await page.waitForTimeout(700);
  await setBetweenHidden(page, true);
  await regionShot(page, 'ins-review-notlogged', [header, floorsGrid]);
  await setBetweenHidden(page, false);
  mode.connectsLogged = true;

  // ============================ Gmail not connected ============================
  const gmailStates = [
    ['ins-review-disconnected', 'notset'],
    ['ins-review-gmail-notconnected', 'notconnected'],
    ['ins-review-gmail-expired', 'expired'],
  ];
  for (const [name, key] of gmailStates) {
    mode.health = key;
    await openInsightsTab(page);
    await page.getByText('Gmail sync').first().waitFor();
    await page.waitForTimeout(700);
    await regionShot(page, name, [page.locator('.card:has-text("Gmail sync")')]);
    if (key === 'notset') {
      await page.locator('button:has-text("How to set this up")').click();
      await page.waitForTimeout(500);
      await regionShot(page, 'ins-review-gmail-setup', [page.locator('.card:has-text("Gmail sync")')]);
    }
  }
  mode.health = null;

  // ============================ INSIGHTS sub-tab ===============================
  await page.setViewportSize(WIDE);
  state.google = 'connected';
  state.insights = 'none';
  mode.stale = false;
  await openInsightsTab(page);
  await openInsightsSection(page);
  await page.getByText('No analysis yet.').first().waitFor();
  await shotTight(page, 'ins-insights-empty', 360);

  // Generate: photograph the working state, then the finished analysis.
  await page.locator('button:has-text("Generate Analysis")').click();
  await page.getByText('Reading pipeline').first().waitFor();
  await page.waitForTimeout(300);
  await shotTight(page, 'ins-insights-generating', 360);
  await page.getByText('Last analysis').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(900);

  // Overview: tick one focus item so the checked state is on show.
  await page.locator('.ins-focus-row').first().click();
  await page.waitForTimeout(300);
  await shotTight(page, 'ins-insights-overview', null, 16);

  await clickSub(page, "What's working");
  await shotTight(page, 'ins-insights-working', null, 16);
  await clickSub(page, "What's not");
  await shotTight(page, 'ins-insights-notworking', null, 16);
  await clickSub(page, 'Recommended moves');
  await shotTight(page, 'ins-insights-moves', null, 16);

  // Snapshot, not live: an analysis that is two days old and written when the
  // tracker held 26 rows, while the tracker now holds 30.
  mode.stale = true;
  await openInsightsTab(page);
  await openInsightsSection(page);
  await page.getByText('Snapshot, not live.').first().waitFor();
  await page.waitForTimeout(500);
  await shotTight(page, 'ins-insights-stale', 452);
  mode.stale = false;
}
