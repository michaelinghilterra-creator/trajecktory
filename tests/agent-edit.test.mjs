#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from './helpers/sandbox.mjs';
import { openEventStore, readEvents } from '../lib/event-store.mjs';
import { importDataFolder } from '../lib/import/import-data-folder.mjs';
import { TRACKER_HEADER, TRACKER_SEPARATOR, formatTrackerLine } from '../lib/tracker.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed += 1; }
  else { console.log(`  FAIL ${message}`); failed += 1; }
};

const baseRow = formatTrackerLine({ num: 900001, date: '2030-05-01', company: 'Zorblax Widgetry', role: 'Example Cog Lead', score: '0.11/5', status: 'Evaluated', pdf: '❌', resume: null, report: '—', notes: 'Invented base note', url: 'https://example.test/900001' });
const tracker = ['# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, baseRow, ''].join('\n');
const followups = ['# Follow-Ups', '', '| # | app# | date | company | role | channel | contact | notes |', '|---|------|------|---------|------|---------|---------|-------|', '| 4 | 900001 | 2030-05-01 | Zorblax Widgetry | Example Cog Lead | Email | Example Personone | Invented earlier note |', ''].join('\n');

function setup(name, on) {
  const dataDir = makeSandbox(`${name}-${on ? 'on' : 'off'}`);
  fs.writeFileSync(path.join(dataDir, 'applications.md'), tracker);
  fs.writeFileSync(path.join(dataDir, 'status-events.tsv'), 'app#\tdate\tstatus\tcompany\tlogged\n');
  fs.writeFileSync(path.join(dataDir, 'follow-ups.md'), followups);
  if (on) {
    fs.writeFileSync(path.join(dataDir, 'event-store.json'), '{"writes":"on"}\n');
    const store = openEventStore(path.join(dataDir, 'trajecktory.db'));
    importDataFolder(store, { dataDir, outputDir: makeSandbox(`${name}-output`), ownerName: 'Example Personone', definitionsVersion: 'v1', importedOn: '2030-05-01' });
    store.close();
  }
  return dataDir;
}

function run(dataDir, args) {
  return spawnSync(process.execPath, [path.join(ROOT, 'agent-edit.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, TJK_DATA_DIR: dataDir, TZ: 'UTC' } });
}

function compare(name, args, files = ['applications.md', 'status-events.tsv']) {
  const off = setup(name, false);
  const on = setup(name, true);
  const a = run(off, args);
  const b = run(on, args);
  const same = files.every(file => Buffer.compare(fs.readFileSync(path.join(off, file)), fs.readFileSync(path.join(on, file))) === 0);
  check(a.status === 0 && b.status === 0 && same, `${name} matches in both switch modes`);
  return { off, on, a, b };
}

console.log('agent-edit.test.mjs');
compare('status change', ['application', '--id', '900001', '--status', 'Applied', '--event-date', '2030-05-02']);
compare('role change', ['application', '--id', '900001', '--role', 'Example Gear Director']);
compare('note replace', ['application', '--id', '900001', '--note', 'Invented replacement note']);
const appended = compare('note append', ['application', '--id', '900001', '--append-note', 'Invented appended note']);
check(fs.readFileSync(path.join(appended.on, 'applications.md'), 'utf8').includes('Invented base note. Invented appended note'), 'append-note uses the required separator');

{
  const dataDir = setup('missing', false);
  const result = run(dataDir, ['application', '--id', '900099', '--status', 'Applied']);
  check(result.status === 1 && /not found/i.test(`${result.stdout}${result.stderr}`), 'missing application exits 1 with a plain message');
}
{
  const dataDir = setup('unknown', false);
  const result = run(dataDir, ['application', '--id', '900001', '--mystery', 'x']);
  check(result.status === 1 && /Unknown argument: --mystery/.test(result.stderr), 'unknown flag exits 1 with a clear message');
}

const followup = compare('follow-up append', ['followup', '--app', '900001', '--date', '2030-05-03', '--company', 'Quennox Ratchet Works', '--role', 'Example Gear Director', '--channel', 'Email', '--contact', 'Example Personone', '--note', 'Invented sent note', '--json'], ['follow-ups.md']);
check(JSON.parse(followup.b.stdout).n === 5, 'follow-up prints the assigned next number');

const store = openEventStore(path.join(followup.on, 'trajecktory.db'));
const semantic = readEvents(store).filter(event => event.source === 'dashboard').map(event => {
  const payload = { ...event.payload };
  delete payload.legacy_effects;
  return JSON.stringify(payload);
});
store.close();
check(semantic.every(text => !/Quennox Ratchet Works|Example Personone|Invented sent note|follow-ups\.md/.test(text)), 'agent edit semantic payloads contain no free text or file path');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
