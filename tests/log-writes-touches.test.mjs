#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox, makeSandbox } from './helpers/sandbox.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FIXED_NOW = '2030-04-10T12:34:00.000Z';
const TT_HEADER = '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---------|------|-------|--------|-------|------|-------|-----|-------|-------|----------|--------|------------|-------|---------|\n';
const REF_HEADER = '# Referral tracker\n\n| # | Name | How you know them | Where they are now | Target company/role | Status | Last Touch | Notes | LinkedIn | Email |\n|---|------|-------------------|--------------------|---------------------|--------|------------|-------|----------|-------|\n';
const APP_HEADER = '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n';
const TT_ROW = '| 900001 | Zorblax Widgetry | Personone | Example |  | Example Talent Lead |  |  |  |  | example.personone@example.test | linkedin.com/in/example-person-one | Not Contacted |  | Invented note | example.test |';
const REF_ROW = '| 900001 | Example Personone | Invented colleague | Zorblax Widgetry | Example Cog Lead | Not Asked |  | from TA Outreach #900001 | linkedin.com/in/example-person-one | example.personone@example.test |';
const APP_ROW = '| 900001 | 2030-04-01 | Zorblax Widgetry | Example Cog Lead | 4/5 | Applied |  |  |  | Invented app note | https://example.test/jobs/900001 |';
const TOUCH_FILES = [
  'follow-ups.md', 'linkedin-connects.json', 'tt-linkedin.json',
  'linkedin-connections.json', 'twc-events.json', 'target-talent.md', 'referrals.md',
];

function snapshot(dataDir) {
  const result = {};
  for (const file of TOUCH_FILES) {
    const target = path.join(dataDir, file);
    result[file] = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  }
  for (const dir of ['target-talent-correspondence', 'referral-correspondence']) {
    const target = path.join(dataDir, dir);
    result[dir] = fs.existsSync(target)
      ? Object.fromEntries(fs.readdirSync(target).sort().map(file => [file, fs.readFileSync(path.join(target, file), 'utf8')]))
      : {};
  }
  return result;
}

async function request(router, method, url, body) {
  const express = (await import('express')).default;
  const app = express(); app.use(express.json()); app.use(router);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const responseBody = await response.json();
  await new Promise(resolve => server.close(resolve));
  return { status: response.status, body: responseBody };
}

