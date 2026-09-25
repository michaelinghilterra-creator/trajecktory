#!/usr/bin/env node

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvKey } from '../lib/env-key.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

const dir = makeSandbox('discover-env');
const dashboardEnv = join(dir, 'dashboard.env');
const rootEnv = join(dir, 'root.env');
writeFileSync(dashboardEnv, 'OTHER_KEY=dashboard-only\n');
writeFileSync(rootEnv, 'EXAMPLE_KEY=root-value\n');
assert.equal(loadEnvKey('EXAMPLE_KEY', [dashboardEnv, rootEnv]), 'root-value');

writeFileSync(dashboardEnv, 'EXAMPLE_KEY=dashboard-value\n');
assert.equal(loadEnvKey('EXAMPLE_KEY', [dashboardEnv, rootEnv]), 'dashboard-value');
assert.equal(loadEnvKey('MISSING_KEY', [dashboardEnv, rootEnv]), '');

console.log('discover env lookup tests passed');
