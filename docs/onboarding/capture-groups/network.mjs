/**
 * Capture group: the Network tab and its five sub-tabs
 * (Follow-ups, Referrals, Decision Makers, TA Outreach, Influencers).
 *
 * Every response is invented (see network-fixtures.mjs). Later route
 * registrations beat the shell's, so the badge payload at /api/followups/stale
 * is replaced here by one that matches the queue on screen.
 */
import { json, state, gotoApp, clickNav, clickSub, shotEl, shotClip, shotWindow, VIEWPORT } from '../capture-lib.mjs';
import { FIXTURES as F } from '../capture-dashboard.mjs';
import * as X from './network-fixtures.mjs';

export const meta = {
  name: 'network',
  summary: 'Network tab: Follow-ups, Referrals, Decision Makers, TA Outreach, Influencers',
};

// Switches the mocks read at request time.
const S = { queue: 'mixed', discover: 'idle' };

export async function install(page) {
  // A request handler that returns undefined falls through to the next route
  // (the shell's, then the catch-all that fails the run).
  const on = (re, fn) => page.route((url) => re.test(url.pathname), async (route) => {
    const req = route.request();
    const out = await fn(new URL(req.url()), req.method(), req);
    if (out === undefined) return route.fallback();
    return json(route, out.body, out.status || 200);
  });
  const ok = (body, status) => ({ body, status });
  const idOf = (u, base) => Number(u.pathname.slice(base.length).split('/')[0]);

  // The signature block in a drafted email reads these fields.
  await page.route('**/api/identity', (r) => json(r, {
    ...F.IDENTITY, fullName: 'Jordan Avery', firstName: 'Jordan', phoneDisplay: '(555) 010-4477',
    linkedinDisplay: 'example.com/in/jordan-avery', portfolioHost: 'example.com',
  }));

  // Follow-ups
  await on(/\/api\/followups\/stale$/, () => ok(X.staleBody(S.queue === 'ta' ? X.TA_ONLY_FOLLOWUPS : X.CONTACT_FOLLOWUPS)));
  await on(/\/api\/followups\/withheld$/, () => ok({ withheld: 0, hasVerifierKeys: true }));
  await on(/\/api\/followups\/muted$/, () => ok({ muted: X.MUTED }));
  await on(/\/api\/followups\/(snooze|unsnooze|mute|unmute)$/, () => ok({ ok: true }));
  await on(/\/api\/referrals\/pending-acceptances$/, () => ok({ pending: X.PENDING_ACCEPTANCES }));
  await on(/\/api\/people\/suggestions$/, () => ok({ suggestions: X.MERGE_SUGGESTIONS }));
  await on(/\/api\/people\/(merge|unmerge|suggestions\/reject)$/, () => ok({ ok: true }));

  // LinkedIn drafting and the InMail budget
  await on(/\/api\/linkedin-drafts\/inmail-budget$/, () => ok(X.INMAIL));
  await on(/\/api\/linkedin-drafts\/connect-note$/, () => ok({
    response: X.DRAFTS.connectNote.response, length: X.DRAFTS.connectNote.response.length, truncated: false,
    review: null, reviewStatus: 'pending', surfaceId: 'connect_note_influencer', gradeContext: null,
  }));
  await on(/\/api\/linkedin-drafts\/followup-message$/, () => ok({
    response: X.DRAFTS.linkedinDm.body, length: X.DRAFTS.linkedinDm.body.length, review: null, reviewStatus: 'pending', surfaceId: 'li_followup', gradeContext: null,
  }));
  await on(/\/api\/linkedin-drafts\/archive-contact$/, () => ok({ ok: true }));

  // TA Outreach and Decision Makers (one book)
  await on(/\/api\/target-talent(\/.*)?$/, (u, method) => {
    const rest = u.pathname.replace(/^.*\/api\/target-talent/, '');
    if (rest === '' && method === 'GET') return ok(X.ttList());
    if (/^\/\d+$/.test(rest)) {
      if (method === 'GET') { const d = X.ttDetail(idOf(u, '/api/target-talent/')); return d ? ok(d) : ok({ error: 'Contact not found' }, 404); }
      if (method === 'PATCH') return ok({ ok: true });
    }
    if (/^\/\d+\/draft$/.test(rest)) return ok({ draft: X.DRAFTS.email, surfaceId: null, gradeContext: null, relatedApp: null });
    if (/^\/\d+\/correspondence$/.test(rest)) return ok({ ok: true });
    return undefined;
  });
  await on(/\/api\/sequences\/templates$/, () => ok({ templates: X.SEQUENCE_TEMPLATES }));
  await on(/\/api\/sequences\/ta\/\d+$/, (u) => ok({ state: X.sequenceState(u.pathname.split('/').pop()) }));
  await on(/\/api\/tt-reconcile\/credit-balances$/, () => ok({
    hunter: { configured: true, left: 142 }, millionVerifier: { configured: true, left: 1830 },
    domainSearchCost: { creditsPerCompany: 1, note: 'One search credit per company, whatever the number of people it returns.' },
  }));
  await on(/\/api\/tt-reconcile\/preview$/, (u) => ok(X.reconcilePreview(u.searchParams.get('mode') || undefined)));
  await on(/\/api\/tt-reconcile\/discover-run(\/.*)?$/, (u, method) => {
    const job = S.discover === 'done' ? X.DISCOVER_JOB_DONE : X.DISCOVER_JOB;
    if (method === 'POST') return ok({ jobId: job.jobId });
    if (u.pathname.endsWith('/discover-run')) return ok(S.discover === 'idle' ? null : job);
    return ok(job);
  });

  // Referrals
  await on(/\/api\/referrals(\/.*)?$/, (u, method) => {
    const rest = u.pathname.replace(/^.*\/api\/referrals/, '');
    if (rest === '' && method === 'GET') return ok(X.referralsPayload());
    if (rest === '/followups') return ok({ queue: X.REFERRAL_FOLLOWUPS });
    if (rest === '/pending-acceptances') return undefined;
    if (rest === '/import-linkedin') return ok({ ok: true, imported: 812, stage1Added: 9, stage2Added: 5, stage2Available: 131, activeCompanies: 15, unarchived: 0, acceptedFlipped: 0, accepted: [] });
    if (rest === '/reconcile') return ok({ ok: true, stage1Added: 0, unarchived: 0, acceptedFlipped: 0 });
    if (rest === '/cleanup') return ok({ archived: 0 });
    if (/^\/\d+\/detail$/.test(rest)) { const d = X.referralDetail(rest.split('/')[1]); return d ? ok(d) : ok({ error: 'Referral not found' }, 404); }
    if (/^\/\d+$/.test(rest) && method === 'PATCH') return ok({ ok: true });
    return undefined;
  });

  // Influencers
  await on(/\/api\/linkedin-ssi\/influencers$/, () => ok(X.INFLUENCERS));
  await on(/\/api\/linkedin-ssi\/influencers\/\d+$/, () => ok(X.INFLUENCERS));
  await on(/\/api\/linkedin-ssi\/engagement-log$/, () => ok(X.ENGAGEMENT_LOG));
  await on(/\/api\/linkedin-ssi\/generate-response$/, () => ok({ response: X.SSI_GENERATED.response }));
  await on(/\/api\/linkedin-ssi\/generate-connect-request$/, () => ok({ response: X.SSI_GENERATED.connect }));
  await on(/\/api\/linkedin-ssi\/generate-reply$/, () => ok({ response: X.SSI_GENERATED.reply }));
}

