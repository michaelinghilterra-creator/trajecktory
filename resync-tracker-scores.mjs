#!/usr/bin/env node
/**
 * resync-tracker-scores.mjs — copy each derived report's headline score into its
 * tracker Score cell.
 *
 * WHY THIS EXISTS:
 * The headline score is DERIVED. `compute-scores.mjs` computes it from the keyed
 * dimensions and stamps it into the report; the tracker Score cell is a COPY of
 * that number. `merge-tracker.mjs` writes the copy, but only for rows flowing
 * through a merge. Re-derive a report after its row has already merged and the
 * two silently diverge, permanently, because nothing re-reads the report for an
 * existing row.
 *
 * That is not hypothetical. When the level-floor policy shipped on 2026-08-17,
 * `compute-scores.mjs --all --apply` re-derived every keyed report. 195 rows
 * moved, every one of them upward, and not one tracker cell followed. The drift
 * stops dead at 2026-08-17 because reports written after that date were derived
 * under the floor from the start.
 *
 * `verify-score-drift.mjs` DETECTS this and used to recommend re-running
 * compute-scores and merge-tracker. That recovery does not work: merge-tracker
 * only rewrites a Score cell for a row it is currently merging, so for an
 * already-merged row it is a no-op and the guard stays red forever. This script
 * is the missing half.
 *
 * DIRECTION OF TRUTH: the report. The tracker cell is the copy, always.
 *
 * WHAT IT TOUCHES:
 * The Score cell, and nothing else, ever. The edit is a surgical replacement of
 * one cell inside the raw line rather than a re-render of the row, so spacing is
 * byte-identical and a legacy 9-column row cannot silently gain columns (which a
 * full formatTrackerLine round-trip would do, since it always emits 11). Every
 * other parsed field is asserted unchanged before a byte is written, and any row
 * failing that assertion aborts the whole run rather than writing a partial file.
 *
 * Legacy reports are skipped BY DESIGN: an authored score predates the derived
 * model and is never recomputed, so a difference there is not drift.
 *
 * data/applications.md is user-layer and gitignored, so there is no git history
 * behind it and a timestamped backup is the ONLY rollback. The plain
 * `applications.md.bak` name is deliberately avoided: other scripts overwrite it.
 *
 * Usage:
 *   node resync-tracker-scores.mjs            # DRY RUN (default): print the plan
 *   node resync-tracker-scores.mjs --apply    # write, after backing up
 *   node resync-tracker-scores.mjs --json     # machine-readable summary
 *
 * Idempotent: a row already carrying its report's score is left alone, so a
 * second run reports zero changes. Run `node verify-score-drift.mjs` after.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseTrackerLine } from './lib/tracker.mjs';
import { hasV1Frontmatter, parseV1 } from './dashboard-web/server/v1-loader.mjs';
import { localToday, logWritesEnabled, writeTableText } from './lib/log-writes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.TJK_DATA_DIR ? path.resolve(process.env.TJK_DATA_DIR) : path.join(HERE, 'data');
const APPS = path.join(DATA_DIR, 'applications.md');

// The canonical Score cell format, matching merge-tracker.mjs exactly.
const fmtScore = (n) => `${n.toFixed(1)}/5`;

// Every parsed field that must survive the edit untouched. `score` is the one
// field allowed to change; `raw` necessarily changes with it.
const INVARIANT = ['num', 'date', 'company', 'role', 'status', 'pdf', 'resume',
  'report', 'reportPath', 'notes', 'url', 'urlCell', 'columns', 'cellCount'];

/**
 * Replace ONLY the Score cell inside a raw tracker line, preserving the exact
 * spacing of every other cell. Returns the new line, or null if the line does
 * not have the expected shape.
 *
 * parseTrackerLine drops the empty strings the leading and trailing pipes
 * create, so its cell 4 (score) is split index 5 in the raw line.
 */
