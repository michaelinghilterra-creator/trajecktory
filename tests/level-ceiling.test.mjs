#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SUB_MANAGER_CEILING,
  levelCeiling,
  loadScoringWeights,
} from '../lib/score.mjs';
import { deriveReportScore } from '../compute-scores.mjs';
import { cleanSandboxes, makeRepoSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
const check = (condition, label) => {
  if (condition) passed++;
  else { failed++; console.error(`  FAIL: ${label}`); }
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
  buildDepthCeilings: { 0: 2, 1: 2, 2: 3 },
};

function ratings(location = 5) {
  return [
    { key: 'fit', dim: 'Fit', val: 5, max: 5 },
    { key: 'northStar', dim: 'North Star', val: 5, max: 5 },
    { key: 'level', dim: 'Level', val: 5, max: 5 },
    { key: 'comp', dim: 'Comp', val: 5, max: 5 },
    { key: 'location', dim: 'Location', val: location, max: 5 },
    { key: 'buildDepth', dim: 'Build', val: 5, max: 5 },
    { key: 'redFlags', dim: 'Red Flags', val: 5, max: 5 },
  ];
}

function report(level, extra = {}) {
  const fm = {
    schema: 'trajecktory-report/v1',
    id: 900030,
    company: 'Acme',
    role: level,
    date: '2031-02-03',
    url: 'https://jobs.example.test/example',
    jdSnapshot: 'Example role',
    summary: { seniority: level, compStated: '$137,500 to $162,500 base' },
    levelMatch: { jdLevel: level },
    globalScore: ratings(),
    ...extra,
  };
  return `---\n${JSON.stringify(fm, null, 2)}\n---\n\nInvented fixture.\n`;
}

const derive = (level, extra = {}, options = {}) => deriveReportScore(report(level, extra), { ...CFG, ...options });

console.log('level ceiling helper');
for (const title of ['Senior Analyst', 'Sales Operations Specialist', 'Coordinator', 'Account Representative', 'Individual Contributor']) {
  same(levelCeiling(title), { ceiling: 2, reason: 'below-minimum' }, `${title} is capped`);
}
for (const title of ['Manager', 'Senior Manager, Widget Analytics', 'Director', 'Associate Director', 'Head of Widget Operations', 'VP']) {
  same(levelCeiling(title), { ceiling: null, reason: 'at-or-above-minimum' }, `${title} is in scope`);
}
for (const title of ['Product Manager', 'Principal Engineer', 'Lead Analyst', '', null]) {
  same(levelCeiling(title), { ceiling: null, reason: 'unranked' }, `${String(title)} is unranked`);
}
same(levelCeiling('Analyst', { ceiling: null }), { ceiling: null, reason: 'disabled' }, 'null disables the cap');
same(levelCeiling('Analyst', { ceiling: 2.5 }), { ceiling: 2.5, reason: 'below-minimum' }, 'a custom cap is honored');
same(levelCeiling('Analyst', { ceiling: -1 }), { ceiling: DEFAULT_SUB_MANAGER_CEILING, reason: 'below-minimum' }, 'an invalid cap uses the default');
same(levelCeiling('Analyst (reports to Director)'), { ceiling: 2, reason: 'below-minimum' }, 'reporting context does not raise the title');

console.log('profile loading');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = makeRepoSandbox(repoRoot, 'level-ceiling');
const writeProfile = (name, yaml) => {
  const file = path.join(sandbox, name);
  fs.writeFileSync(file, yaml, 'utf8');
  return file;
};
check(loadScoringWeights(writeProfile('absent.yml', 'name: Example\n')).subManagerCeiling === 2, 'an absent cap uses 2.0');
check(loadScoringWeights(writeProfile('custom.yml', 'scoring:\n  sub_manager_ceiling: 2.5\n')).subManagerCeiling === 2.5, 'a custom cap loads');
check(loadScoringWeights(writeProfile('disabled.yml', 'scoring:\n  sub_manager_ceiling: null\n')).subManagerCeiling === null, 'null disables the cap');
check(loadScoringWeights(writeProfile('text.yml', 'scoring:\n  sub_manager_ceiling: abc\n')).subManagerCeiling === 2, 'text is ignored');
check(loadScoringWeights(writeProfile('negative.yml', 'scoring:\n  sub_manager_ceiling: -1\n')).subManagerCeiling === 2, 'a negative cap is ignored');

console.log('report derivation');
let result = derive('Senior Analyst');
check(result.ok && result.score === 2 && result.scoreBasis.ceilingApplied === true, 'Senior Analyst is capped at 2.0');
result = derive('Director');
check(result.ok && result.score === 5 && !('ceiling' in result.scoreBasis), 'Director is not capped');
result = derive('Analyst', { scoreCeiling: 1.5, ceilingBasis: 'level' });
check(result.ok && result.score === 1.5, 'a lower authored cap stays');
result = derive('Analyst', { scoreCeiling: 1.5, ceilingBasis: 'comp' });
check(result.ok && result.score === 2, 'a cleared comp cap still gets the level cap');
result = derive('Analyst', {}, { subManagerCeiling: null });
check(result.ok && result.score === 5 && !('ceiling' in result.scoreBasis), 'null disables the derived level cap');
result = derive('Director', { scoreCeiling: 2, ceilingBasis: 'level' });
check(result.ok && result.score === 2, 'an authored Director level judgment stays');
result = derive('Analyst', { globalScore: ratings(1) });
check(result.ok && result.score === 1.5, 'the lower location cap wins');

console.log('regression pair');
const authored = derive('Analyst', { scoreCeiling: 2, ceilingBasis: 'level' });
const omitted = derive('Analyst');
check(authored.ok && omitted.ok && authored.score === omitted.score, `paired reports match at ${authored.score}`);

cleanSandboxes();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
