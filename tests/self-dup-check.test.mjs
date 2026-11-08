#!/usr/bin/env node

import assert from 'node:assert';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';
import { formatTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { checkSelfDuplicate } from '../lib/self-dup-check.mjs';

let passed = 0, failed = 0;
function check(fn, msg) {
  try {
    fn();
    console.log(`  ok ${msg}`);
    passed++;
  } catch (error) {
    console.log(`  fail ${msg}`);
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

function jdBody(replaceCount = 0) {
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

console.log('self-dup-check.test.mjs');

const root = makeSandbox('self-dup-check');
mkdirSync(join(root, 'jds'), { recursive: true });
mkdirSync(join(root, 'reports'), { recursive: true });
const url = 'https://boards.greenhouse.io/acmeexample/jobs/900001';
writeFileSync(join(root, 'jds', '900001-principal-widget-architect.md'),
  `# Principal Widget Architect\nSource: ${url}\nPulled: 2030-01-01\n${jdBody()}\n`, 'utf8');
writeFileSync(join(root, 'reports', '900001-acme-example.md'),
  `{\n  "url": "${url}",\n  "jdSnapshot": "jds/900001-principal-widget-architect.md"\n}\n`, 'utf8');
const row = formatTrackerLine({
  num: 900001,
  date: '2030-01-01',
  company: 'Acme Example',
  role: 'Principal Widget Architect',
  score: '4.0/5',
  status: 'Passed',
  pdf: '-',
  resume: '-',
  report: '[900001](reports/900001-acme-example.md)',
  notes: 'invented fixture',
  url,
});
const appsPath = join(root, 'applications.md');
writeFileSync(appsPath, [TRACKER_HEADER, TRACKER_SEPARATOR, row, ''].join('\n'), 'utf8');

check(() => {
  const hit = checkSelfDuplicate({ url }, { appsPath, rootDir: root });
  assert.equal(hit.kind, 'decided');
  assert.equal(hit.num, 900001);
  assert.equal(hit.status, 'Passed');
  assert.equal(hit.similarity, 1);
}, 'a matching tracker URL returns a decided duplicate');
check(() => {
  const hit = checkSelfDuplicate({ jd: jdBody(6) }, { appsPath, rootDir: root });
  assert.equal(hit.kind, 'similar');
  assert.equal(hit.num, 900001);
  assert.match(hit.message, /#900001/);
}, 'a paraphrased pasted JD returns a similar duplicate');
check(() => assert.equal(checkSelfDuplicate({ jd: unrelatedBody() }, { appsPath, rootDir: root }), null),
  'an unrelated pasted JD returns null');
check(() => assert.equal(checkSelfDuplicate({ url: 'https://jobs.example.test/acme/900099' }, { appsPath, rootDir: root }), null),
  'an unknown URL returns null');
check(() => assert.equal(checkSelfDuplicate({}, { appsPath, rootDir: root }), null),
  'empty input returns null');
check(() => assert.doesNotThrow(() => {
  assert.equal(checkSelfDuplicate({ url }, { appsPath: join(root, 'missing.md'), rootDir: root }), null);
}), 'a missing tracker returns null without throwing');
check(() => assert.doesNotThrow(() => {
  assert.equal(checkSelfDuplicate({ jd: jdBody() }, { appsPath: root, rootDir: root }), null);
}), 'a corrupt tracker path returns null without throwing');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
