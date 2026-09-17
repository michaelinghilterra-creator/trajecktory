import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openEventStore, withTransaction } from './event-store.mjs';
import { DATABASE_FILE, readEventStoreSwitch } from './event-store-switch.mjs';
import { renderDirty } from './legacy-files.mjs';

const enabledByDir = new Map();
const storesByDir = new Map();
const activeByDir = new Map();
let renderOptions;
let testHook;

function keyFor(dataDir) {
  return resolve(dataDir);
}

export function logWritesEnabled(dataDir) {
  const key = keyFor(dataDir);
  if (!enabledByDir.has(key)) {
    enabledByDir.set(key, readEventStoreSwitch(key).writes === 'on');
  }
  return enabledByDir.get(key);
}

export function openDataStore(dataDir) {
  const key = keyFor(dataDir);
  if (storesByDir.has(key)) return storesByDir.get(key);
  const dbPath = join(key, DATABASE_FILE);
  if (!existsSync(dbPath)) {
    throw new Error(`Event store is switched on but ${DATABASE_FILE} is missing`);
  }
  const store = openEventStore(dbPath);
  storesByDir.set(key, store);
  return store;
}

export function withLogWrite(dataDir, fn) {
  const key = keyFor(dataDir);
  const active = activeByDir.get(key);
  if (active) return fn(active);

  const store = openDataStore(key);
  activeByDir.set(key, store);
  let result;
  try {
    result = withTransaction(store, () => fn(store));
  } finally {
    activeByDir.delete(key);
  }

  const rendered = renderDirty(store, key, renderOptions);
  if (rendered.failed.length) {
    const files = rendered.failed.map(({ file }) => file);
    const error = new Error(`Change saved, but files could not be updated yet: ${files.join(', ')}`);
    error.code = 'RENDER_FAILED';
    error.files = files;
    throw error;
  }
  return result;
}

export function localToday(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function runLogWriteTestHook(name) {
  if (testHook) testHook(name);
}

export function setLogWritesTestHooks({ writeFile, hook } = {}) {
  renderOptions = writeFile ? { writeFile } : undefined;
  testHook = hook;
}

export function resetLogWritesCache() {
  enabledByDir.clear();
  activeByDir.clear();
  renderOptions = undefined;
  testHook = undefined;
  for (const store of storesByDir.values()) {
    try { store.close(); } catch { /* already closed */ }
  }
  storesByDir.clear();
}
