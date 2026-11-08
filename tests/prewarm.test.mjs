#!/usr/bin/env node

import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREWARM_PATHS, prewarm } from '../dashboard-web/server/lib/prewarm.mjs';

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

console.log('prewarm.test.mjs');

const seen = [];
let active = 0;
let overlapped = false;
const server = http.createServer((req, res) => {
  active++;
  if (active > 1) overlapped = true;
  seen.push({ url: req.url, token: req.headers['x-tjk-token'] });
  setTimeout(() => {
    active--;
    res.statusCode = req.url === '/api/metrics/core' ? 500 : 200;
    res.end('{}');
  }, 5);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

const result = await prewarm({ port, token: 'invented-token' });
check(seen.map(item => item.url).join(',') === PREWARM_PATHS.join(','), 'every heavy read is requested in order');
check(seen.every(item => item.token === 'invented-token'), 'each request carries the dashboard token');
check(!overlapped, 'the requests run one at a time');
check(result.done === PREWARM_PATHS.length - 1 && result.failed === 1, 'a failing response is counted and does not stop the rest');
await new Promise(resolve => server.close(resolve));

const dead = await prewarm({ port, token: 'invented-token', paths: ['/a', '/b'], timeoutMs: 500 });
check(dead.done === 0 && dead.failed === 2, 'a closed port fails quietly instead of throwing');

const here = dirname(fileURLToPath(import.meta.url));
const index = readFileSync(join(here, '..', 'dashboard-web', 'server', 'index.mjs'), 'utf8');
check(index.includes("from './lib/prewarm.mjs'") && index.includes('TJK_NO_PREWARM'), 'the server starts the warm-up and honours TJK_NO_PREWARM');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
