/**
 * drawer.mjs: the per-role report drawer (.pl-drawer) opened from Pipeline > Roles.
 *
 * Opens rows and captures the drawer and what it shows. The Pipeline sub-tabs
 * themselves belong to another group; the schedule and debrief modals belong to
 * the interview group and are never opened here.
 *
 * Everything the drawer fetches is mocked with invented data from
 * drawer-fixtures.mjs: cheat sheet (per id), notes, posting, files, contacts,
 * follow-up history, identity, and the status guard.
 */
import {
  VIEWPORT, OUT, json, record, gotoApp, clickNav, clickSub, openRowDrawer,
  shotEl, shotDrawer, shotWindow,
} from '../capture-lib.mjs';
import { resolve } from 'path';
import { dialogFor } from '../../../lib/status-guard-dialog.mjs';
import {
  IDENTITY, COMPENSATION, APP_ROWS, cheatsheetFor, NOTES_412, POSTING_412, ARTIFACTS,
  TA_CONTACTS_412, TOUCHES, COACH_ITEM_412, idOf,
} from './drawer-fixtures.mjs';

export const meta = { name: 'drawer', summary: 'per-role report drawer: ten tabs, stage track, footers by status' };

const D = '.pl-drawer.open';
const idFromUrl = (url, re) => parseInt(new URL(url).pathname.match(re)[1], 10);

export async function install(page) {
  await page.route('**/api/identity', (r) => json(r, IDENTITY));
  // Ready install with a compensation band, so "Posted vs target" has something to compare with.
  const { FIXTURES: F } = await import('../capture-dashboard.mjs');
  await page.route('**/api/setup/state', (r) =>
    json(r, { ...F.STATE_READY, values: { ...F.STATE_READY.values, compensation: COMPENSATION } }));
  await page.route('**/api/applications', (r) => json(r, APP_ROWS));
  await page.route('**/api/cheatsheets/*', (r) => {
    const cs = cheatsheetFor(idFromUrl(r.request().url(), /cheatsheets\/(\d+)/));
    return cs ? json(r, cs) : json(r, { error: 'No report for this id' }, 404);
  });
  await page.route('**/api/notes/*', (r) => {
    const id = idFromUrl(r.request().url(), /notes\/(\d+)/);
    return json(r, id === 412 ? NOTES_412 : []);
  });
  await page.route('**/api/jd/*', (r) => {
    const id = idFromUrl(r.request().url(), /jd\/(\d+)/);
    return id === 412 ? json(r, POSTING_412) : json(r, { error: 'no-snapshot' }, 404);
  });
  await page.route('**/api/artifacts/*', (r) => {
    const id = idFromUrl(r.request().url(), /artifacts\/(\d+)/);
    return json(r, ARTIFACTS[id] || { resume: null, cover: null, others: [] });
  });
  await page.route('**/api/target-talent/by-company/**', (r) => {
    const company = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop());
    return json(r, company === 'Northwind Analytics' ? TA_CONTACTS_412 : []);
  });
  await page.route('**/api/followups', (r) => json(r, TOUCHES));
  await page.route('**/api/followups/stale', (r) =>
    json(r, { ...F.FOLLOWUPS_STALE, warm: [COACH_ITEM_412, ...F.FOLLOWUPS_STALE.warm] }));
  // The status guard. Closing a role as Rejected with no rejection email on file is
  // refused by the real server; the answer below is built with the app's own dialogFor().
  await page.route('**/api/applications/*/status-check**', (r) => {
    const id = idFromUrl(r.request().url(), /applications\/(\d+)\/status-check/);
    const app = APP_ROWS.find((a) => a.id === id);
    const verdict = { allowed: false, reason: 'no_employer_evidence', dated_on: null, evidence_ref: null, show_first: [], suggest: null };
    return json(r, { id, to: 'Rejected', ...verdict, dialog: dialogFor(verdict, app.company) });
  });
}

// ---- helpers -------------------------------------------------------------------
async function closeDrawer(page) {
  await page.keyboard.press('Escape');
  await page.locator('.pl-drawer').waitFor({ state: 'detached' });
  await page.waitForTimeout(300);
}

async function openRole(page, company) {
  const d = await openRowDrawer(page, company);
  const title = await page.locator(`${D} .drawer-head h3`).innerText();
  if (title.trim() !== company) throw new Error(`opened "${title}" instead of "${company}"`);
  return d;
}

async function tab(page, label) {
  const t = page.locator(`${D} .dr-tab`).filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) });
  if (await t.count() !== 1) throw new Error(`drawer tab "${label}" not found exactly once`);
  await t.click();
  await page.waitForTimeout(700);
}

async function tabLabels(page) {
  return page.locator(`${D} .dr-tab`).allInnerTexts().then((a) => a.map((s) => s.trim()));
}

