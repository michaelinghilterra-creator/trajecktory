#!/usr/bin/env node
// verify-score-drift.mjs — scoring drift guard.
//
// After the scoring redesign the headline is DERIVED: compute-scores.mjs stamps
// `score` + `scoreSource:"derived"` into a report, and merge-tracker re-derives the
// tracker Score column from that same report. Two copies of one number can drift
// apart: a batch worker that could not run compute-scores, a hand-edit, a stale
// merge. This flags any tracker row whose report is derived but whose Score cell
// does not match the report's headline.
//
// Legacy reports (no derived score) are skipped BY DESIGN: their authored number
// predates the redesign and is never recomputed, so a tracker/report difference
// there is not this guard's concern.
//
// Usage:
//   node verify-score-drift.mjs          # check all derived reports
//   node verify-score-drift.mjs --json   # machine-readable
// Exit 0 if every derived report matches its tracker Score, 1 on any drift.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseTracker } from './lib/tracker.mjs';
import { hasV1Frontmatter, parseV1 } from './dashboard-web/server/v1-loader.mjs';

// Pure core: tracker `rows` (from parseTracker) + `loadReport(relPath) -> md|null`.
// Returns { checked, drift:[{ num, company, reportScore, trackerScore, reason }] }.
// Injectable so it is unit-tested with no files.
export function findScoreDrift(rows, loadReport) {
  const drift = [];
  let checked = 0;
  for (const row of rows) {
    if (!row.reportPath) continue;
    const md = loadReport(row.reportPath);
    if (!md || !hasV1Frontmatter(md)) continue;
    let data;
    try { data = parseV1(md).data; } catch { continue; }
    if (data.scoreSource !== 'derived') continue; // only the derived path
    checked++;
    const reportScore = typeof data.score === 'number' ? data.score : null;
    const trackerScore = Number.parseFloat(row.score); // "4.2/5" -> 4.2
    if (reportScore == null) {
      drift.push({ num: row.num, company: row.company, reportScore: null, trackerScore: row.score, reason: 'report has scoreSource:derived but no numeric score' });
    } else if (Number.isNaN(trackerScore)) {
      drift.push({ num: row.num, company: row.company, reportScore, trackerScore: row.score, reason: 'tracker Score is unparseable' });
    } else if (Math.abs(reportScore - trackerScore) > 0.001) {
      drift.push({ num: row.num, company: row.company, reportScore, trackerScore, reason: 'mismatch' });
    }
  }
  return { checked, drift };
}

function isMain() {
  try { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}

function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const jsonOut = process.argv.includes('--json');
  const appsPath = path.join(__dirname, 'data', 'applications.md');
  const reportsDir = path.join(__dirname, 'reports');

  if (!fs.existsSync(appsPath)) {
    console.log('No data/applications.md yet — nothing to verify.');
    process.exit(0);
  }
  const rows = parseTracker(fs.readFileSync(appsPath, 'utf8'));

  // Only ever read out of reports/; a report path that escapes it is ignored.
  const loadReport = (rel) => {
    const abs = path.resolve(__dirname, rel);
    if (abs !== reportsDir && !abs.startsWith(reportsDir + path.sep)) return null;
    try { return fs.readFileSync(abs, 'utf8'); } catch { return null; }
  };

  const { checked, drift } = findScoreDrift(rows, loadReport);

  if (jsonOut) {
    console.log(JSON.stringify({ checked, drift }, null, 2));
    process.exit(drift.length ? 1 : 0);
  }

  console.log(`\nChecked ${checked} derived report${checked === 1 ? '' : 's'} against the tracker`);
  if (!drift.length) {
    console.log('✅ Every derived report matches its tracker Score\n');
    process.exit(0);
  }
  console.log(`⚠️  ${drift.length} score drift${drift.length === 1 ? '' : 's'} (tracker Score does not match the derived report):\n`);
  for (const d of drift) {
    console.log(`  #${d.num} ${d.company}: tracker ${d.trackerScore} vs report ${d.reportScore ?? 'none'}  (${d.reason})`);
  }
  console.log('\nFix: re-run `node compute-scores.mjs --all --apply` then `node merge-tracker.mjs` so both read the report.\n');
  process.exit(1);
}

if (isMain()) main();
