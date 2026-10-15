#!/usr/bin/env node
/**
 * Source-text check (no DOM harness): when the server holds a reply for acknowledgement, the
 * "anyway" button must repeat the action that was held. It used to always send a plain log, so a
 * held Rejected saved a note and left the application at Applied.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const review = readFileSync(join(root, 'dashboard-web/src/review.jsx'), 'utf8');

let passed = 0, failed = 0;
function check(condition, label) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
}

console.log('reply-guard-held-action.test.mjs');
check(/setGuard\(\{ \.\.\.res\.guard, heldAction: action \}\)/.test(review), 'a held reply remembers the action that was held');
check(/act\(guard\.heldAction \|\| 'log', \{ acknowledged: true \}\)/.test(review), 'the anyway button repeats the held action');
check(!/act\('log', \{ acknowledged: true \}\)/.test(review), 'no anyway button hardcodes a plain log');
check(/act\('log', \{ acknowledged: true, sentiment: 'neutral' \}\)/.test(review), 'Log as neutral still only logs');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