async function worker() {
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [FIXED_NOW])); }
    static now() { return new NativeDate(FIXED_NOW).getTime(); }
  };
  const dataDir = process.env.TJK_DATA_DIR;
  const action = process.env.TJK_TOUCH_ACTION || 'sequence';
  const followups = await import('../dashboard-web/server/lib/followups.mjs');
  const tt = await import('../dashboard-web/server/lib/target-talent.mjs');
  const connects = await import('../dashboard-web/server/lib/connects.mjs');
  const linkedin = await import('../dashboard-web/server/lib/tt-linkedin.mjs');
  const exports = await import('../dashboard-web/server/lib/linkedin-referrals.mjs');
  const twc = await import('../dashboard-web/server/lib/twc-events.mjs');
  const { inLogWrite, openDataStore, setLogWritesTestHooks, withLogWrite } = await import('../lib/log-writes.mjs');
  const { readEvents } = await import('../lib/event-store.mjs');
  const { appendEventsWithEffects } = await import('../lib/legacy-files.mjs');

  if (action === 'nested-linkedin-failure') {
    const store = openDataStore(dataDir);
    const trigger = `CREATE TEMP TRIGGER fail_linkedin_state BEFORE INSERT ON events
      WHEN json_extract(NEW.payload, '$.reason') = 'linkedin_state_set'
      BEGIN SELECT RAISE(ABORT, 'Invented LinkedIn state failure'); END`;
    const warnings = [];
    console.warn = value => warnings.push(String(value?.message || value));
    store.db.exec(trigger);
    const outerState = linkedin.setLinkedInStatus(900001, 'Connected', '2030-04-10');
    store.db.exec('DROP TRIGGER fail_linkedin_state');
    const beforeEvents = readEvents(store).length;
    let nestedError = null;
    let activeInside = false;
    store.db.exec(trigger);
    try {
      withLogWrite(dataDir, active => {
        activeInside = inLogWrite(dataDir);
        appendEventsWithEffects(active, [{
          type: 'legacy_record', occurred_on: '2030-04-10', source: 'dashboard', definitions_version: 'v1',
          payload: { reason: 'invented_outer_write', legacy_effects: [] },
        }]);
        linkedin.setLinkedInStatus(900001, 'Connected', '2030-04-10');
      });
    } catch (error) { nestedError = error.message; }
    store.db.exec('DROP TRIGGER fail_linkedin_state');
    process.stdout.write(`${JSON.stringify({
      outerState, warnings, activeInside, activeAfter: inLogWrite(dataDir), nestedError,
      beforeEvents, afterEvents: readEvents(store).length,
    })}\n`);
    return;
  }

  if (action === 'render-routes') {
    const warnings = [];
    console.warn = value => warnings.push(String(value?.message || value));
    setLogWritesTestHooks({ writeFile() { throw new Error('Invented route renderer failure'); } });
    const { router: followupRouter } = await import('../dashboard-web/server/routes/followups.mjs');
    const { router: ttRouter } = await import('../dashboard-web/server/routes/target-talent.mjs');
    const { router: referralRouter } = await import('../dashboard-web/server/routes/referrals.mjs');
    const route = process.env.TJK_RENDER_ROUTE;
    let response;
    if (route === 'target-patch') response = await request(ttRouter, 'PATCH', '/api/target-talent/900001', { linkedinStatus: 'Connected', notes: 'Invented pending note' });
    else if (route === 'target-correspondence') response = await request(ttRouter, 'POST', '/api/target-talent/900001/correspondence', { direction: 'Sent', subject: 'Invented pending subject', body: 'Invented pending body' });
    else if (route === 'followups') response = await request(followupRouter, 'POST', '/api/followups', { appNum: 900001, channel: 'Email', notes: 'Invented pending follow-up' });
    else if (route === 'referral-import') response = await request(referralRouter, 'POST', '/api/referrals/import-linkedin', { csv: 'First Name,Last Name,URL,Email Address,Company,Position,Connected On\nExample,Persontwo,linkedin.com/in/example-person-two,example.persontwo@example.test,Quennox Ratchet Works,Example Lead,10 Apr 2030' });
    else if (route === 'google') {
      const { router: googleRouter } = await import('../dashboard-web/server/routes/google.mjs');
      response = await request(googleRouter, 'POST', '/api/google/replies/example-msg-900001/rejected', {
        appId: 900001, company: 'Zorblax Widgetry', from: 'Example Persontwo <example.persontwo@example.test>',
        subject: 'Invented pending decision', bodyPreview: 'Invented pending reply', date: '2030-04-10T12:00:00Z', threadId: 'example-thread-900001',
      });
    }
    else response = await request(referralRouter, 'POST', '/api/referrals/900001/correspondence', { direction: 'Sent', subject: 'Invented pending referral', body: 'Invented pending referral body' });
    process.stdout.write(`${JSON.stringify({ response, warnings })}\n`);
    return;
  }

  if (action === 'legacy-connect') {
    const result = connects.logConnect({ name: 'Example Persontwo', source: 'ta', id: 900002, date: '2030-04-10' });
    process.stdout.write(`${JSON.stringify({ result, text: fs.readFileSync(path.join(dataDir, 'linkedin-connects.json'), 'utf8') })}\n`);
    return;
  }

  if (action === 'rollback') {
    const before = snapshot(dataDir);
    const store = openDataStore(dataDir);
    const beforeEvents = readEvents(store).length;
    setLogWritesTestHooks({ hook(name) {
      if (name === process.env.TJK_FAIL_HOOK) throw new Error('Invented final touch failure');
    } });
    const routers = {
      'before-followups-contact-row': (await import('../dashboard-web/server/routes/followups.mjs')).router,
      'before-target-talent-followup-row': (await import('../dashboard-web/server/routes/target-talent.mjs')).router,
      'before-referral-correspondence-referral-update': (await import('../dashboard-web/server/routes/referrals.mjs')).router,
      'before-target-talent-patch-row': (await import('../dashboard-web/server/routes/target-talent.mjs')).router,
    };
    const hook = process.env.TJK_FAIL_HOOK;
    let response;
    if (hook === 'before-followups-contact-row') response = await request(routers[hook], 'POST', '/api/followups', {
      appNum: 900001, channel: 'Email', alsoLogToTalentIds: [900001], alsoLogSubject: 'Invented rollback subject', alsoLogBody: 'Invented rollback body',
    });
    else if (hook === 'before-target-talent-followup-row') response = await request(routers[hook], 'POST', '/api/target-talent/900001/correspondence', {
      direction: 'Sent', channel: 'LinkedIn', subject: 'LinkedIn connection request', body: 'Invented rollback body', alsoLogToAppNum: 900001,
    });
    else if (hook === 'before-target-talent-patch-row') response = await request(routers[hook], 'PATCH', '/api/target-talent/900001', {
      linkedinStatus: 'Connected', notes: 'Invented rollback note',
    });
    else response = await request(routers[hook], 'POST', '/api/referrals/900001/correspondence', {
      direction: 'Sent', subject: 'Invented rollback subject', body: 'Invented rollback body',
    });
    process.stdout.write(`${JSON.stringify({ response, before, after: snapshot(dataDir), beforeEvents, afterEvents: readEvents(store).length })}\n`);
    return;
  }

  if (action === 'render-fail') {
    const warnings = [];
    console.warn = value => warnings.push(String(value?.message || value));
    setLogWritesTestHooks({ writeFile() { throw new Error('Invented renderer failure'); } });
    const state = linkedin.setLinkedInStatus(900001, 'Connected', '2030-04-10');
    process.stdout.write(`${JSON.stringify({ state, warnings })}\n`);
    return;
  }

  if (action === 'stale') {
    const warnings = [];
    if (process.env.TJK_RENDER_FAIL === '1') {
      console.warn = value => warnings.push(String(value?.message || value));
      setLogWritesTestHooks({ writeFile() { throw new Error('Invented stale renderer failure'); } });
    }
    const { router } = await import('../dashboard-web/server/routes/followups.mjs');
    const response = await request(router, 'GET', '/api/followups/stale');
    process.stdout.write(`${JSON.stringify({ response, snapshot: snapshot(dataDir), warnings })}\n`);
    return;
  }

  const steps = [];
  followups.appendFollowupRow({ appNum: 900001, date: '2030-04-10', company: 'Zorblax Widgetry', role: 'Example Cog Lead', channel: 'Email', contact: 'Example Personone', notes: 'Invented first touch' }); steps.push(snapshot(dataDir));
  followups.appendFollowupRow({ appNum: 900001, date: '2030-04-10', company: 'Zorblax Widgetry', role: 'Example Cog Lead', channel: 'LinkedIn', contact: 'Example Personone', notes: 'Invented second touch' }); steps.push(snapshot(dataDir));
  followups.appendFollowupRow({ appNum: 900001, date: '2030-04-10', company: 'Zorblax Widgetry', role: 'Example Cog Lead', channel: 'leak@example.test', contact: 'Example Personone', notes: 'Invented sanitized touch' }); steps.push(snapshot(dataDir));
  const messages = [
    { timestamp: '2030-04-10 08:00', direction: 'Sent', channel: 'Email', subject: 'Invented first subject', body: 'Invented first body' },
    { timestamp: '2030-04-10 09:00', direction: 'Received', channel: 'Email', subject: 'Invented second subject', body: 'Invented second body' },
  ];
  tt.writeTTCorrespondence(900001, messages); steps.push(snapshot(dataDir));
  tt.writeTTCorrespondence(900001, [...messages, { timestamp: '2030-04-10 10:00', direction: 'Sent', channel: 'LinkedIn', subject: 'Invented third subject', body: 'Invented third body' }]); steps.push(snapshot(dataDir));
  connects.logConnect({ name: 'Example Personone', source: 'ta', id: 900001, date: '2030-04-10' }); steps.push(snapshot(dataDir));
  connects.logConnect({ name: 'Example Personone', source: 'ta', id: 900001, date: '2030-04-10' }); steps.push(snapshot(dataDir));
  linkedin.setLinkedInStatus(900001, 'Invite Pending', '2030-04-10');
  linkedin.markInvitePending(900001, '2030-04-11');
  linkedin.setLinkedInStatus(900001, 'Not Connected', '2030-04-12'); steps.push(snapshot(dataDir));
  exports.saveConnections([{ first: 'Example', last: 'Persontwo', company: 'Quennox Ratchet Works', url: 'linkedin.com/in/example-person-two' }], 'C:\\Users\\Example Personone\\Downloads\\Connections.csv'); steps.push(snapshot(dataDir));
  const eventOne = twc.addEvent({ date: '2030-04-10', type: 'Job fair', organizer: 'Zorblax Widgetry', contact: 'Example Personone', method: 'Online', notes: 'Invented event note' });
  twc.addEvent({ date: '2030-04-11', type: 'Employment workshop', organizer: 'Quennox Ratchet Works', contact: 'Example Persontwo', method: 'Online', notes: 'Invented workshop note' });
  twc.deleteEvent(eventOne.event.id); steps.push(snapshot(dataDir));

  const { router: followupRouter } = await import('../dashboard-web/server/routes/followups.mjs');
  const { router: ttRouter } = await import('../dashboard-web/server/routes/target-talent.mjs');
  const { router: referralRouter } = await import('../dashboard-web/server/routes/referrals.mjs');
  const responses = [];
  responses.push(await request(followupRouter, 'POST', '/api/followups', { appNum: 900001, channel: 'Email', contact: 'Example Personone', notes: 'Invented route note', alsoLogToTalentIds: [900001], alsoLogSubject: 'Invented route subject', alsoLogBody: 'Invented route body' })); steps.push(snapshot(dataDir));
  responses.push(await request(ttRouter, 'POST', '/api/target-talent/900001/correspondence', { direction: 'Sent', channel: 'LinkedIn', subject: 'LinkedIn connection request', body: 'Invented invite body', alsoLogToAppNum: 900001 })); steps.push(snapshot(dataDir));
  responses.push(await request(ttRouter, 'PATCH', '/api/target-talent/900001', { linkedinStatus: 'Connected', notes: 'Invented patched note' })); steps.push(snapshot(dataDir));
  responses.push(await request(referralRouter, 'POST', '/api/referrals/900001/correspondence', { direction: 'Sent', subject: 'Invented referral subject', body: 'Invented referral body' })); steps.push(snapshot(dataDir));
  const store = fs.existsSync(path.join(dataDir, 'trajecktory.db')) ? openDataStore(dataDir) : null;
  process.stdout.write(`${JSON.stringify({ steps, responses, events: store ? readEvents(store) : [] })}\n`);
}

