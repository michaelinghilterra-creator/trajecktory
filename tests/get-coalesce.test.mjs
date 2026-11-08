#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const dataSource = readFileSync(join(ROOT, 'dashboard-web', 'src', 'data.js'), 'utf8');
const start = dataSource.indexOf('const tjkInFlightGets = new Map();');
const end = dataSource.indexOf('\n// E-5:', start);
assert.ok(start >= 0 && end > start, 'helper source anchors exist');
const helperSource = dataSource.slice(start, end);

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  try {
    assert.ok(condition, message);
    passed++;
    console.log(`  ok ${message}`);
  } catch (error) {
    failed++;
    console.error(`  not ok ${message}`);
    console.error(`    ${error.message}`);
  }
};

function harness() {
  const calls = [];
  const fetch = (url, options) => {
    let resolve;
    let reject;
    const promise = new Promise((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    calls.push({ url, options, resolve, reject });
    return promise;
  };
  const window = { dispatchEvent() {} };
  const context = vm.createContext({ window, fetch, structuredClone, CustomEvent: class CustomEvent {} });
  vm.runInContext(helperSource, context);
  return { window, calls };
}

const response = (body, status = 200) => ({ status, json: () => Promise.resolve(body) });

console.log('get-coalesce.test.mjs');

{
  const { window, calls } = harness();
  const first = window.tjkGetJson('/same');
  const second = window.tjkGetJson('/same');
  check(calls.length === 1, 'two concurrent reads of one URL make one fetch');
  calls[0].resolve(response({ nested: { value: 1 } }));
  const [a, b] = await Promise.all([first, second]);
  check(a !== b && a.nested !== b.nested, 'each caller receives a distinct object');
  a.nested.value = 9;
  check(b.nested.value === 1, 'mutating one result does not change another');
  const third = window.tjkGetJson('/same');
  check(calls.length === 2, 'a read after settlement makes another fetch');
  calls[1].resolve(response({ value: 2 }));
  await third;
}

{
  const { window, calls } = harness();
  const first = window.tjkGetJson('/one');
  const second = window.tjkGetJson('/two');
  check(calls.length === 2, 'different URLs do not share a fetch');
  calls[0].resolve(response({ value: 1 }));
  calls[1].resolve(response({ value: 2 }));
  await Promise.all([first, second]);
}

{
  const { window, calls } = harness();
  const first = window.tjkGetJson('/reject');
  const second = window.tjkGetJson('/reject');
  calls[0].reject(new Error('network failed'));
  const results = await Promise.allSettled([first, second]);
  check(results.every(result => result.status === 'rejected'), 'a rejected fetch rejects every waiting caller');
  const retry = window.tjkGetJson('/reject');
  check(calls.length === 2, 'a rejected fetch clears the entry for retry');
  calls[1].resolve(response({ retried: true }));
  await retry;
}

{
  const { window, calls } = harness();
  const result = window.tjkGetJson('/json-error');
  calls[0].resolve(response({ error: 'expected' }, 503));
  check((await result).error === 'expected', 'a non-OK response with JSON resolves with its body');
}

{
  const { window, calls } = harness();
  const first = window.tjkGetJson('/write', { method: 'POST' });
  const second = window.tjkGetJson('/write', { method: 'POST' });
  check(calls.length === 2, 'a non-GET method bypasses coalescing');
  calls[0].resolve(response({ value: 1 }));
  calls[1].resolve(response({ value: 2 }));
  await Promise.all([first, second]);
}

{
  const { window, calls } = harness();
  const before = window.tjkGetJson('/clear');
  const mutation = window.tjkMutate('/write', { method: 'POST' });
  const after = window.tjkGetJson('/clear');
  check(calls.filter(call => call.url === '/clear').length === 2, 'a mutation separates reads started before and after it');
  for (const call of calls) call.resolve(response({ ok: true }));
  await Promise.all([before, mutation, after]);
}

const shared = readFileSync(join(ROOT, 'dashboard-web', 'src', 'shared.jsx'), 'utf8');
const launchpad = readFileSync(join(ROOT, 'dashboard-web', 'src', 'launchpad.jsx'), 'utf8');
const pipeline = readFileSync(join(ROOT, 'dashboard-web', 'src', 'pipeline.jsx'), 'utf8');
const overview = readFileSync(join(ROOT, 'dashboard-web', 'src', 'overview.jsx'), 'utf8');

check(!shared.includes("fetch('/api/setup/models')"), 'shared model reads use the coalescing helper');
check(!launchpad.includes("fetch('/api/setup/models')"), 'launchpad model reads use the coalescing helper');
const inboxEffects = pipeline.match(/useEffectP\(\(\) => \{ loadInbox\(\); \}, \[[^\]]+\]\);/g) || [];
check(inboxEffects.length === 1, 'pipeline has one loadInbox effect call');
check(
  overview.includes("fetch('/api/metrics/core', { headers: { accept: 'application/json' } })")
    && overview.includes('response.ok ? response.json() : Promise.reject'),
  'overview keeps its guarded metrics fetch',
);

console.log(`\n get coalesce: ${passed} checks passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
