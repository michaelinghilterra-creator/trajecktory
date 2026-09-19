import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { createEventStoreRouter, runPreviewProcess } from '../dashboard-web/server/routes/event-store.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const sandbox = makeSandbox('event-store-route');
function dataDirNamed(name) {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'applications.md'), '# Invented tracker\n', 'utf8');
  return dir;
}
function snapshot(dir) {
  return JSON.stringify(readdirSync(dir).sort().map(name => [name, readFileSync(join(dir, name), 'utf8')]));
}

async function serve(options) {
  const app = express();
  app.use(express.json());
  app.use(createEventStoreRouter(options));
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

const report = { command: 'flip', dry_run: true, ok: true, exit_code: 0, events: 12, checks: [{ name: 'Tracker', match: true }], byte_checks: [], messages: [], errors: [], will_add: ['trajecktory.db'], will_not_change: ['Your data files are not rewritten.'] };

// status
{
  const dir = dataDirNamed('status');
  const before = snapshot(dir);
  const app = await serve({ dataDir: dir, runPreview: async () => ({ ok: true, report }) });
  let body = await (await fetch(`${app.base}/api/setup/event-store/status`)).json();
  check(body.switch === 'missing' && body.database_present === false, 'no switch file reads as missing with no database');
  writeFileSync(join(dir, 'event-store.json'), '{"writes":"on","flipped_at":"2030-03-04T05:06:07.000Z"}\n', 'utf8');
  writeFileSync(join(dir, 'trajecktory.db'), 'x', 'utf8');
  body = await (await fetch(`${app.base}/api/setup/event-store/status`)).json();
  check(body.switch === 'on' && body.flipped_at === '2030-03-04T05:06:07.000Z' && body.database_present === true, 'an on switch and a database are reported');
  writeFileSync(join(dir, 'event-store.json'), '{"writes":"off"}\n', 'utf8');
  check((await (await fetch(`${app.base}/api/setup/event-store/status`)).json()).switch === 'off', 'an off switch is reported');
  writeFileSync(join(dir, 'event-store.json'), 'not json', 'utf8');
  check((await (await fetch(`${app.base}/api/setup/event-store/status`)).json()).switch === 'invalid', 'a broken switch file is reported as invalid');
  check(snapshot(dir) !== before, 'the fixture changed only because the test wrote it');
  await app.close();
}

// preview
{
  const dir = dataDirNamed('preview');
  const before = snapshot(dir);
  const calls = [];
  const app = await serve({ dataDir: dir, runPreview: async options => { calls.push(options); return { ok: true, report }; } });
  const response = await fetch(`${app.base}/api/setup/event-store/preview`, { method: 'POST' });
  const body = await response.json();
  check(response.status === 200 && body.ok === true && body.events === 12 && body.checks[0].name === 'Tracker', 'the preview returns the dry run report unchanged');
  check(calls.length === 1 && calls[0].dataDir === dir && calls[0].reimport === false, 'the preview runs against the configured data folder without a re-import when there is no database');
  check(snapshot(dir) === before, 'the preview changes no data file');
  writeFileSync(join(dir, 'trajecktory.db'), 'x', 'utf8');
  await fetch(`${app.base}/api/setup/event-store/preview`, { method: 'POST' });
  check(calls[1].reimport === true, 'an older database means the practice run re-imports from the files');
  writeFileSync(join(dir, 'event-store.json'), '{"writes":"on"}\n', 'utf8');
  await fetch(`${app.base}/api/setup/event-store/preview`, { method: 'POST' });
  check(calls[2].reimport === false, 'with the switch on there is no re-import, so the check reports that it is already on');
  check((await fetch(`${app.base}/api/setup/event-store/preview`)).status === 404, 'the preview is POST only');
  await app.close();
}
{
  const app = await serve({ dataDir: dataDirNamed('failure'), runPreview: async () => ({ ok: false, error: 'The check could not start.' }) });
  const response = await fetch(`${app.base}/api/setup/event-store/preview`, { method: 'POST' });
  check(response.status === 500 && (await response.json()).error === 'The check could not start.', 'a failed run gives a 500 with the reason');
  await app.close();
}
{
  const app = await serve({ dataDir: dataDirNamed('throws'), runPreview: async () => { throw new Error('boom'); } });
  const response = await fetch(`${app.base}/api/setup/event-store/preview`, { method: 'POST' });
  check(response.status === 500 && (await response.json()).error === 'boom', 'a thrown error gives a 500');
  await app.close();
}
{
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const app = await serve({ dataDir: dataDirNamed('busy'), runPreview: async () => { await gate; return { ok: true, report }; } });
  const first = fetch(`${app.base}/api/setup/event-store/preview`, { method: 'POST' });
  await new Promise(resolve => setTimeout(resolve, 50));
  const second = await fetch(`${app.base}/api/setup/event-store/preview`, { method: 'POST' });
  check(second.status === 409, 'a second check while one is running is refused with 409');
  release();
  check((await first).status === 200, 'the first check still finishes');
  const third = await fetch(`${app.base}/api/setup/event-store/preview`, { method: 'POST' });
  check(third.status === 200, 'a new check is allowed once the first has finished');
  await app.close();
}

// the real child process, on an empty folder: it must fail cleanly and touch nothing
{
  const dir = dataDirNamed('real-process');
  const before = snapshot(dir);
  const result = await runPreviewProcess({ dataDir: dir, timeoutMs: 120_000 });
  check(result.ok === true ? result.report.dry_run === true && typeof result.report.ok === 'boolean' : typeof result.error === 'string', 'the real process returns a dry run report or a plain error');
  check(snapshot(dir) === before, 'the real process changes nothing in the data folder');
}
{
  const result = await runPreviewProcess({ dataDir: dataDirNamed('timeout'), timeoutMs: 1 });
  check(result.ok === false && /took too long/.test(result.error), 'a check that runs too long is stopped with a plain message');
}

console.log(`event-store-route: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
