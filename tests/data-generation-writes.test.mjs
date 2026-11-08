#!/usr/bin/env node

import assert from 'node:assert/strict';
import { NON_DATA_GETS, requestWritesData } from '../dashboard-web/server/lib/data-generation.mjs';

let passed = 0, failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
    passed++;
  } catch (error) {
    console.log(`  not ok ${name}`);
    console.log(`    ${error.message}`);
    failed++;
  }
}

const mutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const sideEffectGets = new Set(['/api/google/health', '/api/google/replies']);
const nonDataPosts = new Set(['/api/system/update-check']);
const options = { mutatingMethods, sideEffectGets, nonDataPosts, nonDataGets: NON_DATA_GETS };

check('an ordinary POST writes data', () => {
  assert.equal(requestWritesData('POST', '/api/applications', options), true);
});

check('the update check POST does not write data', () => {
  assert.equal(requestWritesData('POST', '/api/system/update-check', options), false);
});

check('the Google health GET does not write data', () => {
  assert.equal(requestWritesData('GET', '/api/google/health', options), false);
});

check('the Google replies GET writes data', () => {
  assert.equal(requestWritesData('GET', '/api/google/replies', options), true);
});

check('an ordinary GET does not write data', () => {
  assert.equal(requestWritesData('GET', '/api/applications', options), false);
});

check('Google replies is not excluded', () => {
  assert.equal(NON_DATA_GETS.has('/api/google/replies'), false);
});

check('only Google health is excluded', () => {
  assert.equal(NON_DATA_GETS.size, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
