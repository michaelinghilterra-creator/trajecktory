#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_NORTH_STAR_RATINGS,
  loadScoringWeights,
  normalizeArchetypeName,
  northStarRating,
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

const TIERS = {
  'director of widgets': 'primary',
  'head of examples': 'secondary',
  'manager of gadgets': 'adjacent',
};

console.log('north star rating helper');
for (const [archetype, match, rating] of [
  ['Director of Widgets', 'strong', 5],
  ['Director of Widgets', 'partial', 4],
  ['Head of Examples', 'strong', 3],
  ['Head of Examples', 'partial', 2],
  ['Manager of Gadgets', 'strong', 2],
  ['Manager of Gadgets', 'partial', 1],
]) {
  same(northStarRating(archetype, match, { tiers: TIERS }), {
    rating, tier: TIERS[normalizeArchetypeName(archetype)], reason: 'classified',
  }, `${archetype} ${match} maps to ${rating}`);
}
same(northStarRating('Director of Widgets', 'none', { tiers: TIERS }), { rating: 1, tier: null, reason: 'no-match' }, 'none match maps to 1');
same(northStarRating('none', 'strong', { tiers: TIERS }), { rating: 1, tier: null, reason: 'no-match' }, 'none archetype maps to 1');
same(northStarRating('  DIRECTOR   OF WIDGETS ', ' STRONG ', { tiers: TIERS }), { rating: 5, tier: 'primary', reason: 'classified' }, 'name and match normalization is insensitive');
same(northStarRating('Director of Unknowns', 'strong', { tiers: TIERS }), { rating: null, tier: null, reason: 'unknown-archetype' }, 'unknown archetype fails open');
for (const match of [undefined, '', 'close']) {
  same(northStarRating('Director of Widgets', match, { tiers: TIERS }), { rating: null, tier: null, reason: 'no-classification' }, `${String(match)} match fails open`);
}
same(northStarRating(' ', 'strong', { tiers: TIERS }), { rating: null, tier: null, reason: 'no-classification' }, 'blank archetype fails open');
const customRatings = { primary: { strong: 4.5, partial: 3.5 }, secondary: {}, adjacent: {}, none: 0.5 };
same(northStarRating('Director of Widgets', 'strong', { tiers: TIERS, ratings: customRatings }), { rating: 4.5, tier: 'primary', reason: 'classified' }, 'custom ratings are honored');
const badRatings = { ...DEFAULT_NORTH_STAR_RATINGS, primary: { strong: 8, partial: 4 } };
same(northStarRating('Director of Widgets', 'strong', { tiers: TIERS, ratings: badRatings }), { rating: null, tier: 'primary', reason: 'no-rating-configured' }, 'bad rating cell fails open');

console.log('profile loading');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = makeRepoSandbox(repoRoot, 'north-star');
const writeProfile = (name, yaml) => {
  const file = path.join(sandbox, name);
  fs.writeFileSync(file, yaml, 'utf8');
  return file;
};
let loaded = loadScoringWeights(writeProfile('tiers.yml', `target_roles:
  archetypes:
    - name: Director of Widgets
      fit: primary
    - name: Head   of Examples
      fit: SECONDARY
    - name: Manager of Gadgets
      fit: adjacent
    - name: Director of Bad Fit
      fit: preferred
    - name: Director of Missing Fit
`));
same(loaded.northStarTiers, {
  'director of widgets': 'primary',
  'head of examples': 'secondary',
  'manager of gadgets': 'adjacent',
}, 'valid archetype tiers load and invalid tiers are skipped');
same(loadScoringWeights(writeProfile('absent.yml', 'name: Example\n')).northStarTiers, {}, 'absent target roles load an empty tier map');
loaded = loadScoringWeights(writeProfile('override.yml', `scoring:
  north_star_ratings:
    primary:
      strong: 4.5
    secondary:
      partial: -1
    adjacent:
      strong: text
    none: 0.5
`));
check(loaded.northStarRatings.primary.strong === 4.5, 'one rating cell is overridden');
check(loaded.northStarRatings.primary.partial === 4, 'an untouched rating cell keeps its default');
check(loaded.northStarRatings.secondary.partial === 2, 'a negative rating cell is ignored');
check(loaded.northStarRatings.adjacent.strong === 2, 'a text rating cell is ignored');
check(loaded.northStarRatings.none === 0.5, 'the no match rating is overridden');

