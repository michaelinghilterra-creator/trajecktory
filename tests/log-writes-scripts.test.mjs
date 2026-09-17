#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox, makeSandbox } from './helpers/sandbox.mjs';

if (process.env.TJK_TABLE_PATCH_WORKER === '1') {
  const { patchRowInMd } = await import('../dashboard-web/server/lib/applications.mjs');
  patchRowInMd(900001, { notes: 'Invented concurrent note' }, { company: 'Zorblax Widgetry' });
  process.exit(0);
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEADER = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
].join('\n');
const row = ({
  num, date = '2030-03-01', company = 'Zorblax Widgetry', role = 'Example Cog Lead',
  score = '0.11/5', status = 'Evaluated', notes = 'Invented fixture', url,
}) => `| ${num} | ${date} | ${company} | ${role} | ${score} | ${status} | ❌ | — | [${num}](reports/${num}-fixture-2030-03-01.md) | ${notes} | ${url || `https://example.test/${num}`} |`;
const BASE_ROWS = [
  row({ num: 900001 }),
  row({
    num: 900002,
    company: 'Quennox Ratchet Works',
    role: 'Example Sprocket Director',
    score: '0.22/5',
  }),
];
const trackerText = (rows = BASE_ROWS, eol = '\n') => `${HEADER.split('\n').concat(rows, '').join(eol)}`;
const keyForTracker = line => {
  const match = line.match(/^\|\s*(\d+)\s*\|/);
  return match ? match[1] : null;
};

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const { openEventStore, readEvents } = await import('../lib/event-store.mjs');
const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
const { appendEventsWithEffects } = await import('../lib/legacy-files.mjs');
const {
  openDataStore,
  resetLogWritesCache,
  setLogWritesTestHooks,
  writeTableText,
} = await import('../lib/log-writes.mjs');

function importFixture(prefix, text = trackerText()) {
  const root = makeSandbox(prefix);
  const dataDir = path.join(root, 'data');
  const outputDir = path.join(root, 'output');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'applications.md'), text);
  fs.writeFileSync(path.join(dataDir, 'event-store.json'), '{"writes":"on"}\n');
  const store = openEventStore(path.join(dataDir, 'trajecktory.db'));
  importDataFolder(store, {
    dataDir,
    outputDir,
    ownerName: 'Example Person',
    definitionsVersion: 'v1',
    importedOn: '2030-03-01',
  });
  store.close();
  resetLogWritesCache();
  return { root, dataDir, text };
}

function buildLegacyEvents({ added, changed, removed }) {
  return [...added, ...changed, ...removed].map(change => ({
    type: 'legacy_record',
    occurred_on: '2030-03-10',
    payload: { reason: 'invented_table_change', legacy_effects: [change.effect] },
  }));
}

function callWrite(fixture, newText, buildEvents = buildLegacyEvents) {
  return writeTableText({
    dataDir: fixture.dataDir,
    file: 'applications.md',
    baseText: fixture.text,
    newText,
    rowKey: keyForTracker,
    buildEvents,
  });
}

function caught(fn) {
  try { fn(); return null; } catch (error) { return error; }
}

console.log('log-writes-scripts.test.mjs');
console.log('\nwriteTableText');

{
  const fixture = importFixture('table-add-start');
  const first = row({ num: 900003, score: '0.33/5' });
  const result = callWrite(fixture, trackerText([first, ...BASE_ROWS]));
  const events = readEvents(openDataStore(fixture.dataDir)).filter(event => event.payload.reason === 'invented_table_change');
  check(result.changed && events.length === 1
    && events[0].payload.legacy_effects[0].anchor.at === 'table_start'
    && fs.readFileSync(path.join(fixture.dataDir, 'applications.md'), 'utf8') === trackerText([first, ...BASE_ROWS]),
  'adds a row at table start with a table_start anchor');
}

{
  const fixture = importFixture('table-add-after');
  const added = row({ num: 900003, score: '0.33/5' });
  const result = callWrite(fixture, trackerText([BASE_ROWS[0], added, BASE_ROWS[1]]));
  const event = readEvents(openDataStore(fixture.dataDir)).find(item => item.payload.reason === 'invented_table_change');
  check(result.changed && event.payload.legacy_effects[0].anchor.at === 'after'
    && event.payload.legacy_effects[0].anchor.row_id === 'applications.md#4',
  'adds a row after the preceding existing row id');
}

