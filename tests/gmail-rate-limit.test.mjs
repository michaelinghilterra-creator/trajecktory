#!/usr/bin/env node
import { fetchMessagesConcurrent } from '../dashboard-web/server/lib/google.mjs';
let passed = 0, failed = 0;
const check = (cond, label) => { if (cond) { console.log(`  ok ${label}`); passed++; } else { console.log(`  fail ${label}`); failed++; } };
console.log('gmail-rate-limit.test.mjs');
const ids = Array.from({ length: 6 }, (_, index) => ({ id: `fixture${index}` }));
let calls = 0;
const loaded = await fetchMessagesConcurrent(ids, {
  concurrency: 1, withFailures: true,
  getImpl: async ({ id }) => {
    calls++;
    if (id === 'fixture1') { const error = new Error('quota'); error.status = 429; throw error; }
    return { id };
  },
});
check(calls === 2, 'no new Gmail loads start after 429');
check(loaded.failedIds.length === 5, 'the blocked id and unattempted ids are failed');
check(loaded.messages.length === 1, 'a message loaded before the block is retained');
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