export function replaceScoreCell(line, newCell) {
  const parts = String(line).split('|');
  if (parts.length < 11) return null;          // 9 inner cells + 2 empties
  const i = 5;
  const old = parts[i];
  // Preserve whatever padding the row already used around the value.
  const lead = (old.match(/^\s*/) || [''])[0];
  const tail = (old.match(/\s*$/) || [''])[0];
  parts[i] = `${lead}${newCell}${tail}`;
  return parts.join('|');
}

/**
 * Pure planner. `rows` are raw lines; `loadReport(relPath) -> md|null`.
 * Returns { checked, changes:[{num, company, from, to, line, newLine}], skipped }.
 */
/**
 * planScoreResync(lines, loadReport, { only })
 *
 * `only` restricts the plan to a set of report/tracker numbers. It exists because
 * all-or-nothing forced a bad choice: after a restamp touched 10 rows, 16 OTHER
 * rows were also out of sync for an unrelated and undiagnosed reason, and the only
 * way to finish the 10 was to also overwrite the 16. That would not have fixed the
 * 16 — it would have destroyed the evidence that something is wrong with them.
 * Drift is information, so a subset resync has to be expressible.
 */
export function planScoreResync(lines, loadReport, { only } = {}) {
  const limit = only == null ? null : new Set([...only].map(n => String(n).trim()).filter(Boolean));
  const changes = [];
  let checked = 0, legacy = 0, noReport = 0, filtered = 0;
  for (const line of lines) {
    const row = parseTrackerLine(line);
    if (!row) continue;
    // parseTrackerLine falls back to the RAW cell when it holds no markdown link,
    // so an em-dash placeholder arrives here as a truthy "path". Require the shape
    // of a real report path, otherwise a row with no report is miscounted as a
    // legacy report, which reads as "checked and skipped" when it was neither.
    if (!row.reportPath || !/^reports\/.+\.md$/.test(row.reportPath)) { noReport++; continue; }
    const md = loadReport(row.reportPath);
    if (!md || !hasV1Frontmatter(md)) { legacy++; continue; }
    let data;
    try { data = parseV1(md).data; } catch { legacy++; continue; }
    if (data.scoreSource !== 'derived') { legacy++; continue; }
    if (typeof data.score !== 'number' || !Number.isFinite(data.score)) { legacy++; continue; }
    checked++;

    const current = Number.parseFloat(row.score);
    if (!Number.isNaN(current) && Math.abs(current - data.score) <= 0.001) continue; // already in sync

    const newLine = replaceScoreCell(line, fmtScore(data.score));
    if (newLine == null) {
      throw new Error(`row #${row.num}: unexpected line shape, refusing to write`);
    }
    // Nothing but the score may move.
    const after = parseTrackerLine(newLine);
    if (!after) throw new Error(`row #${row.num}: rewritten line no longer parses, aborting`);
    for (const k of INVARIANT) {
      if (String(after[k]) !== String(row[k])) {
        throw new Error(`row #${row.num}: field "${k}" changed (${row[k]} -> ${after[k]}), aborting`);
      }
    }
    // Filter AFTER the field-integrity check above, so a row excluded by --only is
    // still validated rather than silently unexamined.
    if (limit && !limit.has(String(row.num))) { filtered++; continue; }
    changes.push({ num: row.num, company: row.company, from: row.score, to: fmtScore(data.score), line, newLine });
  }
  return { checked, changes, skipped: { legacy, noReport, filtered } };
}

