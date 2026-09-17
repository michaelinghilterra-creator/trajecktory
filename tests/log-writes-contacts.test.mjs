#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox, makeSandbox } from './helpers/sandbox.mjs';

const FIXED_NOW = '2030-04-10T12:00:00.000Z';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TT_HEADER = '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---------|------|-------|--------|-------|------|-------|-----|-------|-------|----------|--------|------------|-------|---------|\n';
const REF_HEADER = '# Referral tracker\n\n| # | Name | How you know them | Where they are now | Target company/role | Status | Last Touch | Notes | LinkedIn | Email |\n|---|------|-------------------|--------------------|---------------------|--------|------------|-------|----------|-------|\n';
const TT_ONE = '| 900001 | Zorblax Widgetry | Personone | Example |  | Example Talent Lead |  |  |  |  | example.personone@example.test | linkedin.com/in/example-person-one | Not Contacted |  | Invented note | example.test |';
const TT_OLD = '| 900002 | Quennox Ratchet Works | Persontwo | Example |  | Example Talent Partner |  |  |  |  | example.persontwo@example.test | linkedin.com/in/example-person-two | Not Contacted |  | Invented old row |';
const REF_ONE = '| 900001 | Example Personone | Invented colleague | Zorblax Widgetry | Example Cog Lead | Not Asked |  | from TA Outreach #900001 | linkedin.com/in/example-person-one | example.personone@example.test |';
const REF_TWO = '| 900002 | Example Persontwo | Invented colleague | Quennox Ratchet Works | Example Ratchet Lead | Not Asked |  | Invented note | linkedin.com/in/example-person-two | example.persontwo@example.test |';

function snapshot(dataDir) {
  const read = file => fs.existsSync(path.join(dataDir, file)) ? fs.readFileSync(path.join(dataDir, file), 'utf8') : null;
  return { tt: read('target-talent.md'), referrals: read('referrals.md'), links: read('contact-links.json') };
}

