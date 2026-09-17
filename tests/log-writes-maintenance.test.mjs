#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeSandbox } from './helpers/sandbox.mjs';
import { openEventStore, readEvents } from '../lib/event-store.mjs';
import { importDataFolder } from '../lib/import/import-data-folder.mjs';
import { TRACKER_HEADER, TRACKER_SEPARATOR, formatTrackerLine } from '../lib/tracker.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXED = '2030-04-10T12:00:00.000Z';
let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed += 1; }
  else { console.log(`  FAIL ${message}`); failed += 1; }
};

const row = ({ num, company = 'Zorblax Widgetry', role = 'Example Cog Lead', score = '0.11/5', status = 'Evaluated', notes = 'Invented fixture note', url = `https://example.test/${num}`, report = '—' }) => formatTrackerLine({
  num, date: '2030-04-01', company, role, score, status, pdf: '❌', resume: null, report, notes, url,
});
const tracker = rows => ['# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, ...rows, ''].join('\n');

function copyRuntime(root, scripts) {
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'lib'), path.join(root, 'lib'), { recursive: true });
  for (const script of scripts) {
    const target = path.join(root, script);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, script), target);
  }
  fs.mkdirSync(path.join(root, 'dashboard-web/server'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'dashboard-web/server/v1-loader.mjs'), path.join(root, 'dashboard-web/server/v1-loader.mjs'));
  fs.writeFileSync(path.join(root, 'freeze.mjs'), `const NativeDate = Date; globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ['${FIXED}'])); } static now() { return new NativeDate('${FIXED}').getTime(); } };\n`);
}

function initialize(root) {
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(path.join(root, 'output'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'event-store.json'), '{"writes":"on"}\n');
  const store = openEventStore(path.join(dataDir, 'trajecktory.db'));
  importDataFolder(store, { dataDir, outputDir: path.join(root, 'output'), ownerName: 'Example Personone', definitionsVersion: 'v1', importedOn: '2030-04-01' });
  store.close();
}

function setup(name, on, rows, scripts) {
  const root = makeSandbox(`${name}-${on ? 'on' : 'off'}`);
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(root, 'batch/tracker-additions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/applications.md'), tracker(rows));
  fs.writeFileSync(path.join(root, 'data/status-events.tsv'), 'app#\tdate\tstatus\tcompany\tlogged\n');
  copyRuntime(root, scripts);
  if (on) initialize(root);
  return root;
}

function run(root, script, args = [], extraEnv = {}) {
  return spawnSync(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TZ: 'UTC', NODE_OPTIONS: `--import=${pathToFileURL(path.join(root, 'freeze.mjs')).href}`, TJK_DATA_DIR: path.join(root, 'data'), ...extraEnv },
  });
}

