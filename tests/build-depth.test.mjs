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

// ── the tiers are COMPUTED from config, not authored by the model ──────────
// The two cases above pass a ceiling with no ceilingBasis, which is the legacy
// authored path and still honoured for every historical report. These cover the
// declared path, where the number is the code's to set.
const reportBasis = (ceiling, buildDepth) => `---\n${JSON.stringify({
  schema: 'trajecktory-report/v1', id: 7002, company: 'Quennox Ratchet Works', role: 'Director of Systems',
  date: '2030-01-15', url: 'https://example.test/quennox', score: 0,
  scoreCeiling: ceiling, ceilingBasis: 'buildDepth', ceilingReason: 'Named build mandate',
  globalScore: [...baseDims.slice(0, 5), { key: 'buildDepth', dim: 'Build Depth', val: buildDepth, max: 5, evidence: 'Named build mandate', note: 'recorded, not scored' }, baseDims[5]],
}, null, 2)}\n---\nBody\n`;

const CFG = { buildDepthCeilings: { 0: 2.0, 1: 2.0, 2: 3.0 } };

// The model's authored number is DISCARDED when it declares the basis. A model
// that writes a 5.0 cap on a rating-1 role must not be able to lift its own ceiling.
const lifted = deriveReportScore(reportBasis(5.0, 1), CFG);
check(lifted.ok && lifted.score === 2.0,
  'a declared buildDepth basis recomputes the cap from config, discarding the number the model wrote');

const softened = deriveReportScore(reportBasis(2.0, 1), { buildDepthCeilings: { 0: 2.0, 1: 3.0 } });
check(softened.ok && softened.score === 3.0,
  'retuning the config tier moves the cap with no code or prompt change');

const offPolicy = deriveReportScore(reportBasis(2.0, 4), CFG);
check(offPolicy.ok && offPolicy.score > 4 && offPolicy.scoreBasis.ceilingApplied !== true,
  'a rating outside the configured tiers adds no ceiling at all');

const emptyPolicy = deriveReportScore(reportBasis(2.0, 1), { buildDepthCeilings: {} });
check(emptyPolicy.ok && emptyPolicy.score > 4,
  'an empty tier map switches the whole policy off from config');

// FAILS OPEN. A rating the model never gave must not invent a cap, because
// capping a role nobody rated discards it on no evidence.
const unrated = `---\n${JSON.stringify({
  schema: 'trajecktory-report/v1', id: 7003, company: 'Zorblax Widgetry', role: 'Director of Systems',
  date: '2030-01-15', url: 'https://example.test/zorblax', score: 0,
  scoreCeiling: 2.0, ceilingBasis: 'buildDepth', ceilingReason: 'Named build mandate',
  globalScore: [...baseDims],
}, null, 2)}\n---\nBody\n`;
const missing = deriveReportScore(unrated, CFG);
check(missing.ok && missing.score > 4 && missing.scoreBasis.ceilingApplied !== true,
  'a declared buildDepth basis with NO buildDepth rating fails open — no cap invented');

// A formatting slip must not silently drop a cap that should apply.
const asString = deriveReportScore(reportBasis(2.0, '1'), CFG);
check(asString.ok && asString.score === 2.0,
  'a rating emitted as a string still resolves to its configured tier');

// ── the two prompts must not restate what config now owns ──────────────────
for (const rel of ['modes/oferta.md', 'batch/batch-prompt.md']) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const hardBlocker = text.slice(text.search(/Hard blockers|HARD BLOCKERS/i));
  check(text.includes('"key": "buildDepth"') && /buildDepth/.test(hardBlocker),
    `${rel} emits buildDepth and includes it in the hard-blocker section`);

  // THE DRIFT GUARD. The tiers moved into config precisely so one fact stops
  // living in two prompts. A re-added literal fails here rather than quietly
  // disagreeing with the code months later.
  const buildLines = text.split('\n').filter((l) => /buildDepth|Build depth/i.test(l));
  check(!buildLines.some((l) => /\*\*2\.0\*\*|\*\*3\.0\*\*/.test(l)),
    `${rel} does not restate the tier numbers beside buildDepth`);
  check(text.includes('build_depth_ceilings'),
    `${rel} points the reader at build_depth_ceilings in config`);
}

// The 0-5 ANCHORS are judgment, not arithmetic, so they stay in both prompts and
// are deliberately worded for their own context — byte-identity would be the
// wrong thing to demand. What must hold is that neither prompt silently LOSES a
// tier, which would leave the model with no guidance for that rating while the
// config still caps it. Nothing asserted this before.
{
  const anchorBlock = (rel) => {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    const start = text.search(/`buildDepth` is rated but NOT scored/);
    if (start < 0) return '';
    const rest = text.slice(start);
    const end = rest.search(/\n- \*\*Do not lower `fit`/);
    return end < 0 ? rest : rest.slice(0, end);
  };
  for (const rel of ['modes/oferta.md', 'batch/batch-prompt.md']) {
    const block = anchorBlock(rel);
    const tiers = [0, 1, 2, 3, 4, 5].filter((n) => block.includes(`**${n}**`));
    check(tiers.length === 6, `${rel} defines all six buildDepth anchors (found ${tiers.length}: ${tiers.join(',')})`);
  }
}

// config ships the tiers, and they equal the code defaults, so the move is a no-op
{
  const ex = exampleProfile.scoring.build_depth_ceilings;
  check(ex && Number(ex[0]) === 2.0 && Number(ex[1]) === 2.0 && Number(ex[2]) === 3.0,
    'profile.example.yml ships the tiers, and they match the previously hard-coded policy');
}

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
