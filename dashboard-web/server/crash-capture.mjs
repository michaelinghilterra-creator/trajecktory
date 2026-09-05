import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { inspect } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_PATH = path.join(LOG_DIR, 'server.log');
const MAX_LOG_BYTES = 5 * 1024 * 1024; // 5 MB
const KEEP_ROTATIONS = 2;

// ── Ensure log directory exists ──────────────────────────────────────────────
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* best-effort */ }

// ── Log rotation ─────────────────────────────────────────────────────────────
function rotateIfNeeded() {
  try {
    const stat = fs.statSync(LOG_PATH);
    if (stat.size < MAX_LOG_BYTES) return;
    for (let i = KEEP_ROTATIONS; i >= 1; i--) {
      const older = `${LOG_PATH}.${i}`;
      const newer = i === 1 ? LOG_PATH : `${LOG_PATH}.${i - 1}`;
      try { fs.renameSync(newer, older); } catch { /* missing is fine */ }
    }
  } catch { /* file doesn't exist yet */ }
}
rotateIfNeeded();

// ── Persistent append ────────────────────────────────────────────────────────
let _fd = null;
function ensureFd() {
  if (_fd !== null) return;
  try { _fd = fs.openSync(LOG_PATH, 'a'); } catch { _fd = null; }
}
ensureFd();

function appendLine(line) {
  try {
    ensureFd();
    if (_fd !== null) fs.writeSync(_fd, line + '\n');
  } catch { /* best-effort */ }
}

function ts() { return new Date().toISOString(); }

function formatArgs(args) {
  return args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack || String(a);
    return inspect(a, { depth: 4, colors: false, maxStringLength: 500 });
  }).join(' ');
}

// ── Console tee ──────────────────────────────────────────────────────────────
// Override console.log/error/warn so every call site (ours and libraries) writes
// to both the terminal AND the persistent log file, without touching 14 files.
const _origLog = console.log.bind(console);
const _origError = console.error.bind(console);
const _origWarn = console.warn.bind(console);

console.log = (...args) => {
  _origLog(...args);
  appendLine(`[${ts()}] INFO  ${formatArgs(args)}`);
};
console.error = (...args) => {
  _origError(...args);
  appendLine(`[${ts()}] ERROR ${formatArgs(args)}`);
  _stats.errors++;
  _stats.lastError = { at: ts(), msg: formatArgs(args).slice(0, 300) };
};
console.warn = (...args) => {
  _origWarn(...args);
  appendLine(`[${ts()}] WARN  ${formatArgs(args)}`);
  _stats.warnings++;
};

// ── Stats (exposed for the diagnostics endpoint) ────────────────────────────
const _stats = {
  startedAt: null,
  pid: process.pid,
  nodeVersion: process.version,
  errors: 0,
  warnings: 0,
  lastError: null,
  lastCrash: null,       // populated on startup if previous run ended uncleanly
  requests: 0,           // incremented by the middleware hook
  status5xx: 0,
};

export function serverStats() {
  const m = process.memoryUsage();
  return {
    ..._stats,
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rssMB: Math.round(m.rss / 1048576),
      heapUsedMB: Math.round(m.heapUsed / 1048576),
      heapTotalMB: Math.round(m.heapTotal / 1048576),
      externalMB: Math.round(m.external / 1048576),
    },
  };
}

export function countRequest() { _stats.requests++; }
export function countStatus5xx() { _stats.status5xx++; }

// ── Memory snapshot helper ───────────────────────────────────────────────────
function memLine() {
  const m = process.memoryUsage();
  return `rss=${Math.round(m.rss / 1048576)}MB heap=${Math.round(m.heapUsed / 1048576)}/${Math.round(m.heapTotal / 1048576)}MB ext=${Math.round(m.external / 1048576)}MB bufs=${Math.round(m.arrayBuffers / 1048576)}MB`;
}

