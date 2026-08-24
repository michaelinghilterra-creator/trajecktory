#!/usr/bin/env node
// The helper lives in a small ESM module because Node cannot import the JSX UI
// directly without the dashboard build step. The JSX imports the same helper.

import assert from 'node:assert/strict';
import { discoverErrorMessage } from '../dashboard-web/src/discover-error-message.mjs';

const actionable = discoverErrorMessage(new TypeError('Failed to fetch'));
assert.match(actionable, /run Discover again with fewer companies/i);

const networkError = discoverErrorMessage(new Error('NetworkError when attempting to fetch resource'));
assert.match(networkError, /run Discover again with fewer companies/i);

const ordinary = discoverErrorMessage(new Error('Ordinary discovery failure'));
const empty = discoverErrorMessage(new Error(''));
const nullError = discoverErrorMessage(null);
const undefinedError = discoverErrorMessage(undefined);
assert.equal(ordinary, 'Ordinary discovery failure');
assert.doesNotMatch(empty, /undefined/);
assert.doesNotThrow(() => discoverErrorMessage(null));
assert.doesNotThrow(() => discoverErrorMessage(undefined));

for (const message of [actionable, networkError, ordinary, empty, nullError, undefinedError]) {
  assert.equal(message.includes(String.fromCodePoint(0x2014)), false);
  assert.equal(message.includes('-'.repeat(2)), false);
}

console.log('discover error copy tests passed');
