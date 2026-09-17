import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { openEventStore, withTransaction } from './event-store.mjs';
import { DATABASE_FILE, readEventStoreSwitch } from './event-store-switch.mjs';
import {
  appendEventsWithEffects,
  renderDirty,
  renderLegacyFile,
  splitLegacyLines,
  tableRows,
} from './legacy-files.mjs';

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

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function tableTextRows(text, rowKey) {
  const rows = [];
  const nonRows = [];
  const keys = new Set();
  const occurrences = new Map();
  const occurrenceOf = value => {
    const key = String(value);
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    return occurrence;
  };
  for (const line of splitLegacyLines(text)) {
    const raw = line.text.replace(/\r$/, '');
    const keyValue = rowKey(raw, { occurrenceOf });
    if (keyValue === null || keyValue === undefined) {
      nonRows.push(raw);
      continue;
    }
    const key = String(keyValue);
    if (keys.has(key)) throw codedError('DUPLICATE_ROW_KEY', `Duplicate row key: ${key}`);
    keys.add(key);
    rows.push({ key, raw });
  }
  return { rows, nonRows };
}

function compareTableTexts(baseText, newText, rowKey) {
  const base = tableTextRows(baseText, rowKey);
  const next = tableTextRows(newText, rowKey);
  if (base.nonRows.length !== next.nonRows.length
    || base.nonRows.some((line, index) => line !== next.nonRows[index])) {
    throw codedError('LAYOUT_CHANGED', 'Non-row file layout changed; nothing was saved.');
  }

  const baseByKey = new Map(base.rows.map(row => [row.key, row]));
  const nextByKey = new Map(next.rows.map(row => [row.key, row]));
  const baseOrder = base.rows.filter(row => nextByKey.has(row.key)).map(row => row.key);
  const nextOrder = next.rows.filter(row => baseByKey.has(row.key)).map(row => row.key);
  if (baseOrder.some((key, index) => key !== nextOrder[index])) {
    throw codedError('ROW_ORDER_CHANGED', 'Existing row order changed; nothing was saved.');
  }

  const changedKeys = next.rows
    .filter(row => baseByKey.has(row.key) && row.raw !== baseByKey.get(row.key).raw)
    .map(row => row.key);
  const addedKeys = next.rows.filter(row => !baseByKey.has(row.key)).map(row => row.key);
  const removedKeys = base.rows.filter(row => !nextByKey.has(row.key)).map(row => row.key);
  return { base, next, baseByKey, nextByKey, changedKeys, addedKeys, removedKeys };
}

export function writeTableText({ dataDir, file, baseText, newText, rowKey, buildEvents }) {
  const comparison = compareTableTexts(baseText, newText, rowKey);
  const { base, next, baseByKey, nextByKey, changedKeys, addedKeys, removedKeys } = comparison;
  if (addedKeys.length === 0 && changedKeys.length === 0 && removedKeys.length === 0) {
    return { changed: false };
  }

  return withLogWrite(dataDir, store => {
    if (renderLegacyFile(store, file) !== baseText) {
      throw codedError('BASE_CHANGED', 'The file changed since it was read; nothing was saved; run again.');
    }

    const projectedRows = tableRows(store, file);
    if (projectedRows.length !== base.rows.length) {
      throw codedError('BASE_CHANGED', 'The file changed since it was read; nothing was saved; run again.');
    }
    const rowIdByKey = new Map(base.rows.map((row, index) => [row.key, projectedRows[index].row_id]));
    const added = [];
    const changed = [];
    const removed = [];
    let previousRowId = null;

    for (const row of next.rows) {
      const previous = baseByKey.get(row.key);
      if (previous) {
        const rowId = rowIdByKey.get(row.key);
        if (row.raw !== previous.raw) {
          changed.push({
            key: row.key,
            row_id: rowId,
            raw: row.raw,
            previousRaw: previous.raw,
            effect: { file, op: 'row_upsert', row_id: rowId, raw: row.raw },
          });
        }
        previousRowId = rowId;
        continue;
      }
      const rowId = `${file}#n-${randomUUID()}`;
      const effect = {
        file,
        op: 'row_upsert',
        row_id: rowId,
        raw: row.raw,
        anchor: previousRowId ? { at: 'after', row_id: previousRowId } : { at: 'table_start' },
      };
      added.push({ key: row.key, row_id: rowId, raw: row.raw, previousRaw: undefined, effect });
      previousRowId = rowId;
    }

    for (const row of base.rows) {
      if (nextByKey.has(row.key)) continue;
      const rowId = rowIdByKey.get(row.key);
      removed.push({
        key: row.key,
        row_id: rowId,
        raw: row.raw,
        previousRaw: row.raw,
        effect: { file, op: 'row_delete', row_id: rowId },
      });
    }

    const changes = [...added, ...changed, ...removed];
    if (changes.length === 0) return { changed: false };

    const events = buildEvents({ added, changed, removed });
    if (!Array.isArray(events)) throw new Error('buildEvents must return an array');
    const effectCounts = new Map(changes.map(change => [change.effect, 0]));
    for (const event of events) {
      const effects = event?.payload?.legacy_effects ?? [];
      if (!Array.isArray(effects)) {
        throw new Error('buildEvents must attach every table effect to exactly one event and no other effects');
      }
      for (const effect of effects) {
        if (!effectCounts.has(effect)) {
          throw new Error('buildEvents must attach every table effect to exactly one event and no other effects');
        }
        effectCounts.set(effect, effectCounts.get(effect) + 1);
      }
    }
    if ([...effectCounts.values()].some(count => count !== 1)) {
      throw new Error('buildEvents must attach every table effect to exactly one event and no other effects');
    }

    const normalized = events.map(event => ({
      ...event,
      source: event.source ?? 'cli',
      definitions_version: event.definitions_version ?? 'v1',
    }));
    const ids = appendEventsWithEffects(store, normalized);
    if (renderLegacyFile(store, file) !== newText) {
      throw codedError('ROUND_TRIP_MISMATCH', 'The saved table projection did not match the requested text; nothing was saved.');
    }
    return { changed: true, ids };
  });
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
