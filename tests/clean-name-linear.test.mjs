#!/usr/bin/env node

import assert from 'node:assert/strict';
import { cleanName } from '../dashboard-web/server/lib/contact-identity.mjs';

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  try {
    assert.ok(condition, message);
    passed++;
    console.log(`  ok ${message}`);
  } catch (error) {
    failed++;
    console.error(`  not ok ${message}`);
    console.error(`    ${error.message}`);
  }
};

console.log('clean-name-linear.test.mjs');

// The original implementation, kept here as the reference the new one must match.
function referenceCleanName(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/,.*$/, '')
    .replace(/[^\p{L}\s'-]/gu, ' ')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

const samples = [
  'Example Personone',
  'Example Personone (Maiden Name)',
  'Example (Nick) Personone, MBA',
  'José Example-Personone',
  'Example ((nested) Personone)',
  'Example (unclosed Personone',
  'Example ) stray close ( Personone )',
  '(Example) (Personone)',
  '((((',
  '))))',
  '()',
  '',
  null,
  undefined,
  "O'Example Personone \u{1F600}",
  'Example   Personone\t(x)\n(y) Third',
];
let same = true;
for (const sample of samples) {
  if (cleanName(sample) !== referenceCleanName(sample)) {
    same = false;
    console.error(`    differs for a sample of length ${String(sample ?? '').length}`);
  }
}
check(same, 'cleanName matches the original on ordinary, nested, unclosed and empty names');

let seed = 20310101;
const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
const alphabet = ['(', ')', 'a', 'b', ' ', ',', '-', "'"];
let randomSame = true;
for (let i = 0; i < 400; i++) {
  let text = '';
  const length = next() % 24;
  for (let k = 0; k < length; k++) text += alphabet[next() % alphabet.length];
  if (cleanName(text) !== referenceCleanName(text)) randomSame = false;
}
check(randomSame, 'cleanName matches the original on 400 generated bracket-heavy strings');

const hostile = '('.repeat(200000) + ' Example Personone';
const start = Date.now();
const result = cleanName(hostile);
check(Date.now() - start < 2000 && typeof result === 'string', 'a very long run of unclosed brackets is cleaned in linear time');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
