#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelsState, SECTIONS } from '../dashboard-web/server/lib/pricing.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');
let passed = 0;
const check = (condition, message) => {
  assert.ok(condition, message);
  passed++;
  console.log(`  ok ${message}`);
};

console.log('draft-grading-flag.test.mjs');

const saved = process.env.TJK_DRAFT_GRADING;
delete process.env.TJK_DRAFT_GRADING;
check(modelsState({ keyPresent: false }).draftGrading === false, 'draft grading defaults to off');
process.env.TJK_DRAFT_GRADING = 'on';
check(modelsState({ keyPresent: false }).draftGrading === true, 'TJK_DRAFT_GRADING=on enables draft grading');
process.env.TJK_DRAFT_GRADING = 'off';
check(modelsState({ keyPresent: false }).draftGrading === false, 'TJK_DRAFT_GRADING=off disables draft grading');
if (saved === undefined) delete process.env.TJK_DRAFT_GRADING;
else process.env.TJK_DRAFT_GRADING = saved;

const gradeSection = SECTIONS.find((section) => section.key === 'grade');
check(gradeSection?.hint === "Off by default (TJK_DRAFT_GRADING=on to enable): in a blind test the score matched the user's picks 1 time in 10.",
  'draft-review pricing hint explains the opt-in flag and blind-test result');

const setupRoute = read('dashboard-web/server/routes/setup.mjs');
check(setupRoute.includes("router.get('/api/setup/models'") && setupRoute.includes('modelsState('),
  'the startup models endpoint returns modelsState, including draftGrading');

const shared = read('dashboard-web/src/shared.jsx');
check(shared.includes('window.tjkDraftGrading = false')
  && shared.includes("fetch('/api/setup/models')")
  && shared.includes('window.tjkDraftGrading = state.draftGrading === true'),
  'shared startup wiring defaults grading off and loads draftGrading from the models endpoint');

const surfaces = ['connect.jsx', 'referrals.jsx', 'target-talent.jsx', 'followups.jsx'];
for (const name of surfaces) {
  const source = read(`dashboard-web/src/${name}`);
  check(/if \(window\.tjkDraftGrading !== true\) return Promise\.resolve\(null\);[\s\S]*?window\.tjkGradeDraft/.test(source),
    `${name} cannot call tjkGradeDraft while grading is off`);
  check(/window\.tjkDraftGrading === true && [^\n]*DraftScoreBadge/.test(source),
    `${name} does not render the score badge or Improve control while grading is off`);
  check(/window\.tjkDraftGrading === true && (?:liProposed|emProposed|proposedDraft)/.test(source),
    `${name} does not render proposal panels while grading is off`);
}

console.log(`\n draft grading flag: ${passed} checks passed`);
