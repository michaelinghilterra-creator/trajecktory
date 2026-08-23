#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { buildTitleFilter } from '../lib/scan-core.mjs';

let passed = 0;
let failed = 0;

function check(condition, label) {
  if (condition) {
    passed++;
    console.log(`  PASS ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}`);
  }
}

const consumerSources = [
  ['discover.mjs', readFileSync('discover.mjs', 'utf8')],
  ['batch/process-scan-candidates.mjs', readFileSync('batch/process-scan-candidates.mjs', 'utf8')],
];

for (const [name, source] of consumerSources) {
  check(!/\.positive\b/.test(source), `${name} has no flat positive access`);
  check(!/positive\.some\(/.test(source), `${name} has no hand rolled positive matcher`);
  check(/buildTitleFilter\(/.test(source), `${name} builds the shared title filter`);
}

const matrixOnly = {
  matrix: {
    seniority: ['manager', 'senior manager'],
    functions_bare: ['revenue operations'],
    functions_ranked: ['revenue strategy'],
  },
  negative: ['junior'],
};
const matrixFilter = buildTitleFilter(matrixOnly);
check(matrixFilter('Senior Manager, Revenue Strategy') === true,
  'matrix only filter admits an invented ranked title');
check(matrixFilter('Junior Revenue Strategy Associate') === false,
  'matrix only filter rejects an invented junior title');

const legacyFilter = buildTitleFilter({ positive: ['signal planning'], negative: ['junior'] });
check(legacyFilter('Signal Planning Lead') === true,
  'legacy flat positive filter still admits a matching title');
check(legacyFilter('Junior Signal Planning Lead') === false,
  'legacy flat positive filter still applies negatives');
check(legacyFilter('Customer Support Lead') === false,
  'legacy flat positive filter still rejects an unrelated title');

const example = yaml.load(readFileSync('templates/portals.example.yml', 'utf8'));
check(Array.isArray(example.title_filter?.matrix?.functions_bare) &&
      example.title_filter.matrix.functions_bare.length > 0,
  'shipped example has nonempty matrix functions_bare');
check(example.title_filter?.positive === undefined,
  'shipped example has no dead positive list');

const exampleFilter = buildTitleFilter(example.title_filter);
check(exampleFilter('Revenue Operations Manager') === true,
  'example filter admits its bare function example');
check(exampleFilter('Director of Analytics') === true,
  'example filter admits its ranked function example');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
