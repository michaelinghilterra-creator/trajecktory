#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('sequences-advance-route');
process.env.TJK_DATA_DIR = sandbox;

const talentHeader = '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
const talentRow = ({ id, email = '', linkedin = '' }) => `| ${id} | Example Works | Example | Person${id} | Mx. | Recruiter | Austin | TX | 78701 | | ${email} | ${linkedin} | Not Contacted | | | https://example.test |\n`;
const verifiedEmail = id => `person${id}@example.test [v:ok:manual:2030-01-01]`;
fs.writeFileSync(path.join(sandbox, 'target-talent.md'), talentHeader + [
  talentRow({ id: 940001, email: verifiedEmail(940001), linkedin: 'https://linkedin.example/940001' }),
  talentRow({ id: 940002, email: verifiedEmail(940002) }),
  talentRow({ id: 940003, email: verifiedEmail(940003), linkedin: 'https://linkedin.example/940003' }),
  talentRow({ id: 940004, email: verifiedEmail(940004), linkedin: 'https://linkedin.example/940004' }),
].join(''), 'utf8');

const { getSequence, startSequence } = await import('../dashboard-web/server/lib/sequences.mjs');
const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/sequences.mjs');

const CADENCE = 'application-day-0-1-5-12';
startSequence('ta', 940001, CADENCE, '2030-02-01');
startSequence('ta', 940002, CADENCE, '2030-03-01');
startSequence('ta', 940003, CADENCE, '2030-04-01');
startSequence('ta', 940004, 'cold-intro-principal', '2030-05-01');

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};

const web = express();
web.use(express.json());
web.use(router);
const server = web.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const advance = (id, body) => fetch(`${base}/api/sequences/ta/${id}/advance`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(async response => ({ status: response.status, body: await response.json() }));

console.log('sequences-advance-route.test.mjs');
try {
  let response = await advance(940001, { date: '2030-02-01' });
  let state = getSequence('ta', 940001);
  check(response.status === 200 && state.firstChannel === 'linkedin'
    && state.step === 1 && state.nextStepDue === '2030-02-02',
  'a mixed cadence defaults day 0 to LinkedIn and lands on the day-1 email touch');

  response = await advance(940002, { date: '2030-03-01' });
  state = getSequence('ta', 940002);
  check(response.status === 200 && state.firstChannel === 'email'
    && state.step === 2 && state.nextStepDue === '2030-03-06',
  'an email-only contact defaults day 0 to email and skips the unavailable day-1 touch');

  response = await advance(940003, { date: '2030-04-01', channel: 'EMAIL' });
  state = getSequence('ta', 940003);
  check(response.status === 200 && state.firstChannel === 'email'
    && state.step === 1 && state.nextStepDue === '2030-04-02',
  'an explicit case-insensitive channel overrides the LinkedIn preference');

  response = await advance(940004, { date: '2030-05-03' });
  state = getSequence('ta', 940004);
  check(response.status === 200 && state.step === 1 && state.nextStepDue === '2030-05-10'
    && !Object.hasOwn(state, 'firstChannel') && !Object.hasOwn(state, 'anchorDate'),
  'a legacy single-channel template keeps its previous relative advance behavior');

  const before = getSequence('ta', 940001);
  response = await advance(940001, { date: '2030-02-03', channel: 'sms' });
  check(response.status === 400 && getSequence('ta', 940001).step === before.step,
    'an unknown channel is rejected with 400 and leaves the sequence untouched');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\nsequences advance route: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
