#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clearClosedFromNeedsManual } from './lib/needs-manual.mjs';
import { probePostingGone } from './lib/ats-gone.mjs';

const SCRIPT_ROOT = dirname(fileURLToPath(import.meta.url));

function usage() {
  return 'usage: node clear-closed-manual.mjs [--apply] [--root <dir>] [--json]';
}

function parseArgs(argv) {
  let root = SCRIPT_ROOT;
  let apply = false;
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--apply') apply = true;
    else if (arg === '--json') json = true;
    else if (arg === '--root' && argv[index + 1] && !argv[index + 1].startsWith('--')) root = resolve(argv[++index]);
    else return null;
  }
  return { root, apply, json };
}

function timestamp(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function readRows(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').slice(1).map((line) => {
    const cells = line.replace(/\r$/, '').split('\t');
    return { url: String(cells[0] || '').trim(), company: String(cells[1] || '').trim(), role: String(cells[2] || '').trim() };
  }).filter((row) => /^https?:\/\//.test(row.url));
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (!options) {
    process.stderr.write(usage() + '\n');
    return 2;
  }

  const needsManualPath = join(options.root, 'data', 'needs-manual-jd.tsv');
  const pipelinePath = join(options.root, 'data', 'pipeline.md');
  const gateHistoryPath = join(options.root, 'data', 'gate-history.tsv');
  const rows = readRows(needsManualPath);

  if (options.apply) {
    const suffix = `.bak-clear-closed-${timestamp()}`;
    if (existsSync(needsManualPath)) copyFileSync(needsManualPath, needsManualPath + suffix);
    if (existsSync(pipelinePath)) copyFileSync(pipelinePath, pipelinePath + suffix);
  }

  const observed = new Map();
  const result = await clearClosedFromNeedsManual({
    needsManualPath,
    pipelinePath,
    gateHistoryPath,
    apply: options.apply,
    probe: async (url) => {
      const verdict = await probePostingGone(url);
      observed.set(url, verdict);
      return verdict;
    },
  });

  const details = rows.map((row) => {
    const probe = observed.get(row.url) || { verdict: 'unknown', reason: 'not checked' };
    return { status: probe.verdict === 'gone' ? 'CLOSED' : (probe.verdict === 'live' ? 'keep' : 'unknown'), ...row, reason: probe.reason };
  });
  if (options.json) {
    console.log(JSON.stringify({ dryRun: !options.apply, ...result, rows: details }, null, 2));
  } else {
    if (!options.apply) console.log('DRY RUN: no files will be changed.');
    for (const row of details) console.log([row.status, row.company, row.role, row.reason].join('\t'));
    console.log(`${result.checked} checked, ${result.closed.length} closed, ${result.kept} kept, ${result.unknown} unknown`);
  }
  if (result.error) {
    process.stderr.write(`clear-closed-manual: ${result.error.message || result.error}\n`);
    return 1;
  }
  return 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) process.exitCode = await main();
