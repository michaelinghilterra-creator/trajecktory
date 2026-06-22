/**
 * agent-log.mjs — lightweight, rotating diagnostic log of Claude agent runs.
 *
 * One line (JSON) per Evaluate / Agent-Scan run: timestamp, mode, status, turns,
 * cost, any pressure warning, and the tool-call list (so `Subagent:` activity is
 * captured for diagnosing fan-out). Rotates so it never bloats the install:
 * the active file rolls to a new one every MAX_RECORDS_PER_FILE records, and only
 * MAX_FILES are kept (oldest auto-deleted) — ~MAX_RECORDS_PER_FILE * MAX_FILES of
 * recent history. Logging must NEVER break a run, so everything is wrapped in
 * try/catch and failures are swallowed.
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
