#!/usr/bin/env node
import { createHostPacer, isRateBlock } from '../lib/host-pacer.mjs';
let passed = 0, failed = 0;
const check = (cond, label) => { if (cond) { console.log(`  ok ${label}`); passed++; } else { console.log(`  fail ${label}`); failed++; } };
console.log('host-pacer.test.mjs');

{
  let active = 0, maxActive = 0;
  const pacer = createHostPacer({ concurrency: 2, name: 'fixture' });
  const calls = Array.from({ length: 4 }, (_, index) => pacer.run(async () => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 0));
    active--; return index;
  }));
  await Promise.all(calls);
  check(maxActive === 2, 'concurrency is capped');
}

{
  let clock = 1000;
  const starts = [];
  const pacer = createHostPacer({ gapMs: 25, now: () => clock, sleep: async ms => { clock += ms; }, name: 'fixture' });
  await Promise.all([pacer.run(async () => starts.push(clock)), pacer.run(async () => starts.push(clock))]);
  check(starts.join(',') === '1000,1025', 'fake clock observes the start gap');
}

{
  const pacer = createHostPacer({ name: 'fixture' });
  await pacer.run(async () => { throw new Error('fixture rejection'); }).catch(() => {});
  check(await pacer.run(async () => 'recovered') === 'recovered', 'a rejected call does not jam the queue');
  pacer.trip('HTTP 429');
  const message = await pacer.run(async () => {}).catch(error => error.message);
  check(pacer.tripped && message.startsWith('fixture paused for this run:'), 'trip rejects later calls with the named prefix');
  check(isRateBlock(429) && isRateBlock(503) && !isRateBlock(403) && isRateBlock(403, { include403: true }), 'rate block statuses honor the 403 opt in');
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
