#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openEventStore, readEvents } from '../lib/event-store.mjs';
import { appendEventsWithEffects, recordJsonSnapshots } from '../lib/legacy-files.mjs';
import {
  openDataStore, renderPendingResponse, resetLogWritesCache, setLogWritesTestHooks, withLogWrite,
} from '../lib/log-writes.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  PASS ${message}`);
    passed++;
  } else {
    console.log(`  FAIL ${message}`);
    failed++;
  }
}

const root = makeSandbox('hand-edit-guard');
const importedOn = '2030-09-17';
const definitionsVersion = 'fixture-v1';

function setup(name, texts) {
  const dataDir = path.join(root, name);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'event-store.json'), '{"writes":"on"}\n');
  const store = openEventStore(path.join(dataDir, 'trajecktory.db'));
  recordJsonSnapshots(store, { texts, definitionsVersion, importedOn });
  store.close();
  return dataDir;
}

function event(effects, suffix) {
  return {
    type: 'legacy_record',
    occurred_on: '2030-09-17',
    source: 'cli',
    definitions_version: definitionsVersion,
    dedupe_key: `hand-edit-guard-${suffix}`,
    payload: { reason: 'fixture_guard_write', legacy_effects: effects },
  };
}

function save(dataDir, effects, suffix) {
  return withLogWrite(dataDir, store => appendEventsWithEffects(store, [event(effects, suffix)]));
}

function eventCount(dataDir) {
  return readEvents(openDataStore(dataDir)).length;
}

async function request(router, method, url) {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, { method });
  const body = await response.json();
  await new Promise(resolve => server.close(resolve));
  return { status: response.status, body };
}

