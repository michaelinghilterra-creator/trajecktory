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

// PURE: attach the deterministic, server-side outcome of Agent Scan discovery
// to the final Claude run record. Arrays are counted here (rather than stored in
// the diagnostic log) and absent merge fields safely become zero.
export function buildScanDiscoverySummary(portalMerge, { retried = false, stalled = false } = {}) {
  const merged = portalMerge !== null && typeof portalMerge === 'object';
  const merge = merged ? portalMerge : {};
  const errors = Array.isArray(merge.errors) ? merge.errors : [];
  const hasSingularError = merge.error != null;
  const firstMergeError = hasSingularError ? merge.error : errors[0];
  return {
    merged,
    mergeErrors: errors.length + (hasSingularError ? 1 : 0),
    mergeError: firstMergeError == null ? null : String(firstMergeError).slice(0, 200),
    accepted: Number.isFinite(merge.added) ? merge.added : 0,
    skippedDuplicate: Number.isFinite(merge.skippedDuplicate) ? merge.skippedDuplicate : 0,
    skippedDead: Number.isFinite(merge.skippedDead) ? merge.skippedDead : 0,
    collisions: Array.isArray(merge.collisions) ? merge.collisions.length : 0,
    parseErrors: Array.isArray(merge.parseErrors) ? merge.parseErrors.length : 0,
    rolesAdded: Number.isFinite(merge.rolesAdded) ? merge.rolesAdded : 0,
    retried: !!retried,
    stalled: !!stalled,
  };
}

// PURE: read the summary block scan.mjs prints (Companies scanned, Total jobs
// found, Filtered by title, ...) out of the Bash output the agent saw. Returns
// null when the text is not a scan summary, so a caller never records zeros as if
// they were a measurement.
export function parseScanStats(text) {
  const s = String(text || '');
  const num = (re) => { const m = s.match(re); return m ? Number(m[1]) : null; };
  const companies = num(/Companies scanned:\s*(\d+)/);
  const totalJobs = num(/Total jobs found:\s*(\d+)/);
  if (companies === null || totalJobs === null) return null;
  return {
    companies,
    totalJobs,
    filteredByTitle: num(/Filtered by title:\s*(\d+)/),
    geoBlocked: num(/Geo-blocked:\s*(\d+)/),
    duplicates: num(/Duplicates:\s*(\d+)/),
    newOffers: num(/New offers added:\s*(\d+)/),
    boardErrors: num(/Errors \((\d+)\):/) ?? 0,
    coverageAlerts: num(/Coverage alerts \((\d+)\)/) ?? 0,
  };
}

function scanStatsLine(st) {
  if (!st) return '';
  const part = (n, label) => (n == null ? null : `${n} ${label}`);
  const dropped = [part(st.filteredByTitle, 'filtered by title'), part(st.geoBlocked, 'geo-blocked'), part(st.duplicates, 'duplicates')].filter(Boolean).join(', ');
  const health = [];
  if (st.boardErrors) health.push(`${st.boardErrors} boards errored`);
  if (st.coverageAlerts) health.push(`${st.coverageAlerts} flagged quiet or dead`);
  return ` scan.mjs: ${st.totalJobs} jobs across ${st.companies} boards, ${st.newOffers ?? 0} new${dropped ? ` (${dropped})` : ''}${health.length ? `; ${health.join(', ')}` : ''}.`;
}

const nameList = (names) => {
  const list = Array.isArray(names) ? names.filter(Boolean) : [];
  if (!list.length) return '';
  return ` (${list.slice(0, 8).join(', ')}${list.length > 8 ? `, +${list.length - 8} more` : ''})`;
};

