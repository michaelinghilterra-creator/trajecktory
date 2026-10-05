/**
 * interview group: the Interview tab (company list, round chips, Prep, Live board,
 * Present mode), the Schedule modal, the Debrief modal and the Today outcome card.
 *
 * Every response is invented (see interview-fixtures.mjs). Shapes are copied from
 * dashboard-web/server/lib/interview.mjs and server/routes/event-actions.mjs.
 */
import { FIXTURES as F } from '../capture-dashboard.mjs';
import { json, clickNav, clickSub, gotoApp, openRowDrawer, shotClip, shotEl, shotWindow } from '../capture-lib.mjs';
import { SESSIONS, prepFor, docFor, runsheetFor, PENDING_OUTCOME, RUNSHEET_DERIVED } from './interview-fixtures.mjs';

export const meta = { name: 'interview', summary: 'Interview tab, Live board, Present, Schedule and Debrief modals, outcome card' };

const notFound = (route, error) =>
  route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error }) });

const parts = (route, marker) => {
  const p = new URL(route.request().url()).pathname.split('/');
  const i = p.indexOf(marker);
  return p.slice(i + 1).map(decodeURIComponent);
};

export async function install(page) {
  // ==== Interview tab ======================================================
  await page.route('**/api/interview/sessions', (r) => json(r, SESSIONS));
  await page.route('**/api/interview/prep/**', (r) => {
    const [id, round] = parts(r, 'prep');
    const prep = prepFor(id, round);
    return prep ? json(r, prep) : notFound(r, `No prep file for ${id} round ${round}.`);
  });
  await page.route('**/api/interview/runsheet/**', (r) => {
    const [id, round] = parts(r, 'runsheet');
    const sheet = runsheetFor(id, round);
    return sheet ? json(r, sheet) : notFound(r, `No run sheet for this round. This round has prep but no live board.`);
  });
  await page.route('**/api/interview/doc/**', (r) => {
    const [id, key] = parts(r, 'doc');
    const doc = docFor(id, key);
    return doc ? json(r, doc) : notFound(r, 'Document not found.');
  });

  // ==== Debrief, outcome and status writes (never reach a server) ==========
  await page.route('**/api/interview/debriefs/pending', (r) => json(r, { pending: [] }));
  await page.route('**/api/interview/debriefs/*', (r) => json(r, { ok: true, notes: [] }));
  await page.route('**/api/interviews/pending-outcome', (r) => json(r, PENDING_OUTCOME));
  await page.route('**/api/interviews/outcome', (r) => json(r, { ok: true, debrief: true }));
  await page.route('**/api/applications/*', (r) => {
    if (r.request().method() === 'PATCH') return json(r, { ok: true });
    return r.fallback();
  });

  // ==== Today tab extras ===================================================
  await page.route('**/api/cadence/streak', (r) => json(r, F.CADENCE_STREAK));
  await page.route('**/api/cadence', (r) => json(r, F.CADENCE_TEMPLATE));
  await page.route('**/api/google/calendar/today', (r) => json(r, { canReadCalendar: false, events: [] }));

  // ==== Pipeline drawer extras (only the click path to the Schedule modal) -
  await page.route('**/api/cheatsheets/*', (r) => notFound(r, 'No report for this capture.'));
  await page.route('**/api/notes/*', (r) => json(r, []));
  await page.route('**/api/jd/**', (r) => json(r, { available: false }));
  await page.route('**/api/artifacts/**', (r) => json(r, { files: [] }));
  await page.route('**/api/target-talent/by-company/**', (r) => json(r, []));
}

// ==== helpers ===============================================================
const settle = (page, ms = 500) => page.waitForTimeout(ms);

async function contentToTop(page) {
  await page.evaluate(() => { const c = document.querySelector('.content'); if (c) c.scrollTop = 0; });
  await settle(page, 250);
}

/** Union rect (viewport css px) of the first match of each selector, padded, clamped to the viewport. */
async function rectOf(page, selectors, { pad = 10, fullWidth = false } = {}) {
  let l = Infinity, t = Infinity, rt = -Infinity, b = -Infinity;
  for (const s of selectors) {
    const bb = await page.locator(s).first().boundingBox();
    if (!bb) throw new Error('rectOf: not found ' + s);
    l = Math.min(l, bb.x); t = Math.min(t, bb.y); rt = Math.max(rt, bb.x + bb.width); b = Math.max(b, bb.y + bb.height);
  }
  if (fullWidth) { const c = await page.locator('.content').first().boundingBox(); l = c.x; rt = c.x + c.width; pad = Math.min(pad, 12); }
  const x = fullWidth ? Math.floor(l) : Math.max(0, Math.floor(l - pad));
  const y = Math.max(0, Math.floor(t - pad));
  const width = Math.min(1440, Math.ceil(fullWidth ? rt : rt + pad)) - x;
  const height = Math.min(1000, Math.ceil(b + pad)) - y;
  return { x, y, width, height };
}

const chip = (page, text) => page.locator('.filterbar .chip', { hasText: text }).first();

