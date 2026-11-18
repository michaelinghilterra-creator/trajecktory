#!/usr/bin/env node
import { runEmailLookupBatch, RATE_LIMIT_SKIP_REASON } from '../lib/email-lookup-batch.mjs';
let passed = 0, failed = 0;
const check = (cond, label) => { if (cond) { console.log(`  ok ${label}`); passed++; } else { console.log(`  fail ${label}`); failed++; } };
console.log('email-lookup-rate-limit.test.mjs');
const rows = ['Avery Example', 'Jordan Sample', 'Morgan Fixture'];
const result = await runEmailLookupBatch(rows, async row => {
  if (row === 'Avery Example') { const error = new Error('Hunter rate limit'); error.status = 429; error.service = 'hunter'; throw error; }
  return { found: false };
}, { concurrency: 1 });
check(result.rateLimited === 'hunter', 'the blocked service is returned');
check(result.results.every(item => item.skipped && item.reason === RATE_LIMIT_SKIP_REASON), 'unstarted rows are returned as skipped');
check(result.results.every(item => !item.error), 'rate-limited rows are not failures');
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
