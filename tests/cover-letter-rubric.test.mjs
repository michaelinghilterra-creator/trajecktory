#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildCoverLetterPrompt } from '../dashboard-web/server/lib/apply.mjs';

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

console.log('cover-letter-rubric.test.mjs');

const prompt = buildCoverLetterPrompt(
  { company: 'Example Labs', role: 'Applied AI Lead' },
  {
    cvMd: 'Built a verified system that saved $2.3M annually.',
    profileMd: 'Use a direct and precise voice.',
    reportMd: 'The role owns applied AI delivery.',
    proofPoints: [{ name: 'Verified savings', heroMetric: '$2.3M annually' }],
    superpowers: ['Turns ambiguous goals into shipped systems'],
  },
);

check(prompt.includes('== RUBRIC ==') && prompt.includes('== OUTPUT CONTRACT =='),
  'cover letter prompt contains the rubric and its output contract');
check(prompt.includes('== VERIFIABLE CLAIMS ==')
  && prompt.includes('Verified savings')
  && prompt.includes('$2.3M annually'),
  'cover letter prompt contains the verifiable claims block');
check(prompt.includes('== CV EXCERPT ==') && prompt.includes('Built a verified system'),
  'cover letter rubric receives the CV excerpt');

const paragraphRules = [
  'Opening paragraph: why this company and role specifically (2-3 sentences)',
  'Core evidence paragraph: 2-3 specific achievements from the CV most relevant to this role (2-3 sentences)',
  'Closing paragraph: forward-looking, concise call to action (1-2 sentences)',
  '"salutation": e.g. "Dear Hiring Team,"',
  '"closing": e.g. "Sincerely,"',
];
check(prompt.includes('== PARAGRAPH REQUIREMENTS ==') && paragraphRules.every((rule) => prompt.includes(rule)),
  'cover letter prompt retains every field and paragraph rule');
check(!/Output ONLY|no code fences|Output format \(raw JSON only/i.test(prompt),
  'cover letter prompt has no competing output instruction');

const applySource = fs.readFileSync(path.join(ROOT, 'dashboard-web', 'server', 'lib', 'apply.mjs'), 'utf8');
check(applySource.includes('runClaudeSubprocess(coverJsonPrompt, 2200)'),
  'cover letter generation reserves at least 2200 tokens');
check(/result:\s*produced\s*\?[\s\S]*?review,[\s\S]*?reviewStatus,/.test(applySource),
  'cover letter job result carries review and review status');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
