#!/usr/bin/env node
/**
 * Source-text checks are weaker than a DOM harness. A real harness would change
 * the tier, inspect the request and refreshed state, then open both follow-up
 * panels and exercise their buttons. These checks still pin silent wiring and
 * copy failures that otherwise look valid in a build.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { INFLUENCE_TIERS } from '../lib/influence-tier.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const followups = readFileSync(join(root, 'dashboard-web/src/followups.jsx'), 'utf8');
const targetTalent = readFileSync(join(root, 'dashboard-web/src/target-talent.jsx'), 'utf8');
const connect = readFileSync(join(root, 'dashboard-web/src/connect.jsx'), 'utf8');

let passed = 0, failed = 0;
function check(condition, label) {
  if (condition) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
}

console.log('influence-ui-copy.test.mjs');

check(followups.includes("source: 'stakeholder'"), 'the decision-maker nudge uses the stakeholder snooze bucket');
// This exact count guards against wiring the new nudge to the contactless bucket.
check((followups.match(/contactless/g) || []).length === 10, 'the contactless bucket still has exactly ten references');
check(followups.includes('unthreadedApps'), 'Follow-Ups reads the decision-maker gap');
check(targetTalent.includes('influenceTierSource'), 'the contact UI distinguishes inferred and confirmed tiers');
check(/JSON\.stringify\(\{\s*influenceTier\s*\}\)/.test(targetTalent), 'the contact UI PATCHes influenceTier');
// This is the real guard: the phrasing regression is the bug, and both readings render fine.
check(!connect.includes("'not sent'"), 'queue chips do not claim a message was not sent historically');
check(connect.includes("'to send'"), 'queue chips describe the pending action');

const labelMapMatch = targetTalent.match(/const INFLUENCE_TIER_LABELS = Object\.freeze\(\{([\s\S]*?)\}\);/);
const labelMapSource = labelMapMatch ? labelMapMatch[1] : '';
check(Boolean(labelMapMatch), 'the human-readable tier label map is present');
for (const tier of INFLUENCE_TIERS) {
  check(new RegExp(`\\b${tier}:\\s*["'][^"']+["']`).test(labelMapSource), `${tier} has a human-readable label`);
}

const newUserCopy = [
  ...followups.matchAll(/(?:Reach a decision-maker|Every live application has someone who can move it\. Good\.|where your contacts can help with the process,[^`]*?decides\.|There is no decision-maker worth chasing at this company|Find a decision-maker)/g),
  ...targetTalent.matchAll(/(?:Role in the hire|Read from the job title and not confirmed\.[^"']*|Nothing could be determined from the job title\.[^"']*)/g),
].map(match => match[0]).join('\n');
check(!newUserCopy.includes('—'), 'new user-facing copy contains no em dash');
check(!newUserCopy.includes('--'), 'new user-facing copy contains no double hyphen');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
