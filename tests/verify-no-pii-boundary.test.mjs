#!/usr/bin/env node
// The gate matches a tracker company as a whole word. It used \b for that, which needs a word character on the
// inside of the boundary, so a company whose name starts or ends with punctuation ("Example Co.", "Example (EMEA)")
// could never match and a reproduced tracker row for it passed. This drives the real CLI with its working directory
// set to a sandbox holding an invented tracker, so it runs the same in CI as on the owner's machine.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from './helpers/sandbox.mjs';
import { TRACKER_SEPARATOR } from '../lib/tracker.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(root, 'verify-no-pii.mjs');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const sandbox = makeSandbox('pii-boundary');
mkdirSync(join(sandbox, 'data'), { recursive: true });
writeFileSync(join(sandbox, 'data', 'applications.md'), [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  TRACKER_SEPARATOR,
  '| 900001 | 2030-03-02 | Zorblax Widgetry (EMEA) | Widget Operations Lead | 4.2/5 | Applied | ❌ | | | | |',
  '| 900002 | 2030-03-04 | Quennox Ratchet Works | Ratchet Program Manager | 3.9/5 | Applied | ❌ | | | | |',
  '',
].join('\n'));

function gate(files) {
  const payload = join(sandbox, `payload-${Math.random().toString(36).slice(2)}`);
  mkdirSync(payload, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(payload, name), body);
  try {
    return { code: 0, out: execFileSync('node', [GATE, '--payload', payload], { cwd: sandbox, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { code: error.status, out: `${error.stdout || ''}${error.stderr || ''}` };
  } finally {
    rmSync(payload, { recursive: true, force: true });
  }
}

try {
  const baseline = gate({ 'clean.md': 'Nothing here names a tracker row.\n' });
  check(baseline.code === 0, `a clean payload passes (exit ${baseline.code})`);

  const trailing = gate({ 'example.md': 'Worked example: Zorblax Widgetry (EMEA), Widget Operations Lead, evaluated 2030-03-02.\n' });
  check(trailing.code === 1 && /PIPELINE STATE/.test(trailing.out),
    'a company ending in punctuation that reproduces its row is caught');

  const plain = gate({ 'example.md': 'Worked example: Quennox Ratchet Works, Ratchet Program Manager, evaluated 2030-03-04.\n' });
  check(plain.code === 1 && /PIPELINE STATE/.test(plain.out),
    'a company that starts and ends with a letter is still caught');

  const embedded = gate({ 'example.md': 'Worked example: XZorblax Widgetry (EMEA), Widget Operations Lead, evaluated 2030-03-02.\n' });
  check(!/PIPELINE STATE/.test(embedded.out),
    'the company inside a longer word is not a match');

  const prose = gate({ 'notes.md': 'Last week a recruiter reached out from Zorblax Widgetry (EMEA) about a new role.\n' });
  check(prose.code === 1 && /INTERVIEW STATE \(prose\)/.test(prose.out),
    'a company ending in punctuation beside an outreach verb is caught');
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

console.log(`verify-no-pii-boundary: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
