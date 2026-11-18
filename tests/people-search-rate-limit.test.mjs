#!/usr/bin/env node
import { collectPeople } from '../lib/people-search.mjs';
let passed = 0, failed = 0;
const check = (cond, label) => { if (cond) { console.log(`  ok ${label}`); passed++; } else { console.log(`  fail ${label}`); failed++; } };
console.log('people-search-rate-limit.test.mjs');
let calls = 0;
const result = await collectPeople({
  company: 'Zorblax Systems', tier: 'talent', delayMs: 0, sleep: async () => {},
  search: async () => { calls++; const error = new Error('Brave API HTTP 429'); error.status = 429; throw error; },
});
check(calls === 1, 'a Brave 429 ends the company query loop');
check(result.rateLimited === true, 'the result is marked rate limited');
check(result.errors.length === 1 && result.errors[0].rateLimited === true, 'the rate block remains visible in errors');
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