if (process.env.TJK_TOUCH_WORKER === '1') {
  await worker();
  process.exit(0);
}

let passed = 0, failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

function fixture(dir, { invite = false, followupsText } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'applications.md'), `${APP_HEADER}${APP_ROW}\n`);
  fs.writeFileSync(path.join(dir, 'target-talent.md'), `${TT_HEADER}${TT_ROW}\n`);
  fs.writeFileSync(path.join(dir, 'referrals.md'), `${REF_HEADER}${REF_ROW}\n`);
  if (followupsText !== undefined) fs.writeFileSync(path.join(dir, 'follow-ups.md'), followupsText);
  if (invite) {
    fs.mkdirSync(path.join(dir, 'target-talent-correspondence'));
    fs.writeFileSync(path.join(dir, 'target-talent-correspondence', '900001.md'), '## 2030-04-01 | Sent | Email | LinkedIn connection request\n\nInvented invite body\n');
  }
}

function enable(dir) {
  fs.writeFileSync(path.join(dir, 'event-store.json'), '{"writes":"on"}\n');
  const outputDir = path.join(dir, 'fixture-output'); fs.mkdirSync(outputDir);
  const { openEventStore } = awaitImportEventStore;
  const { importDataFolder } = awaitImportDataFolder;
  const store = openEventStore(path.join(dir, 'trajecktory.db'));
  importDataFolder(store, { dataDir: dir, outputDir, ownerName: 'Example Personone', definitionsVersion: 'v1', importedOn: '2030-04-01' });
  store.close();
}

