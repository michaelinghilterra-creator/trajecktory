#!/usr/bin/env node

import assert from 'node:assert';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';
import { formatTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import {
  MIN_JD_WORDS,
  buildSimilarityIndex,
  findSimilarPosting,
  jdShingles,
  jdSimilarity,
  similarRepostFor,
  snapshotBody,
} from '../lib/jd-similarity.mjs';

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

const dutyWords = [
  'amber', 'birch', 'cobalt', 'delta', 'ember', 'fable', 'garnet', 'harbor',
  'indigo', 'juniper', 'kepler', 'lumen', 'marble', 'nectar', 'opal', 'prairie',
  'quartz', 'ripple', 'saffron', 'timber', 'umber', 'velvet', 'willow', 'xenon',
  'yarrow', 'zephyr', 'acorn', 'brisk', 'cedar', 'drift', 'elmwood', 'frost',
  'grove', 'hearth', 'islet', 'jigsaw', 'kernel', 'lagoon', 'meadow', 'north',
];

function dutySentence(word, index) {
  return `The ${word} team designs invented workflow ${index} with careful planning metrics reviews documentation testing feedback and reliable delivery.`;
}

function alternateSentence(word, index) {
  return `Specialists cultivate ${word} habitat ${index} through botanical sampling seasonal mapping soil observations field journals and conservation exercises.`;
}

function jdBody(replaceCount = 0) {
  return dutyWords.map((word, index) => (
    index < replaceCount ? alternateSentence(word, index) : dutySentence(word, index)
  )).join(' ');
}

function unrelatedBody() {
  return dutyWords.map((word, index) => (
    `A fictional ${word} orchestra ${index} rehearses melodies rhythms harmonies acoustics instruments concerts scores and audience programs nightly.`
  )).join(' ');
}

function snapshot(url, body) {
  return `# Invented Role\nSource: ${url}\nPulled: 2035-05-05\n${body}`;
}

console.log('jd-similarity.test.mjs');

console.log('\n1. shingles and similarity');
check(() => assert.equal(jdShingles(Array(MIN_JD_WORDS - 1).fill('token').join(' ')), null),
  'jdShingles returns null below the word minimum');
check(() => assert.ok(jdShingles(Array(MIN_JD_WORDS).fill('token').join(' ')) instanceof Set),
  'jdShingles returns a Set at the word minimum');

const original = jdBody();
const replaced = jdBody(8);
const unrelated = unrelatedBody();
check(() => assert.equal(jdSimilarity(original, original), 1),
  'identical text has similarity 1');
check(() => assert.ok(jdSimilarity(original, replaced) > 0.5 && jdSimilarity(original, replaced) < 0.95),
  'a body with one fifth of its sentences replaced remains a partial match');
check(() => assert.ok(jdSimilarity(original, unrelated) < 0.1),
  'unrelated invented text has similarity below 0.1');

const firstHeaders = `# Principal Widget Architect\nSource: https://jobs.example.test/acme/900001\nPulled: 2030-01-01\n${original}`;
const secondHeaders = `# Alternate Heading\nSource: https://boards.example.test/acme/900099\nPulled: 2039-12-31\n${original}`;
check(() => assert.equal(jdSimilarity(firstHeaders, secondHeaders), 1),
  'metadata headers do not affect similarity');

console.log('\n2. snapshotBody');
const root = makeSandbox('jd-similarity');
mkdirSync(join(root, 'jds'), { recursive: true });
mkdirSync(join(root, 'reports'), { recursive: true });
writeFileSync(join(root, 'jds', 'a.md'), snapshot('https://jobs.example.test/acme/900001', original), 'utf8');
writeFileSync(join(root, 'secret.md'), 'secret fixture', 'utf8');
check(() => assert.match(snapshotBody('local:jds/a.md', root), /Invented Role/),
  'snapshotBody reads a snapshot inside jds');
check(() => assert.equal(snapshotBody('local:jds/../secret.md', root), null),
  'snapshotBody rejects a path outside jds');

console.log('\n3. similarity index');
const fixtures = [
  {
    num: 900001,
    date: '2030-01-01',
    company: 'Acme Example',
    role: 'Principal Widget Architect',
    status: 'Passed',
    url: 'https://jobs.example.test/acme/900001',
    body: original,
  },
  {
    num: 900002,
    date: '2031-02-02',
    company: 'Acme Example',
    role: 'Network Steward',
    status: 'Applied',
    url: 'https://jobs.example.test/acme/900002',
    body: unrelated,
  },
  {
    num: 900003,
    date: '2032-03-03',
    company: 'Globex Sample',
    role: 'Principal Widget Architect',
    status: 'Evaluated',
    url: 'https://jobs.example.test/globex/900003',
    body: original,
  },
];

const rows = [];
for (const fixture of fixtures) {
  const slug = `${fixture.num}-invented-role.md`;
  writeFileSync(join(root, 'jds', slug), snapshot(fixture.sourceUrl || fixture.url, fixture.body), 'utf8');
  writeFileSync(join(root, 'reports', `${fixture.num}-invented-report.md`),
    `{\n  "url": "${fixture.url}",\n  "jdSnapshot": "jds/${slug}"\n}\n`, 'utf8');
  rows.push(formatTrackerLine({
    num: fixture.num,
    date: fixture.date,
    company: fixture.company,
    role: fixture.role,
    score: '4.0/5',
    status: fixture.status,
    pdf: '-',
    resume: '-',
    report: `[${fixture.num}](reports/${fixture.num}-invented-report.md)`,
    notes: 'invented fixture',
    url: fixture.url,
  }));
}
const appsPath = join(root, 'applications.md');
writeFileSync(appsPath, [TRACKER_HEADER, TRACKER_SEPARATOR, ...rows, ''].join('\n'), 'utf8');

const companies = new Set(['acmeexample', 'globexsample']);
const index = buildSimilarityIndex({ appsPath, rootDir: root, companies });
check(() => assert.deepEqual(index.get('acmeexample').map((entry) => entry.status), ['Passed', 'Applied']),
  'the index includes rows across tracker statuses');

const query = {
  company: 'Acme Example',
  role: 'Principal Widget Architect',
  text: jdBody(6),
  url: 'https://boards.example.test/acme/900099',
  rootDir: root,
};
check(() => {
  const hit = findSimilarPosting(index, query);
  assert.equal(hit.num, 900001);
  assert.equal(hit.status, 'Passed');
}, 'a paraphrased repost with a different URL matches the Passed row');
check(() => assert.equal(findSimilarPosting(index, { ...query, role: 'Network Steward' }), null),
  'the same text under a different role does not match');
check(() => assert.equal(findSimilarPosting(index, { ...query, company: 'Umbra Fiction' }), null),
  'the same text for a different company does not match');
check(() => assert.equal(findSimilarPosting(index, { ...query, url: fixtures[0].url }), null),
  'a candidate with an identical canonical URL is skipped');
check(() => assert.equal(buildSimilarityIndex({ appsPath, rootDir: root, companies: new Set() }).size, 0),
  'an empty companies set returns an empty Map');

console.log('\n4. similar repost helper');
writeFileSync(join(root, 'jds', 'pending.md'),
  snapshot('https://boards.example.test/acme/900099', jdBody(6)), 'utf8');
const pending = {
  company: 'Acme Example',
  role: 'Principal Widget Architect',
  text: jdBody(6),
  url: 'https://boards.example.test/acme/900099',
  local: 'local:jds/pending.md',
};
check(() => {
  const hit = similarRepostFor(index, pending, root);
  assert.equal(hit.num, 900001);
  assert.equal(hit.status, 'Passed');
  assert.equal(typeof hit.similarity, 'number');
  assert.ok(hit.similarity >= 0.6);
}, 'a pending paraphrased snapshot matches the Passed row');
check(() => assert.equal(similarRepostFor(index, { ...pending, local: '' }, root), null),
  'a pending entry without a local snapshot returns null');
check(() => assert.equal(similarRepostFor(index, { ...pending, local: 'local:jds/../secret.md' }, root), null),
  'a pending snapshot path outside jds returns null');
check(() => assert.equal(similarRepostFor(index, { ...pending, role: 'Network Steward' }, root), null),
  'a pending entry with a different role returns null');

rmSync(root, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