if (process.env.TJK_HAND_EDIT_WORKER === 'stale-route') {
  const applications = '# Applications Tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n| 900001 | 2020-09-01 | Zorblax Widgetry | Example Cog Lead | 4/5 | Applied |  |  |  | Invented app note | https://example.test/jobs/900001 |\n';
  const targetTalent = '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---------|------|-------|--------|-------|------|-------|-----|-------|-------|----------|--------|------------|-------|---------|\n| 900001 | Zorblax Widgetry | Personone | Example |  | Example Talent Lead |  |  |  |  | example.personone@example.test | linkedin.com/in/example-person-one | Not Contacted |  | Invented note | example.test |\n';
  const correspondence = '## 2020-09-02 | Sent | LinkedIn | LinkedIn connection request\n\nInvented invite body\n';
  const texts = {
    'applications.md': applications,
    'target-talent.md': targetTalent,
    'target-talent-correspondence/900001.md': correspondence,
    'tt-linkedin.json': '{}\n',
  };
  const dataDir = process.env.TJK_DATA_DIR;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'event-store.json'), '{"writes":"on"}\n');
  for (const [file, text] of Object.entries(texts)) {
    const target = path.join(dataDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  const outputDir = path.join(dataDir, 'fixture-output');
  fs.mkdirSync(outputDir);
  const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
  const store = openEventStore(path.join(dataDir, 'trajecktory.db'));
  importDataFolder(store, { dataDir, outputDir, ownerName: 'Example Personone', definitionsVersion, importedOn });
  store.close();
  save(dataDir, [{ file: 'tt-linkedin.json', op: 'json_set', key: 'unrelated', value: true }], 'stale-baseline');
  const linkedInFile = path.join(dataDir, 'tt-linkedin.json');
  fs.writeFileSync(linkedInFile, '{}\n');
  const beforeText = fs.readFileSync(linkedInFile, 'utf8');
  const beforeCount = eventCount(dataDir);
  const { router } = await import('../dashboard-web/server/routes/followups.mjs');
  const response = await request(router, 'GET', '/api/followups/stale');
  process.stdout.write(`${JSON.stringify({
    response,
    beforeText,
    afterText: fs.readFileSync(linkedInFile, 'utf8'),
    beforeCount,
    afterCount: eventCount(dataDir),
  })}\n`);
  process.exit(0);
}

console.log('hand-edit-guard.test.mjs');

{
  const dataDir = setup('refusal', { 'apply-dates.json': '{}\n' });
  save(dataDir, [{ file: 'apply-dates.json', op: 'json_set', key: '900001', value: '2030-09-17' }], 'render');
  const file = path.join(dataDir, 'apply-dates.json');
  fs.writeFileSync(file, '{"edited":true}\n');
  const beforeText = fs.readFileSync(file, 'utf8');
  const beforeCount = eventCount(dataDir);
  let error;
  try {
    save(dataDir, [{ file: 'apply-dates.json', op: 'json_set', key: '900002', value: '2030-09-18' }], 'refuse');
  } catch (caught) {
    error = caught;
  }
  check(error?.code === 'HAND_EDITED' && error.files?.join(',') === 'apply-dates.json',
    'a drifted file raises HAND_EDITED and names the file');
  check(fs.readFileSync(file, 'utf8') === beforeText && eventCount(dataDir) === beforeCount,
    'a refused save writes no file and appends no event');
  let rethrown;
  try { renderPendingResponse(error, 'fixture'); } catch (caught) { rethrown = caught; }
  check(rethrown === error, 'HAND_EDITED is not treated as RENDER_FAILED');
}

{
  const dataDir = setup('no-marker', { 'apply-dates.json': '{}\n' });
  const beforeCount = eventCount(dataDir);
  save(dataDir, [{ file: 'apply-dates.json', op: 'json_set', key: '900001', value: '2030-09-17' }], 'no-marker');
  check(eventCount(dataDir) === beforeCount + 1
    && JSON.parse(fs.readFileSync(path.join(dataDir, 'apply-dates.json'), 'utf8'))['900001'] === '2030-09-17',
  'a missing render marker allows the first write');
}

{
  const dataDir = setup('interrupted-render', {
    'apply-dates.json': '{}\n',
    'contact-links.json': '{"version":1,"pins":{}}\n',
  });
  save(dataDir, [{ file: 'apply-dates.json', op: 'json_set', key: '900001', value: '2030-09-17' }], 'interrupted-baseline');
  setLogWritesTestHooks({
    writeFile: (destination, content) => {
      fs.writeFileSync(destination, content);
      throw new Error('invented interruption after file write');
    },
  });
  let renderError;
  try {
    save(dataDir, [{ file: 'apply-dates.json', op: 'json_set', key: '900002', value: '2030-09-18' }], 'interrupted-write');
  } catch (error) {
    renderError = error;
  } finally {
    setLogWritesTestHooks();
  }
  const beforeCount = eventCount(dataDir);
  let saveError;
  try {
    save(dataDir, [{ file: 'contact-links.json', op: 'json_set', key: 'version', value: 2 }], 'after-interruption');
  } catch (error) {
    saveError = error;
  }
  const dates = JSON.parse(fs.readFileSync(path.join(dataDir, 'apply-dates.json'), 'utf8'));
  check(renderError?.code === 'RENDER_FAILED' && !saveError
    && dates['900002'] === '2030-09-18' && eventCount(dataDir) === beforeCount + 1,
  'an interrupted render whose bytes match the projection does not block the next save');
}

{
  const dataDir = setup('different-file', {
    'apply-dates.json': '{}\n',
    'contact-links.json': '{"version":1,"pins":{}}\n',
  });
  save(dataDir, [{ file: 'apply-dates.json', op: 'json_set', key: '900001', value: '2030-09-17' }], 'different-render');
  fs.writeFileSync(path.join(dataDir, 'apply-dates.json'), '{"edited":true}\n');
  const beforeCount = eventCount(dataDir);
  save(dataDir, [{ file: 'contact-links.json', op: 'json_set', key: 'version', value: 2 }], 'different-save');
  check(eventCount(dataDir) === beforeCount + 1
    && JSON.parse(fs.readFileSync(path.join(dataDir, 'contact-links.json'), 'utf8')).version === 2,
  'a save that rewrites a different file still succeeds');
}

{
  const dataDir = setup('multiple-files', {
    'apply-dates.json': '{}\n',
    'contact-links.json': '{"version":1,"pins":{}}\n',
  });
  save(dataDir, [
    { file: 'apply-dates.json', op: 'json_set', key: '900001', value: '2030-09-17' },
    { file: 'contact-links.json', op: 'json_set', key: 'version', value: 2 },
  ], 'multiple-render');
  const applyFile = path.join(dataDir, 'apply-dates.json');
  const linksFile = path.join(dataDir, 'contact-links.json');
  fs.writeFileSync(applyFile, '{"edited":true}\n');
  const beforeApply = fs.readFileSync(applyFile, 'utf8');
  const beforeLinks = fs.readFileSync(linksFile, 'utf8');
  const beforeCount = eventCount(dataDir);
  let error;
  try {
    save(dataDir, [
      { file: 'apply-dates.json', op: 'json_set', key: '900002', value: '2030-09-18' },
      { file: 'contact-links.json', op: 'json_set', key: 'version', value: 3 },
    ], 'multiple-refuse');
  } catch (caught) {
    error = caught;
  }
  check(error?.code === 'HAND_EDITED'
    && fs.readFileSync(applyFile, 'utf8') === beforeApply
    && fs.readFileSync(linksFile, 'utf8') === beforeLinks
    && eventCount(dataDir) === beforeCount,
  'one drifted file rolls back an entire multiple file save');
}

{
  const script = fileURLToPath(import.meta.url);
  const fixtureProfile = path.join(root, 'missing-profile.yml');
  const fixturePrep = path.join(root, 'interview-prep');
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TJK_HAND_EDIT_WORKER: 'stale-route',
      TJK_DATA_DIR: path.join(root, 'stale-route'),
      TJK_PROFILE_YML: fixtureProfile,
      TJK_INTERVIEW_PREP_DIR: fixturePrep,
    },
  });
  const output = result.stdout.trim().split('\n').at(-1);
  const actual = result.status === 0 && output ? JSON.parse(output) : null;
  check(actual?.response.status === 200
    && [...(actual.response.body.warm || []), ...(actual.response.body.cold || [])].length > 0,
    'stale route returns 200 with the stale list when a projected file drifted');
  check(actual?.response.body.hand_edited?.files?.join(',') === 'tt-linkedin.json',
    'stale route reports the hand edited projected file');
  check(actual?.beforeText === actual?.afterText && actual?.beforeCount === actual?.afterCount,
    'stale route skips the self heal and saves nothing after a hand edit');
}

resetLogWritesCache();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