const awaitImportEventStore = await import('../lib/event-store.mjs');
const awaitImportDataFolder = await import('../lib/import/import-data-folder.mjs');
const awaitImportLegacyFiles = await import('../lib/legacy-files.mjs');

function run(dataDir, action = 'sequence', extra = {}) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, TJK_DATA_DIR: dataDir, TJK_TOUCH_WORKER: '1', TJK_TOUCH_ACTION: action, ...extra },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

console.log('log-writes-touches.test.mjs');
const root = makeSandbox('log-writes-touches');
const off = path.join(root, 'off'), on = path.join(root, 'on');
fixture(off); fixture(on); enable(on);
const a = run(off), b = run(on);
check(a.responses.every(r => r.status === 200) && b.responses.every(r => r.status === 200), 'all differential touch routes succeed in both modes');
const normalizeGeneratedIds = value => JSON.parse(JSON.stringify(value)
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '<uuid>'));
check(JSON.stringify(normalizeGeneratedIds(b.steps)) === JSON.stringify(normalizeGeneratedIds(a.steps)), 'every touch projection is byte-identical after every direct writer and route step');
check(b.steps[1]['follow-ups.md'].includes('| 2 | 900001 |'), 'follow-up numbers mint identically from max(n)+1');
check(b.steps[6]['linkedin-connects.json'] === b.steps[5]['linkedin-connects.json'], 'duplicate connection request appends no bytes');
check(!JSON.parse(b.steps[7]['tt-linkedin.json'])['900001'], 'Not Connected deletes the LinkedIn state key');
check(JSON.parse(b.steps[9]['twc-events.json']).length === 1, 'work-search deletion replaces the projected array with the kept event');