// --only 2922,2923  or  --only-file path (one id per line, # comments allowed)
function parseOnly(argv) {
  const i = argv.indexOf('--only');
  if (i > -1 && argv[i + 1]) return argv[i + 1].split(/[,\s]+/).filter(Boolean);
  const f = argv.indexOf('--only-file');
  if (f > -1 && argv[f + 1]) {
    return fs.readFileSync(argv[f + 1], 'utf-8')
      .split(/\r?\n/).map(l => l.replace(/#.*$/, '').trim()).filter(Boolean);
  }
  return null;
}

function main() {
  const apply = process.argv.includes('--apply');
  const jsonOut = process.argv.includes('--json');
  const only = parseOnly(process.argv);
  if (!fs.existsSync(APPS)) {
    console.error(`No tracker at ${APPS}`);
    process.exit(1);
  }
  const text = fs.readFileSync(APPS, 'utf-8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const loadReport = (rel) => {
    try { return fs.readFileSync(path.join(HERE, rel), 'utf-8'); } catch { return null; }
  };

  let plan;
  try { plan = planScoreResync(lines, loadReport, { only }); }
  catch (err) { console.error(`ABORTED: ${err.message}`); process.exit(1); }

  if (only && !jsonOut) {
    console.log(`\nSCOPED to ${only.length} id(s): ${only.join(' ')}`);
    console.log(`Rows out of sync but NOT in scope are left alone deliberately.`);
  }

  if (jsonOut) {
    console.log(JSON.stringify({
      checked: plan.checked,
      changed: plan.changes.length,
      skipped: plan.skipped,
      applied: apply,
      changes: plan.changes.map(({ num, company, from, to }) => ({ num, company, from, to })),
    }, null, 2));
    if (!apply) process.exit(0);
  } else {
    console.log(`\nDerived reports checked:  ${plan.checked}`);
    console.log(`Legacy / no report:       ${plan.skipped.legacy} legacy, ${plan.skipped.noReport} without a report link`);
    console.log(`Tracker cells out of sync: ${plan.changes.length}\n`);
    for (const c of plan.changes.slice(0, 40)) {
      console.log(`  #${String(c.num).padEnd(5)} ${String(c.from).padStart(7)} -> ${c.to.padEnd(7)}  ${c.company}`);
    }
    if (plan.changes.length > 40) console.log(`  … and ${plan.changes.length - 40} more`);
  }

  if (!plan.changes.length) {
    if (!jsonOut) console.log('\nNothing to do: every derived report already matches its tracker cell.\n');
    process.exit(0);
  }
  if (!apply) {
    if (!jsonOut) console.log(`\nDRY RUN. Re-run with --apply to write these ${plan.changes.length} cells.\n`);
    process.exit(0);
  }

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const backup = `${APPS}.bak-scores-${stamp}`;

  const byLine = new Map(plan.changes.map(c => [c.line, c.newLine]));
  const out = lines.map(l => (byLine.has(l) ? byLine.get(l) : l));
  const newText = out.join(eol);
  if (logWritesEnabled(DATA_DIR)) {
    try {
      writeTableText({
        dataDir: DATA_DIR,
        file: 'applications.md',
        baseText: text,
        newText,
        rowKey: line => {
          const row = parseTrackerLine(line);
          return row ? String(row.num) : null;
        },
        buildEvents: ({ added, changed, removed }) => {
          if (added.length || removed.length) throw new Error('resync-tracker-scores may only update existing tracker rows');
          return changed.map(change => {
            const row = parseTrackerLine(change.raw);
            return {
              type: 'legacy_record', application_id: String(row.num), occurred_on: localToday(),
              payload: { reason: 'tracker_row_updated', ref: `app:${row.num}`, fields: ['score'], legacy_effects: [change.effect] },
            };
          });
        },
      });
    } catch (error) {
      if (error.code === 'RENDER_FAILED') console.warn(`Warning: ${error.message}`);
      else { console.error(error.message); process.exit(1); }
    }
    fs.writeFileSync(backup, text);
  } else {
    fs.copyFileSync(APPS, backup);
    fs.writeFileSync(APPS, newText, 'utf-8');
  }

  if (!jsonOut) {
    console.log(`\nBacked up to ${path.basename(backup)}`);
    console.log(`Wrote ${plan.changes.length} Score cells. Run \`node verify-score-drift.mjs\` to confirm.\n`);
  }
}

const invokedDirectly = (() => {
  try { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
})();
if (invokedDirectly) main();
