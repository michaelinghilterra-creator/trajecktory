#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';
import { deriveReportScore } from '../compute-scores.mjs';
import { deriveScore, DEFAULT_WEIGHTS, SCORE_DIMENSIONS } from '../lib/score.mjs';

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };

console.log('build-depth.test.mjs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseDims = [
  { key: 'fit', val: 5, max: 5 },
  { key: 'northStar', val: 5, max: 5 },
  { key: 'level', val: 5, max: 5 },
  { key: 'comp', val: 3, max: 5 },
  { key: 'location', val: 5, max: 5 },
  { key: 'redFlags', val: 5, max: 5 },
];

check(SCORE_DIMENSIONS.some(d => d.key === 'buildDepth') && DEFAULT_WEIGHTS.buildDepth === 0,
  'buildDepth is canonical and carries weight 0');

const withoutBuild = deriveScore(baseDims);
const withBuild = deriveScore([...baseDims.slice(0, 5), { key: 'buildDepth', val: 1, max: 5 }, baseDims[5]]);
check(withBuild.score === withoutBuild.score && !withBuild.contributions.some(c => c.key === 'buildDepth'),
  'a rated buildDepth leaves the headline identical and adds no contribution');

const buildOnly = deriveScore([{ key: 'buildDepth', val: 1, max: 5 }]);
check(buildOnly.derivable === false && buildOnly.score === null,
  'buildDepth alone is not derivable');

const report = (ceiling, buildDepth) => `---\n${JSON.stringify({
  schema: 'trajecktory-report/v1', id: 7001, company: 'Kestrel', role: 'Director of Systems',
  date: '2026-08-23', url: 'https://example.test/kestrel', score: 0, scoreCeiling: ceiling,
  globalScore: [...baseDims.slice(0, 5), { key: 'buildDepth', dim: 'Build Depth', val: buildDepth, max: 5, evidence: 'Named build mandate', note: 'recorded, not scored' }, baseDims[5]],
}, null, 2)}\n---\nBody\n`;

const cappedTwo = deriveReportScore(report(2.0, 1));
check(cappedTwo.ok && cappedTwo.score === 2.0 && cappedTwo.scoreBasis.ceilingApplied === true && cappedTwo.scoreBasis.uncapped > 4 && /"key": "buildDepth"/.test(cappedTwo.newMd),
  'the 2.0 tier caps a builder seat and preserves buildDepth in frontmatter');

const cappedThree = deriveReportScore(report(3.0, 2));
check(cappedThree.ok && cappedThree.score === 3.0 && cappedThree.scoreBasis.ceilingApplied === true && cappedThree.scoreBasis.uncapped > 4 && /"key": "buildDepth"/.test(cappedThree.newMd),
  'the 3.0 tier caps a build-leaning role and preserves buildDepth in frontmatter');

const exampleProfile = yaml.load(fs.readFileSync(path.join(root, 'config/profile.example.yml'), 'utf8'));
const userProfilePath = path.join(root, 'config/profile.yml');
const userProfileOk = !fs.existsSync(userProfilePath) || yaml.load(fs.readFileSync(userProfilePath, 'utf8')).scoring.weights.buildDepth === 0;
check(exampleProfile.scoring.weights.buildDepth === 0 && userProfileOk,
  'profile configs declare buildDepth weight 0, with the user profile optional');

for (const rel of ['modes/oferta.md', 'batch/batch-prompt.md']) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const hardBlocker = text.slice(text.search(/Hard blockers|HARD BLOCKERS/i));
  check(text.includes('"key": "buildDepth"') && /buildDepth/.test(hardBlocker),
    `${rel} emits buildDepth and includes it in the hard-blocker section`);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