const dashboardEvents = b.events.filter(event => event.source === 'dashboard');
const eventTypes = new Set(dashboardEvents.map(event => event.type));
check(['message_sent', 'connection_request_sent', 'linkedin_export_imported', 'work_search_event_logged', 'legacy_record'].every(type => eventTypes.has(type)), 'database contains every expected touch event type');
const reasons = new Set(dashboardEvents.filter(event => event.type === 'legacy_record').map(event => event.payload.reason));
check(['correspondence_written', 'linkedin_state_set', 'work_search_event_removed'].every(reason => reasons.has(reason)), 'database contains every expected touch legacy reason');
check(dashboardEvents.every(event => {
  const semantic = { ...event.payload }; delete semantic.raw; delete semantic.legacy_effects;
  return !/Invented (first|second|third|route|invite|referral).*?(body|subject)|Example Person|example\.test/.test(JSON.stringify(semantic));
}), 'message text, subjects, names and emails stay out of semantic event payload fields');
check(dashboardEvents.every(event => {
  const semantic = { ...event.payload }; delete semantic.raw; delete semantic.legacy_effects;
  return !JSON.stringify(semantic).includes('leak@example.test')
    && !JSON.stringify(semantic).includes('Example Personone\\\\Downloads\\\\Connections.csv');
}) && dashboardEvents.some(event => event.type === 'message_sent' && event.payload.channel === 'other')
  && dashboardEvents.some(event => event.type === 'linkedin_export_imported' && event.payload.source === 'cli'),
'free-text channel and Windows CSV path never enter semantic payload fields');

for (const hook of ['before-followups-contact-row', 'before-target-talent-followup-row', 'before-target-talent-patch-row', 'before-referral-correspondence-referral-update']) {
  const dir = path.join(root, hook); fixture(dir); enable(dir);
  const result = run(dir, 'rollback', { TJK_FAIL_HOOK: hook });
  check(result.response.status === 500 && JSON.stringify(result.after) === JSON.stringify(result.before)
    && result.afterEvents === result.beforeEvents, `${hook} rolls every touch file and event back together`);
}

