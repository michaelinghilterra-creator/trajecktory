#!/usr/bin/env node
// verify-interview-prep.mjs — health check for interview cheat sheets.
//
// Scans `interview-prep/` for round-N cheat sheet files (NOT intel research
// reports — those use the {company}-{role-slug}.md naming pattern with no
// "round-N" segment, and have their own structure).
//
// For each cheat sheet detected, infers the stage from the filename and
// validates that the required §-headings for that stage are all present.
//
// Stages detected:
//   *round-1-screen*       | *recruiter*    | *phone*          → screen template
//   *round-N-{name-name}*  | *hiring-manager* | *hm*           → hm-round template
//   *final-loop*           | *final*        | *onsite*         → final-loop template
//
// Usage:
//   node verify-interview-prep.mjs            # check all cheat sheets
//   node verify-interview-prep.mjs --json     # machine-readable output
//
// Exit code 0 if all cheat sheets pass, 1 if any have missing headings.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, 'interview-prep');

const jsonOut = process.argv.includes('--json');

const REQUIRED = {
  screen: [
    '## §0', '## §1', '## §2', '## §3', '## §4',
    '## §5', '## §6', '## §7', '## §8', '## §9', '## §10',
  ],
  'hm-round': [
    '## §0', '## §1', '## §2', '## §3', '## §4',
    '## §5', '## §6', '## §7', '## §8', '## §9', '## §10',
  ],
  'final-loop': [
    '## §0', '## §1', '## §2', '## §3', '## §4',
    '## §5', '## §6', '## §7', '## §8', '## §9', '## §10',
  ],
};

// Infer template stage from filename. Cheat sheets follow the
// {company-slug}-round-{N}-{descriptor}.md convention; intel reports do not
// contain "round-" and are skipped.
function inferStage(filename) {
  const lower = filename.toLowerCase();
  if (!/-round-\d+/.test(lower)) return null; // intel report — skip
  if (/final-?loop|final-?round|onsite|panel/.test(lower)) return 'final-loop';
  if (/hiring-?manager|\bhm\b|round-2|round-3/.test(lower)) return 'hm-round';
  if (/screen|recruiter|phone|round-1/.test(lower))         return 'screen';
  // round-N with no stage hint — best guess by N
  const m = lower.match(/-round-(\d+)/);
  const n = m ? parseInt(m[1], 10) : 0;
  if (n === 1) return 'screen';
  if (n === 2) return 'hm-round';
  if (n >= 3)  return 'final-loop';
  return null;
}

if (!fs.existsSync(DIR)) {
  console.log(`No interview-prep/ directory at ${DIR} — nothing to check.`);
  process.exit(0);
}

const files = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.md') && f !== 'story-bank.md');

const results = [];
let checked = 0;
for (const file of files) {
  const stage = inferStage(file);
  if (!stage) continue; // skip intel reports
  checked++;
  const md = fs.readFileSync(path.join(DIR, file), 'utf8');
  const required = REQUIRED[stage];
  const missing = required.filter(h => !md.includes(h));
  if (missing.length > 0) {
    results.push({ file, stage, missing });
  }
}

if (jsonOut) {
  console.log(JSON.stringify({ total: checked, drift: results }, null, 2));
} else {
  console.log(`\nChecked ${checked} interview cheat sheet(s)`);
  if (results.length === 0) {
    console.log('✅ All cheat sheets have required headings\n');
  } else {
    console.log(`⚠️  ${results.length} cheat sheet(s) missing required headings:\n`);
    for (const r of results) {
      console.log(`  [${r.stage}] ${r.file}`);
      console.log(`    missing: ${r.missing.join(', ')}`);
    }
    console.log('');
    console.log('Fix: regenerate the cheat sheet from the appropriate template');
    console.log('     under templates/interview-cheatsheet-{stage}.md\n');
  }
}

process.exit(results.length === 0 ? 0 : 1);