// helpers

async function viewportHeight(page, h) {
  await page.setViewportSize({ width: VIEWPORT.width, height: h });
  await page.waitForTimeout(600);
}

/** Clip one screenshot to the union of several elements' boxes, plus a margin. */
async function shotBoxes(page, name, locators, pad = 10) {
  const boxes = [];
  await locators[0].first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  for (const loc of locators) {
    const b = await loc.first().boundingBox();
    if (!b) throw new Error(`${name}: an element for the crop has no box`);
    boxes.push(b);
  }
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
  const x1 = Math.min(VIEWPORT.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad);
  const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  await shotClip(page, name, { x: Math.floor(x0), y: Math.floor(y0), width: Math.ceil(x1 - x0), height: Math.ceil(y1 - y0) });
}

/** The open drawer, trimmed to where its content ends. */
async function shotDrawerTight(page, name, pad = 28) {
  const drawer = page.locator('.drawer.wide.open');
  const box = await drawer.boundingBox();
  const last = await drawer.locator('.drawer-body > *:last-child').first().boundingBox();
  if (!box || !last) throw new Error(name + ': drawer has no box');
  await shotClip(page, name, { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(last.y + last.height + pad - box.y) });
}

/** Tag the queue card for a person so it can be addressed by selector. */
async function tagCard(page, personName, tag) {
  const found = await page.evaluate(({ personName, tag }) => {
    const cards = [...document.querySelectorAll('.card')].filter((c) => c.style.borderLeft && c.textContent.includes(personName));
    const card = cards[cards.length - 1];
    if (!card) return false;
    card.setAttribute('data-cap', tag);
    return true;
  }, { personName, tag });
  if (!found) throw new Error(`queue card for ${personName} not found`);
  return page.locator(`[data-cap="${tag}"]`);
}