const renderFail = path.join(root, 'render-fail'); fixture(renderFail); enable(renderFail);
const swallowed = run(renderFail, 'render-fail');
check(swallowed.state === 'Connected' && swallowed.warnings.some(w => /files could not be updated/.test(w)), 'setLinkedInStatus returns the requested state and warns when rendering fails');

const nestedFail = path.join(root, 'nested-linkedin-failure'); fixture(nestedFail); enable(nestedFail);
const nested = run(nestedFail, 'nested-linkedin-failure');
check(nested.outerState === 'Connected' && nested.warnings.length === 1,
  'outermost LinkedIn state writer preserves its best-effort swallow contract');
check(nested.activeInside === true && nested.activeAfter === false && /Invented LinkedIn state failure/.test(nested.nestedError)
  && nested.beforeEvents === nested.afterEvents,
  'nested LinkedIn state failure rethrows and rolls the owning transaction back');

const renderRouteResults = [];
for (const route of ['target-patch', 'target-correspondence', 'followups', 'referral-correspondence', 'referral-import', 'google']) {
  const dir = path.join(root, `render-${route}`); fixture(dir); enable(dir);
  renderRouteResults.push(run(dir, 'render-routes', { TJK_RENDER_ROUTE: route }));
}
check(renderRouteResults.every(({ response, warnings }) => response.status === 200 && response.body.render_pending === true
  && /files could not be updated/.test(response.body.message) && warnings.length === 1),
'touch routes return 200 with render_pending and one warning after committed render failures');

const legacyConnectOff = path.join(root, 'legacy-connect-off');
const legacyConnectOn = path.join(root, 'legacy-connect-on');
fixture(legacyConnectOff); fixture(legacyConnectOn);
const legacyConnectText = `${JSON.stringify({ connects: [{ date: '2030-04-09', name: 'Example Personone', source: 'ta' }] }, null, 2)}\n`;
fs.writeFileSync(path.join(legacyConnectOff, 'linkedin-connects.json'), legacyConnectText);
fs.writeFileSync(path.join(legacyConnectOn, 'linkedin-connects.json'), legacyConnectText);
enable(legacyConnectOn);
const legacyConnectA = run(legacyConnectOff, 'legacy-connect');
const legacyConnectB = run(legacyConnectOn, 'legacy-connect');
check(legacyConnectB.text === legacyConnectA.text && Array.isArray(JSON.parse(legacyConnectB.text))
  && legacyConnectB.result.length === 2,
'legacy { connects: [...] } projection rewrites to the same bare appended array in both modes');

const emptyOff = path.join(root, 'empty-off'), emptyOn = path.join(root, 'empty-on');
fixture(emptyOff, { followupsText: '' }); fixture(emptyOn, { followupsText: '' }); enable(emptyOn);
const emptyA = run(emptyOff), emptyB = run(emptyOn);
check(emptyA.steps[0]['follow-ups.md'] === emptyB.steps[0]['follow-ups.md']
  && emptyB.steps[0]['follow-ups.md'].startsWith('# Follow-Ups\n\n| # |'), 'an empty follow-up file gets the identical heading, header and separator');

const missingOff = path.join(root, 'missing-off'), missingOn = path.join(root, 'missing-on');
fixture(missingOff); fixture(missingOn); enable(missingOn);
const missingA = run(missingOff), missingB = run(missingOn);
check(missingA.steps[0]['follow-ups.md'] === missingB.steps[0]['follow-ups.md'], 'a missing follow-up file is created identically in both modes');

const staleOff = path.join(root, 'stale-off'), staleOn = path.join(root, 'stale-on');
fixture(staleOff, { invite: true }); fixture(staleOn, { invite: true }); enable(staleOn);
const staleA = run(staleOff, 'stale'), staleB = run(staleOn, 'stale');
check(staleA.response.status === 200 && staleB.response.status === 200
  && staleA.snapshot['tt-linkedin.json'] === staleB.snapshot['tt-linkedin.json'], 'stale-queue self-heal writes LinkedIn state through the log byte-identically');

