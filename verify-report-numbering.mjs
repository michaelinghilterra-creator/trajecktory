#!/usr/bin/env node
// verify-report-numbering.mjs — report numbering drift guard.
//
// WHY THIS EXISTS: report numbers used to be computed by an agent reading
// `reports/` and taking the highest existing number + 1. `reports/` gets pruned
// between batches while `data/applications.md` never is, so that scheme reused
// numbers across different companies and drifted the report number away from the
// tracker id it should equal. Fixed by a persistent counter (`next-jd.mjs`) and,
// for dashboard-driven runs, server-side pre-reservation — but both are only as
// good as an agent actually following the prompt that tells it to use them. A
// stale mode file re-taught the old broken scheme as recently as 2026-08-06,
// silently, because nothing checked the OUTPUT for the symptom.
//
// This checks the output, not the process: it cannot see which numbering method
// an agent used, only whether the result is self-consistent.
//
// IMPORTANT — a tracker row's `num` does NOT have to equal its CURRENTLY-linked
// report's frontmatter `id`. A higher-score re-eval intentionally keeps the
// original row's num (its permanent identity — routes cheatsheets, interview-prep,
// the drawer) while pointing it at a fresh report written later with its OWN
// number (merge-tracker.mjs's apply-updates: `num: duplicate.num, report:
// addition.report`). That is correct, working-as-designed behavior, not drift —
// an earlier version of this guard treated it as drift and flagged 14 ordinary
// re-evals as bugs. Do not reintroduce that check.
//
// What IS always wrong, regardless of re-eval:
//   1. SELF-DRIFT — a report's own filename number and its own frontmatter `id`
//      disagree. A report can never disagree with itself.
//   2. COLLISION — two DIFFERENT tracker rows are BOTH currently linked to reports
//      that claim the same frontmatter id. That is the actual "three #100 reports"
//      failure mode this guard exists to catch: a live report a user can click into
//      is not who it says it is.
//
// Scoped to LINKED reports only (referenced by a tracker row's CURRENT report
// link) for both checks, same precedent as audit-orphan-reports.mjs: a collision
// between a linked report and an ORPHAN (superseded by a later re-eval, invisible
// to the user) is harmless and out of scope here — audit-orphan-reports.mjs covers
// orphans; this covers what the user can actually see and click into.
//
// Usage:
//   node verify-report-numbering.mjs          # check all linked reports
//   node verify-report-numbering.mjs --json   # machine-readable
// Exit 0 if every linked report's numbering is self-consistent, 1 on any drift/collision.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseTracker } from './lib/tracker.mjs';
import { hasV1Frontmatter, parseV1 } from './dashboard-web/server/v1-loader.mjs';

// Pure core: tracker `rows` (from parseTracker) + `loadReport(relPath) -> md|null`.
// Returns { checked, drift:[{ num, company, reason, detail }] }. Injectable so it
// is unit-tested with no files, same shape as findScoreDrift in verify-score-drift.mjs.
export function findNumberingDrift(rows, loadReport) {
  const drift = [];
  let checked = 0;
  const byId = new Map(); // frontmatter id -> [{ num, company, reportPath }] among LINKED reports

  for (const row of rows) {
    if (!row.reportPath) continue;
    const md = loadReport(row.reportPath);
    if (!md || !hasV1Frontmatter(md)) continue; // legacy reports predate numbered ids; not this guard's concern
    let data;
    try { data = parseV1(md).data; } catch { continue; }
    if (typeof data.id !== 'number') continue; // no id to check against
    checked++;

    // 1. SELF-drift: filename number vs the report's own frontmatter id.
    // Filename shape: {num}-{slug}-{date}.md. (Tracker row num is deliberately
    // NOT compared here — see the file header on re-eval.)
    const base = path.basename(row.reportPath);
    const fm = base.match(/^(\d+)-/);
    if (fm && Number.parseInt(fm[1], 10) !== data.id) {
      drift.push({
        num: row.num, company: row.company, reason: 'filename/frontmatter id mismatch',
        detail: `${base} has frontmatter id ${data.id}`,
      });
    }

    // Collect for the collision pass below.
    if (!byId.has(data.id)) byId.set(data.id, []);
    byId.get(data.id).push({ num: row.num, company: row.company, reportPath: row.reportPath });
  }

  // 2. Collision — two DIFFERENT tracker rows' CURRENTLY-linked reports share one
  // frontmatter id.
  for (const [id, entries] of byId) {
    const distinctRows = new Set(entries.map((e) => e.num));
    if (distinctRows.size > 1) {
      drift.push({
        num: id, company: entries.map((e) => e.company).join(' / '), reason: 'reused report number',
        detail: `id ${id} is claimed by ${entries.length} linked reports across tracker rows ${[...distinctRows].join(', ')}: ${entries.map((e) => e.reportPath).join(', ')}`,
      });
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

  const { checked, drift } = findNumberingDrift(rows, loadReport);

  if (jsonOut) {
    console.log(JSON.stringify({ checked, drift }, null, 2));
    process.exit(drift.length ? 1 : 0);
  }

  console.log(`\nChecked ${checked} linked report${checked === 1 ? '' : 's'} for numbering drift`);
  if (!drift.length) {
    console.log('✅ Every linked report\'s number is self-consistent\n');
    process.exit(0);
  }
  console.log(`⚠️  ${drift.length} numbering issue${drift.length === 1 ? '' : 's'}:\n`);
  for (const d of drift) {
    console.log(`  #${d.num} ${d.company}: ${d.reason} — ${d.detail}`);
  }
  console.log('\nA report\'s filename number must match its own frontmatter id, and no two');
  console.log('CURRENTLY-LINKED reports (different tracker rows) may claim the same number.');
  console.log('(A tracker row keeping its own num while pointing at a later re-eval\'s report');
  console.log('with a different id is correct, not a bug — see the file header.)');
  console.log('Fix by hand: rename the report file, correct its frontmatter id, and re-point');
  console.log('the tracker\'s report link — do not hand-compute a replacement number.\n');
  process.exit(1);
}

if (isMain()) main();
