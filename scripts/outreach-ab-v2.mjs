#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

await import('../dashboard-web/server/config.mjs');

function fail(message) {
  throw new Error(message);
}

export function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  if (!['sample', 'generate', 'panel', 'record', 'score'].includes(command)) fail('Expected subcommand: sample, generate, panel, record, or score');
  const options = { command, seed: 1, concurrency: 2, force: false };
  while (args.length) {
    const flag = args.shift();
    if (flag === '--force') {
      options.force = true;
      continue;
    }
    const value = args.shift();
    if (value === undefined) fail(`${flag} requires a value`);
    if (flag === '--seed') options.seed = Number(value);
    else if (flag === '--run') options.run = value;
    else if (flag === '--tranche') options.tranche = Number(value);
    else if (flag === '--concurrency') options.concurrency = Number(value);
    else if (flag === '--line-file') options.lineFile = value;
    else if (flag === '--exclude') options.exclude = value;
    else fail(`Unknown option: ${flag}`);
  }
  if (!Number.isFinite(options.seed)) fail('--seed must be numeric');
  if (command !== 'sample' && !options.run) fail(`${command} requires --run DIR`);
  if (['generate', 'panel', 'record'].includes(command) && ![1, 2, 3].includes(options.tranche)) fail(`${command} requires --tranche 1, 2, or 3`);
  if (command === 'record' && !options.lineFile) fail('record requires --line-file F');
  return options;
}

async function run(options) {
  if (options.command === 'sample') {
    const { writeSample } = await import('./outreach-ab-v2/sample.mjs');
    const result = writeSample({ seed: options.seed, runDir: options.run, excludeFile: options.exclude });
    process.stdout.write(`Wrote ${result.cases.length} cases to ${result.runDir}\n`);
    return;
  }
  if (options.command === 'generate') {
    const { generateTranche } = await import('./outreach-ab-v2/generate.mjs');
    const result = await generateTranche({
      runDir: options.run,
      tranche: options.tranche,
      concurrency: options.concurrency,
      force: options.force,
      onCleared: message => process.stdout.write(`${message}\n`),
    });
    process.stdout.write(`Generated tranche ${result.tranche}: ${result.cases.length} cases in ${result.dir}\n`);
    return;
  }
  if (options.command === 'panel') {
    const { renderPanel, buildPanelKey } = await import('./outreach-ab-v2/panel.mjs');
    const dir = path.resolve(options.run);
    const trancheDir = path.join(dir, `tranche-${options.tranche}`);
    const cases = JSON.parse(fs.readFileSync(path.join(trancheDir, 'drafts.json'), 'utf8'));
    const keyFile = path.join(dir, 'key.json');
    const allKey = fs.existsSync(keyFile) ? JSON.parse(fs.readFileSync(keyFile, 'utf8')) : {};
    const seed = JSON.parse(fs.readFileSync(path.join(dir, 'mix.json'), 'utf8')).seed ?? 1;
    const needed = buildPanelKey(cases, seed);
    const key = Object.fromEntries(cases.map(item => {
      const number = String(item.number).padStart(2, '0');
      return [number, allKey[number] || needed[number]];
    }));
    fs.writeFileSync(keyFile, JSON.stringify({ ...allKey, ...key }, null, 2) + '\n', 'utf8');
    const target = path.join(trancheDir, 'panel.html');
    fs.writeFileSync(target, renderPanel({ cases, key, seed }), 'utf8');
    process.stdout.write(`Wrote ${target}\n`);
    return;
  }
  if (options.command === 'record') {
    const { recordAnswers } = await import('./outreach-ab-v2/score.mjs');
    const result = recordAnswers({ runDir: options.run, tranche: options.tranche, lineFile: options.lineFile, force: options.force });
    process.stdout.write(`Wrote ${Object.keys(result.picks).length} case ratings to ${result.target}\n`);
    return;
  }
  const { scoreRun } = await import('./outreach-ab-v2/score.mjs');
  const { markdown } = scoreRun(options.run);
  process.stdout.write(markdown);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    await run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`outreach-ab-v2: ${error.message}`);
    process.exitCode = 1;
  }
}
