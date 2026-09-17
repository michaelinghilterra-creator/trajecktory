#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from './helpers/sandbox.mjs';

const FIXED_NOW = '2030-03-10T12:00:00.000Z';

function snapshot(dataDir) {
  const read = name => fs.existsSync(path.join(dataDir, name))
    ? fs.readFileSync(path.join(dataDir, name), 'utf8') : null;
  return {
    applications: read('applications.md'),
    statusEvents: read('status-events.tsv'),
    applyDates: read('apply-dates.json'),
    pipeline: read('pipeline.md'),
  };
}

async function runWorker() {
  const dataDir = process.env.TJK_DATA_DIR;
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [FIXED_NOW])); }
    static now() { return new NativeDate(FIXED_NOW).getTime(); }
  };

  const { patchRowInMd, removeRowFromMd } = await import('../dashboard-web/server/lib/applications.mjs');
  const { logStatusEvent } = await import('../dashboard-web/server/lib/sidecars.mjs');
  const { openDataStore, setLogWritesTestHooks } = await import('../lib/log-writes.mjs');
  const { readEvents } = await import('../lib/event-store.mjs');
  const workerAction = process.env.TJK_LOG_WRITES_ACTION || 'sequence';
  if (workerAction === 'render-route') {
    const warnings = [];
    console.warn = value => warnings.push(String(value?.message || value));
    setLogWritesTestHooks({ writeFile: () => { throw new Error('invented route render failure'); } });
    const express = (await import('express')).default;
    const { router } = await import('../dashboard-web/server/routes/applications.mjs');
    const app = express(); app.use(express.json()); app.use(router);
    const server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/applications/900001`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: 'Zorblax Widgetry', notes: 'Invented render-pending note' }),
    });
    const body = await response.json();
    await new Promise(resolve => server.close(resolve));
    process.stdout.write(`${JSON.stringify({ status: response.status, body, warnings })}\n`);
    return;
  }
  if (workerAction === 'rollback') {
    const before = snapshot(dataDir);
    const beforeCount = readEvents(openDataStore(dataDir)).length;
    setLogWritesTestHooks({
      hook: name => { if (name === 'before-record-apply-date') throw new Error('invented apply-date failure'); },
    });
    const express = (await import('express')).default;
    const { router } = await import('../dashboard-web/server/routes/applications.mjs');
    const app = express();
    app.use(express.json());
    app.use(router);
    const server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/applications/900001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company: 'Zorblax Widgetry', status: 'Applied', eventDate: '2030-03-05',
      }),
    });
    await new Promise(resolve => server.close(resolve));
    process.stdout.write(`${JSON.stringify({
      status: response.status,
      before,
      after: snapshot(dataDir),
      beforeCount,
      afterCount: readEvents(openDataStore(dataDir)).length,
    })}\n`);
    return;
  }
  const steps = [];
  patchRowInMd(900001, { status: 'Interview Scheduled' }, {
    company: 'Zorblax Widgetry', eventDate: '2030-03-04',
  });
  steps.push(snapshot(dataDir));
  patchRowInMd(900001, { notes: 'Invented note' }, { company: 'Zorblax Widgetry' });
  steps.push(snapshot(dataDir));

  const express = (await import('express')).default;
  const { router } = await import('../dashboard-web/server/routes/applications.mjs');
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const patch = body => fetch(`${base}/api/applications/900001`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await patch({ company: 'Zorblax Widgetry', status: 'Applied', eventDate: '2030-03-05' });
  steps.push(snapshot(dataDir));
  await patch({ company: 'Zorblax Widgetry', status: 'Applied', eventDate: '2030-03-06' });
  steps.push(snapshot(dataDir));
  await new Promise(resolve => server.close(resolve));

  patchRowInMd(900002, { status: 'Rejected' }, {
    company: 'Quennox Ratchet Works', eventDate: '2030-03-07',
  });
  steps.push(snapshot(dataDir));
  logStatusEvent(900002, 'Phone Screen', {
    company: 'Quennox Ratchet Works', date: '2030-03-08',
  });
  steps.push(snapshot(dataDir));
  removeRowFromMd(900003, { company: 'Zorblax Widgetry' });
  steps.push(snapshot(dataDir));
  process.stdout.write(`${JSON.stringify(steps)}\n`);
}

if (process.env.TJK_LOG_WRITES_WORKER === '1') {
  await runWorker();
  process.exit(0);
}

const { openEventStore, readEvents } = await import('../lib/event-store.mjs');
const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
const {
  appendEventsWithEffects,
  renderLegacyFile,
} = await import('../lib/legacy-files.mjs');
const {
  openDataStore,
  resetLogWritesCache,
  setLogWritesTestHooks,
  withLogWrite,
} = await import('../lib/log-writes.mjs');
const { catchUpEventStore } = await import('../dashboard-web/server/lib/event-store-startup.mjs');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

function fixture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'applications.md'),
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
    '| 900001 | 2030-03-01 | Zorblax Widgetry | Example Cog Lead | 0.01/5 | Interested | | | | | https://example.test/900001 |\n' +
    '| 900002 | 2030-03-02 | Quennox Ratchet Works | Example Sprocket Director | 0.01/5 | Applied | | | | | https://example.test/900002 |\n' +
    '| 900003 | 2030-03-03 | Zorblax Widgetry | Example Cog Lead | 0.01/5 | Discarded | | | | | https://example.test/900003 |\n');
  fs.writeFileSync(path.join(dir, 'status-events.tsv'), 'app#\tdate\tstatus\tcompany\tlogged\n');
  fs.writeFileSync(path.join(dir, 'apply-dates.json'), '{}\n');
  fs.writeFileSync(path.join(dir, 'pipeline.md'), '- [ ] https://example.test/seed\n');
}

function runChild(dataDir, action = 'sequence') {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: {
      ...process.env,
      TJK_DATA_DIR: dataDir,
      TJK_LOG_WRITES_WORKER: '1',
      TJK_LOG_WRITES_ACTION: action,
    },
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}

console.log('log-writes.test.mjs');
const root = makeSandbox('log-writes');
const offDir = path.join(root, 'off');
const onDir = path.join(root, 'on');
const outputDir = path.join(root, 'output');
fs.mkdirSync(outputDir);
fixture(offDir);
fixture(onDir);
fs.writeFileSync(path.join(onDir, 'event-store.json'), '{"writes":"on"}\n');

let store = openEventStore(path.join(onDir, 'trajecktory.db'));
const imported = importDataFolder(store, {
  dataDir: onDir,
  outputDir,
  ownerName: 'Example Person',
  definitionsVersion: 'v1',
  importedOn: '2030-03-01',
});
check(imported.texts['applications.md'] === fs.readFileSync(path.join(onDir, 'applications.md'), 'utf8')
  && imported.texts['status-events.tsv'] === fs.readFileSync(path.join(onDir, 'status-events.tsv'), 'utf8')
  && imported.texts['apply-dates.json'] === fs.readFileSync(path.join(onDir, 'apply-dates.json'), 'utf8'),
'importDataFolder returns exact tracker, status, and apply-date source text');
check(imported.reports.trackerComparison.match
  && imported.reports.statusComparison.match
  && imported.reports.applyComparison.match
  && renderLegacyFile(store, 'applications.md') === imported.texts['applications.md'],
'shared import preserves the dry-run MATCH and byte checks');
store.close();

const offSteps = runChild(offDir);
const onSteps = runChild(onDir);
check(offSteps.length === onSteps.length
  && offSteps.every((step, index) => JSON.stringify(step) === JSON.stringify(onSteps[index])),
'switch-on files are byte-identical to switch-off files after every writer step');
check(onSteps.every(step => step.pipeline === '- [ ] https://example.test/seed\n'),
'application log writes do not change pipeline.md');

store = openEventStore(path.join(onDir, 'trajecktory.db'));
const dashboardEvents = readEvents(store).filter(event => event.source === 'dashboard');
const eventCounts = dashboardEvents.reduce((counts, event) => {
  counts[event.type] = (counts[event.type] || 0) + 1;
  return counts;
}, {});
check(eventCounts.status_changed === 5
  && eventCounts.application_submitted === 2
  && eventCounts.legacy_record === 2
  && dashboardEvents.length === 9,
'database contains the expected semantic events');
check(dashboardEvents.filter(event => ['status_changed', 'application_submitted'].includes(event.type))
  .every(event => event.application_id),
'semantic application events carry application_id');
check(dashboardEvents.filter(event => event.type === 'legacy_record')
  .map(event => event.payload.reason).join(',') === 'tracker_row_updated,tracker_row_removed',
'legacy tracker events record both required reasons');
check(store.db.prepare('SELECT COUNT(*) AS n FROM legacy_render_state WHERE dirty > 0').get().n === 0,
'successful writes leave no dirty legacy files');
store.close();

const rollbackDir = path.join(root, 'rollback');
fixture(rollbackDir);
fs.writeFileSync(path.join(rollbackDir, 'event-store.json'), '{"writes":"on"}\n');
store = openEventStore(path.join(rollbackDir, 'trajecktory.db'));
importDataFolder(store, {
  dataDir: rollbackDir, outputDir, ownerName: 'Example Person', definitionsVersion: 'v1', importedOn: '2030-03-01',
});
store.close();
const rollback = runChild(rollbackDir, 'rollback');
check(rollback.status === 500
  && JSON.stringify(rollback.before) === JSON.stringify(rollback.after)
  && rollback.beforeCount === rollback.afterCount,
'PATCH rolls back tracker, status row, apply date, and events when apply-date saving throws');

const renderRouteDir = path.join(root, 'render-route');
fixture(renderRouteDir);
fs.writeFileSync(path.join(renderRouteDir, 'event-store.json'), '{"writes":"on"}\n');
store = openEventStore(path.join(renderRouteDir, 'trajecktory.db'));
importDataFolder(store, {
  dataDir: renderRouteDir, outputDir, ownerName: 'Example Person', definitionsVersion: 'v1', importedOn: '2030-03-01',
});
store.close();
const renderRoute = runChild(renderRouteDir, 'render-route');
check(renderRoute.status === 200 && renderRoute.body.render_pending === true
  && /files could not be updated/.test(renderRoute.body.message)
  && renderRoute.warnings.length === 1,
'PATCH reports a committed RENDER_FAILED change as 200 with render_pending and one warning');

const missingDir = path.join(root, 'missing-db');
fixture(missingDir);
fs.writeFileSync(path.join(missingDir, 'event-store.json'), '{"writes":"on"}\n');
resetLogWritesCache();
const beforeMissing = fs.readFileSync(path.join(missingDir, 'applications.md'), 'utf8');
let missingError;
try { withLogWrite(missingDir, () => {}); } catch (error) { missingError = error; }
check(/switched on.*trajecktory\.db.*missing/i.test(missingError?.message)
  && fs.readFileSync(path.join(missingDir, 'applications.md'), 'utf8') === beforeMissing,
'switch on without trajecktory.db throws and changes no file');

const failureDir = path.join(root, 'render-failure');
fixture(failureDir);
fs.writeFileSync(path.join(failureDir, 'event-store.json'), '{"writes":"on"}\n');
store = openEventStore(path.join(failureDir, 'trajecktory.db'));
importDataFolder(store, {
  dataDir: failureDir, outputDir, ownerName: 'Example Person', definitionsVersion: 'v1', importedOn: '2030-03-01',
});
store.close();
resetLogWritesCache();
setLogWritesTestHooks({ writeFile: () => { throw new Error('invented render failure'); } });
let renderError;
try {
  withLogWrite(failureDir, active => appendEventsWithEffects(active, [{
    type: 'legacy_record', occurred_on: '2030-03-08', source: 'dashboard', definitions_version: 'v1',
    payload: {
      reason: 'tracker_row_updated', num: 900001, company: 'Zorblax Widgetry',
      legacy_effects: [{
        file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#4',
        raw: '| 900001 | 2030-03-01 | Zorblax Widgetry | Example Cog Lead | 0.01/5 | Interested | — | — |  | Render retry | https://example.test/900001 |',
      }],
    },
  }]));
} catch (error) { renderError = error; }
check(renderError?.code === 'RENDER_FAILED' && renderError.message.includes('applications.md'),
'render failure reports RENDER_FAILED with file names');
check(openDataStore(failureDir).db.prepare('SELECT dirty FROM legacy_render_state WHERE file = ?').get('applications.md').dirty > 0,
'render failure commits the event and keeps the file dirty');
setLogWritesTestHooks();
withLogWrite(failureDir, () => true);
check(fs.readFileSync(path.join(failureDir, 'applications.md'), 'utf8').includes('Render retry')
  && openDataStore(failureDir).db.prepare('SELECT dirty FROM legacy_render_state WHERE file = ?').get('applications.md').dirty === 0,
'the next successful write renders the previously dirty file');

withLogWrite(failureDir, active => appendEventsWithEffects(active, [{
  type: 'legacy_record', occurred_on: '2030-03-09', source: 'dashboard', definitions_version: 'v1',
  payload: {
    reason: 'tracker_row_updated', num: 900001, company: 'Zorblax Widgetry',
    legacy_effects: [{
      file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#4',
      raw: '| 900001 | 2030-03-01 | Zorblax Widgetry | Example Cog Lead | 0.01/5 | Interested | — | — |  | Startup retry | https://example.test/900001 |',
    }],
  },
}]));
openDataStore(failureDir).db.prepare('UPDATE legacy_render_state SET dirty = 1 WHERE file = ?').run('applications.md');
fs.writeFileSync(path.join(failureDir, 'applications.md'), beforeMissing);
const startup = catchUpEventStore(failureDir);
check(startup.rendered.includes('applications.md')
  && fs.readFileSync(path.join(failureDir, 'applications.md'), 'utf8').includes('Startup retry'),
'startup catch-up renders a dirty projected file');

resetLogWritesCache();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
