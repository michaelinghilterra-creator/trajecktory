#!/usr/bin/env node

import { createWorkdayPacer } from '../lib/workday-pacer.mjs';

let passed = 0;
let failed = 0;

function check(cond, label) {
  if (cond) {
    console.log(`  ok ${label}`);
    passed++;
  } else {
    console.log(`  fail ${label}`);
    failed++;
  }
}

console.log('workday-pacer.test.mjs');

{
  let clock = 1000;
  let active = 0;
  let maxActive = 0;
  const events = [];
  const pacer = createWorkdayPacer({
    gapMs: 50,
    now: () => clock,
    sleep: async (ms) => {
      events.push(`sleep:${ms}`);
      clock += ms;
    },
  });

  const request = (name, duration) => pacer.run(async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    events.push(`start:${name}:${clock}`);
    await Promise.resolve();
    clock += duration;
    events.push(`end:${name}:${clock}`);
    active -= 1;
    return name;
  });

  const results = await Promise.all([request('one', 7), request('two', 3)]);
  check(maxActive === 1, 'requests run one at a time');
  check(events.includes('sleep:50'), 'the full gap is awaited after a request ends');
  check(events.includes('start:two:1057'), 'the next request starts after the configured gap');
  check(results.join(',') === 'one,two', 'queued results preserve request order');
}

{
  let called = 0;
  const pacer = createWorkdayPacer();
  pacer.trip('HTTP 429');
  let message = '';
  try {
    await pacer.run(async () => { called++; });
  } catch (err) {
    message = err.message;
  }
  check(pacer.tripped, 'trip marks the pacer as tripped');
  check(message.startsWith('Workday paused for this scan:'), 'a tripped pacer rejects with the paused prefix');
  check(called === 0, 'a tripped pacer does not call the request function');
}

{
  const pacer = createWorkdayPacer();
  check(pacer.gapMs === 3000, 'the default request gap is 3000 milliseconds');
  check(pacer.maxPagesPerBoard === 15, 'the default board page cap is 15');
}

{
  let clock = 2000;
  let secondCalled = false;
  const pacer = createWorkdayPacer({
    gapMs: 25,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
  });
  const rejected = pacer.run(async () => {
    clock += 4;
    throw new Error('invented request failure');
  });
  const recovered = pacer.run(async () => {
    secondCalled = true;
    return 'recovered';
  });
  const [first, second] = await Promise.allSettled([rejected, recovered]);
  check(first.status === 'rejected', 'a request rejection reaches its caller');
  check(second.status === 'fulfilled' && second.value === 'recovered', 'a rejection does not break the queue');
  check(secondCalled, 'the request after a rejection still runs');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
