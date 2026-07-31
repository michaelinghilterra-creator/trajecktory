/**
 * agent-log.mjs — lightweight, rotating diagnostic log of Claude agent runs.
 *
 * One line (JSON) per Evaluate / Agent-Scan run: timestamp, mode, status, turns,
 * cost, duration, any pressure warning, and the tool-call list (so `Subagent:`
 * activity is captured for diagnosing fan-out). Rotates so it never bloats the
 * install: the active file rolls to a new one every MAX_RECORDS_PER_FILE records,
 * and only MAX_FILES are kept (oldest auto-deleted) — ~MAX_RECORDS_PER_FILE *
 * MAX_FILES of recent history. Logging must NEVER break a run, so everything is
 * wrapped in try/catch and failures are swallowed.
 *
 * This module is also the SINGLE source for READING those logs back. The
 * cost-history endpoint and the per-day cost/time rollup both go through
 * `readAgentRuns()` here rather than re-globbing and re-parsing the files
 * themselves — same reason lib/tracker.mjs owns tracker parsing: one reader
 * that knows the on-disk shape, so a format change is edited in one place.
 */
import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../config.mjs';

const LOG_DIR = path.join(ROOT_DIR, 'logs');
const PREFIX = 'agent-runs.';
const SUFFIX = '.log';
const MAX_RECORDS_PER_FILE = 100;
const MAX_FILES = 3;

function logFiles() {
  try {
    return fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
      .map(f => ({ f, n: parseInt(f.slice(PREFIX.length, -SUFFIX.length), 10) || 0 }))
      .sort((a, b) => a.n - b.n);
  } catch { return []; }
}

export function logAgentRun(record) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const files = logFiles();
    let active = files[files.length - 1];
    if (!active) {
      active = { f: `${PREFIX}1${SUFFIX}`, n: 1 };
    } else {
      const lines = fs.readFileSync(path.join(LOG_DIR, active.f), 'utf8').split('\n').filter(Boolean).length;
      if (lines >= MAX_RECORDS_PER_FILE) active = { f: `${PREFIX}${active.n + 1}${SUFFIX}`, n: active.n + 1 };
    }
    fs.appendFileSync(path.join(LOG_DIR, active.f), JSON.stringify(record) + '\n', 'utf8');
    // Keep only the MAX_FILES newest; delete the rest.
    const all = logFiles();
    for (const old of all.slice(0, Math.max(0, all.length - MAX_FILES))) {
      try { fs.unlinkSync(path.join(LOG_DIR, old.f)); } catch { /* ignore */ }
    }
  } catch { /* logging is best-effort — never throw into a run */ }
}

// ── Reading the logs back ─────────────────────────────────────────────────────

// Every run record across the rotating log files, newest `ts` first. Torn lines
// (a crash mid-append) are skipped, never thrown. Returns [] when there are no
// logs yet. This is the ONE reader — callers must not re-glob agent-runs.*.log.
export function readAgentRuns() {
  const out = [];
  for (const { f } of logFiles()) {
    let text = '';
    try { text = fs.readFileSync(path.join(LOG_DIR, f), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch { /* skip a torn line */ }
    }
  }
  out.sort((a, b) => String(b && b.ts).localeCompare(String(a && a.ts)));
  return out;
}

// Float sums drift (0.1 + 0.2 !== 0.3), which turns a cost total into JSON noise
// and makes exact-equality tests fragile. Round every money/time sum to 6 places.
function round6(n) { return Math.round(n * 1e6) / 1e6; }

// A run's wall-clock duration in ms, defaulting to 0 when a record predates the
// duration field (Gap 1 landed after some runs were already logged).
function durMs(rec) { return typeof rec.durationMs === 'number' ? rec.durationMs : 0; }
function durApiMs(rec) { return typeof rec.durationApiMs === 'number' ? rec.durationApiMs : 0; }
function costOf(rec) { return typeof rec.cost === 'number' ? rec.cost : 0; }

// PURE: group run records into per-day rollups. Bucketing is by the UTC date
// portion of the ISO `ts` (records store `new Date().toISOString()`), so it is
// deterministic and independent of the reader's timezone. `from`/`to` are
// inclusive `YYYY-MM-DD` bounds compared lexically (ISO dates sort as strings).
// Each day carries { date, cost, machineTimeMs, machineTimeApiMs, runs, byMode }
// where byMode splits the same figures per mode (scan / pipeline / triage / deep).
// Days are returned oldest-first; the caller orders for display.
export function rollupByDay(records, { from, to } = {}) {
  const byDate = new Map();
  for (const rec of records || []) {
    if (!rec || typeof rec.ts !== 'string') continue;
    const date = rec.ts.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (from && date < from) continue;
    if (to && date > to) continue;
    let day = byDate.get(date);
    if (!day) {
      day = { date, cost: 0, machineTimeMs: 0, machineTimeApiMs: 0, runs: 0, byMode: {} };
      byDate.set(date, day);
    }
    const cost = costOf(rec), dur = durMs(rec), durApi = durApiMs(rec);
    day.cost += cost; day.machineTimeMs += dur; day.machineTimeApiMs += durApi; day.runs += 1;
    const mode = rec.mode || 'unknown';
    const m = day.byMode[mode] || (day.byMode[mode] = { cost: 0, machineTimeMs: 0, runs: 0 });
    m.cost += cost; m.machineTimeMs += dur; m.runs += 1;
  }
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of days) {
    d.cost = round6(d.cost);
    for (const m of Object.values(d.byMode)) m.cost = round6(m.cost);
  }
  return days;
}

// PURE: collapse a per-day rollup (the output of rollupByDay) into one total,
// so a week's cost + machine time is a single read rather than a client-side sum.
export function sumRollup(days) {
  const total = { cost: 0, machineTimeMs: 0, machineTimeApiMs: 0, runs: 0, byMode: {} };
  for (const d of days || []) {
    total.cost += d.cost; total.machineTimeMs += d.machineTimeMs;
    total.machineTimeApiMs += d.machineTimeApiMs; total.runs += d.runs;
    for (const [mode, m] of Object.entries(d.byMode || {})) {
      const t = total.byMode[mode] || (total.byMode[mode] = { cost: 0, machineTimeMs: 0, runs: 0 });
      t.cost += m.cost; t.machineTimeMs += m.machineTimeMs; t.runs += m.runs;
    }
  }
  total.cost = round6(total.cost);
  for (const m of Object.values(total.byMode)) m.cost = round6(m.cost);
  return total;
}
