#!/usr/bin/env node

import net from 'node:net';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dashboardPorts, findOtherWriters } from '../lib/event-store-writers.mjs';
import { TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { runEventStore } from '../scripts/event-store.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  PASS ${msg}`); passed++; }
  else { console.log(`  FAIL ${msg}`); failed++; }
}

console.log('event-store-writers.test.mjs');

// dashboardPorts
check(dashboardPorts({}).join() === '3000,3001,3333,5173,8080', 'the default dashboard ports are listed in order');
{
  const ports = dashboardPorts({ PORT: '4100' });
  check(ports.includes(4100) && ports.join() === [...ports].sort((a, b) => a - b).join() && ports.length === 6, 'a configured PORT is added and the list stays sorted');
}
for (const bad of ['abc', '0', '70000', '', '12.5', '-1']) {
  check(dashboardPorts({ PORT: bad }).length === 5, `PORT "${bad}" adds nothing`);
}
check(dashboardPorts({ PORT: '3333' }).length === 5, 'a PORT that is already listed is not duplicated');
check(dashboardPorts({ PORT: '65535' }).includes(65535) && dashboardPorts({ PORT: '1' }).includes(1), 'the ends of the valid port range are accepted');

// findOtherWriters with a stand-in for the child process
{
  const seen = [];
  const spawn = (command, args, options) => {
    seen.push({ command, args, options });
    return { status: args[3] === '3333' ? 0 : 1 };
  };
  const found = findOtherWriters({ ports: [3000, 3333], spawn });
  check(JSON.stringify(found) === JSON.stringify(['something is accepting connections on 127.0.0.1:3333']), 'only the port that accepted a connection is reported, in the exact wording');
  check(seen.length === 2 && seen[0].command === process.execPath && seen[0].args[0] === '-e', 'each port is tried once with the current Node');
  check(seen[0].args[2] === '127.0.0.1' && seen[0].args[3] === '3000' && seen[0].args[4] === '500', 'the host, port and timeout are passed to the probe');
  check(seen[0].options.timeout === 2500, 'the child process itself has a timeout');
  check(findOtherWriters({ ports: [3000], host: '10.0.0.9', timeoutMs: 40, spawn }).length === 0 && seen[2].args[2] === '10.0.0.9' && seen[2].args[4] === '40', 'host and timeout can be changed');
}
check(findOtherWriters({ ports: [1, 2, 3], spawn: () => ({ status: 1 }) }).length === 0, 'no open port gives an empty list');
check(findOtherWriters({ ports: [1], spawn: () => ({ status: null, error: new Error('spawn failed') }) }).length === 0, 'a probe that could not run counts as closed');
check(findOtherWriters({ ports: [1, 2], spawn: () => ({ status: 0 }) }).length === 2, 'every open port is reported');

// The real probe against a real listening socket
async function realProbe() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  // The probe runs in a child process, so give the parent event loop room to accept the connection.
  const open = await new Promise(resolve => setImmediate(() => resolve(findOtherWriters({ ports: [port] }))));
  check(open.length === 1 && open[0].endsWith(`127.0.0.1:${port}`), 'a real listening port is found');
  await new Promise(resolve => server.close(resolve));
  check(findOtherWriters({ ports: [port] }).length === 0, 'the same port is clear after the listener closes');
}

// Through runEventStore
const root = makeSandbox('event-store-writers');
function fixture(name) {
  const base = join(root, name);
  const dataDir = join(base, 'input');
  const outputDir = join(base, 'generated');
  const backupsDir = join(base, 'saved-copies');
  for (const dir of [dataDir, outputDir, backupsDir]) mkdirSync(dir, { recursive: true });
  const row = '| 900001 | 2030-03-01 | Zorblax Widgetry | Example Cog Lead | 0.11/5 | Evaluated | no | example.docx | [900001](https://example.test/r/900001) | Invented fixture | https://example.test/jobs/900001 |';
  writeFileSync(join(dataDir, 'applications.md'), ['# Invented Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, row, ''].join('\n'), 'utf8');
  writeFileSync(join(dataDir, 'apply-dates.json'), '{\n  "900001": "2030-03-02"\n}\n', 'utf8');
  mkdirSync(join(dataDir, 'target-talent-correspondence'));
  writeFileSync(join(dataDir, 'target-talent-correspondence', '900001.md'), '# Example Personone\n\nInvented message for Zorblax Widgetry.\n', 'utf8');
  return { dataDir, outputDir, backupsDir };
}
function run(item, argv, extra) {
  const stdout = [];
  const stderr = [];
  const previous = process.env.TJK_DATA_DIR;
  process.env.TJK_DATA_DIR = item.dataDir;
  let code;
  try {
    code = runEventStore(argv, {
      backupsDir: item.backupsDir,
      getOwnerName: () => 'Example Personone',
      now: () => new Date('2030-03-04T05:06:07.000Z'),
      isProcessAlive: () => false,
      io: { log: value => stdout.push(String(value)), error: value => stderr.push(String(value)) },
      ...extra,
    });
  } finally {
    if (previous === undefined) delete process.env.TJK_DATA_DIR;
    else process.env.TJK_DATA_DIR = previous;
  }
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}
const busy = () => ['something is accepting connections on 127.0.0.1:3333'];
const flipArgs = item => ['flip', '--apply', '--no-other-writers', '--data-dir', item.dataDir, '--output-dir', item.outputDir];

{
  const item = fixture('flip-refused');
  const result = run(item, flipArgs(item), { findOtherWriters: busy });
  check(result.code === 1 && result.stderr.includes('Refusing to flip') && result.stderr.includes('127.0.0.1:3333') && result.stderr.includes('terminal'), 'flip refuses when something is listening, names it, and says scripts are not detected');
  check(!existsSync(join(item.dataDir, 'trajecktory.db')) && !existsSync(join(item.dataDir, 'event-store.json')), 'a refused flip creates no database and no switch');
  check(readdirSync(item.backupsDir).length === 0 && !existsSync(join(item.dataDir, '.event-store-operation.lock')), 'and no backup and no lock file');
}
{
  const item = fixture('rollback-refused');
  const result = run(item, ['rollback', '--apply', '--no-other-writers'], { findOtherWriters: busy });
  check(result.code === 1 && result.stderr.includes('Refusing to roll back') && result.stderr.includes('3333'), 'rollback refuses the same way');
  check(!existsSync(join(item.dataDir, '.event-store-operation.lock')), 'and takes no lock');
}
{
  const item = fixture('flip-clear');
  const result = run(item, flipArgs(item), { findOtherWriters: () => [] });
  check(result.code === 0 && existsSync(join(item.dataDir, 'trajecktory.db')), 'a clean flip goes ahead when nothing is listening');
}
{
  const item = fixture('dry-run');
  const result = run(item, ['flip', '--data-dir', item.dataDir, '--output-dir', item.outputDir], { findOtherWriters: () => { throw new Error('the dry run must not probe'); } });
  check(result.code === 0, 'the dry run never probes for other writers');
}
{
  const item = fixture('rollback-dry-run');
  const result = run(item, ['rollback'], { findOtherWriters: () => { throw new Error('the dry run must not probe'); } });
  check(result.code === 0, 'the rollback dry run never probes for other writers');
}
{
  const item = fixture('missing-flag');
  const result = run(item, ['flip', '--apply', '--data-dir', item.dataDir, '--output-dir', item.outputDir], { findOtherWriters: () => { throw new Error('the flag check comes first'); } });
  check(result.code === 1 && result.stderr.includes('without --no-other-writers'), 'the missing flag is still refused before any probe');
}

await realProbe();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