// ── Detect previous unclean shutdown ─────────────────────────────────────────
function detectLastCrash() {
  try {
    const text = fs.readFileSync(LOG_PATH, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    // Walk backwards: find the last SERVER START, then check if there's an
    // EXIT line between that start and the current boot.
    let lastStartIdx = -1;
    let lastExitIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lastStartIdx === -1 && lines[i].includes('SERVER START')) lastStartIdx = i;
      if (lastExitIdx === -1 && lines[i].includes('] EXIT ')) lastExitIdx = i;
      if (lastStartIdx !== -1 && lastExitIdx !== -1) break;
    }
    // No prior start found, or exit came after last start: clean shutdown.
    if (lastStartIdx === -1) return null;
    if (lastExitIdx !== -1 && lastExitIdx > lastStartIdx) {
      const m = lines[lastExitIdx].match(/EXIT code=(\d+)/);
      if (m && m[1] === '0') return null;
      return { type: 'nonzero-exit', code: m?.[1], line: lines[lastExitIdx] };
    }
    // No exit after last start: the process was killed without running cleanup.
    const startLine = lines[lastStartIdx];
    const lastHeartbeat = lines.slice(lastStartIdx).reverse().find(l => l.includes('heartbeat'));
    return {
      type: 'no-exit',
      startLine,
      lastHeartbeat: lastHeartbeat || null,
    };
  } catch { return null; }
}

// ── Main init ────────────────────────────────────────────────────────────────
export function initCrashCapture() {
  _stats.startedAt = ts();

  // Check previous run before writing this session's start marker.
  const crash = detectLastCrash();
  if (crash) {
    _stats.lastCrash = crash;
    appendLine('');
    appendLine(`!!! PREVIOUS RUN DID NOT EXIT CLEANLY !!!`);
    if (crash.type === 'no-exit') {
      appendLine(`  last start: ${crash.startLine}`);
      if (crash.lastHeartbeat) appendLine(`  last heartbeat before death: ${crash.lastHeartbeat}`);
    } else {
      appendLine(`  ${crash.line}`);
    }
  }

  appendLine('');
  appendLine(`=== SERVER START ${_stats.startedAt} (pid ${process.pid}) ===`);
  appendLine(`  node ${process.version}, platform ${process.platform} ${process.arch}`);
  appendLine(`  mem at start: ${memLine()}`);
  appendLine(`  log path: ${LOG_PATH}`);

  // Memory heartbeat every 60s.
  const memTimer = setInterval(() => {
    const uptime = Math.round(process.uptime());
    appendLine(`[${ts()}] heartbeat uptime=${uptime}s ${memLine()} reqs=${_stats.requests} errs=${_stats.errors} 5xx=${_stats.status5xx}`);
    rotateIfNeeded();
  }, 60_000);
  if (memTimer.unref) memTimer.unref();

  // ── Process lifecycle ──────────────────────────────────────────────────────
  process.on('exit', (code) => {
    appendLine(`[${ts()}] EXIT code=${code} uptime=${Math.round(process.uptime())}s reqs=${_stats.requests} errs=${_stats.errors} 5xx=${_stats.status5xx}`);
    appendLine(`  final mem: ${memLine()}`);
    try { if (_fd !== null) fs.closeSync(_fd); } catch { /* shutting down */ }
  });

  process.on('SIGTERM', () => appendLine(`[${ts()}] SIGTERM received`));
  process.on('SIGINT', () => appendLine(`[${ts()}] SIGINT received`));

  // Process-level safety nets. These are the ONLY handlers needed: the console
  // tee above already persists the console.error calls in index.mjs's own
  // handlers, so there's no duplication.
  process.on('unhandledRejection', (reason) => {
    appendLine(`[${ts()}] UNHANDLED_REJECTION: ${reason instanceof Error ? reason.stack : String(reason)}`);
    _stats.errors++;
  });
  process.on('uncaughtException', (err) => {
    appendLine(`[${ts()}] UNCAUGHT_EXCEPTION: ${err?.stack || err}`);
    _stats.errors++;
  });

  process.on('warning', (warning) => {
    appendLine(`[${ts()}] WARNING ${warning.name}: ${warning.message}`);
    _stats.warnings++;
  });
}
