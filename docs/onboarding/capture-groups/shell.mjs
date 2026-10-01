/**
 * shell group: app shell (sidebar, Workflow panel, topbar, palette, update banner,
 * floating Coach), the Today tab and the AI Coach tab. Every value is invented.
 */
import {
  json, state, gotoApp, clickNav, clickSub, shotWindow, shotTight, shotEl, shotClip, VIEWPORT, FROZEN_NOW,
} from '../capture-lib.mjs';
import { FIXTURES as F } from '../capture-dashboard.mjs';
import * as X from './shell-fixtures.mjs';

export const meta = { name: 'shell', summary: 'app shell, Workflow panel, Today and AI Coach' };

// Switches the routes read at request time.
const S = {
  signedIn: true, trusted: true, needsManual: false, hasKey: false,
  activeJobs: [], evalStatus: null, pending: 7,
  calendar: 'off',        // 'off' | 'granted' | 'reconnect'
  outcome: false, update: false, coach: 'history',
};

export async function install(page) {
  const r = (pattern, fn) => page.route(pattern, fn);

  // Sidebar Workflow panel
  await r('**/api/claude-status', (rt) => json(rt, S.trusted
    ? { signedIn: S.signedIn, workspaceTrusted: true }
    : { signedIn: S.signedIn, workspaceTrusted: false, trustLosing: ['WebFetch', 'WebSearch'] }));
  await r('**/api/pipeline/pending', (rt) => json(rt, { pending: S.pending }));
  await r('**/api/pipeline/needs-manual', (rt) => json(rt, S.needsManual ? X.NEEDS_MANUAL : { items: [] }));
  await r('**/api/setup/models', (rt) => json(rt, S.hasKey ? { ...F.MODELS_STATE, hasKey: true, billingMode: 'key' } : F.MODELS_STATE));
  await r('**/api/agent/roll-config', (rt) => json(rt, { rollMax: 15, batch: S.hasKey ? 10 : 5, active: false }));
  await r('**/api/agent/active', (rt) => json(rt, S.activeJobs));
  await r('**/api/agent/pipeline', (rt) => {
    S.evalStatus = X.EVAL_RUNNING;
    return json(rt, { jobId: X.EVAL_RUNNING.jobId });
  });
  await r('**/api/agent/status/**', (rt) => {
    const id = new URL(rt.request().url()).pathname.split('/').pop();
    const job = [X.EVAL_RUNNING, X.SCAN_RUNNING, X.EVAL_FINISHED].find(j => j.jobId === id);
    return job ? json(rt, job) : json(rt, { error: 'Job not found' }, 404);
  });

  // Topbar
  await r('**/api/search?**', (rt) => json(rt, X.searchResponse(new URL(rt.request().url()).searchParams.get('q'))));
  await r('**/api/system/update-check', (rt) => json(rt, S.update ? X.UPDATE_AVAILABLE : { status: 'up-to-date' }));

  // Today
  await r('**/api/cadence', (rt) => json(rt, X.CADENCE_TEMPLATE));
  await r('**/api/cadence/today', (rt) => json(rt, X.CADENCE_TODAY));
  await r('**/api/cadence/streak', (rt) => json(rt, X.CADENCE_STREAK));
  await r('**/api/todos', (rt) => json(rt, X.TODOS));
  await r('**/api/google/calendar/today', (rt) => json(rt, S.calendar === 'granted' ? X.CALENDAR_GRANTED
    : S.calendar === 'reconnect' ? X.CALENDAR_RECONNECT
    : { connected: false, canReadCalendar: false, needsReconnect: false, needsConnect: true, events: [] }));
  await r('**/api/interviews/pending-outcome', (rt) => json(rt, S.outcome ? X.PENDING_OUTCOME : { enabled: true, items: [] }));

  // AI Coach
  await r('**/api/coach/history', (rt) => json(rt, S.coach === 'empty' ? { messages: [] } : X.COACH_HISTORY));
  await r('**/api/coach/brief', (rt) => json(rt, X.COACH_BRIEF));
  await r('**/api/coach/message', (rt) => json(rt, X.COACH_REPLY_WITH_ACTION));
  await r('**/api/coach/act', (rt) => json(rt, { ok: true, message: 'Marked Fabrikam Freight as Rejected.' }));
}

