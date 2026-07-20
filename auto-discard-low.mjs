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
import { parseTrackerLine, formatTrackerLine } from './lib/tracker.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPS = path.join(__dirname, 'data/applications.md');

const apply = process.argv.includes('--apply');

const lines = fs.readFileSync(APPS, 'utf8').split('\n');
const changes = [];
const out = [];

for (const line of lines) {
  // parseTrackerLine returns null for headers, separators and non-rows, and it
  // knows the current 10-column layout. This used to hand-index line.split('|')
  // against the legacy 9-column schema, which read the Report cell as notes — so
  // the [self-sourced] exemption and the recommends-against check below both ran
  // against a markdown link and never fired, and flipping a row overwrote the
  // Report cell instead of the notes.
  const row = parseTrackerLine(line);
  if (!row) { out.push(line); continue; }

  const { num: id, company, role, score: scoreStr, status, notes } = row;

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
  out.push(formatTrackerLine({ ...row, status: 'Discarded', notes: newNotes }));
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
