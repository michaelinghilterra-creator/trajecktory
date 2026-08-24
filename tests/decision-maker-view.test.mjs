#!/usr/bin/env node
/**
 * Source-text checks are weaker than a DOM harness. This repository has no DOM
 * harness, so these checks pin the split, wiring, endpoint and visible copy.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { INFLUENCE_TIERS } from '../lib/influence-tier.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const network = readFileSync(join(root, 'dashboard-web/src/network.jsx'), 'utf8');
const targetTalent = readFileSync(join(root, 'dashboard-web/src/target-talent.jsx'), 'utf8');

let passed = 0, failed = 0;
function check(condition, label) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
}

console.log('decision-maker-view.test.mjs');

check(/id:\s*['"]decisionmakers['"]\s*,\s*label:\s*['"]Decision Makers['"]/.test(network),
  'Network includes the Decision Makers subtab');

const renders = [...network.matchAll(/<window\.TargetTalentTab\b([^>]*)\/>/g)].map(match => match[1]);
const decisionRender = renders.find(source => /audience=['"]decision-makers['"]/.test(source));
const talentRender = renders.find(source => /audience=['"]talent['"]/.test(source));
check(Boolean(decisionRender) && Boolean(talentRender), 'both contact views pass an audience');
check(Boolean(decisionRender) && Boolean(talentRender) && decisionRender !== talentRender,
  'the two contact views use different audiences');
check(targetTalent.includes('audience'), 'the contact table reads the audience');

const setMatch = targetTalent.match(/const DECISION_MAKER_TIERS = Object\.freeze\(new Set\(\[([^\]]*)\]\)\);/);
const splitTiers = setMatch
  ? [...setMatch[1].matchAll(/["']([^"']+)["']/g)].map(match => match[1])
  : [];
check(Boolean(setMatch), 'the decision-maker split uses one frozen set');
check(JSON.stringify(splitTiers) === JSON.stringify(['hm', 'exec', 'peer']),
  'the decision-maker set contains exactly hm, exec and peer');

const splitSet = new Set(splitTiers);
const membershipCounts = INFLUENCE_TIERS.map(value =>
  Number(splitSet.has(value)) + Number(!splitSet.has(value)));
check(membershipCounts.every(count => count === 1)
    && /audience === "talent"[\s\S]*?!DECISION_MAKER_TIERS\.has\(c\.influenceTier\)/.test(targetTalent),
  'every influence value belongs to exactly one contact view');

check(targetTalent.includes('/api/tt-reconcile/discover-principal'),
  'the existing principal discovery endpoint remains wired');

function visibleStrings(source) {
  const jsxText = [...source.matchAll(/>([^<>{}]+)</g)].map(match => match[1]);
  const visibleAttributes = [...source.matchAll(/\b(?:title|aria-label)=(["'])(.*?)\1/g)].map(match => match[2]);
  return [...jsxText, ...visibleAttributes];
}
const visibleCopy = [...visibleStrings(network), ...visibleStrings(targetTalent)];
check(!visibleCopy.some(value => /\btier\b/i.test(value)),
  'user-facing contact copy does not use the word tier');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