{
  const fixture = importFixture('table-change');
  const changed = row({ num: 900001, score: '0.44/5' });
  const result = callWrite(fixture, trackerText([changed, BASE_ROWS[1]]));
  const event = readEvents(openDataStore(fixture.dataDir)).find(item => item.payload.reason === 'invented_table_change');
  check(result.changed && event.source === 'cli' && event.definitions_version === 'v1'
    && event.payload.legacy_effects[0].row_id === 'applications.md#4'
    && !Object.hasOwn(event.payload.legacy_effects[0], 'anchor'),
  'changes a row in place and supplies event defaults');
}

{
  const fixture = importFixture('table-remove');
  callWrite(fixture, trackerText([BASE_ROWS[1]]));
  const event = readEvents(openDataStore(fixture.dataDir)).find(item => item.payload.reason === 'invented_table_change');
  check(event.payload.legacy_effects[0].op === 'row_delete'
    && !fs.readFileSync(path.join(fixture.dataDir, 'applications.md'), 'utf8').includes('| 900001 |'),
  'removes a row with its existing row id');
}

{
  const fixture = importFixture('table-noop');
  const store = openDataStore(fixture.dataDir);
  const before = readEvents(store).length;
  let renders = 0;
  setLogWritesTestHooks({ writeFile: () => { renders++; } });
  const result = callWrite(fixture, fixture.text);
  check(result.changed === false && readEvents(store).length === before && renders === 0,
    'no-op appends no event and renders no file');
  setLogWritesTestHooks();
}

{
  const fixture = importFixture('table-base-changed');
  const worker = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, TJK_DATA_DIR: fixture.dataDir, TJK_TABLE_PATCH_WORKER: '1' },
    encoding: 'utf8',
  });
  const afterPatch = fs.readFileSync(path.join(fixture.dataDir, 'applications.md'), 'utf8');
  const store = openDataStore(fixture.dataDir);
  const beforeCount = readEvents(store).length;
  const error = caught(() => callWrite(fixture, trackerText([
    row({ num: 900001, score: '0.55/5' }), BASE_ROWS[1],
  ])));
  check(worker.status === 0 && error?.code === 'BASE_CHANGED'
    && fs.readFileSync(path.join(fixture.dataDir, 'applications.md'), 'utf8') === afterPatch
    && readEvents(store).length === beforeCount,
  'BASE_CHANGED after patchRowInMd saves nothing from the stale writer');
}

{
  const fixture = importFixture('table-layout');
  const changedLayout = fixture.text.replace('# Applications Tracker', '# Invented Tracker');
  const error = caught(() => callWrite(fixture, changedLayout));
  check(error?.code === 'LAYOUT_CHANGED', 'rejects changed non-row layout');
}

{
  const fixture = importFixture('table-duplicate');
  const error = caught(() => callWrite(fixture, trackerText([...BASE_ROWS, BASE_ROWS[0]])));
  check(error?.code === 'DUPLICATE_ROW_KEY', 'rejects duplicate row keys');
}

{
  const fixture = importFixture('table-order');
  const error = caught(() => callWrite(fixture, trackerText([...BASE_ROWS].reverse())));
  check(error?.code === 'ROW_ORDER_CHANGED', 'rejects reordering existing rows');
}

{
  const fixture = importFixture('table-effect-drop');
  const store = openDataStore(fixture.dataDir);
  const beforeCount = readEvents(store).length;
  const beforeFile = fs.readFileSync(path.join(fixture.dataDir, 'applications.md'), 'utf8');
  const error = caught(() => callWrite(
    fixture,
    trackerText([row({ num: 900001, score: '0.66/5' }), BASE_ROWS[1]]),
    () => [],
  ));
  check(/exactly one event/.test(error?.message || '')
    && readEvents(store).length === beforeCount
    && fs.readFileSync(path.join(fixture.dataDir, 'applications.md'), 'utf8') === beforeFile,
  'rejects a builder that drops an effect and writes nothing');
}

