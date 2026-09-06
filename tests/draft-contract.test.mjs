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
const graderPath = path.join(serverRoot, 'lib', 'draft-grader.mjs');
const moduleSources = listModules(serverRoot).map((file) => ({ file, source: fs.readFileSync(file, 'utf8') }));
const generatedCallerFiles = moduleSources
  .filter(({ source }) => /\bawait\s+generateWithRubric\s*\(/.test(source))
  .map(({ file }) => path.relative(ROOT, file).replace(/\\/g, '/'));
const directCallerFiles = moduleSources
  .filter(({ file, source }) => file !== graderPath && /\bbuildRubricBlock\s*\(/.test(source))
  .map(({ file }) => path.relative(ROOT, file).replace(/\\/g, '/'));
const callerFiles = [...new Set([...generatedCallerFiles, ...directCallerFiles])];
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
const scannedRegions = new Map();
for (const file of promptFiles) {
  const fullSource = fs.readFileSync(path.join(ROOT, file), 'utf8');
  let source = fullSource;
  // A file may hold both rubric-graded and deliberately ungraded prompts, so
  // scanning it whole would false-positive on the ungraded ones (apply.mjs keeps
  // a length-locked CV-slot prompt that must retain its own output instruction).
  // Narrow to the function enclosing each rubric call. Scan EVERY call, not just
  // the first: checking only one is the same blind spot this test exists to
  // close, and it would silently skip a second rubric prompt added later.
  if (directCallerFiles.includes(file) && !generatedCallerFiles.includes(file)) {
    const regions = [];
    for (const call of fullSource.matchAll(/\bbuildRubricBlock\s*\(/g)) {
      const callIndex = call.index;
      const functionStarts = [...fullSource.slice(0, callIndex).matchAll(/(?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*\{/g)];
      const start = functionStarts.length ? functionStarts[functionStarts.length - 1].index : 0;
      const end = fullSource.indexOf('\n}', callIndex);
      regions.push(fullSource.slice(start, end < 0 ? fullSource.length : end + 2));
    }
    scannedRegions.set(file, regions.length);
    source = regions.join('\n');
  }
  for (const pattern of bannedSources) {
    if (new RegExp(pattern, 'im').test(source)) conflicts.push(`${file}: ${pattern}`);
  }
}
check(callerFiles.length >= 4, `source scan discovered ${callerFiles.length} rubric caller files`);
// Every rubric call in a mixed file must contribute a scanned region. A zero here
// would mean the narrowing silently scanned nothing and the conflict check below
// is vacuously passing.
for (const [file, count] of scannedRegions) {
  check(count > 0, `${file}: narrowed scan covered ${count} rubric call site(s)`);
}
check(callerFiles.includes('dashboard-web/server/lib/apply.mjs'), 'source scan covers the direct cover letter rubric caller');
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
