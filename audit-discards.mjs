#!/usr/bin/env node
// audit-discards.mjs — READ-ONLY. Lists auto-discarded roles whose score sits
// just below the auto-discard threshold, so a noisy score near the line that may
// have wrongly tossed a real match is visible for a human re-check.
//
// The auto-discard fires on a SINGLE eval score with no run-to-run drift guard,
// and once a row is checked off in pipeline.md it is never re-scored — so a role
// that scored, say, 2.9 on its one run hardens into Discarded even if a re-run
// would clear 3.0. This surfaces exactly that band ([threshold-0.5, threshold))
// for review; it never writes. Re-evaluate any that look wrong (the merge already
// resets status when a re-eval clears the threshold).
//
// Usage:
//   node audit-discards.mjs            # list near-threshold auto-discards
//   node audit-discards.mjs --all      # list every auto-discarded row

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseTrackerLine } from './lib/tracker.mjs';
import { AUTO_DISCARD_SCORE, parseScore, scoreIsParseable } from './lib/discard.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APPS = path.join(__dirname, 'data/applications.md');
const all = process.argv.includes('--all');
const BAND = 0.5; // "near the line" = within this much below the threshold

if (!fs.existsSync(APPS)) {
  console.log('No data/applications.md yet — nothing to audit.');
  process.exit(0);
}

const rows = [];
for (const line of fs.readFileSync(APPS, 'utf8').split('\n')) {
  const row = parseTrackerLine(line);
  if (!row) continue;
  if (row.status !== 'Discarded') continue;
  if (!/auto-discarded:/i.test(row.notes || '')) continue;
  const m = (row.score || '').match(/^([\d.]+)/);
  const score = scoreIsParseable(row.score) && m ? parseFloat(m[1]) : null;
  const near = score != null && score >= AUTO_DISCARD_SCORE - BAND && score < AUTO_DISCARD_SCORE;
  if (all || near) rows.push({ ...row, _score: score, _near: near });
}

if (rows.length === 0) {
  console.log(all
    ? 'No auto-discarded rows found.'
    : `No auto-discarded rows in the near-threshold band [${(AUTO_DISCARD_SCORE - BAND).toFixed(1)}, ${AUTO_DISCARD_SCORE.toFixed(1)}).`);
  process.exit(0);
}

rows.sort((a, b) => (b._score ?? -1) - (a._score ?? -1));
const scope = all ? 'auto-discarded' : `near-threshold auto-discarded ([${(AUTO_DISCARD_SCORE - BAND).toFixed(1)}, ${AUTO_DISCARD_SCORE.toFixed(1)}))`;
console.log(`${rows.length} ${scope} role${rows.length === 1 ? '' : 's'} — re-evaluate any that look wrongly tossed:\n`);
console.log('  ID   Score  Company                    Role');
console.log('  ---- -----  -------                    ----');
for (const r of rows) {
  const s = r._score != null ? r._score.toFixed(1) : '  –';
  console.log(`  #${String(r.num).padStart(3)}  ${String(s).padStart(4)}  ${String(r.company).padEnd(25).slice(0, 25)}  ${r.role}`);
}
if (!all) console.log('\nRun with --all to see every auto-discarded row.');
