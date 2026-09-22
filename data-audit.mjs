#!/usr/bin/env node
/**
 * data-audit.mjs — READ-ONLY integrity audit of the trajecktory user layer.
 *
 * WHY THIS EXISTS: after a run of experiments, a batch, or any stretch of
 * one-off scripts pointed at the real data, "it was read-only by design" is a
 * claim, not a check. This checks it.
 *
 * It writes NOTHING and it repairs nothing. Every finding is printed for a
 * human to decide on, because most of them have more than one right answer:
 * a row id that differs from its report number is normal after a
 * re-evaluation, and renumbering it would be worse than leaving it.
 *
 * Usage:
 *   node data-audit.mjs                      # last 7 days
 *   node data-audit.mjs --since 2026-09-19   # a specific experiment window
 *
 * Exit code: 0 clean, 1 if anything needs a human decision.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { localToday, localStamp } from './lib/local-date.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const D = (p) => join(process.env.TJK_DATA_DIR && p.startsWith('data/')
  ? join(process.env.TJK_DATA_DIR, p.slice(5))
  : join(ROOT, p));

// How far back "recent" reaches. Pass --since YYYY-MM-DD to audit a specific
// window, e.g. the days an experiment was running. Defaults to the last 7 days.
const sinceArg = process.argv.indexOf('--since');
const TEST_WINDOW_START = sinceArg >= 0 && process.argv[sinceArg + 1]
  ? new Date(`${process.argv[sinceArg + 1]}T00:00:00`)
  : new Date(Date.now() - 7 * 24 * 3600 * 1000);

let findings = 0;
const note = (s) => console.log(s);
const head = (n, t) => console.log(`\n${'='.repeat(72)}\n${n}. ${t}\n${'='.repeat(72)}`);
const ok = (s) => console.log(`  OK   ${s}`);
const flag = (s) => { console.log(`  FLAG ${s}`); findings++; };

// ── parse the tracker ──────────────────────────────────────────────────────
const trackerLines = readFileSync(D('data/applications.md'), 'utf8').split(/\r?\n/);
const rows = [];
for (let i = 0; i < trackerLines.length; i++) {
  const c = trackerLines[i].split('|').map((s) => s.trim());
  if (c.length < 10 || !/^\d+$/.test(c[1])) continue;
  const m = (c[9] || '').match(/\[(\d+)\]\(([^)]+)\)/);
  rows.push({
    line: i + 1, id: +c[1], date: c[2], company: c[3], role: c[4],
    score: c[5], status: c[6], url: c[c.length - 2] || '',
    label: m ? +m[1] : null, path: m ? m[2] : null,
  });
}
const ids = new Set(rows.map((r) => r.id));
console.log(`trajecktory data audit — READ ONLY`);
console.log(`window: since ${localToday(TEST_WINDOW_START)}`);
console.log(`tracker rows: ${rows.length}`);

// ── 1. did anything write that should not have? ────────────────────────────
head(1, 'Writes during the test window (2026-09-19 onward)');
{
  const watch = ['data/pipeline.md', 'data/triage-results.tsv', 'data/applications.md',
    'data/gate-history.tsv', 'data/status-events.tsv', 'data/scan-history.tsv'];
  for (const f of watch) {
    if (!existsSync(D(f))) { note(`  --   ${f} (absent)`); continue; }
    const m = statSync(D(f)).mtime;
    note(`  ${m >= TEST_WINDOW_START ? 'TOUCHED' : 'untouched'}  ${f}  ${localStamp(m)}`);
  }
  const reps = readdirSync(D('reports')).filter((f) => f.endsWith('.md'));
  const recent = reps.filter((f) => statSync(D(`reports/${f}`)).mtime >= TEST_WINDOW_START);
  note(`\n  reports/ modified in window: ${recent.length} of ${reps.length}`);
  const byDay = {};
  for (const f of recent) {
    const d = localToday(statSync(D(`reports/${f}`)).mtime);
    byDay[d] = (byDay[d] || 0) + 1;
  }
  for (const [d, n] of Object.entries(byDay).sort()) note(`    ${d}: ${n}`);
  note(`\n  A report modified in the window is expected ONLY if it was evaluated then.`);
  const mismatched = recent.filter((f) => {
    const n = +(f.match(/^(\d+)-/)?.[1] || 0);
    const row = rows.find((r) => r.id === n);
    return row && row.date < '2026-09-19';
  });
  if (mismatched.length) {
    flag(`${mismatched.length} report(s) modified in the window whose tracker row predates it:`);
    for (const f of mismatched.slice(0, 20)) note(`         ${f}`);
  } else ok('no report was rewritten whose tracker row predates the test window');
}

// ── 1b. the Spark pre-filter rows ──────────────────────────────────────────
head('1b', 'Spark pre-filter rows in triage-results.tsv');
{
  const p = D('data/triage-results.tsv');
  if (!existsSync(p)) { note('  (no triage-results.tsv)'); }
  else {
    const lines = readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean);
    const spark = lines.filter((l) => l.includes('Spark pre-filter'));
    note(`  total rows: ${lines.length - 1}   Spark pre-filter rows: ${spark.length}`);
    const inTracker = spark.filter((l) => {
      const u = l.split('\t')[0];
      return rows.some((r) => r.url && u && r.url === u);
    });
    if (inTracker.length) {
      flag(`${inTracker.length} Spark-prefiltered URL(s) ALSO have a full tracker row — a discarded posting should not have been evaluated:`);
      for (const l of inTracker.slice(0, 10)) note(`         ${l.split('\t').slice(1, 3).join(' | ')}`);
    } else ok('no Spark-prefiltered URL also carries a full evaluation row');
    const dates = [...new Set(spark.map((l) => l.split('\t')[5]))].sort();
    note(`  dates present: ${dates.join(', ')}`);
  }
}

// ── 2. tracker invariants, all rows ────────────────────────────────────────
head(2, 'Tracker invariants across every row');
{
  const byId = {};
  for (const r of rows) (byId[r.id] ??= []).push(r);
  const dup = Object.entries(byId).filter(([, v]) => v.length > 1);
  dup.length ? flag(`${dup.length} duplicate tracker id(s)`) : ok('no duplicate tracker ids');
  for (const [id, v] of dup) for (const r of v) note(`         id ${id} line ${r.line} ${r.company}`);

  const missing = rows.filter((r) => r.path && !existsSync(D(r.path)));
  missing.length ? flag(`${missing.length} row(s) link to a report file that does not exist`) : ok('every linked report file exists');
  for (const r of missing) note(`         line ${r.line} id ${r.id} ${r.path}`);

  const nolink = rows.filter((r) => !r.path);
  note(`  rows with no report link: ${nolink.length}`);

  const drift = [];
  for (const r of rows) {
    if (!r.path || !existsSync(D(r.path))) continue;
    const m = readFileSync(D(r.path), 'utf8').match(/"id"\s*:\s*(\d+)/);
    if (m && +m[1] !== r.id) drift.push({ ...r, fileId: +m[1] });
  }
  drift.length ? flag(`${drift.length} row(s) whose id != the report's own frontmatter id`) : ok('every row id matches its report frontmatter id');
  const byMonth = {};
  for (const r of drift) byMonth[r.date.slice(0, 7)] = (byMonth[r.date.slice(0, 7)] || 0) + 1;
  for (const [m, n] of Object.entries(byMonth).sort()) note(`         ${m}: ${n}`);

  // Do the drifted rows have sidecar history? That decides whether they are
  // safely renumberable or must be left alone.
  if (drift.length) {
    const sidecarIds = new Set();
    for (const f of ['data/apply-dates.json', 'data/app-notes.json', 'data/followup-mute.json']) {
      if (!existsSync(D(f))) continue;
      const j = JSON.parse(readFileSync(D(f), 'utf8'));
      const keys = j.app ? Object.keys(j.app) : Object.keys(j);
      for (const k of keys) sidecarIds.add(+k);
    }
    const se = existsSync(D('data/status-events.tsv'))
      ? readFileSync(D('data/status-events.tsv'), 'utf8').split(/\r?\n/).slice(1).map((l) => +l.split('\t')[0])
      : [];
    for (const n of se) sidecarIds.add(n);
    const risky = drift.filter((r) => sidecarIds.has(r.id));
    note(`\n  of those ${drift.length} drifted rows, ${risky.length} have sidecar history keyed on the CURRENT id`);
    note(`  -> those ${risky.length} must NOT be renumbered without migrating their history too;`);
    note(`     the other ${drift.length - risky.length} are renumberable in isolation.`);
  }
}

// ── 3. orphan report files ─────────────────────────────────────────────────
head(3, 'Report files with no tracker row');
{
  const linked = new Set(rows.map((r) => r.path).filter(Boolean));
  const all = readdirSync(D('reports')).filter((f) => /^\d+-.*\.md$/.test(f)).map((f) => `reports/${f}`);
  const orphans = all.filter((f) => !linked.has(f));
  note(`  report files: ${all.length}   linked: ${all.length - orphans.length}   orphaned: ${orphans.length}`);
  const recentOrphans = orphans.filter((f) => statSync(D(f)).mtime >= TEST_WINDOW_START);
  recentOrphans.length
    ? flag(`${recentOrphans.length} orphan(s) written DURING the test window — these may be lost evaluations:`)
    : ok('no orphan report was created during the test window');
  for (const f of recentOrphans.slice(0, 20)) note(`         ${f}`);
  note(`  (the remaining ${orphans.length - recentOrphans.length} orphans predate the window; audit-orphan-reports.mjs covers them)`);
}

// ── 4. sidecars vs tracker ─────────────────────────────────────────────────
head(4, 'Sidecar ids that no tracker row claims');
{
  const check = [
    ['data/apply-dates.json', (j) => Object.keys(j)],
    ['data/app-notes.json', (j) => Object.keys(j)],
    ['data/followup-mute.json', (j) => Object.keys(j.app || {})],
    ['data/followup-snooze.json', (j) => Object.keys(j.app || {})],
  ];
  for (const [f, get] of check) {
    if (!existsSync(D(f))) { note(`  --   ${f} (absent)`); continue; }
    let keys;
    try { keys = get(JSON.parse(readFileSync(D(f), 'utf8'))); }
    catch (e) { flag(`${f} did not parse: ${e.message}`); continue; }
    const dangling = keys.filter((k) => /^\d+$/.test(k) && !ids.has(+k));
    dangling.length
      ? flag(`${f}: ${dangling.length} of ${keys.length} ids have no tracker row (${dangling.slice(0, 8).join(', ')}${dangling.length > 8 ? ', …' : ''})`)
      : ok(`${f}: all ${keys.length} ids resolve to a tracker row`);
  }
  if (existsSync(D('data/status-events.tsv'))) {
    const se = readFileSync(D('data/status-events.tsv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
    const dangling = [...new Set(se.map((l) => l.split('\t')[0]).filter((n) => /^\d+$/.test(n) && !ids.has(+n)))];
    dangling.length
      ? flag(`data/status-events.tsv: ${dangling.length} distinct app# with no tracker row (${dangling.slice(0, 8).join(', ')}${dangling.length > 8 ? ', …' : ''})`)
      : ok(`data/status-events.tsv: every app# resolves to a tracker row`);
  }
}

// ── 5. pipeline.md vs jds/ ─────────────────────────────────────────────────
head(5, 'Pipeline queue vs JD snapshots');
{
  const p = D('data/pipeline.md');
  if (!existsSync(p)) { note('  (no pipeline.md)'); }
  else {
    const pl = readFileSync(p, 'utf8').split(/\r?\n/);
    const rowsP = pl.map((l) => l.match(/^\s*-\s*\[([ x!])\]\s*(\S+)/)).filter(Boolean)
      .map((m) => ({ state: m[1], url: m[2] }));
    const open = rowsP.filter((r) => r.state === ' ');
    note(`  pipeline rows: ${rowsP.length}  (open ${open.length}, done ${rowsP.filter(r => r.state === 'x').length}, gated ${rowsP.filter(r => r.state === '!').length})`);
    const localRows = rowsP.filter((r) => r.url.startsWith('local:'));
    const broken = localRows.filter((r) => !existsSync(D(r.url.replace(/^local:/, ''))));
    broken.length
      ? flag(`${broken.length} pipeline row(s) point at a snapshot that no longer exists`)
      : ok(`all ${localRows.length} local: rows resolve to a snapshot on disk`);
    for (const b of broken.slice(0, 10)) note(`         ${b.url}`);
    if (existsSync(D('jds'))) {
      const jds = readdirSync(D('jds')).filter((f) => f.endsWith('.md'));
      const referenced = new Set([
        ...localRows.map((r) => r.url.replace(/^local:jds\//, '')),
        ...rows.map((r) => {
          if (!r.path || !existsSync(D(r.path))) return null;
          const m = readFileSync(D(r.path), 'utf8').match(/"jdSnapshot"\s*:\s*"jds\/([^"]+)"/);
          return m ? m[1] : null;
        }).filter(Boolean),
      ]);
      const unref = jds.filter((f) => !referenced.has(f));
      note(`  jds/ files: ${jds.length}   referenced by a queue row or report: ${jds.length - unref.length}   unreferenced: ${unref.length}`);
    }
  }
}

// ── 6. restore points ──────────────────────────────────────────────────────
head(6, 'Restore points');
{
  const baks = readdirSync(D('data')).filter((f) => f.startsWith('applications.md.bak'));
  note(`  applications.md backups: ${baks.length}`);
  const sorted = baks.map((f) => ({ f, m: statSync(D(`data/${f}`)).mtime, size: statSync(D(`data/${f}`)).size }))
    .sort((a, b) => b.m - a.m);
  for (const b of sorted.slice(0, 5)) note(`    ${localStamp(b.m)}  ${String(b.size).padStart(7)}  ${b.f}`);
  const newest = sorted[0];
  let readable = false;
  try {
    const t = readFileSync(D(`data/${newest.f}`), 'utf8');
    readable = t.split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l)).length > 100;
  } catch { /* unreadable */ }
  readable ? ok(`newest backup is readable and parses as a tracker (${newest.f})`) : flag(`newest backup did NOT parse as a tracker: ${newest.f}`);
}

// ── verdict ────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(72)}`);
console.log(findings === 0 ? 'AUDIT CLEAN — nothing flagged.' : `AUDIT: ${findings} finding(s) above need a human decision.`);
console.log(`${'='.repeat(72)}\n`);
process.exit(findings ? 1 : 0);
