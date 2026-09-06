#!/usr/bin/env node
import { unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('profile-narrative.test.mjs');

const sandbox = makeSandbox('profile-narrative');
const profilePath = join(sandbox, 'profile.yml');
process.env.TJK_PROFILE_YML = profilePath;

writeFileSync(profilePath, `narrative:
  headline: "Widget Engineering Lead | Built the sprocket line at Acme Corp"
  superpowers:
    - "Turns vague requirements into shipped products within a single quarter"
    - "Bridges the gap between engineering and sales: speaks both languages fluently"
    - "Builds teams that outlast any single project or reorg."
  proof_points:
    - name: "Sprocket Assembly Automation (Lead Engineer)"
      hero_metric: "Cycle time 14 days to 3 hours; 98.2% yield across 4 production lines"
    - name: "Widget Quality Dashboard (Senior Engineer)"
      hero_metric: "12 dashboards, 150+ users, 3 plants; cut defect rate from 4.1% to 0.8%"
    - name: "Cross-Plant Standardization (Lead Engineer)"
      hero_metric: "Unified 6 plants onto single BOM system; $2.3M annual savings"
`);

const { getNarrative } = await import('../dashboard-web/server/lib/profile.mjs');
const narrative = getNarrative();

check(narrative.proofPoints.length === 3
  && narrative.proofPoints.every(point => typeof point.name === 'string' && typeof point.heroMetric === 'string'),
  'returns three proof points with name and heroMetric fields');
check(narrative.proofPoints[0].heroMetric === 'Cycle time 14 days to 3 hours; 98.2% yield across 4 production lines'
  && narrative.proofPoints[2].heroMetric === 'Unified 6 plants onto single BOM system; $2.3M annual savings',
  'hero metrics preserve punctuation, currency, and digits');
check(narrative.superpowers.length === 3 && narrative.superpowers.every(value => typeof value === 'string'),
  'returns three superpowers as strings');
check(narrative.superpowers[1] === 'Bridges the gap between engineering and sales: speaks both languages fluently'
  && narrative.superpowers[2] === 'Builds teams that outlast any single project or reorg.',
  'superpowers preserve embedded punctuation');
check(narrative.headline === 'Widget Engineering Lead | Built the sprocket line at Acme Corp',
  'returns the headline');
check(getNarrative() === narrative, 'mtime cache returns the same object reference');

writeFileSync(profilePath, 'candidate:\n  full_name: "Casey Example"\n');
utimesSync(profilePath, new Date(), new Date(Date.now() + 1000));
const noNarrative = getNarrative();
check(noNarrative.headline === '' && noNarrative.superpowers.length === 0 && noNarrative.proofPoints.length === 0,
  'missing narrative key returns empty defaults');

writeFileSync(profilePath, '');
utimesSync(profilePath, new Date(), new Date(Date.now() + 2000));
const emptyProfile = getNarrative();
check(emptyProfile.headline === '' && emptyProfile.superpowers.length === 0 && emptyProfile.proofPoints.length === 0,
  'empty profile returns defaults');

unlinkSync(profilePath);
const missingProfile = getNarrative();
check(missingProfile.headline === '' && missingProfile.superpowers.length === 0 && missingProfile.proofPoints.length === 0,
  'missing profile returns defaults');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
