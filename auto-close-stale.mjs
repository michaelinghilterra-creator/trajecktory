#!/usr/bin/env node
// auto-close-stale.mjs — close phantom pipeline rows.
//
// A cold application (status "Applied", never replied or interviewed) that has
// been silent for N calendar days is, honestly, a No Response: the company
// ghosted it. Leaving it "Applied" inflates how much of the pipeline is actually
// live. This finds those rows and, on --apply, sets them to "No Response" — a
// CLOSED status that still counts in the applied denominator (an honest ghosting,
// not a vanish) and is reversible via the drawer's Reopen button. Warm rows (any
// reply or interview ever) are NEVER touched.
//
// Dry-run by default (lists what would close, writes nothing). --apply writes a
// timestamped backup first (data/ is gitignored with no git history, so the backup
// is the only rollback), changes ONLY the status cell plus an audit note on each
// closed row, and appends a machine-readable audit log.
//
// Usage:
//   node auto-close-stale.mjs               # dry run, 21-calendar-day threshold
//   node auto-close-stale.mjs --days 30     # custom threshold
//   node auto-close-stale.mjs --apply       # write the closures (with backup)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseApplicationsMd } from './dashboard-web/server/lib/applications.mjs';
import { readApplyDates } from './dashboard-web/server/lib/sidecars.mjs';
import { FUNNEL_ORDER } from './dashboard-web/server/lib/statuses.mjs';
import { parseTrackerLine, formatTrackerLine } from './lib/tracker.mjs';
import { APPS_MD, DATA_DIR } from './dashboard-web/server/config.mjs';

const DEFAULT_DAYS = 21;
const CLOSED_STATUS = 'No Response';

// Whole calendar days from an ISO date to `today`. null on a bad date.
export function calendarDaysAgo(iso, today) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(String(iso))) return null;
  const d = new Date(String(iso).slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.floor((t - d) / 86400000);
}

// Pure core: which "Applied" rows are cold (never past Applied) AND stale (applied
// >= `days` calendar days ago)? `rows` is parseApplicationsMd() shape, `applyDates`
// is { id: 'YYYY-MM-DD' }, `today` is a Date. Injectable so it is unit-tested with
// no files or clock.
export function findStaleApplied(rows, applyDates, { today, days = DEFAULT_DAYS, funnelOrder = FUNNEL_ORDER } = {}) {
  const idx = (s) => funnelOrder.indexOf(s);
  const APPLIED = idx('Applied');
  const out = [];
  for (const a of rows) {
    if (a.status !== 'Applied') continue;               // only open, applied rows
    const reachedIdx = a.reached ? idx(a.reached) : -1;
    if (reachedIdx > APPLIED) continue;                 // warm (replied/interviewed) — never close
    const appliedOn = applyDates[String(a.id)] || a.date || null;
    const daysSince = calendarDaysAgo(appliedOn, today);
    if (daysSince == null || daysSince < days) continue; // not stale enough
    out.push({
      id: a.id, company: a.company, role: a.role, appliedOn, daysSince,
      anchorSource: applyDates[String(a.id)] ? 'apply-date' : 'tracker-date',
      selfSourced: /\[self-sourced\]/i.test(a.notes || ''),
    });
  }
  return out.sort((x, y) => y.daysSince - x.daysSince);
}

function isMain() { try { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } }

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const days = args.includes('--days') ? parseInt(args[args.indexOf('--days') + 1], 10) : DEFAULT_DAYS;
  if (!Number.isFinite(days) || days < 1) { console.error('--days must be a positive integer'); process.exit(2); }
  const today = new Date();

  const rows = parseApplicationsMd();
  const applyDates = readApplyDates();
  const stale = findStaleApplied(rows, applyDates, { today, days });

  if (!stale.length) {
    console.log(`\nNo cold "Applied" rows past ${days} calendar days. Nothing to close.\n`);
    process.exit(0);
  }

  console.log(`\n${stale.length} cold "Applied" row(s) silent ${days}+ calendar days — would become "${CLOSED_STATUS}":\n`);
  for (const s of stale) {
    console.log(`  #${s.id} ${s.company} · ${s.role}`);
    console.log(`      applied ${s.appliedOn} (${s.daysSince}d ago, ${s.anchorSource})${s.selfSourced ? '  [self-sourced]' : ''}`);
  }

  if (!apply) {
    console.log(`\nDRY RUN — nothing written. Re-run with --apply to close these (backup written; reversible via Reopen).\n`);
    process.exit(0);
  }

  // ── Apply: backup, edit only the eligible rows' status + an audit note ────────
  const raw = fs.readFileSync(APPS_MD, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  const p2 = (n) => String(n).padStart(2, '0');
  const todayIso = `${today.getFullYear()}-${p2(today.getMonth() + 1)}-${p2(today.getDate())}`;
  const ts = `${todayIso}-${p2(today.getHours())}${p2(today.getMinutes())}${p2(today.getSeconds())}`;
  fs.writeFileSync(`${APPS_MD}.bak-${ts}-auto-close`, raw);

  const staleById = new Map(stale.map(s => [String(s.id), s]));
  let changed = 0;
  const out = lines.map(line => {
    const row = parseTrackerLine(line);
    if (!row || !staleById.has(String(row.num))) return line;
    // Round-trip guard: only rewrite a row that already serializes canonically, so
    // nothing but its status + notes can change.
    if (formatTrackerLine(row) !== line) {
      console.error(`  ! #${row.num} does not round-trip through formatTrackerLine; skipped to stay byte-safe.`);
      return line;
    }
    const s = staleById.get(String(row.num));
    const note = `[auto-closed ${todayIso}: no reply ${s.daysSince}d after apply]`;
    const notes = `${row.notes ? row.notes + ' ' : ''}${note}`.trim();
    changed++;
    return formatTrackerLine({ ...row, status: CLOSED_STATUS, notes });
  });
  fs.writeFileSync(APPS_MD, out.join(eol));

  // Machine-readable audit (supports later review / undo).
  const logPath = path.join(DATA_DIR, 'auto-close-log.json');
  let log = [];
  try { log = JSON.parse(fs.readFileSync(logPath, 'utf8')) || []; } catch { log = []; }
  log.push({ ranAt: today.toISOString(), days, closed: stale.map(s => ({ id: s.id, company: s.company, prevStatus: 'Applied', appliedOn: s.appliedOn, daysSince: s.daysSince })) });
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2) + '\n');

  console.log(`\n=== APPLIED ===`);
  console.log(`backup: ${APPS_MD}.bak-${ts}-auto-close`);
  console.log(`closed ${changed} row(s) to "${CLOSED_STATUS}"; audit appended to ${path.relative(process.cwd(), logPath)}`);
  console.log(`Reversible: Reopen in the drawer sends a row back to Evaluated, or restore the backup.\n`);
  process.exit(0);
}

if (isMain()) main();