export async function capture({ page }) {
  await gotoApp(page);
  // The floating AI Coach button sits bottom right and lands on top of edge crops. It is
  // unrelated to this tab, so it is hidden for these shots only.
  await page.addStyleTag({ content: 'button[style*="bottom: 20px"][style*="border-radius: 50%"]{visibility:hidden !important}' });
  await clickNav(page, 'Interview');
  await page.waitForSelector('.focus-task');
  await settle(page, 900);

  // ================= 1. company list and round chips =================
  await page.locator('button', { hasText: 'Archive (' }).click();
  await settle(page, 400);
  await contentToTop(page);
  // Company list (Active plus the expanded Archive), through the round chips.
  await shotClip(page, 'int-list', await rectOf(page, ['.focus-task', '.filterbar'], { fullWidth: true, pad: 12 }));
  // Header (company, round, stage) plus chips only.
  await shotClip(page, 'int-round-chips', await rectOf(page, ['.content h1', '.filterbar'], { fullWidth: true, pad: 12 }));
  // Collapse the archive again for the rest of the tab.
  await page.locator('button', { hasText: 'Archive (' }).click();
  await settle(page, 300);

  // ================= 2. prep pane =================
  await contentToTop(page);
  await page.waitForSelector('.ib-prepwrap');
  await shotWindow(page, 'int-prep-window');
  await page.evaluate(() => document.querySelector('.subtabs').scrollIntoView({ block: 'start' }));
  await settle(page, 400);
  {
    const st = await page.locator('.subtabs').first().boundingBox();
    const ct = await page.locator('.content').first().boundingBox();
    await shotClip(page, 'int-prep', { x: Math.floor(ct.x), y: Math.max(0, Math.floor(st.y) - 8), width: Math.floor(ct.width), height: 1000 - Math.max(0, Math.floor(st.y) - 8) });
  }
  await contentToTop(page);
  await shotEl(page, '.ib-preprail', 'int-prep-sections');

  // Print menu (Full prep document / Cram sheet)
  await page.locator('button', { hasText: 'Print' }).click();
  await settle(page, 400);
  const menu = await page.evaluate(() => {
    const head = document.querySelector('.ib-prephead').getBoundingClientRect();
    const items = [...document.querySelectorAll('.ib-navitem')].filter((n) => /Full prep document|Cram sheet/.test(n.textContent));
    const last = items[items.length - 1].getBoundingClientRect();
    return { l: head.left, t: head.top, r: head.right, b: last.bottom };
  });
  await shotClip(page, 'int-print-menu', {
    x: Math.floor(menu.l - 10), y: Math.floor(menu.t - 10),
    width: Math.ceil(menu.r - menu.l + 20), height: Math.ceil(menu.b - menu.t + 24),
  });
  await page.keyboard.press('Escape');
  await settle(page, 300);

  // A collapsed section opened (the "expand" affordance) and a section jumped to from the rail.
  await page.locator('.ib-navitem', { hasText: 'Behavioral' }).first().click();
  await settle(page, 700);
  await shotWindow(page, 'int-prep-jumped');
  await contentToTop(page);

  // ================= 3. live board =================
  await clickSub(page, 'Live', { exact: true });
  await page.waitForSelector('#root .ib .row[data-k]');
  await settle(page, 800);
  await page.evaluate(() => document.querySelector('#root .ib').scrollIntoView({ block: 'start' }));
  await settle(page, 400);
  await shotWindow(page, 'int-live-window');
  await shotEl(page, '#root .ib', 'int-live');

  // A cue clicked: the answer box parks at the top and the row is outlined.
  await page.locator('#root .ib .row[data-k="hero"]').click();
  await settle(page, 500);
  await shotWindow(page, 'int-live-cue');
  await page.keyboard.press('Escape');
  await settle(page, 300);

  // Calibration and counts rail (below the board).
  await page.evaluate(() => document.querySelector('.ib-rail').scrollIntoView({ block: 'center' }));
  await settle(page, 400);
  await shotEl(page, '.ib-rail', 'int-live-calibration');
  await contentToTop(page);

  // ================= 4. present mode =================
  await page.locator('button', { hasText: 'Present' }).click();
  await page.waitForSelector('.ib-present .ib');
  await settle(page, 900);
  await shotWindow(page, 'int-present');
  await page.locator('.ib-present .row[data-k="plan90"]').click();
  await settle(page, 500);
  await shotWindow(page, 'int-present-cue');
  await page.keyboard.press('Escape');       // first Esc closes the answer, board stays
  await settle(page, 400);
  await page.locator('.ib-exit').click();    // second path out: the faint "esc" button
  await settle(page, 700);

  // ================= 5. round with no board, new round, doc, needs prep =================
  await chip(page, 'Round 2').click();
  await settle(page, 500);
  await clickSub(page, 'Live', { exact: true });
  await settle(page, 600);
  await contentToTop(page);
  console.log('  Present disabled on a round with no board:', await page.locator('button', { hasText: 'Present' }).first().isDisabled());
  await shotClip(page, 'int-prep-only-empty', await rectOf(page, ['.content h1', '.card:has-text("No live board for this round")'], { fullWidth: true, pad: 12 }));

  await chip(page, '+ New round').click();
  await settle(page, 500);
  await shotClip(page, 'int-new-round', await rectOf(page, ['.content h1', '.card:has-text("Start a new round")'], { fullWidth: true, pad: 12 }));
  await chip(page, '+ New round').click();

  await chip(page, 'Company intel').click();
  await settle(page, 700);
  await contentToTop(page);
  await shotWindow(page, 'int-doc');

  // A tracker row at Phone Screen with nothing on disk.
  await page.locator('.focus-task', { hasText: 'Tyrell Robotics' }).click();
  await settle(page, 600);
  await contentToTop(page);
  await shotClip(page, 'int-needs-prep', await rectOf(page, ['.focus-task', '.card:has-text("Nothing has been prepared")'], { fullWidth: true, pad: 12 }));

  // ================= 6. schedule modal via Pipeline > Roles > drawer =================
  await clickNav(page, 'Pipeline');
  await clickSub(page, 'Roles', { exact: true });
  await settle(page, 900);
  const drawer = await openRowDrawer(page, 'Hooli Systems');
  await shotEl(page, '.pl-drawer.open .ds-section:has(.pipe-track)', 'int-booked-field');
  await shotEl(page, '.pl-drawer.open .dr-foot', 'int-schedule-trigger');
  await drawer.locator('.dr-foot button', { hasText: 'Move to Phone Screen' }).click();
  await page.waitForSelector('h3:has-text("Schedule:")');
  await settle(page, 500);
  const sch = page.locator('.card:has(h3:has-text("Schedule:"))');
  await shotEl(page, '.card:has(h3:has-text("Schedule:"))', 'int-schedule-modal');
  await sch.locator('input[type=date]').fill('2026-07-24');
  await sch.locator('input[type=time]').fill('14:00');
  await sch.locator('input[placeholder=Name]').fill('Ansel Prothero');
  await sch.locator('label', { hasText: 'Video' }).click();
  await settle(page, 400);
  await shotEl(page, '.card:has(h3:has-text("Schedule:"))', 'int-schedule-filled');
  await shotWindow(page, 'int-schedule-context');
  await sch.locator('button', { hasText: 'Cancel' }).click();
  await settle(page, 400);

  // ================= 7. debrief modal =================
  await page.evaluate(() => window.tjkOpenDebrief({ appId: 412, company: 'Northwind Analytics', role: 'VP, Revenue Operations', stage: '1st Interview' }));
  await page.waitForSelector('h3:has-text("Debrief:")');
  await settle(page, 500);
  await shotEl(page, '.card:has(h3:has-text("Debrief:"))', 'int-debrief-modal');
  const deb = page.locator('.card:has(h3:has-text("Debrief:"))');
  await deb.locator('textarea').nth(0).fill('Advanced. Felt strong on the consolidation story, a little rushed at the end.');
  await deb.locator('textarea').nth(1).fill('She asked whether running RevOps without owning the data warehouse would frustrate me. I said no, and named the one dependency I would flag early.');
  await deb.locator('textarea').nth(2).fill('Most likely a timing mismatch: they want someone who can start within a month.');
  await deb.locator('textarea').nth(3).fill('The CRO herself. She is the decision maker.');
  await deb.locator('textarea').nth(5).fill('The carrier scorecard story and the forecast rebuild.');
  await deb.locator('textarea').nth(8).fill('Recruiter books the final loop by Friday.');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await settle(page, 400);
  await shotEl(page, '.card:has(h3:has-text("Debrief:"))', 'int-debrief-filled');
  await deb.locator('button', { hasText: 'Skip for now' }).click();
  await settle(page, 400);

  // ================= 8. outcome card on Today =================
  await page.locator('.pl-drawer.open .icon-btn[title^="Close"]').click();
  await page.waitForSelector('.pl-drawer.open', { state: 'detached' });
  await clickNav(page, 'Today');
  await page.waitForSelector('.card:has-text("Did it happen?")');
  await settle(page, 800);
  const oc = '.card:has-text("Did it happen?")';
  await shotEl(page, oc, 'int-outcome-card');
  await page.locator(`${oc} summary`).click();
  await settle(page, 400);
  await shotEl(page, oc, 'int-outcome-upcoming');
  await page.locator(`${oc} summary`).click();
  await page.getByRole('button', { name: 'Held', exact: true }).first().click();
  await settle(page, 400);
  await shotEl(page, oc, 'int-outcome-held');
  await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
  await page.getByRole('button', { name: 'Rescheduled', exact: true }).first().click();
  await page.locator(`${oc} input[type=date]`).first().fill('2026-07-27');
  await page.locator(`${oc} input[type=time]`).first().fill('15:00');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await settle(page, 400);
  await shotEl(page, oc, 'int-outcome-rescheduled');

  // Keep the derived-warning copy handy for the report.
  console.log('  board warnings (round 3):', JSON.stringify(RUNSHEET_DERIVED.r3.warnings));
  console.log('  board problems (round 3):', JSON.stringify(RUNSHEET_DERIVED.r3.problems));
}