const box = async (loc) => {
  const b = await loc.first().boundingBox();
  if (!b) throw new Error('no bounding box');
  return b;
};
const pad = (b, p, maxW = VIEWPORT.width, maxH = VIEWPORT.height) => {
  const x = Math.max(0, b.x - p), y = Math.max(0, b.y - p);
  return { x, y, width: Math.min(maxW - x, b.width + 2 * p), height: Math.min(maxH - y, b.height + 2 * p) };
};

async function fresh(page, tab = null) {
  await gotoApp(page);
  if (tab) await clickNav(page, tab);
  await page.mouse.move(700, 960);
}

export async function capture({ page }) {
  state.setup = 'ready';
  state.data = 'populated';

  // Window in context: Today, set-up state
  S.calendar = 'granted'; S.outcome = false;
  await fresh(page, 'Today');
  await page.mouse.move(900, 700);
  await shotWindow(page, 'shell-window-today', 660);

  // Workflow panel
  await fresh(page);
  await shotEl(page, '.workflow-panel', 'shell-workflow-default');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.mouse.move(700, 960);
  await page.waitForTimeout(400);
  await shotEl(page, '.workflow-panel', 'shell-workflow-advanced');

  S.signedIn = false;
  await fresh(page);
  await shotEl(page, '.workflow-panel', 'shell-workflow-signin');
  S.signedIn = true;

  S.trusted = false;
  await fresh(page);
  await shotEl(page, '.workflow-panel', 'shell-workflow-trust');
  S.trusted = true;

  S.needsManual = true;
  await fresh(page);
  await shotEl(page, '.workflow-panel', 'shell-workflow-needs-manual');
  S.needsManual = false;

  // Spend gate, plan rail (no charge) and API-key rail (estimated dollars).
  await fresh(page);
  await page.locator('.workflow-btn', { hasText: 'Evaluate' }).click();
  await page.locator('[aria-label="Confirm evaluation spend"]').waitFor();
  await page.waitForTimeout(400);
  const gateCard = page.locator('[aria-label="Confirm evaluation spend"] > div');
  await shotClip(page, 'shell-workflow-spend-gate', pad(await box(gateCard), 4));

  // Confirm it: the rolling Evaluate chain starts and the panel shows the live meter.
  await page.getByRole('button', { name: 'Evaluate', exact: true }).click();
  await page.waitForTimeout(2800); // one 2s poll tick
  await shotEl(page, '.workflow-panel', 'shell-workflow-running');

  S.hasKey = true;
  await fresh(page);
  await page.locator('.workflow-btn', { hasText: 'Evaluate' }).click();
  await page.locator('[aria-label="Confirm evaluation spend"]').waitFor();
  await page.waitForTimeout(400);
  await shotClip(page, 'shell-workflow-spend-gate-key', pad(await box(gateCard), 4));
  await page.getByRole('button', { name: 'Cancel' }).click();
  await shotEl(page, '.workflow-panel', 'shell-workflow-apikey');
  S.hasKey = false;

  S.activeJobs = [X.SCAN_RUNNING];
  await fresh(page);
  await page.waitForTimeout(2800);
  await shotEl(page, '.workflow-panel', 'shell-workflow-scan-running');

  S.activeJobs = [X.EVAL_FINISHED]; S.pending = 0;
  await fresh(page);
  await shotEl(page, '.workflow-panel', 'shell-workflow-finished');
  S.activeJobs = []; S.pending = 7;

  // Topbar: theme list, search, command palette
  await fresh(page);
  // A native <select> popup is drawn by the OS and is not part of the page, so a
  // headless screenshot cannot show it. Re-render the same <select> as an open
  // list (size = option count), pinned under the closed control. Options, order
  // and labels are the real ones.
  await page.evaluate(() => {
    const sel = document.querySelector('.theme-select');
    const b = sel.getBoundingClientRect();
    sel.size = sel.options.length;
    sel.focus();
    Object.assign(sel.style, {
      position: 'fixed', top: `${b.bottom + 4}px`, left: `${b.left}px`, width: `${b.width}px`,
      height: 'auto', zIndex: 500, padding: '4px', overflow: 'hidden',
    });
  });
  await page.waitForTimeout(300);
  const tb = await box(page.locator('.theme-select'));
  await shotClip(page, 'shell-theme-menu', { x: tb.x - 520, y: 0, width: VIEWPORT.width - (tb.x - 520), height: tb.y + tb.height + 12 });

  await fresh(page);
  await page.locator('.search input').click();
  await page.keyboard.type('analytics', { delay: 20 });
  await page.locator('.cmdk-list .cmdk-item').first().waitFor();
  await page.waitForTimeout(500);
  const dd = await box(page.locator('.search .cmdk-list, .cmdk-list').first());
  const sb = await box(page.locator('.search'));
  await shotClip(page, 'shell-search-results', { x: sb.x - 12, y: 0, width: sb.width + 24, height: dd.y + dd.height + 14 });

  await fresh(page);
  await page.keyboard.press('Control+k');
  await page.locator('.cmdk').waitFor();
  await page.waitForTimeout(500);
  await shotClip(page, 'shell-command-palette', pad(await box(page.locator('.cmdk')), 6));

  // Palette filtered by typing
  await page.keyboard.type('theme');
  await page.waitForTimeout(300);
  await shotClip(page, 'shell-command-palette-filtered', pad(await box(page.locator('.cmdk')), 6));
  await page.keyboard.press('Escape');

  // Update banner
  S.update = true;
  await fresh(page, 'Today');
  const banner = page.locator('.content > div').first();
  await banner.waitFor();
  await page.waitForTimeout(500);
  const bb = await box(banner);
  await shotClip(page, 'shell-update-banner', { x: Math.max(0, bb.x - 20), y: Math.max(0, bb.y - 16), width: bb.width + 40, height: bb.height + 32 });
  await page.getByRole('button', { name: "What's new" }).click();
  await page.waitForTimeout(400);
  const bb2 = await box(banner);
  await shotClip(page, 'shell-update-banner-notes', { x: Math.max(0, bb2.x - 20), y: Math.max(0, bb2.y - 16), width: bb2.width + 40, height: bb2.height + 32 });
  S.update = false;

  // Floating Coach
  await fresh(page, 'Pipeline');
  await page.getByRole('button', { name: 'Ask the Coach' }).click();
  await page.waitForTimeout(900);
  await shotClip(page, 'shell-coach-floating', { x: VIEWPORT.width - 480, y: 296, width: 480, height: VIEWPORT.height - 296 });

  S.coach = 'empty';
  await fresh(page);
  await page.getByRole('button', { name: 'Ask the Coach' }).click();
  await page.waitForTimeout(900);
  await shotClip(page, 'shell-coach-floating-empty', { x: VIEWPORT.width - 480, y: 296, width: 480, height: VIEWPORT.height - 296 });
  S.coach = 'history';

  // Today
  S.calendar = 'off'; S.outcome = false;
  await fresh(page, 'Today');
  await page.mouse.move(900, 900);
  await shotTight(page, 'today-main');

  // To-do list: expanded editor on one row
  await page.locator('.todo-disclosure').first().click();
  await page.waitForTimeout(500);
  await shotEl(page, '.todo-card', 'today-todos-editor');
  await page.locator('.todo-disclosure').first().click();

  // To-do filters
  for (const f of ['Today', 'Overdue', 'Done', 'All']) {
    await page.locator('.todo-card .chip', { hasText: new RegExp(`^${f}$`) }).click();
    await page.waitForTimeout(300);
    await shotEl(page, '.todo-card', `today-todos-${f.toLowerCase()}`);
  }
  await page.locator('.todo-card .chip', { hasText: /^Open$/ }).click();

  S.calendar = 'granted';
  await fresh(page, 'Today');
  await shotEl(page, '.card:has-text("Google Calendar")', 'today-calendar-card');

  S.calendar = 'reconnect';
  await fresh(page, 'Today');
  await shotEl(page, '.card:has-text("Reconnect Google to show")', 'today-calendar-reconnect');

  S.calendar = 'off'; S.outcome = true;
  await fresh(page, 'Today');
  await page.locator('summary', { hasText: 'still upcoming' }).click();
  await page.waitForTimeout(400);
  await shotEl(page, '.card:has-text("Did it happen?")', 'today-outcome-card');
  await page.locator('.card:has-text("Did it happen?") button', { hasText: 'Held' }).first().click();
  await page.waitForTimeout(400);
  await shotEl(page, '.card:has-text("Did it happen?")', 'today-outcome-held');
  await page.locator('.card:has-text("Did it happen?") button', { hasText: 'Cancel' }).first().click();
  await page.locator('.card:has-text("Did it happen?") button', { hasText: 'Rescheduled' }).first().click();
  await page.waitForTimeout(400);
  await shotEl(page, '.card:has-text("Did it happen?")', 'today-outcome-rescheduled');
  await page.locator('.card:has-text("Did it happen?") button', { hasText: 'Cancel' }).first().click();

  // Everything on at once (extra, in-context)
  S.calendar = 'granted'; S.outcome = true;
  await fresh(page, 'Today');
  await shotTight(page, 'today-full');

  // Pomodoro: restore a saved session so the clock shows mid-interval (the browser
  // clock is frozen, so a fresh Start would sit at the full length forever).
  S.calendar = 'off'; S.outcome = false;
  await page.evaluate((now) => {
    localStorage.setItem('trj.focusTimer', JSON.stringify({
      taskId: 't_outreach', phase: 'work', running: true,
      endsAt: new Date(now).getTime() + (31 * 60 + 12) * 1000, pausedRemaining: 0, breakLong: false, sessionPomos: 1,
    }));
  }, FROZEN_NOW);
  await fresh(page, 'Today');
  await shotTight(page, 'today-pomodoro');
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForTimeout(400);
  await shotTight(page, 'today-pomodoro-paused');
  await page.evaluate(() => localStorage.removeItem('trj.focusTimer'));

  // Schedule
  await fresh(page, 'Today');
  await clickSub(page, 'Schedule', { exact: true });
  await shotTight(page, 'today-schedule');
  await page.getByRole('button', { name: /Archived \(1\)/ }).click();
  await page.getByRole('button', { name: '+ Add block' }).click();
  await page.waitForTimeout(400);
  await shotTight(page, 'today-schedule-editing');

  // AI Coach
  await fresh(page, 'AI Coach');
  await page.waitForTimeout(500);
  await shotTight(page, 'coach-chat');

  const rail = page.getByText('Quick starts', { exact: true }).locator('..');
  const rb = await box(rail);
  const note = await box(page.getByText('Tap one to ask it, or type your own below.'));
  await shotClip(page, 'coach-quickstarts', { x: rb.x, y: rb.y, width: rb.width, height: note.y + note.height + 14 - rb.y });

  await page.locator('textarea[placeholder^="Ask the Coach"]').fill('I just got a rejection from Fabrikam Freight.');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Mark Fabrikam Freight as Rejected/ }).waitFor();
  await page.waitForTimeout(500);
  await shotTight(page, 'coach-action');
  await page.getByRole('button', { name: /Mark Fabrikam Freight as Rejected/ }).click();
  await page.waitForTimeout(700);
  await shotTight(page, 'coach-action-done');

  // Coach with no history yet: the first-visit starter bubbles inline (narrow) are
  // replaced by the Quick starts rail on wide windows.
  S.coach = 'empty';
  await fresh(page, 'AI Coach');
  await shotTight(page, 'coach-empty');
  S.coach = 'history';
}
