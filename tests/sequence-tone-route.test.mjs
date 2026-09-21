#!/usr/bin/env node
// The TA draft route must hand the live sequence's channel-matched tone to the prompt it sends to the model:
// the email draft and the fresh LinkedIn draft, and nothing when the next touch expects the other channel.
// The prompt is captured through the fake model seam (TJK_FAKE_LLM_PROMPT_LOG), so this exercises the real route.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('sequence-tone-route');
process.env.TJK_DATA_DIR = sandbox;
process.env.TJK_FAKE_LLM = '1';
const promptLog = path.join(sandbox, 'prompts.jsonl');
process.env.TJK_FAKE_LLM_PROMPT_LOG = promptLog;

fs.writeFileSync(path.join(sandbox, 'target-talent.md'),
  '# Target Talent\n\n' +
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n' +
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n' +
  '| 900001 | Zorblax Widgetry | Personone | Example | Mx. | Recruiter | Austin | TX | 78701 | | example.personone@example.test | linkedin.com/in/example-personone-ex | Not Contacted | | | |\n',
  'utf8');

const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/target-talent.mjs');
const { startSequence, advanceSequence } = await import('../dashboard-web/server/lib/sequences.mjs');

const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};

const draft = async (channel) => {
  fs.rmSync(promptLog, { force: true });
  const response = await fetch(`${base}/api/target-talent/900001/draft`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel }),
  });
  const lines = fs.existsSync(promptLog) ? fs.readFileSync(promptLog, 'utf8').split('\n').filter(Boolean) : [];
  return { status: response.status, prompts: lines.map((line) => JSON.parse(line).prompt) };
};

console.log('sequence-tone-route.test.mjs');
try {
  let result = await draft('email');
  check(result.status === 200 && result.prompts.length > 0 && result.prompts.every((p) => !p.includes('SEQUENCE TONE')),
    'with no sequence, the email draft prompt carries no sequence tone');

  startSequence('ta', 900001, 'application-day-0-1-5-12', '2030-01-01');

  result = await draft('email');
  check(result.prompts.some((p) => p.includes('SEQUENCE TONE: Brief and professional')),
    'day 0 email draft carries the email variant of the first touch tone');

  result = await draft('linkedin');
  check(result.prompts.some((p) => p.includes('SEQUENCE TONE: Under 300 characters')),
    'day 0 LinkedIn draft carries the LinkedIn first touch tone');

  advanceSequence('ta', 900001, '2030-01-01', 'linkedin');
  advanceSequence('ta', 900001, '2030-01-02', 'email');

  result = await draft('email');
  check(result.prompts.some((p) => p.includes('SEQUENCE TONE: Short check-in')),
    'the day 5 email draft carries the follow-up tone');

  result = await draft('linkedin');
  check(result.prompts.length > 0 && result.prompts.every((p) => !p.includes('SEQUENCE TONE')),
    'a LinkedIn draft while the next touch expects email carries no sequence tone');
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log(`\nsequence-tone-route: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
