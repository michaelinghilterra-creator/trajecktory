#!/usr/bin/env node
import { cursorAfterQueries } from '../lib/discover-rotation.mjs';
let passed = 0, failed = 0;
const check = (cond, label) => { if (cond) { console.log(`  ok ${label}`); passed++; } else { console.log(`  fail ${label}`); failed++; } };
console.log('brave-rate-limit.test.mjs');
const rotation = { from: 3, to: 6, total: 8, nextCursor: 6 };
check(cursorAfterQueries(rotation, 2) === 4, 'cursor advances only past attempted Brave queries');
check(cursorAfterQueries(rotation, 0) === 2, 'cursor stays at the first unrun query');
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
