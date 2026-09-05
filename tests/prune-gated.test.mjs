#!/usr/bin/env node
/**
 * Regression coverage for deletion safety in prune-gated.mjs.
 *
 * Every invocation runs from a repo-local sandbox. The script and all imported
 * modules are copied there, so this suite cannot read or write the real data
 * directory.
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox } from './helpers/sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DAY_MS = 86400000;

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('prune-gated.test.mjs');

const dated = (daysAgo) => new Date(Date.now() - daysAgo * DAY_MS)
  .toISOString().slice(0, 10);
const pipeline = (rows, eol = '\n') => ['# Pipeline', '', ...rows, ''].join(eol);
const gateHistory = (rows) => [
  'date\turl\tcompany\trole\tresult\treason',
  ...rows.map(([date, url]) => `${date}\t${url}\tExample\tRole\texpired\tclosed`),
  '',
].join('\n');

function runCase({ text, gateRows, scanText, args = [], histories = true }) {
  const sandbox = makeRepoSandbox(ROOT, 'prune-gated-test');
  const dataDir = join(sandbox, 'data');
  const libDir = join(sandbox, 'lib');
  const pipelinePath = join(dataDir, 'pipeline.md');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(libDir, { recursive: true });
  copyFileSync(join(ROOT, 'prune-gated.mjs'), join(sandbox, 'prune-gated.mjs'));
  for (const module of ['identity.mjs', 'pipeline.mjs', 'tracker.mjs']) {
    copyFileSync(join(ROOT, 'lib', module), join(libDir, module));
  }
  writeFileSync(pipelinePath, text, 'utf8');
  if (histories) {
    if (gateRows !== undefined) {
      writeFileSync(join(dataDir, 'gate-history.tsv'), gateHistory(gateRows), 'utf8');
    }
    if (scanText !== undefined) {
      writeFileSync(join(dataDir, 'scan-history.tsv'), scanText, 'utf8');
    }
  }

  const before = readFileSync(pipelinePath);
  const result = spawnSync(process.execPath, [join(sandbox, 'prune-gated.mjs'), ...args], {
    cwd: sandbox,
    encoding: 'utf8',
  });
  const after = readFileSync(pipelinePath);
  return {
    before,
    after,
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

const APPLY = '--apply';
const PRUNE_UNDATED = '--prune-undated';
const DAYS = '--days';
const OLD = dated(60);
const NEW = dated(1);
const fallbackHistory = [[OLD, 'https://jobs.example/history-only']];

{
  const url = 'https://jobs.example/undated';
  const row = `- [!] ${url} | Example | Undated`;
  const r = runCase({ text: pipeline([row]), gateRows: fallbackHistory, args: [APPLY] });
  check(r.code === 0 && r.after.toString('utf8').includes(row),
    'default apply keeps an undated gated row');
}

{
  const url = 'https://jobs.example/bad-date';
  const row = `- [!] ${url} | Example | Bad date`;
  const r = runCase({ text: pipeline([row]), gateRows: [['not-a-date', url]], args: [APPLY] });
  check(r.code === 0 && r.after.toString('utf8').includes(row),
    'default apply keeps a gated row with an unparseable date');
}

{
  const url = 'https://jobs.example/old';
  const row = `- [!] ${url} | Example | Old`;
  const r = runCase({ text: pipeline([row]), gateRows: [[OLD, url]], args: [APPLY] });
  check(r.code === 0 && !r.after.toString('utf8').includes(row),
    'default apply removes a gated row older than the cutoff');
}

{
  const url = 'https://jobs.example/new';
  const row = `- [!] ${url} | Example | New`;
  const r = runCase({ text: pipeline([row]), gateRows: [[NEW, url]], args: [APPLY] });
  check(r.code === 0 && r.after.toString('utf8').includes(row),
    'default apply keeps a gated row newer than the cutoff');
}

{
  const oldUrl = 'https://jobs.example/remove-for-write';
  const open = '- [ ] https://jobs.example/open | Open Company | Open Role';
  const done = '- [x] https://jobs.example/done | Done Company | Done Role';
  const r = runCase({
    text: pipeline([open, `- [!] ${oldUrl} | Example | Old`, done]),
    gateRows: [[OLD, oldUrl]],
    args: [APPLY],
  });
  const after = r.after.toString('utf8');
  check(r.code === 0 && after.includes(open) && after.includes(done),
    'open and done rows remain byte-identical after apply');
}

{
  const oldUrl = 'https://jobs.example/crlf-old';
  const newUrl = 'https://jobs.example/crlf-new';
  const r = runCase({
    text: pipeline([
      `- [!] ${oldUrl} | Example | Old`,
      `- [!] ${newUrl} | Example | New`,
    ], '\r\n'),
    gateRows: [[OLD, oldUrl], [NEW, newUrl]],
    args: [APPLY],
  });
  const after = r.after.toString('utf8');
  check(r.code === 0 && after.includes('\r\n') && !/(^|[^\r])\n/.test(after),
    'CRLF endings survive apply with no lone LF introduced');
}

{
  const undatedUrl = 'https://jobs.example/prune-undated';
  const badUrl = 'https://jobs.example/prune-bad-date';
  const r = runCase({
    text: pipeline([
      `- [!] ${undatedUrl} | Example | Undated`,
      `- [!] ${badUrl} | Example | Bad date`,
    ]),
    gateRows: [['not-a-date', badUrl], ...fallbackHistory],
    args: [PRUNE_UNDATED, APPLY],
  });
  const after = r.after.toString('utf8');
  check(r.code === 0 && !after.includes(undatedUrl) && !after.includes(badUrl),
    'prune undated removes both undated and bad-date gated rows');
}

{
  const row = '- [!] https://jobs.example/no-history | Example | No history';
  const r = runCase({ text: pipeline([row]), histories: false, args: [APPLY] });
  check(r.code !== 0 && r.after.equals(r.before),
    'missing history files produce a nonzero exit and no pipeline write');
}

{
  const row = '- [!] https://jobs.example/bad-days | Example | Bad days';
  const r = runCase({
    text: pipeline([row]),
    gateRows: fallbackHistory,
    args: [DAYS, 'abc', APPLY],
  });
  check(r.code !== 0, 'a nonnumeric days value produces a nonzero exit');
}

{
  const url = 'https://jobs.example/today';
  const row = `- [!] ${url} | Example | Today`;
  const r = runCase({
    text: pipeline([row]),
    gateRows: [[dated(0), url]],
    args: [DAYS, '0', APPLY],
  });
  check(r.code === 0 && !r.after.toString('utf8').includes(row) && /\(0 days ago\)/.test(r.stdout),
    'days zero is honored instead of falling back to thirty');
}

{
  const url = 'https://jobs.example/dry-run';
  const row = `- [!] ${url} | Example | Dry run`;
  const r = runCase({ text: pipeline([row]), gateRows: [[OLD, url]] });
  check(r.code === 0 && r.after.equals(r.before),
    'a dry run leaves pipeline bytes unchanged');
}

{
  const first = 'https://jobs.example/printed-one';
  const second = 'https://jobs.example/printed-two';
  const r = runCase({
    text: pipeline([
      `- [!] ${first} | Example | First`,
      `- [!] ${second} | Example | Second`,
    ]),
    gateRows: [[OLD, first], [OLD, second]],
    args: [APPLY],
  });
  const writeAt = r.stdout.indexOf('Written:');
  const firstAt = r.stdout.indexOf(first);
  const secondAt = r.stdout.indexOf(second);
  // indexOf returns -1 for a URL that was never printed, and -1 is less than
  // writeAt, so the ordering check alone passes when the audit line is gone.
  const bothNamed = firstAt >= 0 && secondAt >= 0;
  check(r.code === 0 && bothNamed && writeAt > firstAt && writeAt > secondAt,
    'stdout names every removed row before the write');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
