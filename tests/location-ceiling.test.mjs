#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LOCATION_CEILINGS,
  buildDepthCeiling,
  loadScoringWeights,
  locationCeiling,
} from '../lib/score.mjs';
import { deriveReportScore } from '../compute-scores.mjs';
import { cleanSandboxes, makeRepoSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
const check = (condition, label) => {
  if (condition) passed++;
  else {
    failed++;
    console.error(`  FAIL: ${label}`);
  }
};
const same = (actual, expected, label) => check(
  JSON.stringify(actual) === JSON.stringify(expected),
  `${label} (got ${JSON.stringify(actual)})`,
);

const CFG = {
  weights: { fit: 0.35, northStar: 0.25, level: 0.15, comp: 0, location: 0.10, buildDepth: 0 },
  redFlagPenalty: 1.5,
  minimumLevel: 'Manager',
  compMinimum: 120000,
  nonManagementTitles: [],
  buildDepthCeilings: { 0: 2, 1: 2, 2: 3 },
};

function ratings(location = 5, buildDepth = 5) {
  return [
    { key: 'fit', dim: 'Fit', val: 5, max: 5 },
    { key: 'northStar', dim: 'North Star', val: 5, max: 5 },
    { key: 'level', dim: 'Level', val: 5, max: 5 },
    { key: 'comp', dim: 'Comp', val: 5, max: 5 },
    { key: 'location', dim: 'Location', val: location, max: 5 },
    { key: 'buildDepth', dim: 'Build', val: buildDepth, max: 5 },
    { key: 'redFlags', dim: 'Red Flags', val: 5, max: 5 },
  ];
}

function report(extra = {}) {
  const fm = {
    schema: 'trajecktory-report/v1',
    id: 1,
    company: 'Acme',
    role: 'Director of Examples',
    date: '2026-01-01',
    url: 'https://jobs.example.test/example',
    jdSnapshot: 'Example role',
    summary: { seniority: 'Director', compStated: '$150,000 to $180,000 base' },
    globalScore: ratings(),
    ...extra,
  };
  return `---\n${JSON.stringify(fm, null, 2)}\n---\n\n## Example\n\nInvented fixture.\n`;
}

const derive = (extra = {}, options = {}) => deriveReportScore(report(extra), { ...CFG, ...options });

console.log('location ceiling helper');
for (const rating of [0, 0.5, 1]) {
  same(locationCeiling(rating), { ceiling: 1.5, reason: `rating-${rating}` }, `rating ${rating} caps at 1.5`);
}
for (const rating of [1.5, 2, 3, 5]) {
  same(locationCeiling(rating), { ceiling: null, reason: 'rating-adds-no-ceiling' }, `rating ${rating} adds no cap`);
}
same(locationCeiling('1'), { ceiling: 1.5, reason: 'rating-1' }, 'string rating is coerced');
for (const rating of [null, undefined, 'abc']) {
  same(locationCeiling(rating), { ceiling: null, reason: 'no-rating' }, `${String(rating)} fails open`);
}
same(locationCeiling(2, { ceilings: { 2: 2.5 } }), { ceiling: 2.5, reason: 'rating-2' }, 'custom map is honored');
same(locationCeiling(1, { ceilings: {} }), { ceiling: null, reason: 'rating-adds-no-ceiling' }, 'empty map disables caps');

console.log('build depth helper remains stable');
same(buildDepthCeiling(0), { ceiling: 2, reason: 'rating-0' }, 'build depth 0');
same(buildDepthCeiling(1), { ceiling: 2, reason: 'rating-1' }, 'build depth 1');
same(buildDepthCeiling(2), { ceiling: 3, reason: 'rating-2' }, 'build depth 2');
same(buildDepthCeiling(3), { ceiling: null, reason: 'rating-adds-no-ceiling' }, 'build depth 3');
same(buildDepthCeiling('2'), { ceiling: 3, reason: 'rating-2' }, 'build depth string rating');

console.log('profile map loading');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = makeRepoSandbox(repoRoot, 'location-ceiling');
const writeProfile = (name, yaml) => {
  const file = path.join(sandbox, name);
  fs.writeFileSync(file, yaml, 'utf8');
  return file;
};
const defaults = loadScoringWeights(writeProfile('default.yml', 'name: Example\n'));
same(defaults.locationCeilings, { ...DEFAULT_LOCATION_CEILINGS }, 'missing scoring uses location defaults');
const override = loadScoringWeights(writeProfile('override.yml', 'scoring:\n  location_ceilings:\n    2: 2.5\n'));
same(override.locationCeilings, { 2: 2.5 }, 'location override is honored');
const empty = loadScoringWeights(writeProfile('empty.yml', 'scoring:\n  location_ceilings: {}\n'));
same(empty.locationCeilings, {}, 'empty location map disables policy');
const invalid = loadScoringWeights(writeProfile('invalid.yml', 'scoring:\n  location_ceilings:\n    0: -1\n    1: nope\n    2: 2.5\n    6: 1\n'));
same(invalid.locationCeilings, { 2: 2.5 }, 'invalid location entries are dropped');
const buildMap = loadScoringWeights(writeProfile('build.yml', 'scoring:\n  build_depth_ceilings:\n    0: 1.25\n    1: null\n    2: 2.75\n    bad: 1\n'));
same(buildMap.buildDepthCeilings, { 0: 1.25, 2: 2.75 }, 'build depth map parsing is unchanged');

console.log('report derivation');
let result = derive();
check(result.ok && result.score === 5, `location 5 derives 5 (got ${result.score})`);
result = derive({ globalScore: ratings(1) });
check(result.ok && result.score === 1.5, `location 1 caps at 1.5 (got ${result.score})`);
check(result.scoreBasis.ceilingApplied === true, 'location 1 marks the ceiling applied');
check(result.scoreBasis.ceiling === 1.5, 'location 1 records ceiling 1.5');
result = derive({ globalScore: ratings(0.5) });
check(result.ok && result.score === 1.5, `location 0.5 caps at 1.5 (got ${result.score})`);
result = derive({ globalScore: ratings(2) });
check(result.ok && result.score > 1.5 && !('ceiling' in result.scoreBasis), 'location 2 is not capped');
result = derive({ globalScore: ratings(1), scoreCeiling: 1, ceilingBasis: 'location' });
check(result.ok && result.score === 1, `lower authored location cap stays 1 (got ${result.score})`);
result = derive({ globalScore: ratings(5), scoreCeiling: 1, ceilingBasis: 'location' });
check(result.ok && result.score === 1, 'authored location judgment stays when rating is above 1');
result = derive({ globalScore: ratings(1), scoreCeiling: 1, ceilingBasis: 'comp' });
check(result.ok && result.score === 1.5, `cleared comp cap still gets location cap (got ${result.score})`);
result = derive({ globalScore: ratings(1, 5), scoreCeiling: 1, ceilingBasis: 'buildDepth' });
check(result.ok && result.score === 1.5, `cleared build cap still gets location cap (got ${result.score})`);
result = derive(
  { globalScore: ratings(1, 0), scoreCeiling: 4, ceilingBasis: 'buildDepth' },
  { buildDepthCeilings: { 0: 1.25 } },
);
check(result.ok && result.score === 1.3 && result.scoreBasis.ceiling === 1.25, `lower build cap wins (got ${result.score})`);
result = derive({ globalScore: ratings(1) }, { locationCeilings: {} });
check(result.ok && result.score > 1.5 && !('ceiling' in result.scoreBasis), 'empty location options disable the cap');
result = derive({ globalScore: ratings(1), scoreCeiling: 1.5, ceilingBasis: 'location' });
check(result.ok && result.score === 1.5, 'authored 1.5 location cap is unchanged');

console.log('regression pair');
const authored = derive({ globalScore: ratings(1), scoreCeiling: 1.5, ceilingBasis: 'location' });
const omitted = derive({ globalScore: ratings(1) });
check(authored.ok && omitted.ok && authored.score === omitted.score, `paired reports match at ${authored.score}`);

cleanSandboxes();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
