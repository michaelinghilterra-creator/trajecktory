#!/usr/bin/env node
/**
 * influence-tier.test.mjs tests influence tier parsing, safe Notes cell writes,
 * target talent file updates, and the legacy hiring principal contract.
 *
 * Run: node tests/influence-tier.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';
import {
  INFLUENCE_TIERS,
  parseInfluenceTier,
  setInfluenceTier,
} from '../lib/influence-tier.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('influence-tier.test.mjs');

const parseCases = [
  ['[principal]', 'hm'],
  ['[tier:exec]', 'exec'],
  ['[TIER:HM]', 'hm'],
  ['Met at a meetup [tier:peer] follow up in Q3', 'peer'],
  ['[tier:cro]', 'ta'],
  ['[tier:]', 'ta'],
  ['', 'ta'],
  [null, 'ta'],
  [undefined, 'ta'],
  ['[principal] [tier:peer]', 'peer'],
];
for (const [notes, expected] of parseCases) {
  check(parseInfluenceTier(notes) === expected, `${String(notes)} parses as ${expected}`);
}

check(setInfluenceTier('', 'hm') === '[tier:hm]', 'empty notes receive the exact tier tag');
const replaced = setInfluenceTier('Met once [tier:ta] [tier:peer]', 'exec');
check((replaced.match(/\[tier:/gi) || []).length === 1, 'replacing tier tags leaves exactly one');
check(!setInfluenceTier('Lead contact · [principal]', 'peer').includes('[principal]'), 'writing strips the legacy principal tag');
for (const tier of INFLUENCE_TIERS) {
  check(parseInfluenceTier(setInfluenceTier('some note', tier)) === tier, `${tier} round trips`);
}
const safeNotes = setInfluenceTier('first|second\nthird', 'ta');
check(!/[|\r\n]/.test(safeNotes), 'written notes cannot split a markdown row');
for (const tier of ['cro', '', null]) {
  let threw = false;
  try { setInfluenceTier('some note', tier); } catch (err) { threw = err instanceof TypeError; }
  check(threw, `${String(tier)} throws TypeError`);
}

const tmp = makeSandbox('influence-tier');
process.env.TJK_DATA_DIR = tmp;
const { parseTargetTalentMd, updateTTLine } = await import('../dashboard-web/server/lib/target-talent.mjs');
const row = (id, company, notes) => `| ${id} | ${company} | Last | First | Ms. | Recruiter | City | ST | 00000 | 555-0100 | person@${company.toLowerCase()}.example | linkedin.example/in/person | Not Contacted |  | ${notes} | ${company.toLowerCase()}.example |`;
const fixtureLines = [
  '| ID | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  row(1, 'Aster', 'first note'),
  row(2, 'Cobalt', 'middle note'),
  row(3, 'Northwind', '[principal]'),
];
const fixture = fixtureLines.join('\r\n') + '\r\n';
const fixturePath = path.join(tmp, 'target-talent.md');
fs.writeFileSync(fixturePath, fixture, 'utf8');

check(updateTTLine(2, { influenceTier: 'exec' }), 'middle fixture row is updated');
const written = fs.readFileSync(fixturePath, 'utf8');
const writtenLines = written.split('\r\n');
check(writtenLines[2] === fixtureLines[2] && writtenLines[4] === fixtureLines[4], 'other fixture rows stay byte identical');
check(parseInfluenceTier(writtenLines[3].split('|')[15].trim()) === 'exec', 'middle Notes cell receives the tier');
check(!written.replace(/\r\n/g, '').includes('\n'), 'fixture retains CRLF line endings');

// Passing both at once must apply the notes replacement FIRST and the tier to
// that new value. The other order would write the tier onto the OLD notes and
// then discard it, silently losing the field the caller just set.
check(updateTTLine(1, { notes: 'rewritten note', influenceTier: 'peer' }), 'notes and tier apply together');
const combined = parseTargetTalentMd().find(item => item.id === 1);
check(combined?.notes.includes('rewritten note'), 'the new notes text survives');
check(combined?.influenceTier === 'peer', 'the tier survives alongside the new notes');

const legacy = parseTargetTalentMd().find(item => item.id === 3);
check(legacy?.isPrincipal === true && legacy?.influenceTier === 'hm', 'legacy principal remains a hiring principal');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort cleanup */ }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
