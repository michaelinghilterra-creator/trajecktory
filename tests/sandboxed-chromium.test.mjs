import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchSandboxedChromium, sandboxedLaunchOptions } from '../lib/sandboxed-chromium.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fakeLauncher({ chromeFails = false } = {}) {
  const calls = [];
  return {
    calls,
    async launch(options) {
      calls.push(options);
      if (chromeFails && options.channel === 'chrome') throw new Error('Chromium distribution not found\nmore detail');
      return { options };
    },
  };
}

test('installed Chrome is tried first with the sandbox on', async () => {
  const launcher = fakeLauncher();
  const browser = await launchSandboxedChromium({}, launcher);
  assert.equal(launcher.calls.length, 1);
  assert.equal(browser.options.channel, 'chrome');
  assert.equal(browser.options.chromiumSandbox, true);
  assert.equal(browser.options.headless, true);
});

test('missing Chrome falls back to bundled Chromium, still sandboxed', async () => {
  const launcher = fakeLauncher({ chromeFails: true });
  const write = process.stderr.write;
  let warned = '';
  process.stderr.write = chunk => { warned += chunk; return true; };
  try {
    const browser = await launchSandboxedChromium({}, launcher);
    assert.equal(launcher.calls.length, 2);
    assert.equal(browser.options.channel, undefined);
    assert.equal(browser.options.chromiumSandbox, true);
  } finally {
    process.stderr.write = write;
  }
  assert.match(warned, /bundled Chromium with the sandbox on/);
  assert.doesNotMatch(warned, /more detail/);
});

test('a caller cannot switch the sandbox off', () => {
  const options = sandboxedLaunchOptions({ chromiumSandbox: false, args: ['--no-sandbox', '--lang=en-US'], headless: false });
  assert.equal(options.chromiumSandbox, true);
  assert.deepEqual(options.args, ['--lang=en-US']);
  assert.equal(options.headless, false);
});

test('the liveness scripts launch through the sandboxed helper', () => {
  for (const file of ['check-liveness.mjs', 'gate-pipeline.mjs']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(source, /launchSandboxedChromium\(/, file);
    assert.doesNotMatch(source, /chromium\.launch\(/, file);
    assert.doesNotMatch(source, /no-sandbox/, file);
  }
});