function bytes(root, relative) {
  const file = path.join(root, relative);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

const semanticEvents = [];
function compareCase(name, rows, script, args, prepare = () => {}, files = ['data/applications.md']) {
  const off = setup(name, false, rows, [script]);
  const on = setup(name, true, rows, [script]);
  prepare(off);
  prepare(on);
  const a = run(off, script, args);
  const b = run(on, script, args);
  const same = files.every(file => Buffer.compare(bytes(off, file) || Buffer.alloc(0), bytes(on, file) || Buffer.alloc(0)) === 0);
  if (!(a.status === 0 && b.status === 0 && same)) {
    console.log(`    off status=${a.status} stdout=${JSON.stringify(a.stdout)} stderr=${JSON.stringify(a.stderr)}`);
    console.log(`    on status=${b.status} stdout=${JSON.stringify(b.stdout)} stderr=${JSON.stringify(b.stderr)} same=${same}`);
  }
  check(a.status === 0 && b.status === 0 && same, `${name} is byte identical with log writes off and on`);
  const store = openEventStore(path.join(on, 'data/trajecktory.db'));
  semanticEvents.push(...readEvents(store).filter(event => event.source === 'cli'));
  store.close();
  return { off, on, a, b };
}

console.log('log-writes-maintenance.test.mjs');

compareCase('auto-discard', [row({ num: 900001 })], 'auto-discard-low.mjs', ['--apply']);
compareCase('normalize', [row({ num: 900001, status: 'Aplicado 2030-04-02' })], 'normalize-statuses.mjs');

compareCase('resync', [row({ num: 900001, score: '0.11/5', report: '[900001](reports/900001-fixture.md)' })], 'resync-tracker-scores.mjs', ['--apply'], root => {
  fs.writeFileSync(path.join(root, 'reports/900001-fixture.md'), '---\n{"schema":"trajecktory-report/v1","score":0.22,"scoreSource":"derived"}\n---\n# Example\n');
});

compareCase('dedup', [
  row({ num: 900001, score: '0.22/5', status: 'Evaluated', url: 'https://example.test/shared' }),
  row({ num: 900002, company: 'Zorblax Widgetry', role: 'Example Cog Lead', score: '0.11/5', status: 'Applied', url: 'https://example.test/shared' }),
], 'dedup-tracker.mjs', ['--apply']);

const archived = compareCase('archive', [row({ num: 900001, status: 'Discarded' }), row({ num: 900002, status: 'Applied' })], 'archive-discarded.mjs', ['2030-04-01', '--apply'], () => {}, [
  'data/applications.md', 'data/applications-archive-2030-04-01.md',
]);
const restoreOff = run(archived.off, 'archive-discarded.mjs', ['--restore', '2030-04-01']);
const restoreOn = run(archived.on, 'archive-discarded.mjs', ['--restore', '2030-04-01']);
check(restoreOff.status === 0 && restoreOn.status === 0
  && Buffer.compare(bytes(archived.off, 'data/applications.md'), bytes(archived.on, 'data/applications.md')) === 0,
'archive restore is byte identical with log writes off and on');

for (const archiveCase of [
  { name: 'date', args: ['2030-04-01', '--apply'], file: 'data/applications-archive-2030-04-01.md' },
  { name: 'ids', args: ['--ids', '900001', '--tag', 'refused', '--apply'], file: 'data/applications-archive-refused.md' },
]) {
  const root = setup(`archive-refusal-${archiveCase.name}`, true, [row({ num: 900001, status: 'Discarded' })], ['archive-discarded.mjs']);
  const apps = path.join(root, 'data/applications.md');
  const changed = fs.readFileSync(apps, 'utf8').replace('Invented fixture note', 'Changed after import');
  fs.writeFileSync(apps, changed);
  const result = run(root, 'archive-discarded.mjs', archiveCase.args);
  check(result.status === 1 && fs.readFileSync(apps, 'utf8') === changed && !fs.existsSync(path.join(root, archiveCase.file)),
    `archive ${archiveCase.name} refusal leaves the tracker unchanged and creates no archive`);
}

for (const script of ['dedup-tracker.mjs', 'normalize-statuses.mjs']) {
  const root = setup(`legacy-root-refusal-${script}`, true, [row({ num: 900001, status: 'Aplicado 2030-04-02' })], [script]);
  const dataApps = path.join(root, 'data/applications.md');
  const rootApps = path.join(root, 'applications.md');
  const original = fs.readFileSync(dataApps);
  fs.writeFileSync(rootApps, original);
  fs.unlinkSync(dataApps);
  const result = run(root, script, script === 'dedup-tracker.mjs' ? ['--apply'] : []);
  check(result.status === 1
    && /Event-log writes require an existing data\/applications\.md/.test(`${result.stdout}${result.stderr}`)
    && Buffer.compare(fs.readFileSync(rootApps), original) === 0
    && !fs.existsSync(dataApps),
  `${script} refuses the legacy root tracker before any write`);
}

compareCase('backfill', [row({ num: 900001, url: null, report: '[900001](reports/900001-fixture.md)' })], 'backfill-tracker-urls.mjs', ['--apply'], root => {
  fs.writeFileSync(path.join(root, 'reports/900001-fixture.md'), '# Example\n\n**URL:** https://example.test/backfill\n');
});

compareCase('obsidian', [row({ num: 900001, status: 'Discarded', url: 'https://example.test/old', report: '[900001](reports/900001-fixture.md)' })], 'batch/obsidian-postfix.mjs', ['--source', 'source', '--dest', 'dest', '--repo', '.test', '--apply'], root => {
  const repo = path.join(root, '.test');
  fs.mkdirSync(path.join(repo, 'batch'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(root, 'source'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dest'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'batch/obsidian-manifest.tsv'), 'id\tsource_file\tsource_url\tbytes\n1\tunused\thttps://example.test/new\t1\n');
  fs.writeFileSync(path.join(repo, 'batch/batch-state.tsv'), 'id\turl\tstatus\tstarted_at\tcompleted_at\treport_num\tscore\terror\tretries\n1\tlocal:x\tcompleted\ta\tb\t900001\t0.11\t\t0\n');
  fs.writeFileSync(path.join(repo, 'reports/900001-fixture.md'), '---\n{"url":"https://example.test/old"}\n---\n');
});

{
  const legacy = setup('backfill-refusal', true, [row({ num: 900001, url: null, report: '[900001](reports/900001-fixture.md)' })], ['backfill-tracker-urls.mjs']);
  const apps = path.join(legacy, 'data/applications.md');
  const old = fs.readFileSync(apps, 'utf8').replace(TRACKER_HEADER, '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes |').replace(TRACKER_SEPARATOR, '|---|------|---------|------|-------|--------|-----|--------|--------|-------|');
  fs.writeFileSync(apps, old);
  fs.writeFileSync(path.join(legacy, 'reports/900001-fixture.md'), '# Example\n\n**URL:** https://example.test/refusal\n');
  const result = run(legacy, 'backfill-tracker-urls.mjs', ['--apply']);
  if (result.status !== 1) console.log(`    refusal status=${result.status} stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`);
  check(result.status === 1 && /event log owns applications\.md/.test(`${result.stdout}${result.stderr}`) && fs.readFileSync(apps, 'utf8') === old,
    'backfill refuses a legacy layout under log writes and writes nothing');

  const refused = setup('backfill-write-refusal', true, [row({ num: 900001, url: null, report: '[900001](reports/900001-fixture.md)' })], ['backfill-tracker-urls.mjs']);
  const refusedApps = path.join(refused, 'data/applications.md');
  fs.writeFileSync(refusedApps, fs.readFileSync(refusedApps, 'utf8').replace('Invented fixture note', 'Changed after import'));
  fs.writeFileSync(path.join(refused, 'reports/900001-fixture.md'), '# Example\n\n**URL:** https://example.test/refused\n');
  const refusedResult = run(refused, 'backfill-tracker-urls.mjs', ['--apply']);
  const refusedBackups = fs.readdirSync(path.join(refused, 'data')).filter(file => file.includes('.bak-'));
  check(refusedResult.status === 1 && /file changed since it was read/.test(`${refusedResult.stdout}${refusedResult.stderr}`) && refusedBackups.length === 0,
    'backfill removes its backup when the event logged write is refused');

  const off = setup('backfill-upgrade', false, [row({ num: 900001, url: null, report: '[900001](reports/900001-fixture.md)' })], ['backfill-tracker-urls.mjs']);
  const offApps = path.join(off, 'data/applications.md');
  fs.writeFileSync(offApps, fs.readFileSync(offApps, 'utf8').replace(TRACKER_HEADER, '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes |').replace(TRACKER_SEPARATOR, '|---|------|---------|------|-------|--------|-----|--------|--------|-------|'));
  fs.writeFileSync(path.join(off, 'reports/900001-fixture.md'), '# Example\n\n**URL:** https://example.test/upgrade\n');
  const upgraded = run(off, 'backfill-tracker-urls.mjs', ['--apply']);
  if (upgraded.status !== 0) console.log(`    upgrade status=${upgraded.status} stdout=${JSON.stringify(upgraded.stdout)} stderr=${JSON.stringify(upgraded.stderr)}`);
  check(upgraded.status === 0 && fs.readFileSync(offApps, 'utf8').includes(TRACKER_HEADER), 'backfill still upgrades a legacy layout with log writes off');
}

{
  const root = setup('repair-atomic', true, [row({ num: 900001, status: 'Closed' })], ['repair-twc-data.mjs']);
  const dataDir = path.join(root, 'data');
  fs.writeFileSync(path.join(dataDir, 'apply-dates.json'), '{"900001":"2030-04-01"}\n');
  fs.writeFileSync(path.join(dataDir, 'twc-overrides.json'), '{"applications":{"900001":{"include":false}},"interviews":[],"exclude":[],"add":[]}\n');
  const ledger = { final: [{ date: '2030-04-02', kind: 'application', activity: 'Applied online', employer: 'Zorblax Widgetry', role: 'Example Cog Lead', contact: '', method: 'Online', result: 'Submitted job application', status: 'VERIFIED', evidence: 'Invented evidence', include: 'yes', appId: '900001' }], stats: {}, wk: {} };
  fs.writeFileSync(path.join(root, 'ledger.json'), `${JSON.stringify(ledger)}\n`);
  const worker = path.join(root, 'atomic-worker.mjs');
  fs.writeFileSync(worker, `process.env.TJK_DATA_DIR = ${JSON.stringify(dataDir)}; const { runRepair } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'repair-twc-data.mjs')).href)}); try { runRepair({ ledgerPath: ${JSON.stringify(path.join(root, 'ledger.json'))}, planPath: ${JSON.stringify(path.join(root, 'plan.md'))}, apply: true, now: new Date('${FIXED}'), statusEventLogger: () => { throw new Error('Invented forced failure'); } }); } catch (error) { console.error(error.message); process.exitCode = 1; }\n`);
  const tracked = ['applications.md', 'apply-dates.json', 'status-events.tsv', 'twc-overrides.json'];
  const before = new Map(tracked.map(file => [file, fs.readFileSync(path.join(dataDir, file))]));
  const storeBefore = openEventStore(path.join(dataDir, 'trajecktory.db'));
  const countBefore = readEvents(storeBefore).length;
  storeBefore.close();
  const result = spawnSync(process.execPath, [worker], { cwd: root, encoding: 'utf8' });
  const storeAfter = openEventStore(path.join(dataDir, 'trajecktory.db'));
  const countAfter = readEvents(storeAfter).length;
  storeAfter.close();
  check(result.status === 1 && /Invented forced failure/.test(result.stderr)
    && tracked.every(file => Buffer.compare(before.get(file), fs.readFileSync(path.join(dataDir, file))) === 0) && countAfter === countBefore,
    'repair failure rolls back all four projected files and every event');
}

{
  const root = setup('repair-payload', true, [row({ num: 900001, status: 'Closed' })], []);
  const dataDir = path.join(root, 'data');
  fs.writeFileSync(path.join(dataDir, 'apply-dates.json'), '{"900001":"2030-04-01"}\n');
  fs.writeFileSync(path.join(dataDir, 'twc-overrides.json'), '{"applications":{"900001":{"include":false}},"interviews":[],"exclude":[],"add":[]}\n');
  const ledger = { final: [{ date: '2030-04-02', kind: 'application', activity: 'Applied online', employer: 'Zorblax Widgetry', role: 'Example Cog Lead', contact: '', method: 'Online', result: 'Submitted job application', status: 'VERIFIED', evidence: 'Invented evidence', include: 'yes', appId: '900001' }], stats: {}, wk: {} };
  fs.writeFileSync(path.join(root, 'ledger.json'), `${JSON.stringify(ledger)}\n`);
  const result = spawnSync(process.execPath, [path.join(ROOT, 'repair-twc-data.mjs'), '--ledger', path.join(root, 'ledger.json'), '--plan', path.join(root, 'plan.md'), '--apply'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, TJK_DATA_DIR: dataDir, TZ: 'UTC' },
  });
  const store = openEventStore(path.join(dataDir, 'trajecktory.db'));
  semanticEvents.push(...readEvents(store).filter(event => event.source === 'cli' || event.source === 'dashboard'));
  store.close();
  check(result.status === 0, 'repair commits all four projected files together on success');
}

const forbidden = ['Invented fixture note', 'Zorblax Widgetry', 'Quennox Ratchet Works', 'https://example.test/', ROOT];
const cleanPayloads = semanticEvents.every(event => {
  const payload = { ...event.payload };
  delete payload.legacy_effects;
  const text = JSON.stringify(payload);
  return forbidden.every(value => !text.includes(value));
});
check(cleanPayloads, 'maintenance semantic payloads contain ids, refs, fields, dates, counts, channels and states only');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