{
  const crlfText = trackerText(BASE_ROWS, '\r\n');
  const fixture = importFixture('table-crlf', crlfText);
  const changed = row({ num: 900001, score: '0.77/5' });
  const newText = trackerText([changed, BASE_ROWS[1]], '\r\n');
  callWrite(fixture, newText);
  check(fs.readFileSync(path.join(fixture.dataDir, 'applications.md'), 'utf8') === newText,
    'CRLF base rows keep their line endings when changed or unchanged');
}

function copyRuntime(sandbox, script) {
  fs.copyFileSync(path.join(ROOT, script), path.join(sandbox, script));
  fs.cpSync(path.join(ROOT, 'lib'), path.join(sandbox, 'lib'), { recursive: true });
  if (script === 'merge-tracker.mjs') {
    fs.mkdirSync(path.join(sandbox, 'dashboard-web/server'), { recursive: true });
    fs.copyFileSync(
      path.join(ROOT, 'dashboard-web/server/v1-loader.mjs'),
      path.join(sandbox, 'dashboard-web/server/v1-loader.mjs'),
    );
  }
}

function runScript(sandbox, script, args = []) {
  return spawnSync(process.execPath, [path.join(sandbox, script), ...args], {
    cwd: sandbox,
    encoding: 'utf8',
  });
}

function importSandbox(sandbox) {
  const dataDir = path.join(sandbox, 'data');
  const outputDir = path.join(sandbox, 'output');
  fs.mkdirSync(outputDir, { recursive: true });
  const store = openEventStore(path.join(dataDir, 'trajecktory.db'));
  importDataFolder(store, {
    dataDir,
    outputDir,
    ownerName: 'Example Person',
    definitionsVersion: 'v1',
    importedOn: '2030-04-01',
  });
  store.close();
}

function report(num, url) {
  return `---\n${JSON.stringify({
    schema: 'trajecktory-report/v1', num, url,
  })}\n---\n# Invented fixture\n`;
}

function setupMergeSandbox(name, writesOn) {
  const sandbox = makeRepoSandbox(ROOT, name);
  copyRuntime(sandbox, 'merge-tracker.mjs');
  fs.mkdirSync(path.join(sandbox, 'data'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'batch/tracker-additions'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'dashboard-web/server'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'templates'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'dashboard-web/server/v1-loader.mjs'), path.join(sandbox, 'dashboard-web/server/v1-loader.mjs'));
  fs.copyFileSync(path.join(ROOT, 'templates/states.yml'), path.join(sandbox, 'templates/states.yml'));

  const existingUrl = 'https://example.test/posting/900001';
  const newUrl = 'https://example.test/posting/900002';
  const seed = trackerText([row({ num: 900001, url: existingUrl })]);
  fs.writeFileSync(path.join(sandbox, 'data/applications.md'), seed);
  fs.writeFileSync(path.join(sandbox, 'data/pipeline.md'),
    `- [ ] ${existingUrl} | Zorblax Widgetry | Example Cog Lead\n- [ ] ${newUrl} | Quennox Ratchet Works | Example Sprocket Director\n`);
  fs.writeFileSync(path.join(sandbox, 'data/status-events.tsv'), 'app#\tdate\tstatus\tcompany\tlogged\n');
  fs.writeFileSync(path.join(sandbox, 'reports/900002-fixture.md'), report(900002, newUrl));
  fs.writeFileSync(path.join(sandbox, 'reports/900003-fixture.md'), report(900003, existingUrl));
  fs.writeFileSync(path.join(sandbox, 'reports/900004-fixture.md'), report(900004, existingUrl));
  const additions = {
    '900002-quennox.tsv': ['900002', '2030-04-02', 'Quennox Ratchet Works', 'Example Sprocket Director', 'Evaluated', '0.55/5', '❌', '[900002](reports/900002-fixture.md)', '[self-sourced] invented new row'],
    '900003-zorblax.tsv': ['900003', '2030-04-03', 'Zorblax Widgetry', 'Example Cog Lead', 'Evaluated', '0.99/5', '❌', '[900003](reports/900003-fixture.md)', '[self-sourced] invented higher re-evaluation'],
    '900004-zorblax.tsv': ['900004', '2030-04-04', 'Zorblax Widgetry', 'Example Cog Lead', 'Evaluated', '0.01/5', '❌', '[900004](reports/900004-fixture.md)', '[self-sourced] invented lower re-evaluation'],
  };
  for (const [file, cells] of Object.entries(additions)) {
    fs.writeFileSync(path.join(sandbox, 'batch/tracker-additions', file), `${cells.join('\t')}\n`);
  }
  if (writesOn) {
    fs.writeFileSync(path.join(sandbox, 'data/event-store.json'), '{"writes":"on"}\n');
    importSandbox(sandbox);
  }
  return sandbox;
}

