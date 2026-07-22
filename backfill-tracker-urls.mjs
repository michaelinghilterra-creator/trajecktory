#!/usr/bin/env node
/**
 * backfill-tracker-urls.mjs — write the posting URL into the url cell of every
 * tracker row that predates the url column.
 *
 * WHY THIS EXISTS:
 * `lib/identity.mjs` answers "have I already decided on this posting?" from the
 * tracker's url cell, falling back to the report file. The fallback works but is
 * fragile in one direction that matters: reports get pruned, the tracker never
 * is. Until the cell is populated, the memory of what was evaluated lives only
 * in files that are expected to disappear. This copies it into the file that
 * does not.
 *
 * WHAT IT TOUCHES:
 * The url cell, and the table header. Nothing else, ever. Every other cell is
 * asserted byte-identical before a single byte is written, and any row that
 * fails that assertion aborts the whole run rather than writing a partial file.
 *
 * data/applications.md is user-layer and gitignored: there is no git history
 * behind it, so a timestamped backup is the ONLY rollback. The plain
 * `applications.md.bak` is deliberately never used — dedup-tracker.mjs
 * historically overwrote that filename on every run, so a backup written there
 * can be destroyed by an unrelated command before you notice you need it.
 *
 * Usage:
 *   node backfill-tracker-urls.mjs            # DRY RUN (default): print the plan
 *   node backfill-tracker-urls.mjs --apply    # write, after backing up
 *   node backfill-tracker-urls.mjs --json     # machine-readable summary
 *
 * Idempotent: a row that already carries a url is left alone, so a second run
 * finds nothing to do.
 *
 * Exit code: 0 on success (including "nothing to do"); 1 if the schema guard
 * fails, a merge is in flight, verification fails, or the file changed underfoot.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { TRACKER_COLUMNS, TRACKER_HEADER, TRACKER_SEPARATOR, parseTrackerLine, formatTrackerLine } from './lib/tracker.mjs';
import { urlFromReport, canonicalUrl, normalizeCompany } from './lib/identity.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const JSON_OUT = argv.includes('--json');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`backfill-tracker-urls.mjs — populate the tracker's url column

  node backfill-tracker-urls.mjs            dry run (default), writes nothing
  node backfill-tracker-urls.mjs --apply    back up, verify, then write
  node backfill-tracker-urls.mjs --json     machine-readable summary`);
  process.exit(0);
}

const say = (...a) => { if (!JSON_OUT) console.log(...a); };
const die = (msg) => {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
  else console.error(`\n❌ ${msg}`);
  process.exit(1);
};

// ── Guard 1: the schema must actually have a url column ──────────────────────
// Fails closed. If the url column were reverted out of lib/tracker.mjs,
// formatTrackerLine would drop the cell and this script would rewrite 500+ rows
// to no effect, burning the backup slot for nothing.
if (!TRACKER_COLUMNS.includes('url')) {
  die("lib/tracker.mjs has no 'url' column. Nothing to backfill — this script is for the 11-column schema.");
}

const APPS = join(ROOT, 'data/applications.md');
if (!existsSync(APPS)) die(`No tracker at ${APPS}`);

// ── Guard 2: no merge in flight ──────────────────────────────────────────────
// merge-tracker.mjs rewrites this same file. Backfilling while TSVs are pending
// means the two writes race, and whichever lands second silently reverts the
// other. Pending work is a reason to stop, not to hurry.
const ADDITIONS = join(ROOT, 'batch/tracker-additions');
const pending = existsSync(ADDITIONS)
  ? readdirSync(ADDITIONS).filter(f => f.endsWith('.tsv'))
  : [];
if (pending.length) {
  const msg = `${pending.length} unmerged TSV(s) in batch/tracker-additions/. Run "node merge-tracker.mjs" first, then re-run this.`;
  if (APPLY) die(msg);
  say(`⚠️  ${msg}\n   (dry run continues, but --apply will refuse)\n`);
}

// ── Read ─────────────────────────────────────────────────────────────────────
const originalText = readFileSync(APPS, 'utf-8');
const mtimeBefore = statSync(APPS).mtimeMs;
// Split on \n only, and carry each line's trailing \r through untouched, so a
// CRLF checkout is not silently converted to LF. Rewriting every line ending in
// the user's tracker would be a far larger change than the one being asked for.
const originalLines = originalText.split('\n');
const newLines = originalLines.slice();
const changed = new Set();   // indices this run is allowed to have modified

let rows = 0, alreadyHad = 0, written = 0;
const unusable = [];         // report exists but its URL field is not a URL
const missing = [];          // no report, or report has no URL at all
const byCanonical = new Map();

for (let i = 0; i < originalLines.length; i++) {
  const line = originalLines[i];
  const cr = line.endsWith('\r') ? '\r' : '';
  const row = parseTrackerLine(line);

  // ── Header + separator upgrade ─────────────────────────────────────────────
  // parseTrackerLine returns null for both, so they are handled here. Without
  // this, an 11-cell row sits under a 10-cell header and every markdown renderer
  // drops the URL column from view — the data would be present and invisible.
  if (!row) {
    const bare = line.slice(0, line.length - cr.length);
    if (/^\|\s*#\s*\|/.test(bare) && bare !== TRACKER_HEADER) {
      newLines[i] = TRACKER_HEADER + cr; changed.add(i);
    } else if (/^\|[-\s|]+\|$/.test(bare.trim()) && bare !== TRACKER_SEPARATOR) {
      newLines[i] = TRACKER_SEPARATOR + cr; changed.add(i);
    }
    continue;
  }

  rows++;

  if (row.url) { alreadyHad++; continue; }   // idempotent: leave it alone

  const raw = urlFromReport(row.report, ROOT);
  if (!raw) { missing.push({ num: row.num, company: row.company, report: row.reportPath }); continue; }

  // Only ever write something that reads back AS a url. Some older reports carry
  // a placeholder in the URL field (a board name, "TBD", "N/A") rather than a
  // link. parseTrackerLine accepts an 11th cell as a url only when it is
  // http(s)-shaped, and treats anything else there as a stray pipe from a
  // legacy note — so writing a placeholder would not store a URL, it would make
  // a clean row parse as a malformed one.
  if (!/^https?:\/\//.test(raw)) {
    unusable.push({ num: row.num, company: row.company, value: raw });
    continue;
  }

  newLines[i] = formatTrackerLine({ ...row, url: raw }) + cr;
  changed.add(i);
  written++;

  const key = canonicalUrl(raw);
  if (!byCanonical.has(key)) byCanonical.set(key, []);
  byCanonical.get(key).push({ num: row.num, company: row.company, role: row.role, status: row.status });
}

const newText = newLines.join('\n');

// ── Verification — runs BEFORE any write, on both dry run and apply ──────────
// The failure mode this defends against is silent: a shifted cell still produces
// a syntactically valid row, so nothing throws and nothing looks wrong until a
// column quietly holds the wrong thing. Only an explicit comparison catches it.
const problems = [];

if (newLines.length !== originalLines.length) {
  problems.push(`line count changed: ${originalLines.length} → ${newLines.length}`);
}

// Every line this run did not deliberately touch must be byte-identical.
for (let i = 0; i < originalLines.length; i++) {
  if (!changed.has(i) && newLines[i] !== originalLines[i]) {
    problems.push(`line ${i + 1} changed but was not scheduled to change`);
  }
}

const before = [];
const after = [];
for (const l of originalLines) { const r = parseTrackerLine(l); if (r) before.push(r); }
for (const l of newLines) { const r = parseTrackerLine(l); if (r) after.push(r); }

if (before.length !== after.length) {
  problems.push(`row count changed: ${before.length} → ${after.length}`);
} else {
  const CARRIED = ['num', 'date', 'company', 'role', 'score', 'status', 'pdf', 'resume', 'report', 'reportPath', 'notes'];
  for (let i = 0; i < before.length; i++) {
    for (const f of CARRIED) {
      if ((before[i][f] ?? null) !== (after[i][f] ?? null)) {
        problems.push(`row #${before[i].num}: ${f} changed ${JSON.stringify(before[i][f])} → ${JSON.stringify(after[i][f])}`);
      }
    }
    // A row must never LOSE columns, and the url written must read back exactly.
    if (after[i].columns < before[i].columns) {
      problems.push(`row #${before[i].num}: columns shrank ${before[i].columns} → ${after[i].columns}`);
    }
    if (after[i].cellCount > 11) {
      problems.push(`row #${before[i].num}: ${after[i].cellCount} cells (stray pipe introduced)`);
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const duplicates = [...byCanonical.entries()]
  .filter(([, v]) => v.length > 1)
  .map(([url, v]) => ({ url, rows: v }));

say(`\n📋 backfill-tracker-urls — ${APPLY ? 'APPLY' : 'DRY RUN (nothing will be written)'}\n`);
say(`   tracker rows          : ${rows}`);
say(`   already had a url     : ${alreadyHad}`);
say(`   url to write          : ${written}`);
say(`   no usable url         : ${unusable.length + missing.length}`);

if (unusable.length) {
  say(`\n   ⚠️  ${unusable.length} report(s) carry a placeholder instead of a link.`);
  say(`      These rows are left at 10 columns — a non-URL in the url cell would`);
  say(`      make the row parse as malformed, which is worse than leaving it empty.`);
  for (const u of unusable) say(`      #${u.num} ${u.company} → "${u.value}"`);
}
if (missing.length) {
  say(`\n   ⚠️  ${missing.length} row(s) have no report URL to read.`);
  for (const m of missing.slice(0, 20)) say(`      #${m.num} ${m.company} (${m.report || 'no report'})`);
  if (missing.length > 20) say(`      ...and ${missing.length - 20} more`);
}

if (duplicates.length) {
  say(`\n   ℹ️  ${duplicates.length} posting(s) are already on the tracker TWICE.`);
  say(`      The backfill does not merge or delete anything — it only makes this`);
  say(`      visible for the first time. Review with "node dedup-tracker.mjs".`);
  for (const d of duplicates) {
    say(`      ${d.url}`);
    for (const r of d.rows) say(`         #${r.num} ${r.company} | ${r.role} | ${r.status}`);
  }
}

if (problems.length) {
  say(`\n❌ VERIFICATION FAILED — ${problems.length} problem(s). Nothing written.`);
  for (const p of problems.slice(0, 40)) say(`   ${p}`);
  if (problems.length > 40) say(`   ...and ${problems.length - 40} more`);
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, rows, written, problems }, null, 2));
  process.exit(1);
}
say(`\n✅ Verified: ${before.length} rows intact, every non-url cell byte-identical.`);

// ── Write ────────────────────────────────────────────────────────────────────
let backup = null;
if (APPLY && (written || changed.size)) {
  // Re-check mtime: a dashboard status PATCH or a merge between the read above
  // and this write would be silently reverted by it.
  if (statSync(APPS).mtimeMs !== mtimeBefore) {
    die('data/applications.md changed while this script was running. Nothing written — re-run it.');
  }
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  backup = `${APPS}.bak-${stamp}-url-backfill`;
  copyFileSync(APPS, backup);
  writeFileSync(APPS, newText);
  say(`\n💾 Backup: ${backup.replace(ROOT, '.')}`);
  say(`✅ Wrote ${written} url cell(s) into data/applications.md`);
  say(`\n   Rollback:  cp "${backup.replace(ROOT, '.')}" data/applications.md`);
} else if (APPLY) {
  say('\n   Nothing to write — every row already has a url.');
} else {
  say(`\n   Dry run only. Re-run with --apply to write.`);
}

if (JSON_OUT) {
  console.log(JSON.stringify({
    ok: true, applied: APPLY, rows, alreadyHad, written,
    unusable, missing, duplicates, backup,
  }, null, 2));
}
