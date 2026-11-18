#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkArgs } from '../lib/cli-args.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(cond, label) {
  if (cond) { console.log(`  PASS ${label}`); passed++; }
  else { console.log(`  FAIL ${label}`); failed++; }
}

console.log('cli-args.test.mjs');

const options = {
  flags: ['--dry-run', '--verbose'],
  valueFlags: ['--company'],
  usage: 'Usage: example',
};
check(checkArgs(['--dry-run', '--company', 'Zorblax Systems'], options).ok === true,
  'known flags and a consumed value are accepted');
check(checkArgs(['--company=Quennox Labs'], options).ok === true,
  'value flags accept the equals form');
check(checkArgs(['--help', '--bad'], options).help === true,
  'help wins without reporting another option');
check(checkArgs(['--bad'], options).unknown?.[0] === '--bad',
  'an unknown flag is reported');
check(checkArgs(['Avery Example'], options).unknown?.[0] === 'Avery Example',
  'positional arguments are rejected by default');
check(checkArgs(['Avery Example'], { ...options, allowPositional: true }).ok === true,
  'positional arguments are accepted when enabled');

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scripts = [
  'scan.mjs',
  'discover.mjs',
  'resolve-jds.mjs',
  'gate-pipeline.mjs',
  'merge-tracker.mjs',
  'normalize-statuses.mjs',
  'prune-history.mjs',
];

for (const script of scripts) {
  const dir = makeSandbox(`cli-args-${script.replace(/\W+/g, '-')}`);
  try {
    const started = Date.now();
    const help = spawnSync(process.execPath, [join(root, script), '--help'], {
      cwd: dir, encoding: 'utf8', timeout: 5000,
    });
    check(help.status === 0 && /Usage:/.test(help.stdout), `${script} help exits 0 with usage`);
    check(Date.now() - started < 5000, `${script} help exits quickly`);
    check(readdirSync(dir).length === 0, `${script} help creates no files`);

    const unknown = spawnSync(process.execPath, [join(root, script), '--definitely-not-a-flag'], {
      cwd: dir, encoding: 'utf8', timeout: 5000,
    });
    check(unknown.status === 2 && /Unknown option: --definitely-not-a-flag/.test(unknown.stderr),
      `${script} unknown option exits 2`);
    check(readdirSync(dir).length === 0, `${script} unknown option creates no files`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
