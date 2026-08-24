#!/usr/bin/env node
/**
 * tier-derivation.test.mjs tests tagged and title-derived influence tiers.
 * Every contact and domain is an invented fixture.
 *
 * Run: node tests/tier-derivation.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';
import { DEFAULT_TIER, resolveInfluenceTier } from '../lib/influence-tier.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('tier-derivation.test.mjs');

const resolutionCases = [
  [{ notes: '[tier:peer]', title: 'VP Revenue Operations' }, { tier: 'peer', source: 'tag' }],
  [{ notes: '[principal]', title: 'Talent Acquisition Partner' }, { tier: 'hm', source: 'tag' }],
  [{ notes: '', title: 'VP Revenue Operations' }, { tier: 'hm', source: 'title' }],
  [{ notes: '', title: 'Revenue Ops Analyst' }, { tier: DEFAULT_TIER, source: 'default' }],
  [{ notes: '', title: '' }, { tier: DEFAULT_TIER, source: 'default' }],
  [{ notes: '', title: 'VP Sales Development', track: 'salesdev' }, { tier: 'hm', source: 'title' }],
];

for (const [input, expected] of resolutionCases) {
  check(
    JSON.stringify(resolveInfluenceTier(input)) === JSON.stringify(expected),
    `${JSON.stringify(input)} resolves to ${expected.tier} from ${expected.source}`,
  );
}

for (const input of [
  undefined,
  { notes: null, title: null },
  { notes: 42, title: 42 },
  { notes: {}, title: [] },
]) {
  let result;
  let threw = false;
  try { result = resolveInfluenceTier(input); } catch { threw = true; }
  check(
    !threw && result?.tier === DEFAULT_TIER && result?.source === 'default',
    `${JSON.stringify(input)} defaults without throwing`,
  );
}

const tmp = makeSandbox('tier-derivation');
process.env.TJK_DATA_DIR = tmp;
const { parseTargetTalentMd } = await import('../dashboard-web/server/lib/target-talent.mjs');
const row = (id, title, notes) => `| ${id} | Example ${id} | Last | First | Ms. | ${title} | City | ST | 00000 | 555-010${id} | person${id}@example.example | linkedin.example/person${id} | Not Contacted |  | ${notes} | example.example |`;
const fixtureLines = [
  '| ID | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  row(1, 'Revenue Ops Analyst', '[tier:exec]'),
  row(2, 'Talent Acquisition Partner', '[principal]'),
  row(3, 'VP Revenue Operations', ''),
  row(4, 'Technical Recruiter', ''),
  row(5, 'Office Coordinator', ''),
];
fs.writeFileSync(path.join(tmp, 'target-talent.md'), fixtureLines.join('\r\n') + '\r\n', 'utf8');

const contacts = parseTargetTalentMd();
const expectedRows = [
  [1, 'exec', 'tag', false],
  [2, 'hm', 'tag', true],
  [3, 'hm', 'title', true],
  [4, 'ta', 'title', false],
  [5, 'ta', 'default', false],
];
for (const [id, tier, source, isPrincipal] of expectedRows) {
  const contact = contacts.find(item => item.id === id);
  check(
    contact?.influenceTier === tier
      && contact?.influenceTierSource === source
      && contact?.isPrincipal === isPrincipal,
    `parser row ${id} reports ${tier} from ${source} with principal ${isPrincipal}`,
  );
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort cleanup */ }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