/** Run `fn` with a viewport tall enough to show the whole drawer body (capped). */
async function tall(page, fn, cap = 1700) {
  const extra = await page.evaluate(() => {
    const b = document.querySelector('.pl-drawer.open .drawer-body');
    return Math.max(0, b.scrollHeight - b.clientHeight);
  });
  const h = Math.min(cap, VIEWPORT.height + extra);
  const grew = h > VIEWPORT.height;
  if (grew) { await page.setViewportSize({ width: VIEWPORT.width, height: h }); await page.waitForTimeout(500); }
  try { return await fn(h); }
  finally { if (grew) { await page.setViewportSize(VIEWPORT); await page.waitForTimeout(300); } }
}

const shotDrawerFull = (page, name) => tall(page, async (h) => {
  await shotDrawer(page, name);
  return h;
});

async function shotLoc(loc, name, kind) {
  await loc.waitFor({ state: 'visible' });
  await loc.scrollIntoViewIfNeeded();
  await loc.page().waitForTimeout(300);
  await loc.screenshot({ path: resolve(OUT, `${name}.png`) });
  record(name, { kind: kind || 'el' });
  console.log('  saved', name + '.png');
}

const section = (page, text) => page.locator(`${D} .rp-section`).filter({ hasText: text }).first();

export async function capture(h) {
  const { page } = h;
  await gotoApp(page);
  // The floating Coach button sits over the drawer footer at this width; hide it so crops are clean.
  await page.addStyleTag({ content: 'button[aria-label="Ask the Coach"]{visibility:hidden !important}' });
  await clickNav(page, 'Pipeline');
  await clickSub(page, 'Roles', { exact: true });

  const facts = {};

  // ======================= Northwind: the full report ===========================
  await openRole(page, 'Northwind Analytics');
  // In context: the drawer over the Roles table.
  await shotWindow(page, 'dr-in-context');

  facts.tabsNorthwind = await tabLabels(page);
  if (!facts.tabsNorthwind.includes('Follow-up')) throw new Error('Follow-up tab missing for a 2nd Interview role');

  // Overview
  await shotDrawerFull(page, 'dr-overview');

  // Score explainer: breakdown plus the panel it opens.
  await page.locator(`${D} button`).filter({ hasText: 'How is this scored?' }).click();
  await page.waitForTimeout(700);
  await tall(page, () => shotLoc(section(page, 'Score Breakdown'), 'dr-score-explainer'));
  await page.locator(`${D} button`).filter({ hasText: /^Close$/ }).click();
  await page.waitForTimeout(400);

  // Stage track, files row, quick copy bar.
  await shotLoc(page.locator(`${D} .ds-section`).first(), 'dr-stage-track');
  await shotLoc(page.getByText('Files for this application:').locator('..'), 'dr-files-row');
  await shotLoc(page.getByText('Quick copy:').locator('..'), 'dr-quickcopy');

  // Resume Match
  await tab(page, 'Resume Match');
  await shotDrawerFull(page, 'dr-resume-match');

  // Comp
  await tab(page, 'Comp');
  await shotDrawerFull(page, 'dr-comp');

  // Interview: open the first red-flag question so the answer is visible.
  await tab(page, 'Interview');
  await page.locator(`${D} details.rp-rf summary`).first().click();
  await page.waitForTimeout(400);
  await shotDrawerFull(page, 'dr-interview');

  // Customize (CV Changes default, then LinkedIn)
  await tab(page, 'Customize');
  await shotDrawerFull(page, 'dr-customize');
  await page.locator(`${D} .rp-seg button`).filter({ hasText: /^LinkedIn/ }).click();
  await page.waitForTimeout(500);
  await shotDrawerFull(page, 'dr-customize-linkedin');

  // Legitimacy
  await tab(page, 'Legitimacy');
  await shotDrawerFull(page, 'dr-legitimacy');

  // Posting
  await tab(page, 'Posting');
  await shotDrawerFull(page, 'dr-posting');

  // Notes, then the to-do control filled in.
  await tab(page, 'Notes');
  await shotDrawerFull(page, 'dr-notes');
  const todo = section(page, 'Add a to-do');
  await todo.locator('input.dr-note-input').fill('Rehearse the migration walkthrough for the CRO');
  await todo.locator('input[type=date]').fill('2026-07-23');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(300);
  await shotLoc(todo, 'dr-notes-add-todo');
  await todo.getByRole('button', { name: 'Add', exact: true }).click();
  await page.waitForTimeout(500);
  await shotLoc(todo, 'dr-notes-todo-added');

  // Contacts
  await tab(page, 'Contacts');
  await shotDrawerFull(page, 'dr-contacts');

  // Follow-up
  await tab(page, 'Follow-up');
  await shotDrawerFull(page, 'dr-followup');
  await page.locator(`${D} button`).filter({ hasText: 'Log touch (manual)' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: resolve(OUT, 'dr-followup-log-touch.png'), clip: { x: 0, y: 0, ...VIEWPORT } });
  record('dr-followup-log-touch', { kind: 'window' });
  console.log('  saved dr-followup-log-touch.png');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForTimeout(300);

  // Footer of an interview-stage role (Northwind itself).
  await tab(page, 'Overview');
  facts.footerInterview = await footerButtons(page);
  await shotLoc(page.locator(`${D} .dr-foot`), 'dr-footer-interview');
  await closeDrawer(page);

  // ======================= Footers by status ===================================
  const FOOT = [
    ['Umbra Logistics', 'evaluated'],
    ['Acme Robotics', 'applied'],
    ['Contoso Freight', 'offer'],
    ['Stark Freight', 'closed'],
    ['Globex Health', 'interview-globex'],
  ];
  for (const [company, key] of FOOT) {
    await openRole(page, company);
    facts['footer:' + key] = await footerButtons(page);
    facts['tabs:' + key] = await tabLabels(page);
    facts['header:' + key] = await page.locator(`${D} .drawer-head`).innerText();
    await shotLoc(page.locator(`${D} .dr-foot`), `dr-footer-${key}`);
    await shotDrawer(page, `dr-footer-${key}-drawer`);
    if (key === 'closed') await shotLoc(page.locator(`${D} .ds-section`).first(), 'dr-stage-track-closed-notafit');
    if (company === 'Acme Robotics') await closerGuard(page, facts);
    await closeDrawer(page);
  }

  // A role closed after it advanced: the stage track marks where it was lost.
  await openRole(page, 'Wayne Logistics');
  facts['footer:rejected'] = await footerButtons(page);
  await shotLoc(page.locator(`${D} .ds-section`).first(), 'dr-stage-track-lost');
  await shotLoc(page.locator(`${D} .dr-foot`), 'dr-footer-rejected');
  await closeDrawer(page);

  // A near-threshold auto-discard: Reopen plus Re-evaluate.
  await openRole(page, 'Vandelay Industries');
  facts['footer:reeval'] = await footerButtons(page);
  await shotLoc(page.locator(`${D} .dr-foot`), 'dr-footer-reeval');
  await closeDrawer(page);

  console.log('\nFACTS ' + JSON.stringify(facts, null, 1));
}