async function worker() {
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [FIXED_NOW])); }
    static now() { return new NativeDate(FIXED_NOW).getTime(); }
  };
  const dataDir = process.env.TJK_DATA_DIR;
  const action = process.env.TJK_CONTACT_ACTION || 'sequence';
  const tt = await import('../dashboard-web/server/lib/target-talent.mjs');
  const referrals = await import('../dashboard-web/server/lib/referrals.mjs');
  const links = await import('../dashboard-web/server/lib/contact-links.mjs');
  const { openDataStore, setLogWritesTestHooks } = await import('../lib/log-writes.mjs');
  const { readEvents } = await import('../lib/event-store.mjs');

  if (action === 'missing') {
    const eventStore = fs.existsSync(path.join(dataDir, 'trajecktory.db')) ? openDataStore(dataDir) : null;
    const beforeEvents = eventStore ? readEvents(eventStore).length : 0;
    const ttResult = tt.appendTTRows([{ company: 'Zorblax Widgetry', last: 'Personone', first: 'Example' }]);
    const ttEventsAdded = eventStore ? readEvents(eventStore).length - beforeEvents : 0;
    const afterTT = snapshot(dataDir);
    const referralResult = referrals.appendReferralRows([{ name: 'Example Personone', where: 'Zorblax Widgetry' }]);
    process.stdout.write(`${JSON.stringify({ ttResult, ttEventsAdded, referralResult, referralHeader: referrals.REFERRAL_HEADER, afterTT, snapshot: snapshot(dataDir) })}\n`);
    return;
  }
  if (action === 'missing-update') {
    try {
      tt.updateTTLine(900001, { notes: 'Invented missing-file update' });
    } catch (error) {
      process.stdout.write(`${JSON.stringify({
        code: error.code,
        errno: error.errno,
        syscall: error.syscall,
        path: path.basename(error.path || ''),
        message: error.message.replaceAll(dataDir, '<data>'),
      })}\n`);
      return;
    }
    throw new Error('invented missing target-talent update did not throw');
  }
  if (action === 'bulk-import') {
    const express = (await import('express')).default;
    const { router } = await import('../dashboard-web/server/routes/tt-reconcile.mjs');
    const app = express(); app.use(express.json()); app.use(router);
    const server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/tt-reconcile/bulk-import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        csv: 'company,first,last,title\nZorblax Widgetry,Example,Personthree,Example Talent Lead\n',
      }),
    });
    const body = await response.json();
    await new Promise(resolve => server.close(resolve));
    process.stdout.write(`${JSON.stringify({ status: response.status, body, snapshot: snapshot(dataDir) })}\n`);
    return;
  }
  if (action === 'unprojected-append') {
    const eventStore = fs.existsSync(path.join(dataDir, 'trajecktory.db')) ? openDataStore(dataDir) : null;
    const beforeEvents = eventStore ? readEvents(eventStore).length : 0;
    const ttResult = tt.appendTTRows([{ company: 'Zorblax Widgetry', last: 'Personthree', first: 'Example' }]);
    const referralResult = referrals.appendReferralRows([{ name: 'Example Personthree', where: 'Zorblax Widgetry' }]);
    process.stdout.write(`${JSON.stringify({
      ttResult, referralResult, eventsAdded: eventStore ? readEvents(eventStore).length - beforeEvents : 0, snapshot: snapshot(dataDir),
    })}\n`);
    return;
  }
  if (action === 'duplicates') {
    tt.updateTTLine(900001, { notes: 'Invented duplicate update' });
    referrals.deleteReferralLine(900001);
    process.stdout.write(`${JSON.stringify(snapshot(dataDir))}\n`);
    return;
  }
  if (action === 'rollback') {
    const before = snapshot(dataDir);
    const beforeEvents = readEvents(openDataStore(dataDir)).length;
    setLogWritesTestHooks({ hook: name => {
      if (name === 'before-referral-correspondence-referral-update') throw new Error('invented second-write failure');
    } });
    const response = await postCorrespondence();
    process.stdout.write(`${JSON.stringify({
      status: response.status, before, after: snapshot(dataDir), beforeEvents,
      afterEvents: readEvents(openDataStore(dataDir)).length,
    })}\n`);
    return;
  }

  const steps = [];
  tt.updateTTLine(900001, { notes: 'Invented changed note' }); steps.push(snapshot(dataDir));
  tt.updateTTLine(900002, { website: 'quennox.example.test' }); steps.push(snapshot(dataDir));
  tt.appendTTRows([
    { company: 'Zorblax Widgetry', last: 'Personthree', first: 'Example' },
    { company: 'Quennox Ratchet Works', last: 'Personthree', first: 'Example' },
  ]); steps.push(snapshot(dataDir));
  const [added] = referrals.appendReferralRows([{ name: 'Example Personthree', where: 'Zorblax Widgetry' }]); steps.push(snapshot(dataDir));
  referrals.updateReferralLine(added.id, { status: 'Asked', notes: 'Invented referral update' }); steps.push(snapshot(dataDir));
  referrals.deleteReferralLine(900002); steps.push(snapshot(dataDir));
  links.pinTogether('ta:900001', 'referral:900001', 'Invented pin note'); steps.push(snapshot(dataDir));
  links.unpin('ta:900001'); steps.push(snapshot(dataDir));
  links.pinAlone('referral:900001'); steps.push(snapshot(dataDir));
  const response = await postCorrespondence(); steps.push(snapshot(dataDir));
  process.stdout.write(`${JSON.stringify({ steps, routeStatus: response.status })}\n`);

  async function postCorrespondence() {
    const express = (await import('express')).default;
    const { router } = await import('../dashboard-web/server/routes/referrals.mjs');
    const app = express(); app.use(express.json()); app.use(router);
    const server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/referrals/900001/correspondence`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'Sent', subject: 'Invented subject', body: 'Invented body' }),
    });
    await new Promise(resolve => server.close(resolve));
    return response;
  }
}

if (process.env.TJK_CONTACT_WORKER === '1') {
  await worker();
  process.exit(0);
}

const { openEventStore, readEvents } = await import('../lib/event-store.mjs');
const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
const { findTableRowsByKey } = await import('../lib/legacy-files.mjs');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

function fixture(dir, { duplicates = false, trailingBlank = false } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const ttRows = duplicates ? `${TT_ONE}\n${TT_ONE}\n` : `${TT_ONE}\n${TT_OLD}\n`;
  const refRows = duplicates ? `${REF_ONE}\n${REF_ONE}\n` : `${REF_ONE}\n${REF_TWO}\n`;
  fs.writeFileSync(path.join(dir, 'target-talent.md'), `${TT_HEADER}${ttRows}${trailingBlank ? '\n' : ''}`);
  fs.writeFileSync(path.join(dir, 'referrals.md'), `${REF_HEADER}${refRows}`);
  fs.writeFileSync(path.join(dir, 'contact-links.json'), '{\n  "version": 1,\n  "pins": {}\n}\n');
}

function enable(dir) {
  fs.writeFileSync(path.join(dir, 'event-store.json'), '{"writes":"on"}\n');
  const outputDir = path.join(dir, 'fixture-output'); fs.mkdirSync(outputDir);
  const store = openEventStore(path.join(dir, 'trajecktory.db'));
  importDataFolder(store, { dataDir: dir, outputDir, ownerName: 'Example Personone', definitionsVersion: 'v1', importedOn: '2030-04-01' });
  store.close();
}

function run(dataDir, action = 'sequence') {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    cwd: ROOT,
    env: { ...process.env, TJK_DATA_DIR: dataDir, TJK_CONTACT_WORKER: '1', TJK_CONTACT_ACTION: action },
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

console.log('log-writes-contacts.test.mjs');
const root = makeSandbox('log-writes-contacts');
const off = path.join(root, 'off'); const on = path.join(root, 'on');
fixture(off); fixture(on); enable(on);
const offRun = run(off); const onRun = run(on);
check(offRun.routeStatus === 200 && onRun.routeStatus === 200, 'linked referral correspondence route succeeds in both modes');
check(assert.deepEqual(onRun.steps, offRun.steps) === undefined, 'all three contact projections are byte-identical after every differential step');
check(onRun.steps[2].tt.indexOf('| 900003 |') < onRun.steps[2].tt.indexOf('| 900004 |'), 'multi-contact append assigns consecutive ids and preserves order');

let store = openEventStore(path.join(on, 'trajecktory.db'));
const dashboardEvents = readEvents(store).filter(event => event.source === 'dashboard');
const types = new Set(dashboardEvents.map(event => event.type));
check(['person_updated', 'person_added', 'people_merged', 'people_unmerged', 'people_kept_separate', 'legacy_record'].every(type => types.has(type)), 'database contains every expected contact event type');
check(dashboardEvents.every(event => event.payload.ref || event.type.startsWith('people_')), 'row events carry refs and people events carry refs arrays');
check(dashboardEvents.every(event => {
  const semantic = { ...event.payload }; delete semantic.raw; delete semantic.legacy_effects;
  return !/Example Person|Zorblax|Quennox|example\.test/.test(JSON.stringify(semantic));
}), 'semantic payload fields contain refs and field names, not personal values');
const mergeEvent = dashboardEvents.find(event => event.type === 'people_merged');
const mergeSemantic = { ...mergeEvent.payload }; delete mergeSemantic.legacy_effects;
check(mergeEvent.payload.note_present === true
  && JSON.stringify(mergeEvent.payload.legacy_effects).includes('Invented pin note')
  && !JSON.stringify(mergeSemantic).includes('Invented pin note'), 'pin note stays in the json_replace effect and is excluded from semantic payload fields');
check(store.db.prepare('SELECT COUNT(*) AS n FROM legacy_render_state WHERE dirty > 0').get().n === 0, 'successful contact writes leave no dirty projections');
check(findTableRowsByKey(store, 'target-talent.md', raw => Number(raw.split('|')[1]?.trim()), 900001).length === 1, 'findTableRowsByKey reads the existing projection');
store.close();

const duplicateOff = path.join(root, 'duplicate-off'); const duplicateOn = path.join(root, 'duplicate-on');
fixture(duplicateOff, { duplicates: true }); fixture(duplicateOn, { duplicates: true }); enable(duplicateOn);
const duplicateA = run(duplicateOff, 'duplicates'); const duplicateB = run(duplicateOn, 'duplicates');
check(assert.deepEqual(duplicateB, duplicateA) === undefined && (duplicateB.tt.match(/Invented duplicate update/g) || []).length === 2, 'duplicate contact ids update every matching row in both modes');
check(!duplicateB.referrals.includes('| 900001 |'), 'duplicate referral ids delete every matching row in both modes');

const rollback = path.join(root, 'rollback'); fixture(rollback); enable(rollback);
const rolledBack = run(rollback, 'rollback');
check(rolledBack.status === 500 && assert.deepEqual(rolledBack.after, rolledBack.before) === undefined && rolledBack.afterEvents === rolledBack.beforeEvents, 'linked twin and referral row changes roll back together when the second write throws');

const missingOff = path.join(root, 'missing-off'); const missingOn = path.join(root, 'missing-on');
fs.mkdirSync(missingOff); fs.mkdirSync(missingOn); enable(missingOn);
const missingA = run(missingOff, 'missing'); const missingB = run(missingOn, 'missing');
check(assert.deepEqual(missingB, missingA) === undefined && missingB.ttResult.length === 0 && missingB.ttEventsAdded === 0 && missingB.afterTT.tt === null, 'missing target-talent append returns [], appends no event, and creates nothing in both modes');
check(missingB.snapshot.referrals === `${missingB.referralHeader}| 1 | Example Personone |  | Zorblax Widgetry |  | Not Asked |  |  |  |  |\n`, 'missing referral append creates the exact REFERRAL_HEADER skeleton in both modes');
const missingUpdateA = run(missingOff, 'missing-update'); const missingUpdateB = run(missingOn, 'missing-update');
check(assert.deepEqual(missingUpdateB, missingUpdateA) === undefined && missingUpdateB.code === 'ENOENT' && missingUpdateB.path === 'target-talent.md', 'missing target-talent update surfaces the same file error in both modes');

const unprojectedOff = path.join(root, 'unprojected-off'); const unprojectedOn = path.join(root, 'unprojected-on');
fs.mkdirSync(unprojectedOff); fs.mkdirSync(unprojectedOn); enable(unprojectedOn);
for (const dir of [unprojectedOff, unprojectedOn]) {
  fs.writeFileSync(path.join(dir, 'target-talent.md'), TT_HEADER);
  fs.writeFileSync(path.join(dir, 'referrals.md'), REF_HEADER);
}
const unprojectedA = run(unprojectedOff, 'unprojected-append'); const unprojectedB = run(unprojectedOn, 'unprojected-append');
check(assert.deepEqual(unprojectedB.snapshot, unprojectedA.snapshot) === undefined
  && unprojectedB.ttResult[0]?.id === 1 && unprojectedB.referralResult[0]?.id === 1
  && unprojectedB.eventsAdded === 2, 'physical contact files append through row effects when their projections have no layout');

const bulkOff = path.join(root, 'bulk-off'); const bulkOn = path.join(root, 'bulk-on');
fs.mkdirSync(bulkOff); fs.mkdirSync(bulkOn); enable(bulkOn);
const bulkA = run(bulkOff, 'bulk-import'); const bulkB = run(bulkOn, 'bulk-import');
check(bulkA.status === 200 && bulkB.status === 200 && bulkA.body.imported === 1 && bulkB.body.imported === 1, 'bulk-import appends when the physical file exists even without a projected layout');
check(assert.deepEqual(bulkB.snapshot, bulkA.snapshot) === undefined && bulkB.snapshot.tt.startsWith(TT_HEADER), 'renderer target-talent skeleton bytes equal the header written by the bulk-import route');

const blankOff = path.join(root, 'blank-off'); const blankOn = path.join(root, 'blank-on');
fixture(blankOff, { trailingBlank: true }); fixture(blankOn, { trailingBlank: true }); enable(blankOn);
const blankA = run(blankOff); const blankB = run(blankOn);
check(blankA.steps[2].tt.endsWith('|\n') && blankB.steps[2].tt.endsWith('|\n\n'), 'switch-on append preserves a trailing blank line that all table readers ignore');

const importer = makeRepoSandbox(ROOT, 'contact-importer');
fs.mkdirSync(path.join(importer, 'data'));
for (const file of ['import-target-talent.mjs']) fs.copyFileSync(path.join(ROOT, file), path.join(importer, file));
fs.cpSync(path.join(ROOT, 'lib'), path.join(importer, 'lib'), { recursive: true });
fs.writeFileSync(path.join(importer, 'data', 'event-store.json'), '{"writes":"on"}\n');
const beforeImporter = fs.readdirSync(path.join(importer, 'data')).join(',');
const importerResult = spawnSync(process.execPath, ['import-target-talent.mjs', 'invented.csv'], { cwd: importer, encoding: 'utf8' });
check(importerResult.status !== 0 && /event log is in charge.*dashboard's CSV import/is.test(importerResult.stderr)
  && fs.readdirSync(path.join(importer, 'data')).join(',') === beforeImporter, 'legacy target-talent importer refuses switch-on mode before any write');

function setupBackfill(name, writesOn) {
  const sandbox = makeRepoSandbox(ROOT, name);
  fs.mkdirSync(path.join(sandbox, 'data'));
  fs.mkdirSync(path.join(sandbox, 'templates'));
  fs.copyFileSync(path.join(ROOT, 'backfill-bounces.mjs'), path.join(sandbox, 'backfill-bounces.mjs'));
  fs.copyFileSync(path.join(ROOT, 'templates', 'states.yml'), path.join(sandbox, 'templates', 'states.yml'));
  fs.cpSync(path.join(ROOT, 'lib'), path.join(sandbox, 'lib'), { recursive: true });
  const row = '| 900001 | Zorblax Widgetry | Personone | Example |  | Example Talent Lead |  |  |  |  | example.personone@example.test | linkedin.com/in/example-person-one | Not Contacted |  | EMAIL BOUNCED 2030-04-05 — do not reach out again | example.test |';
  fs.writeFileSync(path.join(sandbox, 'data', 'target-talent.md'), `${TT_HEADER}${row}\n`);
  if (writesOn) enable(path.join(sandbox, 'data'));
  return sandbox;
}

const backfillOff = setupBackfill('bounce-off', false);
const backfillOn = setupBackfill('bounce-on', true);
for (const sandbox of [backfillOff, backfillOn]) {
  const result = spawnSync(process.execPath, ['backfill-bounces.mjs', '--apply', '--json'], { cwd: sandbox, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
check(fs.readFileSync(path.join(backfillOn, 'data', 'target-talent.md'), 'utf8')
  === fs.readFileSync(path.join(backfillOff, 'data', 'target-talent.md'), 'utf8'), 'backfill-bounces produces byte-identical target-talent output in both modes');
check(fs.readdirSync(path.join(backfillOff, 'data')).some(file => file.includes('.bak-'))
  && fs.readdirSync(path.join(backfillOn, 'data')).some(file => file.includes('.bak-')), 'backfill-bounces writes its backup in both modes');
store = openEventStore(path.join(backfillOn, 'data', 'trajecktory.db'));
const backfillEvents = readEvents(store).filter(event => event.source === 'cli' && event.type === 'person_updated');
check(backfillEvents.length === 1 && backfillEvents[0].payload.ref === 'ta:900001', 'backfill-bounces records one person_updated event per changed row');
store.close();

function setupVerify(name, writesOn, { duplicates = false } = {}) {
  const sandbox = makeRepoSandbox(ROOT, name);
  fs.mkdirSync(path.join(sandbox, 'data'));
  fs.mkdirSync(path.join(sandbox, 'dashboard-web'));
  fs.copyFileSync(path.join(ROOT, 'verify-contacts.mjs'), path.join(sandbox, 'verify-contacts.mjs'));
  fs.cpSync(path.join(ROOT, 'lib'), path.join(sandbox, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'dashboard-web', '.env'), 'MILLIONVERIFIER_API_KEY=invented-key\n');
  fs.writeFileSync(path.join(sandbox, 'fetch-stub.mjs'), `globalThis.fetch = async url => String(url).includes('/credits')\n  ? { json: async () => ({ credits: 10 }) }\n  : { ok: true, json: async () => ({ result: 'ok', quality: 'good' }) };\n`);
  fs.writeFileSync(path.join(sandbox, 'data', 'target-talent.md'), `${TT_HEADER}${TT_ONE}\n${duplicates ? `${TT_ONE}\n` : ''}`);
  if (writesOn) enable(path.join(sandbox, 'data'));
  return sandbox;
}

const verifyOff = setupVerify('verify-off', false, { duplicates: true });
const verifyOn = setupVerify('verify-on', true, { duplicates: true });
for (const sandbox of [verifyOff, verifyOn]) {
  const result = spawnSync(process.execPath, ['--import', './fetch-stub.mjs', 'verify-contacts.mjs', '--apply', '--json'], { cwd: sandbox, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
check(fs.readFileSync(path.join(verifyOn, 'data', 'target-talent.md'), 'utf8')
  === fs.readFileSync(path.join(verifyOff, 'data', 'target-talent.md'), 'utf8'), 'verify-contacts with a stubbed lookup is byte-identical in both modes');
check((fs.readFileSync(path.join(verifyOn, 'data', 'target-talent.md'), 'utf8').match(/\[v:ok:mv:/g) || []).length === 2, 'verify-contacts updates both occurrences of a duplicate contact id in both modes');
check(fs.readdirSync(path.join(verifyOff, 'data')).some(file => file.includes('.bak-'))
  && fs.readdirSync(path.join(verifyOn, 'data')).some(file => file.includes('.bak-')), 'verify-contacts writes its backup in both modes');
store = openEventStore(path.join(verifyOn, 'data', 'trajecktory.db'));
const verifyEvents = readEvents(store).filter(event => event.source === 'cli' && event.type === 'person_updated');
check(verifyEvents.length === 2 && verifyEvents.every(event => event.payload.id === 900001 && event.payload.ref === 'ta:900001'), 'verify-contacts records one event per duplicate row with a plain integer semantic id');
store.close();

const renderFailed = setupVerify('verify-render-failed', true);
fs.writeFileSync(path.join(renderFailed, 'render-fail-stub.mjs'), `import { setLogWritesTestHooks } from './lib/log-writes.mjs';\nsetLogWritesTestHooks({ writeFile() { throw new Error('Invented renderer failure'); } });\n`);
const renderFailedRun = spawnSync(process.execPath, [
  '--import', './fetch-stub.mjs', '--import', './render-fail-stub.mjs',
  'verify-contacts.mjs', '--apply', '--json',
], { cwd: renderFailed, encoding: 'utf8' });
const renderFailedJson = JSON.parse(renderFailedRun.stdout);
check(renderFailedRun.status === 0 && /Change saved, but files could not be updated yet: target-talent\.md/.test(renderFailedRun.stderr), 'RENDER_FAILED warning is always printed to stderr in JSON mode');
check(renderFailedJson.render_failed === true && /target-talent\.md/.test(renderFailedJson.render_failed_message), 'JSON result reports render_failed and its warning message');

store = openEventStore(path.join(duplicateOn, 'trajecktory.db'));
check(findTableRowsByKey(store, 'target-talent.md', raw => Number(raw.split('|')[1]?.trim()), 900001).length === 2, 'findTableRowsByKey returns every matching row in file order');
store.close();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
