import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.mjs';
import { localToday } from '../../../lib/local-date.mjs';
import { logWritesEnabled, withLogRead } from '../../../lib/log-writes.mjs';

// Bumped after every request that can write data, so a read-side response cache
// can tell whether anything changed since it computed. Writes made outside the
// server (CLI scripts) do not bump it; caches also cap their age for that reason.
let generation = 0;

export function dataGeneration() {
  return generation;
}

export function bumpDataGeneration() {
  generation += 1;
}

// Size and mtime of every top-level data file, the event store's database and WAL
// included, so a write from any path (a CLI script, a test, another route) is seen.
// About 3ms for ~100 files. Nested folders are covered by the generation and the age cap.
function dataFingerprint() {
  let fingerprint = '';
  try {
    for (const entry of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const stat = fs.statSync(path.join(DATA_DIR, entry.name));
      fingerprint += `${entry.name}:${stat.size}:${stat.mtimeMs}|`;
    }
  } catch {
    return null;
  }
  return fingerprint;
}

// The state a cached value was computed against. Take it BEFORE computing, so a
// write that lands during the computation invalidates the result.
export function cacheStamp() {
  return { generation, fingerprint: dataFingerprint(), day: localToday(), at: Date.now() };
}

const MAX_AGE_MS = 60 * 1000;

export function stampIsFresh(stamp) {
  return !!stamp && stamp.fingerprint !== null
    && stamp.generation === generation
    && stamp.day === localToday()
    && Date.now() - stamp.at < MAX_AGE_MS
    && stamp.fingerprint === dataFingerprint();
}

const MAX_ENTRIES = 200;
const entries = new Map();

// Reuse a read-only computation until the data changes, the day rolls over, or it
// is a minute old. `compute` must not write: it runs inside one shared event-store
// read scope, where a write would re-render files from projections cached before it.
export function cachedRead(key, compute) {
  const hit = entries.get(key);
  if (hit && stampIsFresh(hit.stamp)) return hit.value;
  const stamp = cacheStamp();
  const value = logWritesEnabled(DATA_DIR) ? withLogRead(DATA_DIR, compute) : compute();
  if (entries.size >= MAX_ENTRIES) entries.clear();
  entries.set(key, { value, stamp });
  return value;
}