async function footerButtons(page) {
  return page.locator(`${D} .dr-foot`).evaluate((el) =>
    [...el.querySelectorAll('button, a')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
}

/**
 * Closing Rejected with no rejection email on file: the app asks, with a native
 * browser prompt (window.prompt), which no screenshot can contain. The real text is
 * recorded from the dialog event; the picture is a REPLICA of that prompt drawn over
 * the dimmed app, because Playwright cannot capture native dialogs.
 */
async function closerGuard(page, facts) {
  const dialogP = page.waitForEvent('dialog');
  await page.locator(`${D} .dr-foot button`).filter({ hasText: /^Rejected$/ }).click();
  const dlg = await dialogP;
  facts.closerDialog = { type: dlg.type(), message: dlg.message() };
  await dlg.dismiss();
  await page.waitForTimeout(500);
  // Cancelling the prompt still closes the drawer (advance() closes it for any non-active target), so reopen it for the picture.
  facts.drawerClosedAfterCancel = (await page.locator('.pl-drawer').count()) === 0;
  if (facts.drawerClosedAfterCancel) await openRole(page, 'Acme Robotics');
  await page.evaluate((message) => {
    const o = document.createElement('div');
    o.id = 'capture-replica';
    o.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding-top:70px;font-family:Segoe UI,Arial,sans-serif;';
    o.innerHTML = `<div style="width:440px;background:#fff;color:#1f1f1f;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.4);padding:20px 22px 16px;">
      <div style="font-size:15px;font-weight:600;margin-bottom:10px;">localhost:3333 says</div>
      <div style="font-size:13px;line-height:1.45;margin-bottom:12px;">${message}</div>
      <div style="border:2px solid #0b57d0;border-radius:6px;height:30px;margin-bottom:16px;"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <div style="background:#0b57d0;color:#fff;border-radius:16px;padding:7px 20px;font-size:13px;">OK</div>
        <div style="border:1px solid #c4c7c5;color:#0b57d0;border-radius:16px;padding:7px 18px;font-size:13px;">Cancel</div>
      </div></div>`;
    document.body.appendChild(o);
  }, facts.closerDialog.message);
  await page.waitForTimeout(300);
  await shotWindow(page, 'dr-closer-confirm');
  await page.evaluate(() => document.getElementById('capture-replica')?.remove());
}
