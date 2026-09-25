#!/usr/bin/env node

import assert from 'node:assert/strict';
import { agentTail } from '../dashboard-web/server/lib/agent-summary.mjs';

const summary = agentTail([
  '<<<PORTAL_ADDITIONS>>>',
  'Example Co scan complete',
  '<<<END_PORTAL_ADDITIONS>>>',
  '2 roles reviewed',
].join('\n'));

assert.equal(summary, 'Example Co scan complete\n2 roles reviewed');
assert.doesNotMatch(summary, /<<<[A-Z_]+>>>/);

console.log('agent summary marker tests passed');
