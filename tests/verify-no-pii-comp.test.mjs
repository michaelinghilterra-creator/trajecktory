#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox } from './helpers/sandbox.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceGate = join(repoRoot, 'verify-no-pii.mjs');

let passed = 0;
let failed = 0;
let payloadId = 0;

function check(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}`);
  }
}

const profile = [
  'candidate:',
  '  full_name: "Avery Example"',
  '  email: "avery@example.test"',
  '  phone: "+1-555-0142"',
  'compensation:',
  '  target_range: "$123K-146K"',
  '  minimum: "$117K"',
  '',
].join('\n');

function makeRoot(profileText = profile) {
  const root = makeRepoSandbox(repoRoot, 'pii-comp');
  copyFileSync(sourceGate, join(root, 'verify-no-pii.mjs'));
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'config', 'profile.yml'), profileText);
  return root;
}

function run(root, args = []) {
  const result = spawnSync(process.execPath, [join(root, 'verify-no-pii.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return {
    code: result.status,
    out: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function scan(root, files) {
  const payload = join(root, `payload-${++payloadId}`);
  mkdirSync(payload, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const target = join(payload, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return run(root, ['--payload', payload]);
}

function initRepo(root) {
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Avery Example'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'avery@example.test'], { cwd: root });
}

console.log('\n🧪 verify-no-pii compensation figures\n');

console.log('1. Payload figures are detected and masked');
{
  const root = makeRoot();
  const result = scan(root, {
    'comp.yml': 'compensation:\n  target_base: 123000\n',
    'comp-prose.md': 'My target base salary is $123k.\n',
    'comma.md': 'The offer is $146,000.\n',
    'usd.md': 'The package is USD 117000.\n',
  });
  check(result.code === 1, 'payload scan exits 1');
  check(/\[COMP FIGURE\]/.test(result.out), 'payload scan uses the COMP FIGURE label');
  check(/comp\.yml:2/.test(result.out), 'finding includes file and line number');
  check(!/123000|123k|146,000|117000/i.test(result.out), 'output never prints an unmasked figure');
}

console.log('\n2. Similar numbers do not produce false positives');
{
  const negatives = [
    ['timeout without context', 'timeout: 123000\n'],
    ['larger containing number', 'salary audit value 1123000\n'],
    ['different decimal value', 'salary audit value 123000.5\n'],
    ['dotted version', 'salary parser version 1.123000.0\n'],
    ['hex id', 'salary audit id deadbeef123000cafe\n'],
    ['different salary', 'salary is $124K\n'],
  ];
  for (const [label, body] of negatives) {
    const root = makeRoot();
    const result = scan(root, { 'only.md': body });
    check(result.code === 0, label);
  }
}

console.log('\n3. Attribution allowlists do not exempt compensation');
{
  const root = makeRoot();
  const result = scan(root, { 'README.md': '$146K salary\n' });
  check(result.code === 1 && /\[COMP FIGURE\].*README\.md:1/.test(result.out), 'README figure is flagged');
}

console.log('\n4. Profile formats are normalized into exact spellings');
{
  const formatProfile = [
    'candidate:',
    '  full_name: "Avery Example"',
    '  email: "avery@example.test"',
    '  phone: "+1-555-0142"',
    'compensation:',
    '  target_range: "121-148K"',
    '  bonus: "185,000"',
    '  equity: "$187.5K"',
    '  other: "95k to 135k"',
    'preferences:',
    '  salary_floor: 163500',
    '',
  ].join('\n');
  const root = makeRoot(formatProfile);
  const result = scan(root, {
    'plain.md': 'salary 121000\n',
    'short.md': 'salary $148K\n',
    'comma.md': 'offer $185,000\n',
    'decimal.md': 'salary 187.5k\n',
    'range.md': 'salary band 95000 to 135000\n',
    'outside-key.md': 'USD 163500\n',
  });
  check(result.code === 1 && /derived:.*7 comp figures/.test(result.out), 'ranges, commas, decimals, and compensation keys are derived');
}

console.log('\n5. Tracked, staged, and message scans use the shared matcher');
{
  const root = makeRoot();
  initRepo(root);
  writeFileSync(join(root, 'public.md'), 'Expected salary: $123K\n');
  execFileSync('git', ['add', 'public.md'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'add public example'], { cwd: root });
  const result = run(root);
  check(result.code === 1 && /\[COMP FIGURE\].*public\.md:1/.test(result.out), 'tracked tree figure is flagged');
}
{
  const root = makeRoot();
  initRepo(root);
  writeFileSync(join(root, 'staged.md'), 'Expected salary: $123K\n');
  execFileSync('git', ['add', 'staged.md'], { cwd: root });
  const result = run(root, ['--staged']);
  check(result.code === 1 && /\[COMP FIGURE\].*staged\.md:1/.test(result.out), 'staged figure is flagged');
}
{
  const root = makeRoot();
  initRepo(root);
  writeFileSync(join(root, 'seed.md'), 'seed\n');
  execFileSync('git', ['add', 'seed.md'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'initial snapshot'], { cwd: root });
  writeFileSync(join(root, 'seed.md'), 'next\n');
  execFileSync('git', ['add', 'seed.md'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'target base $123K'], { cwd: root });
  const result = run(root, ['--messages', 'HEAD~1..HEAD']);
  check(result.code === 1 && /\[COMP FIGURE\].*commit .*:1/.test(result.out), 'commit message figure is flagged');
  check(/derived:.*3 comp figures/.test(result.out), 'message summary includes the comp figure count');
}

console.log('\n6. Derivation health and summary are explicit');
{
  const invalidProfile = [
    'candidate:',
    '  full_name: "Avery Example"',
    '  email: "avery@example.test"',
    '  phone: "+1-555-0142"',
    'compensation:',
    '  minimum: 19',
    '',
  ].join('\n');
  const root = makeRoot(invalidProfile);
  const result = scan(root, { 'clean.md': 'nothing sensitive\n' });
  check(result.code === 2, 'unusable compensation derivation exits 2');
  check(/compensation block containing digits but yielded 0 compensation figures/i.test(result.out), 'health failure explains the broken compensation derivation');
}
{
  const root = makeRoot();
  const result = scan(root, { 'clean.md': 'nothing sensitive\n' });
  check(result.code === 0 && /derived:.*3 comp figures/.test(result.out), 'summary includes the comp figure count');
}

console.log('\n7. Unicode range separators propagate shorthand suffixes');
{
  const unicodeRangeProfile = [
    'candidate:',
    '  full_name: "Avery Example"',
    '  email: "avery@example.test"',
    '  phone: "+1-555-0142"',
    'compensation:',
    '  target_range: "123\u2013146K"',
    '  bonus_range: "117\u2014129K"',
    '',
  ].join('\n');
  const root = makeRoot(unicodeRangeProfile);
  const result = scan(root, { 'ranges.md': 'salary figures 123000 and 117000\n' });
  const figureHits = result.out.match(/\[COMP FIGURE\]/g) || [];
  check(result.code === 1 && figureHits.length === 2, 'both unicode range separators propagate K');
}

console.log('\n8. Zero-only fractional suffixes retain the same figure');
{
  const root = makeRoot();
  const result = scan(root, {
    'one-zero.md': 'salary 123000.0\n',
    'two-zero.md': 'salary 123,000.00\n',
  });
  const figureHits = result.out.match(/\[COMP FIGURE\]/g) || [];
  check(result.code === 1 && figureHits.length === 2, 'one or two zero decimal places are flagged');
  const longer = scan(makeRoot(), { 'longer.md': 'salary 123000.000\n' });
  check(longer.code === 0, 'a longer zero fraction remains a different value');
}

console.log('\n9. Currency codes and symbols count as prefixes');
{
  const root = makeRoot();
  const result = scan(root, {
    'eur-tight.md': 'EUR123K\n',
    'eur-space.md': 'EUR 123000\n',
    'gbp.md': 'GBP146K\n',
    'cad.md': 'CAD 117000\n',
    'aud.md': 'AUD123,000\n',
    'usd.md': 'USD146000\n',
    'euro.md': '€117K\n',
    'pound.md': '£123K\n',
    'dollar.md': '$146K\n',
  });
  const figureHits = result.out.match(/\[COMP FIGURE\]/g) || [];
  check(result.code === 1 && figureHits.length === 9, 'all supported currency prefixes are flagged');
}

console.log('\n10. Field identifiers provide compensation context');
{
  const root = makeRoot();
  const result = scan(root, {
    'fields.yml': [
      'compStated: 123000',
      'targetBase: 123000',
      'baseSalary: 123000',
      'salary_band: 123000',
      'walkAwayValue: 123000',
      '',
    ].join('\n'),
  });
  const figureHits = result.out.match(/\[COMP FIGURE\]/g) || [];
  check(result.code === 1 && figureHits.length === 5, 'camel and snake field names provide context');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
