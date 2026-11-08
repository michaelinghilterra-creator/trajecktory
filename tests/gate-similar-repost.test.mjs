#!/usr/bin/env node

import assert from 'node:assert';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { formatTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { makeRepoSandbox } from './helpers/sandbox.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
let passed = 0;
let failed = 0;

function check(fn, message) {
  try {
    fn();
    console.log(`  ok ${message}`);
    passed++;
  } catch (error) {
    console.log(`  fail ${message}`);
    console.log(`    ${error.message}`);
    failed++;
  }
}

const words = [
  'amber', 'birch', 'cobalt', 'delta', 'ember', 'fable', 'garnet', 'harbor',
  'indigo', 'juniper', 'kepler', 'lumen', 'marble', 'nectar', 'opal', 'prairie',
  'quartz', 'ripple', 'saffron', 'timber', 'umber', 'velvet', 'willow', 'xenon',
  'yarrow', 'zephyr', 'acorn', 'brisk', 'cedar', 'drift', 'elmwood', 'frost',
  'grove', 'hearth', 'islet', 'jigsaw', 'kernel', 'lagoon', 'meadow', 'north',
];

function matchingBody(replaceCount = 0) {
  return words.map((word, index) => index < replaceCount
    ? `Specialists cultivate ${word} habitat ${index} through botanical sampling seasonal mapping soil observations field journals and conservation exercises.`
    : `The ${word} team designs invented workflow ${index} with careful planning metrics reviews documentation testing feedback and reliable delivery.`
  ).join(' ');
}

function unrelatedBody() {
  return words.map((word, index) =>
    `A fictional ${word} orchestra ${index} rehearses melodies rhythms harmonies acoustics instruments concerts scores and audience programs nightly.`
  ).join(' ');
}

function snapshot(url, body) {
  return `# Invented Role\nSource: ${url}\nPulled: 2035-05-05\n${body}`;
}

const sandbox = makeRepoSandbox(ROOT, 'gate-similar-repost-test');
mkdirSync(join(sandbox, 'data'), { recursive: true });
mkdirSync(join(sandbox, 'jds'), { recursive: true });
mkdirSync(join(sandbox, 'lib'), { recursive: true });
copyFileSync(join(ROOT, 'gate-pipeline.mjs'), join(sandbox, 'gate-pipeline.mjs'));
copyFileSync(join(ROOT, 'liveness-core.mjs'), join(sandbox, 'liveness-core.mjs'));
for (const file of [
  'sandboxed-chromium.mjs', 'safe-url.mjs', 'identity.mjs', 'gate-history.mjs',
  'local-date.mjs', 'jd-fingerprint.mjs', 'jd-similarity.mjs', 'tracker.mjs',
]) {
  copyFileSync(join(ROOT, 'lib', file), join(sandbox, 'lib', file));
}

writeFileSync(join(sandbox, 'jds', '900001-prior.md'),
  snapshot('https://jobs.example.test/acme/900001', matchingBody()), 'utf8');
writeFileSync(join(sandbox, 'jds', '900002-similar.md'),
  snapshot('https://jobs.example.test/acme/900002', matchingBody(6)), 'utf8');
writeFileSync(join(sandbox, 'jds', '900003-unrelated.md'),
  snapshot('https://jobs.example.test/acme/900003', unrelatedBody()), 'utf8');

const row = formatTrackerLine({
  num: 900001,
  date: '2030-01-01',
  company: 'Acme Example',
  role: 'Principal Widget Architect',
  score: '4.0/5',
  status: 'Passed',
  pdf: '-',
  resume: '-',
  report: '[900001](reports/900001-invented.md)',
  notes: 'invented fixture',
  url: 'https://jobs.example.test/acme/900001',
});
writeFileSync(join(sandbox, 'data', 'applications.md'),
  [TRACKER_HEADER, TRACKER_SEPARATOR, row, ''].join('\n'), 'utf8');
writeFileSync(join(sandbox, 'data', 'pipeline.md'), [
  '- [ ] local:jds/900002-similar.md | Acme Example | Principal Widget Architect',
  '- [ ] local:jds/900003-unrelated.md | Acme Example | Principal Widget Architect',
  '',
].join('\n'), 'utf8');

console.log('gate-similar-repost.test.mjs');
try {
  execFileSync(process.execPath, [join(sandbox, 'gate-pipeline.mjs'), '-'.repeat(2) + 'suppress-only'], {
    cwd: sandbox,
    encoding: 'utf8',
  });
} catch (error) {
  console.log((error.stdout || '') + (error.stderr || error.message));
  process.exit(1);
}

const pipeline = readFileSync(join(sandbox, 'data', 'pipeline.md'), 'utf8');
const drops = readFileSync(join(sandbox, 'data', 'merge-drops.tsv'), 'utf8');
check(() => assert.match(pipeline, /^- \[!\].*similar repost of #900001/m),
  'the similar repost is suppressed with its prior number');
check(() => assert.match(drops, /\tsimilar-repost\t900001\tPassed\tAcme Example\tPrincipal Widget Architect\t/),
  'the similar repost is written to the drop log');
check(() => assert.match(pipeline, /^- \[ \] local:jds\/900003-unrelated\.md/m),
  'the unrelated pending row stays pending');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
