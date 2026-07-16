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

// Recursively collect .md files under interview-prep/, including the per-company
// subfolders (e.g. "Example Co/example-co-round-2-hiring-manager.md"). Stage
// inference and the story-bank skip both key off the basename, so nesting is
// transparent to the checks below.
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.md') &&
      entry.name !== 'story-bank.md' &&
      // Run sheets are compiled sidecars with JSON frontmatter, not prose prep
      // files. They have no §-sections, so inferStage() would file every one as a
      // legacy warning. They are validated by their own schema instead.
      // See templates/runsheet-schema-v1.md
      !entry.name.endsWith('.run.md')
    ) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(DIR);

const results = []; // genuine drift: a standardized sheet missing some §-headings
const legacy = [];  // pre-standard free-form cards: none of the §-headings present
let checked = 0;
for (const full of files) {
  const name = path.basename(full);
  const stage = inferStage(name);
  if (!stage) continue; // skip intel reports and non-cheatsheet files
  checked++;
  const md = fs.readFileSync(full, 'utf8');
  const required = REQUIRED[stage];
  const missing = required.filter(h => !md.includes(h));
  if (missing.length === 0) continue; // conforms
  // Report the path relative to interview-prep/ so the subfolder is visible.
  const rel = path.relative(DIR, full);
  // A file with NONE of the standard §-headings is a legacy free-form card that
  // predates the §0–§10 template, not drift in a standardized sheet. Surface it
  // as a warning to migrate, but don't hard-fail the run on it. A file missing
  // only SOME §-headings is genuine drift and still fails.
  if (missing.length === required.length) {
    legacy.push({ file: rel, stage });
  } else {
    results.push({ file: rel, stage, missing });
  }
}

if (jsonOut) {
  console.log(JSON.stringify({ total: checked, drift: results, legacy }, null, 2));
} else {
  console.log(`\nChecked ${checked} interview cheat sheet(s)`);
  if (results.length === 0) {
    console.log('✅ All standardized cheat sheets have required headings');
  } else {
    console.log(`⚠️  ${results.length} cheat sheet(s) missing required headings:\n`);
    for (const r of results) {
      console.log(`  [${r.stage}] ${r.file}`);
      console.log(`    missing: ${r.missing.join(', ')}`);
    }
    console.log('');
    console.log('Fix: regenerate the cheat sheet from the appropriate template');
    console.log('     under templates/interview-cheatsheet-{stage}.md');
  }
  if (legacy.length > 0) {
    console.log(`\nℹ️  ${legacy.length} legacy free-form card(s) (predate the §0–§10 template, not counted as failures):`);
    for (const l of legacy) console.log(`  [${l.stage}] ${l.file}`);
    console.log('  Regenerate from the current template when convenient to standardize.');
  }
  console.log('');
}

process.exit(results.length === 0 ? 0 : 1);