console.log('report derivation');
const CFG = {
  weights: { fit: 0.35, northStar: 0.25, level: 0.15, comp: 0, location: 0.10, buildDepth: 0 },
  redFlagPenalty: 1.5,
  minimumLevel: 'Manager',
  compMinimum: 137500,
  northStarTiers: TIERS,
  northStarRatings: DEFAULT_NORTH_STAR_RATINGS,
  buildDepthCeilings: { 0: 2, 1: 2, 2: 3 },
};

function ratings(northStar = 2, level = 5, location = 5) {
  return [
    { key: 'fit', dim: 'Fit', val: 5, max: 5, evidence: 'Example fit.' },
    { key: 'northStar', dim: 'North Star', val: northStar, max: 5, evidence: 'Example alignment.' },
    { key: 'level', dim: 'Level', val: level, max: 5, evidence: 'Example level.' },
    { key: 'comp', dim: 'Comp', val: 5, max: 5, evidence: 'Example pay.' },
    { key: 'location', dim: 'Location', val: location, max: 5, evidence: 'Example location.' },
    { key: 'buildDepth', dim: 'Build', val: 5, max: 5, evidence: 'Example build.' },
    { key: 'redFlags', dim: 'Red Flags', val: 5, max: 5, evidence: 'Example clean.' },
  ];
}

function report({ northStar = 2, level = 'Director', levelRating = 5, location = 5, classification = true, archetype = 'Director of Widgets' } = {}) {
  const fm = {
    schema: 'trajecktory-report/v1',
    id: 900031,
    company: 'Acme',
    role: level,
    date: '2032-03-04',
    url: 'https://jobs.example.test/widgets',
    jdSnapshot: 'Invented widget role',
    summary: { seniority: level, compStated: '$137,500 to $162,500 base' },
    levelMatch: { jdLevel: level },
    globalScore: ratings(northStar, levelRating, location),
    ...(classification ? { northStarArchetype: archetype, northStarMatch: 'strong' } : {}),
  };
  return `---\n${JSON.stringify(fm, null, 2)}\n---\n\nInvented fixture.\n`;
}

const classified = deriveReportScore(report(), CFG);
const modelFive = deriveReportScore(report({ northStar: 5, classification: false }), CFG);
check(classified.ok && classified.score === modelFive.score, 'primary strong derives as if the model rated north star 5');
same(classified.scoreBasis.northStar, { archetype: 'Director of Widgets', tier: 'primary', match: 'strong', from: 2, to: 5, reason: 'classified' }, 'north star basis records the override');
const classifiedData = JSON.parse(classified.newMd.split('\n---\n')[0].slice(4));
const persistedNorthStar = classifiedData.globalScore.find((d) => d.key === 'northStar');
check(persistedNorthStar.val === 5 && persistedNorthStar.max === 5, 'the overridden dimension is persisted');
check(persistedNorthStar.evidence.includes('[North star set from the archetype classification: Director of Widgets / strong.]'), 'the persisted evidence explains the override');

const historicalInput = report({ northStar: 2, classification: false });
const historical = deriveReportScore(historicalInput, CFG);
const historicalData = JSON.parse(historical.newMd.split('\n---\n')[0].slice(4));
check(historicalData.globalScore.find((d) => d.key === 'northStar').val === 2, 'a historical report keeps the model rating');
check(!('northStar' in historical.scoreBasis), 'a historical report adds no north star basis');
check(!historical.newMd.includes('North star set from the archetype classification'), 'a historical report adds no evidence note');

const unknown = deriveReportScore(report({ archetype: 'Director of Unknowns' }), CFG);
const unknownData = JSON.parse(unknown.newMd.split('\n---\n')[0].slice(4));
check(unknownData.globalScore.find((d) => d.key === 'northStar').val === 2, 'an unknown archetype keeps the model rating');
check(!('northStar' in unknown.scoreBasis), 'an unknown archetype adds no basis');

const rerun = deriveReportScore(classified.newMd, CFG);
check(rerun.score === classified.score, 'a second pass keeps the same score');
check(rerun.newMd === classified.newMd, 'a second pass is byte identical');
const pairLow = deriveReportScore(report({ northStar: 2 }), CFG);
const pairHigh = deriveReportScore(report({ northStar: 5 }), CFG);
check(pairLow.score === pairHigh.score, 'classified regression pair derives the same score');

const composed = deriveReportScore(report({ northStar: 2, level: 'Director', levelRating: 2, location: 1 }), CFG);
check(composed.score === 1.5, 'north star override, level floor, and location cap compose');
check(composed.scoreBasis.northStar.to === 5 && composed.scoreBasis.levelFloor.applied && composed.scoreBasis.ceiling === 1.5, 'composed basis records classification, floor, and cap');

cleanSandboxes();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
