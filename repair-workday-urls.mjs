#!/usr/bin/env node
/**
 * repair-workday-urls.mjs - put the careers-site segment back into stored Workday links.
 *
 * WHY THIS EXISTS:
 * Until v5.13.1 the scanner saved Workday postings as
 *   https://{tenant}.{shard}.myworkdayjobs.com/job/{Location}/{Title}_{ReqId}
 * with no careers-site segment. Workday answers that shape with "invalid URL", so
 * the dashboard's JD link was dead on those rows, and an evaluation that opened one
 * could read it as a closed posting. The scanner is fixed, but nothing could change
 * a link already stored: agent-edit has no url field and backfill-tracker-urls only
 * fills blank cells.
 *
 * HOW IT DECIDES:
 * The site comes from portals.yml (the careers_url or api of every Workday company
 * for that tenant and shard). One distinct site: repair. Several, or none known:
 * the row is reported and left alone. Nothing is guessed.
 *
 * WHAT IT TOUCHES:
 * The url cell of matching rows. Nothing else, ever. Every other cell is asserted
 * byte-identical before a single byte is written, and any failure aborts the whole
 * run. Reports and JD snapshot headers keep the old link: they are evidence files,
 * and identity is unaffected because canonicalUrl treats both shapes as one posting.
 *
 * data/applications.md is user-layer and gitignored: there is no git history behind
 * it, so a timestamped backup is the ONLY rollback. The same safeguards as
 * backfill-tracker-urls.mjs apply (no merge in flight, mtime re-check, event log).
 *
 * Usage:
 *   node repair-workday-urls.mjs                 # DRY RUN (default): print the plan
 *   node repair-workday-urls.mjs --apply         # back up, verify, then write
 *   node repair-workday-urls.mjs --json          # machine-readable summary
 *   node repair-workday-urls.mjs --portals FILE  # portals config (default ./portals.yml)
 *
 * Idempotent: a repaired link has a site, so a second run finds nothing to do.
 * Exit code: 0 on success (including "nothing to do"); 1 if a guard or the
 * verification fails or the file changed underfoot.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { TRACKER_COLUMNS, parseTrackerLine, formatTrackerLine } from './lib/tracker.mjs';
import { isSitelessWorkdayUrl, buildWorkdaySiteMap, repairWorkdayUrl } from './lib/workday-repair.mjs';
import { localToday, logWritesEnabled, writeTableText } from './lib/log-writes.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.TJK_DATA_DIR ? resolve(process.env.TJK_DATA_DIR) : join(ROOT, 'data');
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const JSON_OUT = argv.includes('--json');
const portalsIdx = argv.indexOf('--portals');
const PORTALS = portalsIdx !== -1 && argv[portalsIdx + 1] ? resolve(argv[portalsIdx + 1]) : join(ROOT, 'portals.yml');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`repair-workday-urls.mjs - restore the careers-site segment in stored Workday links

  node repair-workday-urls.mjs                 dry run (default), writes nothing
  node repair-workday-urls.mjs --apply         back up, verify, then write
  node repair-workday-urls.mjs --json          machine-readable summary
  node repair-workday-urls.mjs --portals FILE  portals config (default ./portals.yml)`);
  process.exit(0);
}

const say = (...a) => { if (!JSON_OUT) console.log(...a); };
const die = (msg) => {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
  else console.error(`\nERROR: ${msg}`);
  process.exit(1);
};

// Guard 1: the schema must have a url column, or there is nothing to repair.
if (!TRACKER_COLUMNS.includes('url')) die("lib/tracker.mjs has no 'url' column. Nothing to repair.");

const APPS = join(DATA_DIR, 'applications.md');
if (!existsSync(APPS)) die(`No tracker at ${APPS}`);
if (!existsSync(PORTALS)) die(`No portals config at ${PORTALS} (pass --portals FILE). The site name is read from it.`);

// Guard 2: no merge in flight. merge-tracker.mjs rewrites this same file, and two
// writers racing means whichever lands second silently reverts the other.
const ADDITIONS = join(ROOT, 'batch/tracker-additions');
const pending = existsSync(ADDITIONS) ? readdirSync(ADDITIONS).filter((f) => f.endsWith('.tsv')) : [];
if (pending.length) {
  const msg = `${pending.length} unmerged TSV(s) in batch/tracker-additions/. Run "node merge-tracker.mjs" first, then re-run this.`;
  if (APPLY) die(msg);
  say(`WARNING: ${msg}\n   (dry run continues, but --apply will refuse)\n`);
}

let portalsDoc;
try { portalsDoc = yaml.load(readFileSync(PORTALS, 'utf-8')); } catch (e) { die(`Could not read ${PORTALS}: ${e.message}`); }
const entries = (portalsDoc && (portalsDoc.tracked_companies || portalsDoc.companies)) || [];
const siteMap = buildWorkdaySiteMap(entries);

// Read. Split on \n only and carry each line's trailing \r through untouched, so a
// CRLF checkout is not silently converted to LF.
const originalText = readFileSync(APPS, 'utf-8');
const mtimeBefore = statSync(APPS).mtimeMs;
const originalLines = originalText.split('\n');
const newLines = originalLines.slice();
const changed = new Set();

let rows = 0, siteless = 0;
const repaired = [], ambiguous = [], noSite = [];

for (let i = 0; i < originalLines.length; i++) {
  const line = originalLines[i];
  const cr = line.endsWith('\r') ? '\r' : '';
  const row = parseTrackerLine(line);
  if (!row) continue;
  rows++;
  if (!isSitelessWorkdayUrl(row.url)) continue;
  siteless++;
  const fix = repairWorkdayUrl(row.url, siteMap);
  const base = { num: row.num, company: row.company, status: row.status };
  if (fix.status === 'repaired') {
    newLines[i] = formatTrackerLine({ ...row, url: fix.url }) + cr;
    changed.add(i);
    repaired.push({ ...base, site: fix.site, from: row.url, to: fix.url });
  } else if (fix.status === 'ambiguous') {
    ambiguous.push({ ...base, sites: fix.sites });
  } else {
    noSite.push(base);
  }
}

const newText = newLines.join('\n');

// Verification: runs BEFORE any write, on dry run and apply alike. A shifted cell
// still produces a valid row, so only an explicit comparison catches it.
const problems = [];
if (newLines.length !== originalLines.length) problems.push(`line count changed: ${originalLines.length} -> ${newLines.length}`);
for (let i = 0; i < originalLines.length; i++) {
  if (!changed.has(i) && newLines[i] !== originalLines[i]) problems.push(`line ${i + 1} changed but was not scheduled to change`);
}
const before = [], after = [];
for (const l of originalLines) { const r = parseTrackerLine(l); if (r) before.push(r); }
for (const l of newLines) { const r = parseTrackerLine(l); if (r) after.push(r); }
if (before.length !== after.length) {
  problems.push(`row count changed: ${before.length} -> ${after.length}`);
} else {
  const CARRIED = ['num', 'date', 'company', 'role', 'score', 'status', 'pdf', 'resume', 'report', 'reportPath', 'notes'];
  for (let i = 0; i < before.length; i++) {
    for (const f of CARRIED) {
      if ((before[i][f] ?? null) !== (after[i][f] ?? null)) {
        problems.push(`row #${before[i].num}: ${f} changed ${JSON.stringify(before[i][f])} -> ${JSON.stringify(after[i][f])}`);
      }
    }
    if (after[i].columns < before[i].columns) problems.push(`row #${before[i].num}: columns shrank ${before[i].columns} -> ${after[i].columns}`);
    if (after[i].cellCount > 11) problems.push(`row #${before[i].num}: ${after[i].cellCount} cells (stray pipe introduced)`);
  }
  // Every repaired url must read back exactly and must no longer be site-less.
  const wanted = new Map(repaired.map((r) => [String(r.num), r.to]));
  for (const a of after) {
    if (wanted.has(String(a.num)) && (a.url !== wanted.get(String(a.num)) || isSitelessWorkdayUrl(a.url))) {
      problems.push(`row #${a.num}: url did not read back as the repaired link`);
    }
  }
}

// Report
say(`\nrepair-workday-urls - ${APPLY ? 'APPLY' : 'DRY RUN (nothing will be written)'}\n`);
say(`   tracker rows                 : ${rows}`);
say(`   site-less Workday links      : ${siteless}`);
say(`   will be repaired             : ${repaired.length}`);
say(`   ambiguous (several sites)    : ${ambiguous.length}`);
say(`   no site known in portals.yml : ${noSite.length}`);
for (const r of repaired) say(`      #${r.num} ${r.company} (${r.status}) -> /${r.site}/job/...`);
if (ambiguous.length) {
  say(`\n   Ambiguous: the tenant lists more than one careers site, so the right one cannot be chosen from the config.`);
  for (const a of ambiguous) say(`      #${a.num} ${a.company}: ${a.sites.join(', ')}`);
}
if (noSite.length) {
  say(`\n   No site: no Workday entry for this tenant in the portals config.`);
  for (const n of noSite) say(`      #${n.num} ${n.company}`);
}

if (problems.length) {
  say(`\nVERIFICATION FAILED - ${problems.length} problem(s). Nothing written.`);
  for (const p of problems.slice(0, 40)) say(`   ${p}`);
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, rows, repaired: repaired.length, problems }, null, 2));
  process.exit(1);
}
say(`\nVerified: ${before.length} rows intact, every non-url cell byte-identical.`);

// Write
let backup = null;
if (APPLY && repaired.length) {
  // A dashboard status change or a merge between the read above and this write
  // would be silently reverted by it.
  if (statSync(APPS).mtimeMs !== mtimeBefore) die('data/applications.md changed while this script was running. Nothing written - re-run it.');
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  backup = `${APPS}.bak-${stamp}-workday-url-repair`;
  copyFileSync(APPS, backup);
  if (logWritesEnabled(DATA_DIR)) {
    try {
      writeTableText({
        dataDir: DATA_DIR,
        file: 'applications.md',
        baseText: originalText,
        newText,
        rowKey: (line) => {
          const row = parseTrackerLine(line);
          return row ? String(row.num) : null;
        },
        buildEvents: ({ added, changed: rowChanges, removed }) => {
          if (added.length || removed.length) throw new Error('repair-workday-urls may only update existing tracker rows');
          return rowChanges.map((change) => {
            const row = parseTrackerLine(change.raw);
            return {
              type: 'legacy_record', application_id: String(row.num), occurred_on: localToday(),
              payload: { reason: 'tracker_row_updated', ref: `app:${row.num}`, fields: ['url'], legacy_effects: [change.effect] },
            };
          });
        },
      });
    } catch (error) {
      if (error.code === 'RENDER_FAILED') console.warn(`Warning: ${error.message}`);
      else {
        try { unlinkSync(backup); } catch { /* best effort cleanup after a refused write */ }
        die(error.message);
      }
    }
  } else writeFileSync(APPS, newText);
  say(`\nBackup: ${backup.replace(ROOT, '.')}`);
  say(`Wrote ${repaired.length} url cell(s) into data/applications.md`);
  say(`\n   Rollback:  cp "${backup.replace(ROOT, '.')}" data/applications.md`);
} else if (APPLY) {
  say('\n   Nothing to write - no link could be repaired.');
} else {
  say(`\n   Dry run only. Re-run with --apply to write.`);
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    ok: true, applied: APPLY, rows, siteless, repaired: repaired.length,
    ambiguous, noSite, backup,
  }, null, 2));
}