function fileBytes(root, relative) {
  const file = path.join(root, relative);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

function treeBytes(root, relative) {
  const dir = path.join(root, relative);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map(name => [name, fs.readFileSync(path.join(dir, name)).toString('base64')]);
}

console.log('\nmerge-tracker');
{
  const off = setupMergeSandbox('merge-log-off', false);
  const on = setupMergeSandbox('merge-log-on', true);
  const offRun = runScript(off, 'merge-tracker.mjs');
  const onRun = runScript(on, 'merge-tracker.mjs');
  const files = [
    'data/applications.md',
    'data/pipeline.md',
    'data/merge-drops.tsv',
    'data/source-corrections.tsv',
  ];
  const sameFiles = files.every(file => Buffer.compare(fileBytes(off, file), fileBytes(on, file)) === 0);
  const sameMoved = JSON.stringify(treeBytes(off, 'batch/tracker-additions/merged'))
      === JSON.stringify(treeBytes(on, 'batch/tracker-additions/merged'))
    && JSON.stringify(treeBytes(off, 'batch/tracker-additions/dropped'))
      === JSON.stringify(treeBytes(on, 'batch/tracker-additions/dropped'));
  const store = openEventStore(path.join(on, 'data/trajecktory.db'));
  const evaluated = readEvents(store).filter(event => event.type === 'posting_evaluated' && event.source === 'cli');
  const dirty = store.db.prepare('SELECT COUNT(*) AS n FROM legacy_render_state WHERE dirty > 0').get().n;
  store.close();
  check(offRun.status === 0 && onRun.status === 0 && sameFiles && sameMoved,
    'switch-on merge is byte-identical to switch-off files and TSV destinations');
  check(evaluated.length === 2
    && evaluated.filter(event => event.payload.re_evaluation === true).length === 1
    && evaluated.filter(event => event.payload.re_evaluation === false).length === 1
    && dirty === 0,
  'merge logs one added and one re-evaluated posting with no dirty files');
}

{
  const sandbox = setupMergeSandbox('merge-log-conflict', true);
  const apps = path.join(sandbox, 'data/applications.md');
  const pipeline = path.join(sandbox, 'data/pipeline.md');
  const beforeApps = fs.readFileSync(apps);
  const beforePipeline = fs.readFileSync(pipeline);
  const store = openEventStore(path.join(sandbox, 'data/trajecktory.db'));
  appendEventsWithEffects(store, [{
    type: 'legacy_record',
    occurred_on: '2030-04-05',
    source: 'dashboard',
    definitions_version: 'v1',
    payload: {
      reason: 'tracker_row_updated',
      legacy_effects: [{
        file: 'applications.md',
        op: 'row_upsert',
        row_id: 'applications.md#4',
        raw: row({ num: 900001, score: '0.88/5', url: 'https://example.test/posting/900001' }),
      }],
    },
  }]);
  store.close();
  const run = runScript(sandbox, 'merge-tracker.mjs');
  check(run.status !== 0 && /changed since it was read/i.test(run.stderr)
    && Buffer.compare(fs.readFileSync(apps), beforeApps) === 0
    && Buffer.compare(fs.readFileSync(pipeline), beforePipeline) === 0
    && !fs.existsSync(path.join(sandbox, 'batch/tracker-additions/merged'))
    && !fs.existsSync(path.join(sandbox, 'batch/tracker-additions/dropped')),
  'merge BASE_CHANGED exits before tracker, pipeline, or TSV moves are saved');
}

{
  const sandbox = makeRepoSandbox(ROOT, 'merge-log-missing-db');
  copyRuntime(sandbox, 'merge-tracker.mjs');
  fs.mkdirSync(path.join(sandbox, 'data'), { recursive: true });
  fs.writeFileSync(path.join(sandbox, 'data/event-store.json'), '{"writes":"on"}\n');
  const run = runScript(sandbox, 'merge-tracker.mjs');
  check(run.status !== 0 && !fs.existsSync(path.join(sandbox, 'data/applications.md'))
    && !fs.existsSync(path.join(sandbox, 'batch/tracker-additions')),
  'switch-on merge without a database or tracker exits before any write');
}

{
  const sandbox = makeRepoSandbox(ROOT, 'merge-log-missing-db-existing-tracker');
  copyRuntime(sandbox, 'merge-tracker.mjs');
  fs.mkdirSync(path.join(sandbox, 'data'), { recursive: true });
  const apps = path.join(sandbox, 'data/applications.md');
  const before = trackerText([BASE_ROWS[0]]);
  fs.writeFileSync(apps, before);
  fs.writeFileSync(path.join(sandbox, 'data/event-store.json'), '{"writes":"on"}\n');
  const run = runScript(sandbox, 'merge-tracker.mjs');
  const unchanged = fs.readFileSync(apps, 'utf8') === before;
  const noBatchDir = !fs.existsSync(path.join(sandbox, 'batch/tracker-additions'));
  check(run.status !== 0 && /trajecktory\.db.*missing/i.test(run.stderr) && unchanged && noBatchDir,
    `switch-on merge with a tracker but no database exits before any write (status=${run.status}, unchanged=${unchanged}, noBatchDir=${noBatchDir}, stderr=${JSON.stringify(run.stderr.trim())})`);
}

function setupVerifySandbox(name, writesOn) {
  const sandbox = makeRepoSandbox(ROOT, name);
  copyRuntime(sandbox, 'verify-actionable.mjs');
  fs.mkdirSync(path.join(sandbox, 'data'), { recursive: true });
  const dead = row({ num: 900001, url: 'https://example.test/dead/900001' });
  const active = row({
    num: 900002,
    company: 'Quennox Ratchet Works',
    role: 'Example Sprocket Director',
    score: '0.22/5',
    url: 'https://example.test/active/900002',
  });
  fs.writeFileSync(path.join(sandbox, 'data/applications.md'), trackerText([dead, active]));
  fs.writeFileSync(path.join(sandbox, 'data/status-events.tsv'), 'app#\tdate\tstatus\tcompany\tlogged\n');
  fs.writeFileSync(path.join(sandbox, 'check-liveness.mjs'),
    "for (const url of process.argv.slice(2)) console.log(`${url.includes('/dead/') ? 'X expired' : 'OK active'}    ${url}`);\nif (process.argv.some(arg => arg.includes('/dead/'))) process.exitCode = 1;\n");
  if (writesOn) {
    fs.writeFileSync(path.join(sandbox, 'data/event-store.json'), '{"writes":"on"}\n');
    importSandbox(sandbox);
  }
  return sandbox;
}

console.log('\nverify-actionable');
{
  const off = setupVerifySandbox('verify-log-off', false);
  const on = setupVerifySandbox('verify-log-on', true);
  const offStatusBefore = fileBytes(off, 'data/status-events.tsv');
  const onStatusBefore = fileBytes(on, 'data/status-events.tsv');
  const offRun = runScript(off, 'verify-actionable.mjs', ['--apply']);
  const onRun = runScript(on, 'verify-actionable.mjs', ['--apply']);
  const store = openEventStore(path.join(on, 'data/trajecktory.db'));
  const statusEvents = readEvents(store).filter(event => event.type === 'status_changed' && event.source === 'cli');
  const dirty = store.db.prepare('SELECT COUNT(*) AS n FROM legacy_render_state WHERE dirty > 0').get().n;
  store.close();
  check(offRun.status === 0 && onRun.status === 0
    && Buffer.compare(fileBytes(off, 'data/applications.md'), fileBytes(on, 'data/applications.md')) === 0,
  'switch-on verify-actionable output is byte-identical to switch-off output');
  check(Buffer.compare(fileBytes(off, 'data/status-events.tsv'), offStatusBefore) === 0
    && Buffer.compare(fileBytes(on, 'data/status-events.tsv'), onStatusBefore) === 0
    && statusEvents.length === 1
    && statusEvents[0].application_id === '900001'
    && statusEvents[0].payload.reason === 'posting_closed'
    && dirty === 0,
  'verify-actionable logs one status change without a status-events row');
}

resetLogWritesCache();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
