#!/usr/bin/env node
import { createHostPacer } from '../lib/host-pacer.mjs';
import { runAtsRequest, scanFailureOutcome } from '../scan.mjs';
let passed = 0, failed = 0;
const check = (cond, label) => { if (cond) { console.log(`  ok ${label}`); passed++; } else { console.log(`  fail ${label}`); failed++; } };
console.log('scanner-family-pacer.test.mjs');
const pacer = createHostPacer({ name: 'greenhouse' });
const blocked = new Error('HTTP 429'); blocked.status = 429;
await runAtsRequest(pacer, async () => { throw blocked; }).catch(() => {});
const skipped = await runAtsRequest(pacer, async () => []).catch(error => scanFailureOutcome(error, 'greenhouse'));
check(pacer.tripped, 'a family rate block trips its pacer');
check(skipped.result === 'skipped_paused' && skipped.pausedFamily === 'greenhouse', 'a paused family maps to skipped_paused');
const ordinary = scanFailureOutcome(new Error('HTTP 404'), 'lever');
check(ordinary.result === 'http_404' && !ordinary.paused, 'a 404 does not map to a paused family');
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
