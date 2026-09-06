#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import { readOptionalProjectFile, readProjectFile } from '../dashboard-web/server/lib/anthropic.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let passed = 0;
let failed = 0;

function check(condition, message, details = []) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
    return;
  }
  console.log(`  ❌ ${message}`);
  for (const detail of details) console.log(`       ${detail}`);
  failed++;
}

console.log('project-file-sentinel.test.mjs');

const tempRoot = makeSandbox('project-file-sentinel');
const missingPath = 'missing.md';
check(
  readOptionalProjectFile(tempRoot, missingPath) === '',
  'optional reads return an empty string for a missing file',
);
check(
  readProjectFile(tempRoot, missingPath) === `[${missingPath} not found]`,
  'required reads retain the missing file sentinel',
);

const content = 'Named artifact with a quantified result.\n';
writeFileSync(join(tempRoot, 'proof.md'), content, 'utf8');
check(
  readOptionalProjectFile(tempRoot, 'proof.md') === content,
  'optional reads return existing content unchanged',
);

const bracketLeadingContent = '[Name](https://example.com)\n\nExperienced operator.\n';
writeFileSync(join(tempRoot, 'bracket-leading.md'), bracketLeadingContent, 'utf8');
check(
  readOptionalProjectFile(tempRoot, 'bracket-leading.md') === bracketLeadingContent,
  'optional reads preserve files whose content legitimately starts with a bracket',
);

const routesDir = join(ROOT, 'dashboard-web', 'server', 'routes');
const routeFiles = readdirSync(routesDir)
  .filter((name) => name.endsWith('.mjs'))
  .map((name) => join(routesDir, name));
const bareDigestReads = [];
for (const file of routeFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/\barticleDigestMd\s*=\s*(?:await\s+)?readProjectFile\s*\(/g)) {
    const line = source.slice(0, match.index).split('\n').length;
    bareDigestReads.push(`${relative(ROOT, file).split(sep).join('/')}:${line}`);
  }
}
check(
  bareDigestReads.length === 0,
  'draft routes never load articleDigestMd with the required file reader',
  bareDigestReads,
);

const promptFiles = [
  'dashboard-web/server/lib/reply-draft.mjs',
  'dashboard-web/server/routes/target-talent.mjs',
  'dashboard-web/server/routes/referrals.mjs',
  'dashboard-web/server/routes/linkedin-drafts.mjs',
  'dashboard-web/server/routes/followups.mjs',
  'dashboard-web/server/routes/posts.mjs',
  'dashboard-web/server/routes/drafts.mjs',
];
const emDash = String.fromCodePoint(0x2014);
const badHeaders = [];
for (const relPath of promptFiles) {
  const lines = readFileSync(join(ROOT, relPath), 'utf8').split('\n');
  lines.forEach((line, index) => {
    const hasPromptHeader = /(?:^|[^=])== [^\r\n]* ==(?:[^=]|$)/.test(line);
    if (hasPromptHeader && line.includes(emDash)) {
      badHeaders.push(`${relPath}:${index + 1}`);
    }
  });
}
check(
  badHeaders.length === 0,
  'prompt headers in the touched files contain no em dash',
  badHeaders,
);

console.log(`\n${failed === 0 ? '🟢' : '🔴'} project file sentinel: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
