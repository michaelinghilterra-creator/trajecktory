#!/usr/bin/env node
/*
 * The activation log records where a new user's time goes. Its entire safety
 * argument is one rule: SHAPES AND COUNTS ONLY, NEVER VALUES.
 *
 * That rule is worth nothing as a comment. The instinct when describing a
 * problem is to include the specifics that make it concrete, and that instinct
 * is exactly what leaks: this repo has already had real compensation figures and
 * a real company name reach published commit messages, every one written while
 * documenting that same class of mistake. A log with a free-text field is one
 * edit away from carrying a company name for ever.
 *
 * So these tests assert the negative: that an attempt to log a company, a job
 * title, a salary or a location does NOT reach the file. If someone later widens
 * a field to "just this once", this suite is what stops it.
 *
 * Runs against a temp DATA_DIR via TJK_DATA_DIR, so it never touches real data.
 *
 * Run: node tests/activation.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-activation-'));
fs.mkdirSync(path.join(sandbox, 'data'), { recursive: true });
process.env.TJK_DATA_DIR = path.join(sandbox, 'data');

let passed = 0, failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
};

const A = await import('../dashboard-web/server/lib/activation.mjs');
const { ACTIVATION_PATH } = await import('../dashboard-web/server/config.mjs');
const fileText = () => { try { return fs.readFileSync(ACTIVATION_PATH, 'utf8'); } catch { return ''; } };

console.log('\n🧪 activation log\n');

console.log('1. Opt-in: nothing is recorded until it is switched on');
check(!A.activationEnabled(), 'starts disabled');
check(A.record('setup_opened') === false, 'a record call while disabled is refused');
check(fileText() === '', 'and writes no file at all');

A.setActivationEnabled(true);
check(A.activationEnabled(), 'enabling creates the file');

console.log('\n2. Permitted events are recorded');
check(A.record('setup_opened') === true, 'a known event is written');
check(A.record('step_completed', { step: 'cv', ms: 4200 }) === true, 'a known step with a duration is written');
check(A.record('scan_finished', { count: 12, detail: 'ok' }) === true, 'a count and an enum detail are written');
check(/step_completed\tcv\t4200/.test(fileText()), 'the row holds the step id and the duration');

console.log('\n3. Unknown events and steps are dropped, not written');
check(A.record('user_typed_something') === false, 'an unknown event is refused');
check(A.record('step_completed', { step: 'salary_expectations' }) === true, 'an unknown step still writes the event');
check(!/salary_expectations/.test(fileText()), 'but the unknown step id itself never reaches the file');

console.log('\n4. THE RULE: values never reach the file');
// Each of these is a plausible thing to want to log while debugging, and each is
// exactly what must not be recorded. They are passed through every field.
const secrets = [
  ['a company name', 'Northwind Freight'],
  ['a job title', 'Director of Revenue Operations'],
  ['a salary', '$185K'],
  ['a city', 'Columbus, OH'],
  ['an email', 'someone@example.com'],
  ['a file path', 'C:/Users/someone/cv.md'],
];
for (const [label, value] of secrets) {
  A.record('step_completed', { step: value, detail: value });
  A.record('scan_finished', { count: value, detail: value });
  A.record('apply_finished', { step: 'cv', ms: value, detail: value });
  check(!fileText().includes(value), `${label} passed into every field never appears in the log`);
}

console.log('\n5. Numeric fields stay numeric');
A.record('scan_finished', { count: -5 });
A.record('scan_finished', { count: 'NaN' });
A.record('step_completed', { step: 'cv', ms: 1.9 });
const rows = A.readActivation().rows;
check(rows.every(r => r.count === null || (Number.isFinite(r.count) && r.count >= 0)), 'no negative or non-numeric counts survive');
check(rows.some(r => r.ms === 2), 'a fractional duration is rounded rather than dropped');

console.log('\n6. The summary answers the question the log exists for');
A.setActivationEnabled(false);
A.setActivationEnabled(true);
const t0 = Date.now();
A.record('setup_opened');
A.record('ready_shown');
A.record('started_using');
A.record('scan_finished', { count: 0, detail: 'empty' });
A.record('handoff_started'); A.record('handoff_missing');
const { summary } = A.summarizeActivation();
check(summary !== null, 'a summary is produced');
check(summary.minutesToReady !== null, 'time to "you can start now" is reported');
check(summary.minutesSpentAfterReady !== null, 'time spent in setup AFTER it was usable is reported');
check(summary.emptyScans === 1, 'an empty scan is counted');
check(summary.handoffsMissing === 1, 'a handoff that wrote nothing is counted');
check(Date.now() - t0 < 5000, 'summarising is cheap');

console.log('\n7. Opting out removes the data, not just the switch');
A.setActivationEnabled(false);
check(!A.activationEnabled(), 'disabling reports disabled');
check(!fs.existsSync(ACTIVATION_PATH), 'and deletes the file, so opting out is not merely cosmetic');

fs.rmSync(sandbox, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
