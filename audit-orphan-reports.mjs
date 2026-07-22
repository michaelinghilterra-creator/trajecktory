#!/usr/bin/env node
/**
 * audit-orphan-reports.mjs — find evaluations that exist as a report on disk but
 * have no row in the tracker.
 *
 * WHY THIS EXISTS:
 * An evaluation costs real tokens and real time, and its only durable record is
 * its tracker row. Reports went missing from the tracker two ways: a deduper
 * that clustered on a guessed role title and deleted rows, and a merge path that
 * skipped an addition, wrote no row, and then filed its TSV under merged/
 * exactly as if it had landed. Both were silent, because a tracker with a
 * missing row is still a perfectly valid tracker.
 *
 * Both causes are fixed. This exists to find what they already took, and to keep
 * catching anything new that slips through.
 *
 * IT IS READ-ONLY. It never writes, never restores, never deletes. A report with
 * no row might be a genuine loss worth reinstating, or deliberately archived
 * noise. Only the user can tell those apart, so this classifies and reports and
 * stops there. Restoring is a separate, deliberate act, described in the output.
 *
 * Usage:
 *   node audit-orphan-reports.mjs            # grouped summary + the losses
 *   node audit-orphan-reports.mjs --lost     # only the losses
 *   node audit-orphan-reports.mjs --json     # machine-readable
 *
 * Exit code: always 0. This is a report, not a gate. A genuine loss is something
 * to think about, not a reason to fail a build.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';
import { parseTrackerLine } from './lib/tracker.mjs';
import { canonicalUrl, urlFromReport, urlForRow } from './lib/identity.mjs';

/**
 * Classify every report on disk against the tracker. Pure and read-only.
 * Exported so doctor.mjs can surface the count without spawning a process or
 * keeping a second copy of the rules.
 */
