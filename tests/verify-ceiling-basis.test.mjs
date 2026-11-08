#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CEILING_BASIS_REQUIRED_SINCE,
  findCeilingBasisIssues,
} from '../verify-ceiling-basis.mjs';
import { cleanSandboxes, makeRepoSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const run = (data, since = CEILING_BASIS_REQUIRED_SINCE) => findCeilingBasisIssues({
  reports: data.map((item, index) => ({ id: String(900001 + index), data: item })),
  since,
});

console.log('verify-ceiling-basis.test.mjs');

let r = run([{ date: '2026-11-08', scoreCeiling: 2 }]);
check(r.ok && r.checked === 0, 'a report before the cutover is not checked');

r = run([{ date: '2026-11-09', scoreCeiling: 2 }]);
check(!r.ok && r.checked === 1 && eq(r.missing, ['900001']), 'a report on the cutover is missing its basis');

r = run([
  { date: '2031-01-01', scoreCeiling: 2, ceilingBasis: ' ' },
  { date: '2031-01-02', scoreCeiling: 2, ceilingBasis: 4 },
]);
check(eq(r.missing, ['900001', '900002']), 'blank and non-string bases are missing');

r = run([
  { date: '2031-01-01', scoreCeiling: 2, ceilingBasis: 'Location' },
  { date: '2031-01-02', scoreCeiling: 2, ceilingBasis: ' level ' },
]);
check(r.ok && r.checked === 2, 'known bases are trimmed and matched without case');

r = run([{ date: '2031-01-01', scoreCeiling: 2, ceilingBasis: 'banana' }]);
check(!r.ok && eq(r.invalid, [{ id: '900001', basis: 'banana' }]), 'an unknown basis is invalid');

r = run([
  { date: '2031-01-01', ceilingBasis: 'level' },
  { date: '2031-01-02', scoreCeiling: '2', ceilingBasis: 'level' },
  { scoreCeiling: 2, ceilingBasis: 'level' },
]);
check(r.ok && r.checked === 0, 'missing, non-numeric, and undated ceilings are not checked');

r = run([{ date: '2031-01-01', scoreCeiling: 2, ceilingBasis: 'visa' }]);
check(r.ok && r.missing.length === 0 && r.invalid.length === 0, 'a clean set is ok');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = makeRepoSandbox(repoRoot, 'verify-ceiling-basis');
fs.mkdirSync(path.join(sandbox, 'dashboard-web', 'server'), { recursive: true });
fs.mkdirSync(path.join(sandbox, 'reports'), { recursive: true });
fs.copyFileSync(path.join(repoRoot, 'verify-ceiling-basis.mjs'), path.join(sandbox, 'verify-ceiling-basis.mjs'));
fs.copyFileSync(path.join(repoRoot, 'dashboard-web', 'server', 'v1-loader.mjs'), path.join(sandbox, 'dashboard-web', 'server', 'v1-loader.mjs'));
const report = (data) => `---\n${JSON.stringify({ schema: 'trajecktory-report/v1', ...data }, null, 2)}\n---\n\nInvented fixture.\n`;
fs.writeFileSync(path.join(sandbox, 'reports', '900020-acme.md'), report({ id: 900020, date: '2032-01-01', scoreCeiling: 2 }), 'utf8');
fs.writeFileSync(path.join(sandbox, 'reports', '900021-example.md'), report({ id: 900021, date: '2032-01-02', scoreCeiling: 2, ceilingBasis: 'banana' }), 'utf8');
const cli = spawnSync(process.execPath, ['verify-ceiling-basis.mjs', '-' + '-json'], {
  cwd: sandbox,
  encoding: 'utf8',
});
let cliResult = null;
try { cliResult = JSON.parse(cli.stdout); } catch { /* assertion below reports it */ }
check(cli.status === 1 && eq(cliResult, {
  checked: 2,
  missing: ['900020'],
  invalid: [{ id: '900021', basis: 'banana' }],
  ok: false,
}), 'json CLI returns the expected issue shape for two reports');

cleanSandboxes();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