const staleRender = path.join(root, 'stale-render'); fixture(staleRender, { invite: true }); enable(staleRender);
const stalePending = run(staleRender, 'stale', { TJK_RENDER_FAIL: '1' });
check(stalePending.response.status === 200 && stalePending.response.body.render_pending === true
  && /files could not be updated/.test(stalePending.response.body.message) && stalePending.warnings.length === 1,
'stale self-heal reports committed render failure without failing the read route');

const scriptOff = makeRepoSandbox(ROOT, 'connect-ids-off');
const scriptOn = makeRepoSandbox(ROOT, 'connect-ids-on');
for (const [sandbox, writesOn] of [[scriptOff, false], [scriptOn, true]]) {
  fs.mkdirSync(path.join(sandbox, 'data'));
  fs.cpSync(path.join(ROOT, 'lib'), path.join(sandbox, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'dashboard-web'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'dashboard-web', 'server'), path.join(sandbox, 'dashboard-web', 'server'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'templates'), path.join(sandbox, 'templates'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'backfill-connect-ids.mjs'), path.join(sandbox, 'backfill-connect-ids.mjs'));
  fixture(path.join(sandbox, 'data'));
  fs.writeFileSync(path.join(sandbox, 'data', 'linkedin-connects.json'), '[{"date":"2030-04-10","name":"Example Personone","source":"ta"}]\n');
  if (writesOn) enable(path.join(sandbox, 'data'));
  const result = spawnSync(process.execPath, ['backfill-connect-ids.mjs', '--apply'], { cwd: sandbox, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
check(fs.readFileSync(path.join(scriptOn, 'data', 'linkedin-connects.json'), 'utf8')
  === fs.readFileSync(path.join(scriptOff, 'data', 'linkedin-connects.json'), 'utf8'), 'backfill-connect-ids --apply is byte-identical in both modes');

let scriptRun, scriptStore;
const projectedBackfill = makeRepoSandbox(ROOT, 'connect-ids-projection');
fs.mkdirSync(path.join(projectedBackfill, 'data'));
fs.cpSync(path.join(ROOT, 'lib'), path.join(projectedBackfill, 'lib'), { recursive: true });
fs.mkdirSync(path.join(projectedBackfill, 'dashboard-web'), { recursive: true });
fs.cpSync(path.join(ROOT, 'dashboard-web', 'server'), path.join(projectedBackfill, 'dashboard-web', 'server'), { recursive: true });
fs.cpSync(path.join(ROOT, 'templates'), path.join(projectedBackfill, 'templates'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'backfill-connect-ids.mjs'), path.join(projectedBackfill, 'backfill-connect-ids.mjs'));
fixture(path.join(projectedBackfill, 'data'));
fs.writeFileSync(path.join(projectedBackfill, 'data', 'linkedin-connects.json'), '[]\n');
enable(path.join(projectedBackfill, 'data'));
scriptStore = awaitImportEventStore.openEventStore(path.join(projectedBackfill, 'data', 'trajecktory.db'));
awaitImportEventStore.withTransaction(scriptStore, () => awaitImportLegacyFiles.appendEventsWithEffects(scriptStore, [{
  type: 'connection_request_sent', occurred_on: '2030-04-10', source: 'dashboard', definitions_version: 'v1',
  payload: {
    file: 'linkedin-connects.json', ref: null, date: '2030-04-10',
    legacy_effects: [{ file: 'linkedin-connects.json', op: 'json_append', item: { date: '2030-04-10', name: 'Example Personone', source: 'ta' } }],
  },
}]));
scriptStore.close();
scriptRun = spawnSync(process.execPath, ['backfill-connect-ids.mjs', '--apply'], { cwd: projectedBackfill, encoding: 'utf8' });
if (scriptRun.status !== 0) throw new Error(scriptRun.stderr || scriptRun.stdout);
check(JSON.parse(fs.readFileSync(path.join(projectedBackfill, 'data', 'linkedin-connects.json'), 'utf8'))[0]?.id === 900001,
'backfill-connect-ids reads a newer projected ledger entry that is absent from the stale physical file');

const statusBackfill = makeRepoSandbox(ROOT, 'linkedin-status-on');
fs.mkdirSync(path.join(statusBackfill, 'data'));
fs.cpSync(path.join(ROOT, 'lib'), path.join(statusBackfill, 'lib'), { recursive: true });
fs.mkdirSync(path.join(statusBackfill, 'dashboard-web'), { recursive: true });
fs.cpSync(path.join(ROOT, 'dashboard-web', 'server'), path.join(statusBackfill, 'dashboard-web', 'server'), { recursive: true });
fs.cpSync(path.join(ROOT, 'templates'), path.join(statusBackfill, 'templates'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'backfill-linkedin-status.mjs'), path.join(statusBackfill, 'backfill-linkedin-status.mjs'));
fixture(path.join(statusBackfill, 'data'), { invite: true });
enable(path.join(statusBackfill, 'data'));
scriptRun = spawnSync(process.execPath, ['backfill-linkedin-status.mjs', '--apply'], { cwd: statusBackfill, encoding: 'utf8' });
if (scriptRun.status !== 0) throw new Error(scriptRun.stderr || scriptRun.stdout);
scriptStore = awaitImportEventStore.openEventStore(path.join(statusBackfill, 'data', 'trajecktory.db'));
check(awaitImportEventStore.readEvents(scriptStore).some(event => event.payload.reason === 'linkedin_state_set'), 'backfill-linkedin-status reaches the redirected markInvitePending writer');
scriptStore.close();

const replyBackfill = makeRepoSandbox(ROOT, 'reply-correspondence-on');
fs.mkdirSync(path.join(replyBackfill, 'data'));
fs.cpSync(path.join(ROOT, 'lib'), path.join(replyBackfill, 'lib'), { recursive: true });
fs.mkdirSync(path.join(replyBackfill, 'dashboard-web'), { recursive: true });
fs.cpSync(path.join(ROOT, 'dashboard-web', 'server'), path.join(replyBackfill, 'dashboard-web', 'server'), { recursive: true });
fs.cpSync(path.join(ROOT, 'templates'), path.join(replyBackfill, 'templates'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'backfill-reply-correspondence.mjs'), path.join(replyBackfill, 'backfill-reply-correspondence.mjs'));
fixture(path.join(replyBackfill, 'data'));
fs.writeFileSync(path.join(replyBackfill, 'data', 'google-sync.json'), '{"handledReplies":{"fixture-msg-900001":{"action":"log","appId":900001,"date":"2030-04-10"}}}\n');
fs.writeFileSync(path.join(replyBackfill, 'data', 'google-tokens.json'), '{"access_token":"invented-token","refresh_token":"invented-refresh","expiry_date":4102444800000}\n');
enable(path.join(replyBackfill, 'data'));
const encodedBody = Buffer.from('Invented fetched reply body.', 'utf8').toString('base64url');
fs.writeFileSync(path.join(replyBackfill, 'fetch-stub.mjs'), `globalThis.fetch = async () => ({ ok: true, json: async () => ({ id: 'fixture-msg-900001', threadId: 'fixture-thread-900001', snippet: 'Invented fetched reply body.', payload: { headers: [{ name: 'From', value: 'Example Personone <example.personone@example.test>' }, { name: 'Subject', value: 'Invented fetched reply subject' }, { name: 'Date', value: 'Wed, 10 Apr 2030 12:00:00 +0000' }], parts: [{ mimeType: 'text/plain', body: { data: '${encodedBody}' } }] } }) });\n`);
scriptRun = spawnSync(process.execPath, ['--import', './fetch-stub.mjs', 'backfill-reply-correspondence.mjs', '--apply'], { cwd: replyBackfill, encoding: 'utf8' });
if (scriptRun.status !== 0) throw new Error(scriptRun.stderr || scriptRun.stdout);
scriptStore = awaitImportEventStore.openEventStore(path.join(replyBackfill, 'data', 'trajecktory.db'));
check(awaitImportEventStore.readEvents(scriptStore).some(event => event.payload.reason === 'correspondence_written')
  && fs.readFileSync(path.join(replyBackfill, 'data', 'target-talent-correspondence', '900001.md'), 'utf8').includes('Invented fetched reply body'), 'backfill-reply-correspondence reaches the redirected writer with stubbed Gmail');
scriptStore.close();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