// PURE: say WHY an Agent Scan produced nothing, from facts the server measured
// rather than a list of guesses. `code` is stable for filtering the log; `message`
// is what the dashboard shows. Returns null when the run did produce something
// (or the cause is not one of the known shapes), so the caller keeps its fallback.
export function diagnoseEmptyScan({ merge, webSearchCount = 0, scanStats = null, stalled = false, trackedListComplete = null } = {}) {
  const m = merge && typeof merge === 'object' ? merge : null;
  const tail = scanStatsLine(scanStats);
  const searches = `${webSearchCount} web search${webSearchCount === 1 ? '' : 'es'}`;
  const result = (code, message) => ({ code, message: message + tail });
  // Proposals that were already tracked mean the agent did not see the whole list.
  const listNote = trackedListComplete === true ? '' : ' The agent did not read the full tracked-company list before searching.';
  if (!m) return result('merge-not-run', 'The discovery merge never ran, so no companies were added.');
  if (m.error || (Array.isArray(m.errors) && m.errors.length)) {
    const why = String(m.error ?? m.errors[0]).split('\n')[0].slice(0, 200);
    return result('merge-error', `Adding discovered companies failed: ${why}.`);
  }
  if (m.added > 0 || m.rolesAdded > 0) return null;
  if (scanStats && scanStats.newOffers > 0) return null;   // scan.mjs itself found postings, so the run was productive
  if (stalled || webSearchCount === 0) return result('no-searches', 'The agent issued no web search, so discovery did not run.');
  const proposed = Number.isFinite(m.proposed) ? m.proposed : 0;
  const parseErrors = Array.isArray(m.parseErrors) ? m.parseErrors : [];
  if (proposed === 0) {
    const why = parseErrors[0] ? ` Parse problem: ${String(parseErrors[0]).slice(0, 160)}.` : '';
    return result('no-proposals', `The agent ran ${searches} but named no company to add.${why}`);
  }
  const dup = m.skippedDuplicate || 0;
  const dead = m.skippedDead || 0;
  const collisions = Array.isArray(m.collisions) ? m.collisions.length : 0;
  if (dup === proposed) {
    return result('all-tracked', `The agent ran ${searches} and proposed ${proposed} ${proposed === 1 ? 'company' : 'companies'}, all already in your scan list${nameList(m.skippedDuplicateNames)}. Nothing new to add.${listNote}`);
  }
  if (dead === proposed) {
    return result('all-dead', `The agent proposed ${proposed} ${proposed === 1 ? 'company' : 'companies'} but every board was unreachable${nameList(m.skippedDeadNames)}; the slugs are probably invented.`);
  }
  return result('all-skipped', `The agent proposed ${proposed} ${proposed === 1 ? 'company' : 'companies'}: ${dup} already tracked${nameList(m.skippedDuplicateNames)}, ${dead} unreachable${nameList(m.skippedDeadNames)}, ${collisions} name collision${collisions === 1 ? '' : 's'} left for you to check.${dup ? listNote : ''}`);
}

// PURE: say WHY an Evaluate (pipeline) or Deep batch wrote nothing. `facts` are
// measured by the server around the run: the pending queue before it, how many
// reports and tracker TSVs appeared, how many postings were deferred to
// data/needs-manual-jd.tsv, and how every `node fetch-jd.mjs` call ended. Returns
// null when the batch produced a tracker TSV. `code` is stable for filtering.
export function diagnoseEmptyEval({
  mode = 'pipeline', pendingBefore = null, reportsDelta = 0, tsvDelta = 0, deferredDelta = 0,
  fetch = {}, webFetchCount = 0, toolCount = 0, resultText = '', resultSubtype = null,
} = {}) {
  if (tsvDelta > 0) return null;
  const f = { ok: fetch.ok || 0, closed: fetch.closed || 0, failed: fetch.failed || 0 };
  const fetchLine = (f.ok + f.closed + f.failed)
    ? ` fetch-jd results: ${f.ok} read, ${f.closed} closed, ${f.failed} failed${webFetchCount ? `; ${webFetchCount} WebFetch fallback${webFetchCount === 1 ? '' : 's'}` : ''}.`
    : '';
  const said = String(resultText || '').replace(/\s+/g, ' ').trim();
  const tailSaid = said ? ` Agent's last words: "${said.slice(-200)}"` : '';
  const out = (code, message) => ({ code, message: message + fetchLine });
  if (mode === 'pipeline' && pendingBefore === 0) {
    return out('queue-empty', 'No pending unchecked URLs were in data/pipeline.md when the batch started, so there was nothing to evaluate.');
  }
  if (reportsDelta > 0) {
    return out('report-without-tsv', `${reportsDelta} report${reportsDelta === 1 ? ' was' : 's were'} written but no tracker TSV, so Merge Tracker has nothing to add to your pipeline.`);
  }
  if (deferredDelta > 0) {
    return out('all-deferred', `${deferredDelta} posting${deferredDelta === 1 ? '' : 's'} could not be read and ${deferredDelta === 1 ? 'was' : 'were'} deferred to data/needs-manual-jd.tsv. Paste the job text for ${deferredDelta === 1 ? 'it' : 'them'} to evaluate.`);
  }
  if (f.closed > 0 && f.ok === 0) {
    return out('all-closed', 'Every posting the agent tried to read had been taken down (fetch-jd exit code 3), so none could be evaluated.');
  }
  if (f.failed > 0 && f.ok === 0) {
    return out('fetch-failed', 'The agent could not read any posting (fetch-jd failed and no fallback produced a job description).' + tailSaid);
  }
  if (toolCount === 0) {
    return out('no-work-attempted', 'The agent made no tool calls, so it did no work at all.' + tailSaid);
  }
  if (said.endsWith('?')) {
    return out('asked-question', 'The agent stopped to ask a question, and nobody can answer one in a headless run.' + tailSaid);
  }
  const queue = pendingBefore > 0 ? ` ${pendingBefore} URLs were pending; rows already evaluated or dismissed are checked off only after the run, so the agent may have skipped them all.` : '';
  return out('unknown', `The batch finished (${resultSubtype || 'no result subtype'}, ${toolCount} tool calls) but no report, TSV or deferral appeared.${queue}${tailSaid}`);
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
// where byMode splits the same figures per mode (scan / pipeline / deep).
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
