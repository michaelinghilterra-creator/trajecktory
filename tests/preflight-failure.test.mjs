#!/usr/bin/env node
/**
 * preflight-failure.test.mjs pins the explanation shown when the Launchpad
 * cannot get a usable result from doctor.mjs. The classifier is pure, so these
 * invented fixtures exercise the remedy without starting an Express server.
 *
 * Run: node tests/preflight-failure.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { classifyPreflightFailure, firstLine, stripAnsiSgr } from '../dashboard-web/server/routes/setup.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
}

console.log('preflight-failure.test.mjs');

const initializeFailure = classifyPreflightFailure({ error: new Error('invented'), code: 3221225794 });
check(initializeFailure.kind === 'process-did-not-start', 'initialization status is a process launch failure');
check(/restart/i.test(initializeFailure.hint), 'initialization hint tells the user to restart');
check(/initialize/i.test(initializeFailure.hint), 'initialization status has its own wording');

const accessViolation = classifyPreflightFailure({ error: new Error('invented'), code: 0xC0000005 });
check(accessViolation.kind === 'process-did-not-start', 'access violation is a process launch failure');
check(/access violation/i.test(accessViolation.hint), 'access violation has its own wording');

const interrupted = classifyPreflightFailure({ error: new Error('invented'), code: 0xC000013A });
check(interrupted.kind === 'process-did-not-start', 'interrupted status is a process launch failure');
check(/interrupted/i.test(interrupted.hint), 'interrupted status has its own wording');

const unknownStatus = classifyPreflightFailure({ error: new Error('invented'), code: 0xC0000022 });
check(unknownStatus.kind === 'process-did-not-start', 'unknown NTSTATUS remains a process launch failure');

const failedWithStderr = classifyPreflightFailure({ code: 1, stderr: 'invented failure' });
check(failedWithStderr.kind === 'doctor-failed', 'ordinary nonzero exit with stderr is a doctor failure');

const failedWithoutStderr = classifyPreflightFailure({ code: 1, stderr: '' });
check(failedWithoutStderr.kind === 'doctor-failed', 'ordinary nonzero exit without stderr is a doctor failure');

const emptyOutput = classifyPreflightFailure({ error: null, stdout: '' });
check(emptyOutput.kind === 'empty-output', 'blank stdout after a clean run is empty output');

for (const code of [null, undefined]) {
  let result;
  let threw = false;
  try { result = classifyPreflightFailure({ error: new Error('invented'), code }); }
  catch { threw = true; }
  check(!threw && result.kind === 'doctor-failed', `${String(code)} exit code is handled safely`);
}

const everyKind = [
  initializeFailure,
  failedWithStderr,
  emptyOutput,
  classifyPreflightFailure({ badJson: true }),
];
for (const result of everyKind) {
  check(typeof result.hint === 'string' && result.hint.trim().length > 0, `${result.kind} includes a nonempty hint`);
}

const escape = String.fromCharCode(27);
check(stripAnsiSgr(`before ${escape}[90mgrey${escape}[39m after`) === 'before grey after', 'ANSI colour codes are removed without losing visible text');
check(stripAnsiSgr('plain text') === 'plain text', 'plain text is unchanged by ANSI stripping');
for (const value of ['', null, undefined]) {
  let result;
  let threw = false;
  try { result = stripAnsiSgr(value); }
  catch { threw = true; }
  check(!threw && result === '', `${String(value)} is handled safely by ANSI stripping`);
}

check(firstLine('first line\nsecond line') === 'first line', 'first-line helper removes text after the first newline');
check(firstLine('only line') === 'only line', 'first-line helper preserves a message without a newline');
check(firstLine('\nsecond line') === '', 'first-line helper handles a leading newline');
for (const value of [null, undefined]) {
  let result;
  let threw = false;
  try { result = firstLine(value); }
  catch { threw = true; }
  check(!threw && result === '', `${String(value)} is handled safely by the first-line helper`);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
