#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('target-talent-sequence-advance');
process.env.TJK_DATA_DIR = sandbox;

const rows = [900001, 900002, 900003, 900004, 900005]
  .map(id => `| ${id} | Example Works | Contact${id} | Test | Mx. | Recruiter | Austin | TX | 78701 | | test${id}@example.test | linkedin.com/in/test-${id} | Not Contacted | | | |`)
  .join('\n');
fs.writeFileSync(path.join(sandbox, 'target-talent.md'),
  '# Target Talent\n\n' +
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n' +
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n' + rows + '\n',
  'utf8');

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/target-talent.mjs');
const {
  advanceSequence,
  expectedNextChannel,
  getSequence,
  getTemplate,
  startSequence,
} = await import('../dashboard-web/server/lib/sequences.mjs');

const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const send = (id, channel, timestamp) => fetch(`${base}/api/target-talent/${id}/correspondence`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    direction: 'Sent', channel, timestamp,
    subject: 'Invented outreach', body: 'Invented message body.',
  }),
}).then(async response => ({ status: response.status, body: await response.json() }));

const sequenceId = 'application-day-0-1-5-12';
let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};

console.log('target-talent-sequence-advance.test.mjs');
try {
  startSequence('ta', 900001, sequenceId, '2030-01-01');
  let response = await send(900001, 'LinkedIn');
  let entry = getSequence('ta', 900001);
  check(response.status === 200 && entry?.step === 1 && entry.firstChannel === 'linkedin',
    'a Sent LinkedIn message advances a sequence that expects LinkedIn');
  check(expectedNextChannel(entry, getTemplate(sequenceId)) === 'email',
    'a LinkedIn-first sequence expects email for day 1');

  startSequence('ta', 900002, sequenceId, '2030-01-01');
  response = await send(900002, 'Email');
  entry = getSequence('ta', 900002);
  check(response.status === 200 && entry?.step === 1 && entry.firstChannel === 'email',
    'a Sent email advances the channel-flexible day-0 touch');
  check(expectedNextChannel(entry, getTemplate(sequenceId)) === 'linkedin',
    'an email-first sequence expects LinkedIn for day 1');

  startSequence('ta', 900003, sequenceId, '2030-01-01');
  advanceSequence('ta', 900003, '2030-01-01', 'linkedin');
  response = await send(900003, 'Email');
  check(response.status === 200 && getSequence('ta', 900003)?.step === 2,
    'a Sent email advances a sequence that expects email');

  response = await send(900004, 'Email');
  check(response.status === 200 && getSequence('ta', 900004) === null,
    'a Sent message without an active sequence succeeds and creates no sequence');

  startSequence('ta', 900005, sequenceId, '2030-03-01');
  response = await send(900005, 'Email', '2030-03-04 15:30');
  entry = getSequence('ta', 900005);
  check(response.status === 200 && entry?.nextStepDue === '2030-03-05',
    'a backfilled Sent message schedules the next touch from its correspondence date');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\ntarget-talent-sequence-advance: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
