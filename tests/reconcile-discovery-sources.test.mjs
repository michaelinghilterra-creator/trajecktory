#!/usr/bin/env node
/**
 * Source-text checks are weaker than a DOM harness. A real harness would select
 * each preview group, verify its request endpoint, inspect the merged review
 * labels, then assert that every accepted suggestion reaches bulk-add with its
 * declared machine source and that rejected contacts render after the write.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const targetTalent = readFileSync(join(root, 'dashboard-web/src/target-talent.jsx'), 'utf8');

let passed = 0, failed = 0;
function check(condition, label) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
}

console.log('reconcile-discovery-sources.test.mjs');

check(targetTalent.includes('companiesNeedingPrincipal'), 'Reconcile reads the decision-maker gap');
check(targetTalent.includes('/api/tt-reconcile/discover-principal'), 'Reconcile calls decision-maker discovery');

const bulkAddCalls = targetTalent.split('window.tjkMutate("/api/tt-reconcile/bulk-add"').slice(1);
const bulkAddBodies = bulkAddCalls
  .map(call => call.match(/body:\s*JSON\.stringify\(\{([\s\S]*?)\}\)\s*[,}]/)?.[1])
  .filter(Boolean);
check(bulkAddCalls.length > 0 && bulkAddBodies.length === bulkAddCalls.length, 'every bulk-add request body is visible to the source-text check');
check(bulkAddBodies.every(body => /\bsource\s*:/.test(body)), 'no bulk-add request body contains contacts alone');
check(targetTalent.includes('"agent"') || targetTalent.includes("'agent'"), 'Reconcile declares the agent source');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
