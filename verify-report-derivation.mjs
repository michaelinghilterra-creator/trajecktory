#!/usr/bin/env node
/**
 * verify-report-derivation.mjs — every report's stored headline must equal the
 * score derived from that report's OWN dimension ratings.
 *
 * WHY THIS EXISTS, and why verify-score-drift.mjs does not cover it:
 * that script compares the TRACKER cell against the REPORT headline. Both can
 * agree perfectly while the headline disagrees with the dimensions underneath it,
 * and then nothing anywhere notices. That is exactly what happened: a batch of 15
 * reports on 2026-09-18 carried headlines that no longer matched their own ratings,
 * their tracker cells faithfully mirrored the wrong headlines, and verify-score-drift
 * reported them as clean. They were found only because a --all dry run was read by
 * hand during an unrelated investigation.
 *
 * The two guards are complementary and neither replaces the other:
 *   verify-score-drift.mjs      tracker cell  <-> report headline
 *   verify-report-derivation.mjs  report headline <-> its own globalScore
 *
 * Exit 1 when any report drifts, so this can be wired into CI rather than read.
 * Usage: node verify-report-derivation.mjs [--json] [--limit N]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { deriveReportScore } from './compute-scores.mjs';
import { loadScoringWeights } from './lib/score.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPORTS = path.join(ROOT, 'reports');
const asJson = process.argv.includes('--json');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const cfg = loadScoringWeights(path.join(ROOT, 'config', 'profile.yml'));

function storedScore(md) {
  if (!md.startsWith('---')) return null;
  const e = md.indexOf('\n---', 3);
  if (e < 0) return null;
  try {
    const d = JSON.parse(md.slice(3, e).trim());
    return { score: typeof d.score === 'number' ? d.score : null, id: d.id ?? null, company: d.company ?? '', date: d.date ?? '' };
  } catch { return null; }
}

let checked = 0, skipped = 0;
const drift = [];

let files = [];
try { files = fs.readdirSync(REPORTS).filter(f => f.endsWith('.md')).sort(); }
catch { console.error(`No reports directory at ${REPORTS}`); process.exit(1); }

for (const f of files) {
  if (checked >= LIMIT) break;
  const md = fs.readFileSync(path.join(REPORTS, f), 'utf8');
  const meta = storedScore(md);
  if (!meta) { skipped++; continue; }
  const r = deriveReportScore(md, cfg);
  // Legacy reports carry no keyed dimensions and are deliberately out of scope --
  // there is nothing to derive from, so there is nothing to disagree with.
  if (!r.ok) { skipped++; continue; }
  checked++;
  if (meta.score === null || Math.abs(r.score - meta.score) > 1e-9) {
    drift.push({ file: f, id: meta.id, company: meta.company, date: meta.date, stored: meta.score, derived: r.score });
  }
}

if (asJson) {
  console.log(JSON.stringify({ checked, skipped, drifted: drift.length, drift }, null, 2));
} else {
  console.log(`\nChecked ${checked} derivable reports against their own dimension ratings (${skipped} legacy/unparseable skipped)`);
  if (!drift.length) {
    console.log('✅ No derivation drift — every headline matches its own globalScore.\n');
  } else {
    console.log(`⚠️  ${drift.length} report(s) whose headline disagrees with their own ratings:\n`);
    for (const d of drift.slice(0, 40)) {
      console.log(`  #${d.id} ${String(d.company).slice(0, 26).padEnd(27)} ${d.date}  stored ${d.stored} vs derived ${d.derived}`);
    }
    if (drift.length > 40) console.log(`  ... and ${drift.length - 40} more`);
    console.log(`\nFix: node compute-scores.mjs --all --apply  (then merge-tracker.mjs and verify-score-drift.mjs)`);
    console.log(`Read the diff BEFORE applying — restamping overwrites the stored headline.\n`);
  }
}

process.exit(drift.length === 0 ? 0 : 1);
