#!/usr/bin/env node
/**
 * provenance-stale.test.mjs tests age flags on discovered contact records.
 * Every contact and domain is an invented fixture.
 *
 * Run: node tests/provenance-stale.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('provenance-stale.test.mjs');

function toLocalYmd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function daysBefore(fixedDate, days) {
  const date = new Date(fixedDate.getFullYear(), fixedDate.getMonth(), fixedDate.getDate());
  date.setDate(date.getDate() - days);
  return toLocalYmd(date);
}

// Build every stamp from one fixed local date captured for this run. A test that
// expires is worse than no test because it fails for a reason unrelated to code.
const fixedDate = new Date();
const dates = {
  today: daysBefore(fixedDate, 0),
  day89: daysBefore(fixedDate, 89),
  day91: daysBefore(fixedDate, 91),
};

const tmp = makeSandbox('provenance-stale');
process.env.TJK_DATA_DIR = tmp;
const { parseTargetTalentMd } = await import('../dashboard-web/server/lib/target-talent.mjs');
const row = (id, title, notes) => `| ${id} | Example ${id} | Last | First | Ms. | ${title} | City | ST | 00000 | 555-010${id} | person${id}@example.example | linkedin.example/person${id} | Not Contacted |  | ${notes} | example.example |`;
const fixtureLines = [
  '| ID | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  row(1, 'VP Revenue Operations', `[src:agent:${dates.today}]`),
  row(2, 'VP Revenue Operations', `[tier:peer] [src:agent:${dates.day89}]`),
  row(3, 'Technical Recruiter', `[src:agent:${dates.day91}]`),
  row(4, 'Office Coordinator', ''),
  row(5, 'VP Revenue Operations', '[src:agent:not-a-date]'),
];
fs.writeFileSync(path.join(tmp, 'target-talent.md'), fixtureLines.join('\r\n') + '\r\n', 'utf8');

const contacts = parseTargetTalentMd();
check(contacts.find(item => item.id === 1)?.provenanceStale === false, 'a record stamped today is not stale');
check(contacts.find(item => item.id === 2)?.provenanceStale === false, 'a record stamped 89 days ago is not stale');
check(contacts.find(item => item.id === 3)?.provenanceStale === true, 'a record stamped 91 days ago is stale');

const unstamped = contacts.find(item => item.id === 4);
check(
  unstamped?.provenanceStale === false
    && unstamped?.provenance?.source === null
    && unstamped?.provenance?.date === null,
  'an unstamped record is not stale and has null provenance fields',
);

const malformed = contacts.find(item => item.id === 5);
check(
  malformed?.provenanceStale === false
    && malformed?.provenance?.source === null
    && malformed?.provenance?.date === null,
  'a malformed stamp is not stale and does not throw',
);

const expectedTiers = [
  [1, 'hm', 'title'],
  [2, 'peer', 'tag'],
  [3, 'ta', 'title'],
  [4, 'ta', 'default'],
  [5, 'hm', 'title'],
];
for (const [id, tier, source] of expectedTiers) {
  const contact = contacts.find(item => item.id === id);
  check(
    contact?.influenceTier === tier && contact?.influenceTierSource === source,
    `parser row ${id} keeps ${tier} from ${source}`,
  );
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort cleanup */ }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
