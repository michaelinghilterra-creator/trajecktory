#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildPlainContract } from '../lib/outreach-rubric.mjs';
import { generateWithRubric } from '../dashboard-web/server/lib/draft-grader.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

console.log('draft-contract.test.mjs');

function listModules(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listModules(full));
    else if (entry.name.endsWith('.mjs')) files.push(full);
  }
  return files;
}

const serverRoot = path.join(ROOT, 'dashboard-web', 'server');
const callerFiles = listModules(serverRoot)
  .filter((file) => /\bawait\s+generateWithRubric\s*\(/.test(fs.readFileSync(file, 'utf8')))
  .map((file) => path.relative(ROOT, file).replace(/\\/g, '/'));
const promptFiles = [...new Set([
  ...callerFiles,
  'dashboard-web/server/lib/reply-draft.mjs',
  'dashboard-web/server/lib/linkedin-ssi.mjs',
])];
const bannedSources = [
  'Output ONLY',
  'Return ONLY the (message|reply|comment|post|body|note)',
  'no code fences',
  '^\\s*\\{\\s*"(subject|body)"\\s*:',
];
const conflicts = [];
for (const file of promptFiles) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const pattern of bannedSources) {
    if (new RegExp(pattern, 'im').test(source)) conflicts.push(`${file}: ${pattern}`);
  }
}
check(callerFiles.length >= 4, `source scan discovered ${callerFiles.length} rubric caller files`);
check(conflicts.length === 0, `rubric prompt sources contain no competing output contract${conflicts.length ? ` (${conflicts.join(', ')})` : ''}`);

const emailContract = buildPlainContract('ta_email');
const dmContract = buildPlainContract('ta_dm');
check(emailContract.includes('"subject"') && emailContract.includes('"body"'), 'plain email contract includes subject and body keys');
check(!dmContract.includes('"subject"') && dmContract.includes('"body"'), 'plain direct-message contract includes only the body key');

const priorStrict = process.env.TJK_STRICT_CONTRACT;
const priorFake = process.env.TJK_FAKE_LLM;
process.env.TJK_STRICT_CONTRACT = '1';
process.env.TJK_FAKE_LLM = '1';
let strictThrew = false;
try {
  await generateWithRubric('Output ' + 'ONLY the message body.', 'ta_dm');
} catch {
  strictThrew = true;
}
if (priorStrict === undefined) delete process.env.TJK_STRICT_CONTRACT;
else process.env.TJK_STRICT_CONTRACT = priorStrict;
if (priorFake === undefined) delete process.env.TJK_FAKE_LLM;
else process.env.TJK_FAKE_LLM = priorFake;
check(strictThrew, 'strict contract mode throws on a competing output instruction');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