const btn = (scope, text) => scope.locator('button', { hasText: text }).first();

// the capture

export async function capture({ page }) {
  state.google = 'connected';
  await gotoApp(page);
  await clickNav(page, 'Network');
  await page.waitForTimeout(1500);

  // ===== Follow-ups ======================================================
  await shotWindow(page, 'net-followups');
  await viewportHeight(page, 3600);

  await shotBoxes(page, 'net-followups-kpis', [page.locator('.row:has(.card:has-text("Contacts going quiet"))')]);
  await shotEl(page, '.card.padded-lg:has-text("Recently accepted")', 'net-followups-accepted');
  await shotEl(page, '.card.padded-lg:has-text("Possible duplicate contacts")', 'net-followups-duplicates');

  // The queue: controls and the first cards.
  const queueHead = page.locator('h2', { hasText: /^Follow-ups$/ });
  const cardsBefore = page.locator('.card[style*="border-left"]');
  await shotBoxes(page, 'net-followups-queue', [queueHead, cardsBefore.nth(3)], 14);
  // Contact type narrowed to Referral, to show the filter at work.
  await page.locator('span', { hasText: /^Referral\s*\d+$/ }).first().click();
  await page.waitForTimeout(500);
  await shotBoxes(page, 'net-followups-queue-referral', [queueHead, page.locator('.card[style*="border-left"]').nth(1)], 14);
  await page.locator('span', { hasText: /^All\s*\d+$/ }).last().click();
  await page.waitForTimeout(400);

  // Draft flow: both lanes on a dual-channel hiring manager.
  const draftCard = await tagCard(page, 'Desmond Aldaine', 'draft');
  await btn(draftCard, 'Draft note').click();
  await page.waitForTimeout(700);
  await btn(draftCard, 'Draft email').click();
  await page.waitForTimeout(700);
  await shotEl(page, '[data-cap="draft"]', 'net-followups-draft');

  // Held rows: reveal them with Show anyway.
  const heldBar = page.locator('div.dim:has(button:text-is("Show anyway"))').first();
  await shotBoxes(page, 'net-followups-held-collapsed', [heldBar], 10);
  await btn(heldBar, 'Show anyway').click();
  await page.waitForTimeout(600);
  const heldBar2 = page.locator('div.dim:has(button:text-is("Hide them"))').first();
  const lucan = await tagCard(page, 'Lucan Fairweather', 'held-last');
  await shotBoxes(page, 'net-followups-held', [heldBar2, lucan], 12);
  await btn(heldBar2, 'Hide them').click();
  await page.waitForTimeout(400);

  // Reconcile LinkedIn sent invites: the paste box, opened.
  await btn(page.locator('body'), 'Reconcile LinkedIn sent invites').click();
  await page.waitForTimeout(500);
  await shotBoxes(page, 'net-followups-reconcile-invites', [page.locator('div.dim:has(button:has-text("Reconcile LinkedIn sent invites"))')], 10);
  await btn(page.locator('body'), 'Reconcile LinkedIn sent invites').click();

  // Find a contact, and Reach a decision-maker.
  await shotBoxes(page, 'net-followups-find', [page.locator('div:has(> .ta-head h1:text-is("Find a contact"))')], 12);
  await shotBoxes(page, 'net-followups-reach', [page.locator('div:has(> .ta-head h1:text-is("Reach a decision-maker"))')], 12);
  await shotEl(page, '.card.padded-lg:has-text("Snoozed")', 'net-followups-snoozed');

  // The whole stacked page, for the in-context view.
  await page.locator('.content').first().evaluate((el) => { el.scrollTop = 0; });
  await shotBoxes(page, 'net-followups-page', [page.locator('.content > *').first()], 4);

  // The same page when the live feed holds only talent contacts (what the
  // Contact type chips read for a user who has not queued referrals).
  S.queue = 'ta';
  await gotoApp(page);
  await clickNav(page, 'Network');
  await page.waitForTimeout(1200);
  await shotBoxes(page, 'net-followups-queue-ta-only', [page.locator('h2', { hasText: /^Follow-ups$/ }), page.locator('.card[style*="border-left"]').nth(2)], 14);
  S.queue = 'mixed';
  await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height });
  await gotoApp(page);
  await clickNav(page, 'Network');
  await page.waitForTimeout(800);

  // ===== Referrals =======================================================
  await clickSub(page, 'Referrals', { exact: true });
  await page.waitForTimeout(1000);
  await viewportHeight(page, 2800);
  const refHeader = page.locator('.card.padded-lg:has-text("Your warmest channel")');
  await shotEl(page, '.card.padded-lg:has-text("Your warmest channel")', 'net-referrals-buttons');
  await shotEl(page, '.card.padded-lg:has-text("Follow up now")', 'net-referrals-followups');
  const stageBar = page.locator('.subtabs:has-text("Stage 1")');
  const stageTable = page.locator('.subtabs:has-text("Stage 1") + .card');
  await shotBoxes(page, 'net-referrals-stage1', [stageBar, stageTable]);
  await clickSub(page, 'Stage 2');
  await shotBoxes(page, 'net-referrals-stage2', [stageBar, stageTable]);
  await clickSub(page, 'All', { exact: false });
  await shotBoxes(page, 'net-referrals-all', [stageBar, stageTable]);
  await page.locator('.subtab', { hasText: /^Archived/ }).first().click();
  await page.waitForTimeout(600);
  await shotBoxes(page, 'net-referrals-archived', [stageBar, stageTable]);
  // Add someone, and the import receipt.
  await btn(refHeader, '+ Add person').click();
  await page.waitForTimeout(400);
  await shotBoxes(page, 'net-referrals-add', [refHeader, page.locator('.card.padded-lg:has-text("Add someone to your network list")')]);
  await btn(refHeader, 'Cancel').click();
  await page.setInputFiles('input[type="file"][accept=".csv,text/csv"]', {
    name: 'Connections.csv', mimeType: 'text/csv',
    buffer: Buffer.from('First Name,Last Name,URL,Email Address,Company,Position,Connected On\n'),
  });
  await page.waitForTimeout(1200);
  await shotEl(page, '.card.padded-lg:has-text("Your warmest channel")', 'net-referrals-import-receipt');
  // Back to Stage 1, then open a referral.
  await page.locator('.subtab', { hasText: /^Stage 1/ }).first().click();
  await page.waitForTimeout(500);
  await page.locator('tbody tr', { hasText: 'Annika Strandvold' }).first().click();
  await page.locator('.drawer.wide.open').waitFor({ state: 'visible' });
  await page.waitForTimeout(1500);
  await viewportHeight(page, 1700);
  await shotDrawerTight(page, 'net-referral-drawer');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // ===== Decision Makers =================================================
  await viewportHeight(page, 2000);
  await clickSub(page, 'Decision Makers');
  await page.waitForTimeout(900);
  await shotBoxes(page, 'net-decision-makers', [page.locator('.fade-up:has(.ta-head h1:text-is("Decision Makers"))')], 12);
  await btn(page.locator('.ta-head .act'), 'Reconcile').click();
  await page.locator('.modal').waitFor({ state: 'visible' });
  await page.waitForTimeout(1200);
  await shotEl(page, '.modal', 'net-decision-makers-reconcile');
  // Discover: a run caught mid-flight, then finished.
  S.discover = 'running';
  await btn(page.locator('.modal'), 'Discover contacts').click();
  await page.waitForTimeout(2600);
  await shotEl(page, '.modal', 'net-decision-makers-discover');
  S.discover = 'done';
  await page.waitForTimeout(3200);
  await shotEl(page, '.modal', 'net-decision-makers-discover-done');
  await page.locator('.modal .modal-head .icon-btn').first().click();
  S.discover = 'idle';
  await page.waitForTimeout(500);
  await page.locator('tbody tr', { hasText: 'Marisol Tavernier' }).first().click();
  await page.locator('.drawer.wide.open').waitFor({ state: 'visible' });
  await page.waitForTimeout(1500);
  await viewportHeight(page, 1900);
  await shotDrawerTight(page, 'net-decision-makers-drawer');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // ===== TA Outreach =====================================================
  await viewportHeight(page, 1400);
  await clickSub(page, 'TA Outreach');
  await page.waitForTimeout(900);
  await shotBoxes(page, 'net-ta-outreach', [page.locator('.fade-up:has(.ta-head h1:text-is("TA Outreach"))')], 12);
  await btn(page.locator('.ta-head .act'), 'Reconcile').click();
  await page.locator('.modal').waitFor({ state: 'visible' });
  await page.waitForTimeout(1200);
  await shotEl(page, '.modal', 'net-ta-reconcile');
  await page.locator('.modal .modal-head .icon-btn').first().click();
  await page.waitForTimeout(500);
  await page.locator('tbody tr', { hasText: 'Corinne Abelard' }).first().click();
  await page.locator('.drawer.wide.open').waitFor({ state: 'visible' });
  await page.waitForTimeout(1500);
  await viewportHeight(page, 1900);
  await shotDrawerTight(page, 'net-ta-drawer');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // ===== Influencers =====================================================
  await viewportHeight(page, 1100);
  await clickSub(page, 'Influencers');
  await page.waitForTimeout(900);
  await shotEl(page, '.fade-up:has(.card-title:text-is("Influencers"))', 'net-influencers');
  await page.locator('tbody tr', { hasText: 'Calista Verhoeven' }).first().click();
  await page.locator('.drawer.wide.open').waitFor({ state: 'visible' });
  await page.waitForTimeout(900);
  await viewportHeight(page, 1500);
  const drawer = page.locator('.drawer.wide.open');
  await shotDrawerTight(page, 'net-influencer-drawer-overview');

  await btn(drawer, 'AI Response').click();
  await page.waitForTimeout(400);
  await drawer.locator('textarea[placeholder^="Paste the post"]').fill(X.SSI_GENERATED.post);
  await btn(drawer, 'Generate Response').click();
  await page.waitForTimeout(900);
  await shotDrawerTight(page, 'net-influencer-drawer-ai-response');

  await btn(drawer, 'AI Connect').click();
  await page.waitForTimeout(400);
  await drawer.locator('textarea[placeholder^="e.g. RevOps tooling"]').fill('Forecast hygiene and stage exit criteria');
  await btn(drawer, 'Generate Request').click();
  await page.waitForTimeout(900);
  await shotDrawerTight(page, 'net-influencer-drawer-ai-connect');

  await btn(drawer, 'AI Reply').click();
  await page.waitForTimeout(400);
  await drawer.locator('textarea[placeholder^="Paste their reply"]').fill(X.SSI_GENERATED.theirMessage);
  await btn(drawer, 'Generate my reply').click();
  await page.waitForTimeout(900);
  await shotDrawerTight(page, 'net-influencer-drawer-ai-reply');

  await page.setViewportSize({ width: VIEWPORT.width, height: VIEWPORT.height });
}
