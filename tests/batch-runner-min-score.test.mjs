import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = fs.readFileSync(path.join(root, 'batch', 'batch-runner.sh'), 'utf8');
const shell = process.platform === 'win32' ? 'bash' : undefined;

test('min-score gate does not use bc', () => {
  const gate = text.match(/# Check min-score gate[\s\S]*?below-min-score/)?.[0] || '';
  assert.ok(gate.length > 0, 'min-score gate block not found');
  assert.doesNotMatch(gate, /\bbc\b/, 'min-score gate still uses bc');
  assert.match(gate, /\bawk\b/, 'min-score gate should use awk');
});

test('score accumulation does not use bc', () => {
  const line = text.match(/score_sum=\$\(.*\)/)?.[0] || '';
  assert.ok(line.length > 0, 'score_sum assignment not found');
  assert.doesNotMatch(line, /\bbc\b/, 'score accumulation still uses bc');
  assert.match(line, /\bawk\b/, 'score accumulation should use awk');
});

test('average calculation does not use bc', () => {
  const line = text.match(/avg=\$\(.*\)/)?.[0] || '';
  assert.ok(line.length > 0, 'avg assignment not found');
  assert.doesNotMatch(line, /\bbc\b/, 'average calculation still uses bc');
  assert.match(line, /\bawk\b/, 'average calculation should use awk');
});

test('awk min-score comparison produces correct exit codes', () => {
  // MIN_SCORE > 0 should be true for 3.5
  execSync('awk "BEGIN{exit(!(3.5 > 0))}"', { stdio: 'pipe', shell });

  // MIN_SCORE > 0 should be false for 0
  let threw = false;
  try {
    execSync('awk "BEGIN{exit(!(0 > 0))}"', { stdio: 'pipe', shell });
  } catch { threw = true; }
  assert.ok(threw, '0 > 0 should produce non-zero exit');

  // score < MIN_SCORE: 2.5 < 3.0 should be true
  execSync('awk "BEGIN{exit(!(2.5 < 3.0))}"', { stdio: 'pipe', shell });

  // score < MIN_SCORE: 3.5 < 3.0 should be false
  threw = false;
  try {
    execSync('awk "BEGIN{exit(!(3.5 < 3.0))}"', { stdio: 'pipe', shell });
  } catch { threw = true; }
  assert.ok(threw, '3.5 < 3.0 should produce non-zero exit');

  // score == MIN_SCORE: 3.0 < 3.0 should be false (not skipped)
  threw = false;
  try {
    execSync('awk "BEGIN{exit(!(3.0 < 3.0))}"', { stdio: 'pipe', shell });
  } catch { threw = true; }
  assert.ok(threw, '3.0 < 3.0 should produce non-zero exit (equal scores pass)');
});

test('awk score accumulation produces correct sums', () => {
  const result = execSync('awk "BEGIN{printf \\"%.4f\\", 1.5 + 2.3}"', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell,
  }).trim();
  assert.strictEqual(result, '3.8000');
});

test('awk average calculation produces correct output', () => {
  const result = execSync('awk "BEGIN{printf \\"%.1f\\", 10.5 / 3}"', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell,
  }).trim();
  assert.strictEqual(result, '3.5');
});