export function auditOrphanReports(rootDir) {
  const REPORTS_DIR = join(rootDir, 'reports');
  const APPS = join(rootDir, 'data/applications.md');
  const MERGED_DIR = join(rootDir, 'batch/tracker-additions/merged');
  const empty = { counts: { reports: 0, onTracker: 0, archived: 0, duplicateOfLive: 0, lost: 0, recoverable: 0 }, live: [], archived: [], duplicate: [], lost: [] };
  if (!existsSync(REPORTS_DIR) || !existsSync(APPS)) return empty;

  // ── What the tracker currently knows ───────────────────────────────────────
  const liveRows = [];
  for (const line of readFileSync(APPS, 'utf-8').split('\n')) {
    const row = parseTrackerLine(line);
    if (row) liveRows.push(row);
  }
  // A report counts as represented if a row points AT it (by path) or carries
  // its number. Both, because a hand-edited row can lose its link while keeping
  // its id, and either alone would report false losses.
  const claimedPaths = new Set();
  const claimedNums = new Set();
  const liveByCanonical = new Map();
  for (const row of liveRows) {
    if (row.reportPath) claimedPaths.add(basename(row.reportPath));
    claimedNums.add(row.num);
    const u = urlForRow(row, rootDir);
    if (u) {
      const key = canonicalUrl(u);
      if (key && !liveByCanonical.has(key)) liveByCanonical.set(key, row);
    }
  }

  // ── What was deliberately archived ─────────────────────────────────────────
  // archive-discarded.mjs moves rows out to data/applications-archive-*.md.
  // Those are a decision the user made, not a loss, and must not be reported as
  // one — a report that cries wolf about 300 deliberate archives gets ignored.
  const archivedNums = new Map();
  const dataDir = join(rootDir, 'data');
  if (existsSync(dataDir)) {
    for (const f of readdirSync(dataDir).filter(n => /^applications-archive.*\.md$/.test(n))) {
      for (const line of readFileSync(join(dataDir, f), 'utf-8').split('\n')) {
        const row = parseTrackerLine(line);
        if (row && !archivedNums.has(row.num)) archivedNums.set(row.num, f);
      }
    }
  }

  // ── A TSV under merged/ means the evaluation can be replayed ───────────────
  const tsvByNum = new Map();
  if (existsSync(MERGED_DIR)) {
    for (const f of readdirSync(MERGED_DIR).filter(n => n.endsWith('.tsv'))) {
      const m = f.match(/^(\d+)-/);
      if (m && !tsvByNum.has(Number(m[1]))) tsvByNum.set(Number(m[1]), f);
    }
  }

  const meta = (file) => {
    try {
      const text = readFileSync(join(REPORTS_DIR, file), 'utf-8').slice(0, 4000);
      const pick = (k) => (text.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`)) || [])[1] || null;
      return { company: pick('company'), role: pick('role'), date: pick('date') };
    } catch { return { company: null, role: null, date: null }; }
  };

  const live = [], archived = [], duplicate = [], lost = [];
  for (const file of readdirSync(REPORTS_DIR).filter(f => f.endsWith('.md')).sort()) {
    const m = file.match(/^(\d+)-/);
    if (!m) continue;                     // not a numbered evaluation report
    const num = Number(m[1]);

    if (claimedPaths.has(file) || claimedNums.has(num)) { live.push(num); continue; }
    if (archivedNums.has(num)) { archived.push({ num, file, archive: archivedNums.get(num) }); continue; }

    // The posting may still be on the tracker under a DIFFERENT report: a
    // re-eval that wrote a second report file while the row kept pointing at the
    // first. The evaluation is duplicated, not lost, so it is not a problem.
    const url = urlFromReport(`reports/${file}`, rootDir);
    const key = url ? canonicalUrl(url) : null;
    if (key && liveByCanonical.has(key)) {
      duplicate.push({ num, file, coveredBy: liveByCanonical.get(key).num });
      continue;
    }

    lost.push({ num, file, url, tsv: tsvByNum.get(num) || null, ...meta(file) });
  }

  return {
    counts: {
      reports: live.length + archived.length + duplicate.length + lost.length,
      onTracker: live.length,
      archived: archived.length,
      duplicateOfLive: duplicate.length,
      lost: lost.length,
      recoverable: lost.filter(l => l.tsv).length,
    },
    live, archived, duplicate, lost,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ROOT = dirname(fileURLToPath(import.meta.url));
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`audit-orphan-reports.mjs — evaluations with no tracker row (READ-ONLY)

  node audit-orphan-reports.mjs          grouped summary + the losses
  node audit-orphan-reports.mjs --lost   only the losses
  node audit-orphan-reports.mjs --json   machine-readable`);
    process.exit(0);
  }

  const result = auditOrphanReports(ROOT);
  const { counts, lost } = result;

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ ok: true, ...result, live: undefined }, null, 2));
    process.exit(0);
  }

  const say = (...a) => console.log(...a);
  if (!argv.includes('--lost')) {
    say(`\n📋 audit-orphan-reports — READ-ONLY, nothing is written\n`);
    say(`   reports on disk        : ${counts.reports}`);
    say(`   on the tracker         : ${counts.onTracker}`);
    say(`   deliberately archived  : ${counts.archived}   (a decision you made, not a loss)`);
    say(`   duplicate of a live row: ${counts.duplicateOfLive}   (same posting, second report file)`);
    say(`   NO ROW AND NOT ARCHIVED: ${counts.lost}`);
  }

  if (!lost.length) {
    say(`\n✅ Every evaluation on disk is either on the tracker or deliberately archived.`);
    process.exit(0);
  }

  say(`\n⚠️  ${lost.length} evaluation${lost.length === 1 ? '' : 's'} exist as a report with no tracker row.`);
  say(`   Each cost tokens to produce and is currently invisible to the dashboard,`);
  say(`   to scans, and to every dedup check.\n`);

  const w = (s, n) => String(s ?? '—').slice(0, n - 1).padEnd(n);
  say(`   ${w('#', 6)}${w('Company', 24)}${w('Role', 38)}${w('Date', 12)}Recoverable`);
  say(`   ${'-'.repeat(79)}`);
  for (const l of lost) say(`   ${w(l.num, 6)}${w(l.company, 24)}${w(l.role, 38)}${w(l.date, 12)}${l.tsv ? 'yes' : 'report only'}`);

  say(`\n   ${counts.recoverable} of ${lost.length} still have their original TSV under batch/tracker-additions/merged/.`);
  say(`\n   To reinstate one, put it back THROUGH THE MERGE rather than hand-editing the`);
  say(`   tracker (a hand-rolled row is how several of these were lost to begin with):`);
  say(`\n     cp batch/tracker-additions/merged/<file>.tsv batch/tracker-additions/`);
  say(`     node merge-tracker.mjs`);
  say(`\n   Do this only on a version carrying the URL veto, or the merge drops them`);
  say(`   again for the same reason it did the first time. Check with:`);
  say(`\n     grep -q "VETOES" merge-tracker.mjs && echo "veto present"`);
  say(`\n   Reports with no TSV cannot be replayed. Reinstating one means re-evaluating`);
  say(`   the posting, if it is even still open.\n`);
}
