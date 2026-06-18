#!/usr/bin/env node
// auto-discard-low.mjs — retroactively flip status from Evaluated → Discarded
// for any tracker entry with score < 3.0. Run once after enabling the
// auto-discard rule in merge-tracker.mjs to clean up the existing tracker.
//
// Usage:
//   node auto-discard-low.mjs              # show what would change
//   node auto-discard-low.mjs --apply      # actually rewrite applications.md
//
// Adds "auto-discarded: score X < 3.0" prefix to the notes column.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPS = path.join(__dirname, 'data/applications.md');

const apply = process.argv.includes('--apply');

const lines = fs.readFileSync(APPS, 'utf8').split('\n');
const changes = [];
const out = [];

for (const line of lines) {
  if (!line.startsWith('|') || line.includes('---') || /\|\s*#\s*\|/.test(line)) {
    out.push(line);
    continue;
  }
  // | id | date | company | role | score/5 | status | pdf | report | notes |
  const parts = line.split('|').map(p => p);
  if (parts.length < 10) { out.push(line); continue; }

  const id = parts[1].trim();
  const company = parts[3].trim();
  const role = parts[4].trim();
  const scoreStr = parts[5].trim();
  const status = parts[6].trim();
  const notes = parts[9].trim();

  // Only touch Evaluated entries (don't override Applied/Interview/Offer)
  if (status !== 'Evaluated') { out.push(line); continue; }

  // EXEMPT: self-sourced JDs and referrals always stay Evaluated
  // (user explicitly chose these — they want to see them no matter what)
  if (/\[self-sourced\]/i.test(notes) || /\[referral:/i.test(notes) || /\[cowork\]/i.test(notes)) {
    out.push(line); continue;
  }

  const m = scoreStr.match(/^([\d.]+)\s*\/\s*5/);
  const score = m ? parseFloat(m[1]) : null;
  const notesLower = (notes || '').toLowerCase();
  const recommendsAgainst = /\b(do not apply|do not pursue|recommend against|hard\s*(?:no|blocker|disqualifier)|hard.?disqualifier|location\s+(?:blocker|hard.?no|mismatch|disqualifier)|international\s+relocation|requires\s+(?:relocation|presence\s+in)|not recommended|not applicable)\b/.test(notesLower);
  const lowScore = score != null && !isNaN(score) && score < 3.0;

  if (!lowScore && !recommendsAgainst) { out.push(line); continue; }

  // Flip to Discarded
  const reason = recommendsAgainst
    ? `auto-discarded: agent recommends against`
    : `auto-discarded: score ${score} < 3.0`;
  const newNotes = notes ? `${reason}. ${notes}` : reason;
  parts[6] = ' Discarded ';
  parts[9] = ` ${newNotes} `;
  const newLine = parts.join('|');
  out.push(newLine);
  changes.push({ id, score: score ?? '–', company, role, why: recommendsAgainst ? 'rec' : 'score' });
}

if (changes.length === 0) {
  console.log('✅ No Evaluated entries with score <3.0 found.');
  process.exit(0);
}

console.log(`Found ${changes.length} Evaluated entries to discard:\n`);
console.log(`  ID   Score Why  Company                    Role`);
console.log(`  ---- ----- ---- -------                    ----`);
for (const c of changes) {
  console.log(`  #${String(c.id).padStart(3)}  ${String(c.score).padStart(4)}  ${c.why.padEnd(4)} ${c.company.padEnd(25).slice(0, 25)}  ${c.role}`);
}

if (!apply) {
  console.log('\nRun with --apply to flip these to Discarded in applications.md');
  process.exit(0);
}

fs.writeFileSync(APPS, out.join('\n'));
console.log(`\n✅ Flipped ${changes.length} entries to Discarded.`);
