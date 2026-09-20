import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { insertEvents, withTransaction } from './event-store.mjs';
import { voidedIds } from './void-events.mjs';
import { writeFileAtomic } from './atomic-write.mjs';
import { parseTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from './tracker.mjs';

export const LEGACY_TABLE_FILES = Object.freeze([
  'applications.md',
  'status-events.tsv',
  'target-talent.md',
  'referrals.md',
  'follow-ups.md',
]);
export const LEGACY_CORRESPONDENCE_DIRS = Object.freeze([
  'target-talent-correspondence',
  'referral-correspondence',
]);
export const LEGACY_JSON_FILES = Object.freeze([
  'apply-dates.json',
  'linkedin-connects.json',
  'tt-linkedin.json',
  'linkedin-connections.json',
  'twc-events.json',
  'twc-overrides.json',
  'contact-links.json',
]);

const TABLE_FILE_SET = new Set(LEGACY_TABLE_FILES);
const CORRESPONDENCE_DIR_SET = new Set(LEGACY_CORRESPONDENCE_DIRS);
const JSON_FILE_SET = new Set(LEGACY_JSON_FILES);
const JSON_ARRAY_FILES = new Set(['linkedin-connects.json', 'twc-events.json']);
const JSON_EFFECT_OPS = new Set(['json_replace', 'json_set', 'json_delete', 'json_append']);
const EFFECT_OPS = new Set(['row_upsert', 'row_delete', 'file_replace', ...JSON_EFFECT_OPS]);
const PROJECTION_CACHE = Symbol('legacyProjectionCache');

export function withProjectionCache(store, fn) {
  if (store[PROJECTION_CACHE]) return fn();
  store[PROJECTION_CACHE] = new Map();
  try { return fn(); }
  finally { delete store[PROJECTION_CACHE]; }
}

export function correspondenceParts(file) {
  if (typeof file !== 'string') return null;
  const match = file.match(/^([^/\\]+)\/([^/\\]+\.md)$/);
  if (!match || !CORRESPONDENCE_DIR_SET.has(match[1]) || match[2] === '.md') return null;
  return { dir: match[1], name: match[2] };
}

function isKnownFile(file) {
  return TABLE_FILE_SET.has(file) || JSON_FILE_SET.has(file) || correspondenceParts(file) !== null;
}

function contactLinksDocument(value) {
  const document = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const pins = document.pins && typeof document.pins === 'object' && !Array.isArray(document.pins)
    ? { ...document.pins } : {};
  // Mirrors writePins in dashboard-web/server/lib/contact-links.mjs.
  return { ...document, version: document.version || 1, pins };
}

function serializeJsonFile(file, value) {
  if (file === 'contact-links.json') {
    return `${JSON.stringify(contactLinksDocument(value), null, 2)}\n`;
  }
  if (file === 'tt-linkedin.json') return JSON.stringify(value, null, 2);
  if (file === 'linkedin-connections.json') return JSON.stringify(value);
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonSnapshotPayload(file, text) {
  if (text === null) return { reason: 'json_snapshot', file, exists: false };
  try {
    const value = JSON.parse(text);
    if (text === serializeJsonFile(file, value)) {
      return { reason: 'json_snapshot', file, exists: true, format: 'writer', value };
    }
    return { reason: 'json_snapshot', file, exists: true, format: 'raw', raw: text, value };
  } catch {
    return { reason: 'json_snapshot', file, exists: true, format: 'raw', raw: text };
  }
}

export function recordJsonSnapshots(store, { texts, definitionsVersion, importedOn }) {
  if (!texts || typeof texts !== 'object' || Array.isArray(texts)) {
    throw new Error('texts must be an object');
  }
  const events = LEGACY_JSON_FILES.map(file => ({
    type: 'legacy_record',
    occurred_on: importedOn,
    source: 'import',
    definitions_version: definitionsVersion,
    evidence_ref: `${file}#snapshot`,
    dedupe_key: `import:${file}:snapshot`,
    payload: jsonSnapshotPayload(file, texts[file] ?? null),
  }));
  return withTransaction(store, () => insertEvents(store, events));
}

export function splitLegacyLines(text) {
  const source = String(text ?? '');
  const lines = [];
  let start = 0;
  while (start < source.length) {
    const newline = source.indexOf('\n', start);
    if (newline === -1) {
      lines.push({ text: source.slice(start), eol: '' });
      break;
    }
    const crlf = newline > start && source[newline - 1] === '\r';
    lines.push({
      text: source.slice(start, crlf ? newline - 1 : newline),
      eol: crlf ? '\r\n' : '\n',
    });
    start = newline + 1;
  }
  return lines;
}

export function recordFileLayout(store, {
  file,
  text,
  exists = true,
  rowLineIndexes = [],
  definitionsVersion,
  importedOn,
}) {
  if (!TABLE_FILE_SET.has(file)) throw new Error(`unknown legacy table file: ${file}`);
  const rowIndexes = new Set(rowLineIndexes);
  const lines = exists ? splitLegacyLines(text).map((line, lineIndex) => (
    rowIndexes.has(lineIndex)
      ? { row_id: `${file}#${lineIndex}`, eol: line.eol }
      : line
  )) : [];
  return withTransaction(store, () => insertEvents(store, [{
    type: 'legacy_record',
    occurred_on: importedOn,
    source: 'import',
    definitions_version: definitionsVersion,
    evidence_ref: `${file}#layout`,
    dedupe_key: `import:${file}:layout`,
    payload: { reason: 'file_layout', file, exists: Boolean(exists), lines },
  }]));
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertOnlyKeys(effect, allowed, label) {
  for (const key of Object.keys(effect)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key}: unknown field`);
  }
}

function validateAnchor(anchor, label) {
  assertPlainObject(anchor, label);
  if (!['table_start', 'table_end', 'before', 'after'].includes(anchor.at)) {
    throw new Error(`${label}.at: unknown anchor`);
  }
  const allowed = anchor.at === 'before' || anchor.at === 'after'
    ? new Set(['at', 'row_id']) : new Set(['at']);
  for (const key of Object.keys(anchor)) {
    if (!allowed.has(key)) throw new Error(`${label}.${key}: unknown field`);
  }
  if ((anchor.at === 'before' || anchor.at === 'after')
    && (typeof anchor.row_id !== 'string' || anchor.row_id.length === 0)) {
    throw new Error(`${label}.row_id: is required`);
  }
}

function assertJsonValue(value, label, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${label}: must be JSON-serializable`);
    return;
  }
  if (typeof value !== 'object') throw new Error(`${label}: must be JSON-serializable`);
  if (ancestors.has(value)) throw new Error(`${label}: must be JSON-serializable`);
  // Only plain data: a class instance or any toJSON hook (even non-enumerable)
  // could serialize differently from what the checks below inspect.
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) {
    throw new Error(`${label}: must be a plain object or array`);
  }
  if ('toJSON' in value) throw new Error(`${label}: must not define toJSON`);
  ancestors.add(value);
  for (const key of Object.keys(value)) assertJsonValue(value[key], `${label}.${key}`, ancestors);
  ancestors.delete(value);
}

export function validateLegacyEffects(effects) {
  if (!Array.isArray(effects)) throw new Error('legacy_effects must be an array');
  effects.forEach((effect, index) => {
    const label = `legacy_effects[${index}]`;
    assertPlainObject(effect, label);
    if (!EFFECT_OPS.has(effect.op)) throw new Error(`${label}.op: unknown op`);
    if (!isKnownFile(effect.file)) throw new Error(`${label}.file: unknown file`);

    if (JSON_EFFECT_OPS.has(effect.op)) {
      if (!JSON_FILE_SET.has(effect.file)) throw new Error(`${label}.file: JSON effects require a JSON file`);
      if (effect.op === 'json_delete') {
        assertOnlyKeys(effect, new Set(['file', 'op', 'key']), label);
      } else if (effect.op === 'json_append') {
        assertOnlyKeys(effect, new Set(['file', 'op', 'item']), label);
        if (!Object.hasOwn(effect, 'item')) throw new Error(`${label}.item: is required`);
        assertJsonValue(effect.item, `${label}.item`);
      } else {
        assertOnlyKeys(effect, new Set(['file', 'op', ...(effect.op === 'json_set' ? ['key'] : []), 'value']), label);
        if (!Object.hasOwn(effect, 'value')) throw new Error(`${label}.value: is required`);
        assertJsonValue(effect.value, `${label}.value`);
      }
      if ((effect.op === 'json_set' || effect.op === 'json_delete')
        && (typeof effect.key !== 'string' || effect.key.length === 0)) {
        throw new Error(`${label}.key: is required`);
      }
      return;
    }

    if (effect.op === 'file_replace') {
      assertOnlyKeys(effect, new Set(['file', 'op', 'raw']), label);
      if (!correspondenceParts(effect.file)) throw new Error(`${label}.file: file_replace requires correspondence file`);
      if (typeof effect.raw !== 'string') throw new Error(`${label}.raw: is required`);
      return;
    }
    if (!TABLE_FILE_SET.has(effect.file)) throw new Error(`${label}.file: row effects require a table file`);
    if (typeof effect.row_id !== 'string' || effect.row_id.length === 0) {
      throw new Error(`${label}.row_id: is required`);
    }
    if (effect.op === 'row_delete') {
      assertOnlyKeys(effect, new Set(['file', 'op', 'row_id']), label);
      return;
    }
    assertOnlyKeys(effect, new Set(['file', 'op', 'row_id', 'raw', 'anchor']), label);
    if (typeof effect.raw !== 'string') throw new Error(`${label}.raw: is required`);
    if (effect.anchor !== undefined) validateAnchor(effect.anchor, `${label}.anchor`);
  });
  return effects;
}

function eventEffects(payload, file) {
  return Array.isArray(payload?.legacy_effects)
    ? payload.legacy_effects.filter(effect => effect?.file === file)
    : [];
}

// D-10: the events a void (event_undone) has taken out of the projections. An event stays in the log; its
// effects are skipped. Undoing the void brings it back. Empty when nothing was ever voided.
const VOIDED_CACHE_KEY = ' voided-event-ids';
function voidedEventIds(store) {
  const cache = store[PROJECTION_CACHE];
  if (cache?.has(VOIDED_CACHE_KEY)) return cache.get(VOIDED_CACHE_KEY);
  const ids = queryVoidedEventIds(store);
  cache?.set(VOIDED_CACHE_KEY, ids);
  return ids;
}

function queryVoidedEventIds(store) {
  const rows = store.db.prepare(`
    SELECT id, type, corrects_event_id FROM events
    WHERE type = 'event_undone'
       OR id IN (SELECT corrects_event_id FROM events WHERE type = 'event_undone' AND corrects_event_id IS NOT NULL)
  `).all();
  return rows.length === 0 ? new Set() : voidedIds(rows);
}

function tableEvents(store, file) {
  return store.db.prepare(`
    SELECT events.id, events.type, events.evidence_ref, events.payload
    FROM event_files
    JOIN events ON events.id = event_files.event_id
    WHERE event_files.file = ?
    ORDER BY events.id
  `).all(file).map(row => ({ ...row, payload: JSON.parse(row.payload) }));
}

function skeleton(file) {
  // applications.md mirrors the fresh-install writer in merge-tracker.mjs.
  if (file === 'applications.md') {
    return `# Applications Tracker\n\n${TRACKER_HEADER}\n${TRACKER_SEPARATOR}\n`;
  }
  // status-events.tsv mirrors logStatusEvent in dashboard-web/server/lib/sidecars.mjs.
  if (file === 'status-events.tsv') return 'app#\tdate\tstatus\tcompany\tlogged\n';
  // target-talent.md mirrors TT_HEADER in dashboard-web/server/routes/tt-reconcile.mjs.
  if (file === 'target-talent.md') {
    return '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---------|------|-------|--------|-------|------|-------|-----|-------|-------|----------|--------|------------|-------|---------|\n';
  }
  // referrals.md mirrors REFERRAL_HEADER in dashboard-web/server/lib/referrals.mjs.
  if (file === 'referrals.md') {
    return '# Referral tracker\n\n| # | Name | How you know them | Where they are now | Target company/role | Status | Last Touch | Notes | LinkedIn | Email |\n|---|------|-------------------|--------------------|---------------------|--------|------------|-------|----------|-------|\n';
  }
  // follow-ups.md mirrors appendFollowupRow in dashboard-web/server/lib/followups.mjs.
  return '# Follow-Ups\n\n| # | app# | date | company | role | channel | contact | notes |\n|---|------|------|---------|------|---------|---------|-------|\n';
}

function makeTableProjection(store, file) {
  const events = tableEvents(store, file);
  const rawByRowId = new Map();
  let layout = null;
  for (const event of events) {
    const payload = event.payload;
    if (payload.reason === 'file_layout' && payload.file === file) layout = payload;
    if (Number.isInteger(payload.line_index) && typeof payload.raw === 'string') {
      // Imported raw keeps a trailing \r on CRLF rows; the layout already stores the ending.
      rawByRowId.set(`${file}#${payload.line_index}`, payload.raw.replace(/\r$/, ''));
    }
  }

  const state = {
    exists: layout?.exists === true,
    lines: [],
    usedRowIds: new Set(),
  };
  if (layout?.exists === true) {
    state.lines = layout.lines.map(entry => {
      if (Object.hasOwn(entry, 'row_id')) {
        const raw = rawByRowId.get(entry.row_id);
        if (raw === undefined) throw new Error(`missing imported raw row ${entry.row_id}`);
        state.usedRowIds.add(entry.row_id);
        return { row_id: entry.row_id, raw, eol: entry.eol };
      }
      return { text: entry.text, eol: entry.eol };
    });
  }

  // With no void in the log this loop is exactly the old one. With a void, the voided events are skipped, and an
  // effect that only made sense on top of a skipped one (an edit of a row that was never inserted) is dropped.
  const voided = voidedEventIds(store);
  let dropped = 0;
  for (const event of events) {
    if (voided.has(event.id)) continue;
    for (const effect of eventEffects(event.payload, file)) {
      if (voided.size === 0) { applyTableEffect(state, file, effect); continue; }
      try { applyTableEffect(state, file, effect); } catch { dropped++; }
    }
  }
  if (dropped > 0) console.warn(`[legacy-files] ${file}: dropped ${dropped} effect(s) that depended on a voided event`);
  return state;
}

export function tableRows(store, file) {
  if (!TABLE_FILE_SET.has(file)) throw new Error(`unknown legacy table file: ${file}`);
  return makeTableProjection(store, file).lines
    .filter(line => Object.hasOwn(line, 'row_id'))
    .map(({ row_id, raw }) => ({ row_id, raw }));
}

export function findTableRowsByKey(store, file, keyOf, key) {
  return tableRows(store, file)
    .filter(({ raw }) => keyOf(raw) === key);
}

export function findTrackerRow(store, num, { company } = {}) {
  const wanted = Number(num);
  const candidates = tableRows(store, 'applications.md')
    .map(({ row_id, raw }) => ({ row_id, raw, row: parseTrackerLine(raw) }))
    .filter(candidate => candidate.row?.num === wanted);
  if (candidates.length === 0) return null;
  return (company && candidates.find(candidate => candidate.row.company === company))
    || candidates[0];
}

function emptyTableAnchorIndex(lines, file) {
  let lastSeparator = -1;
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].text;
    if (typeof text === 'string' && /^\|[\s:|-]+\|\s*$/.test(text)) lastSeparator = index;
  }
  if (lastSeparator >= 0) return lastSeparator + 1;
  if (file === 'status-events.tsv' && lines.length) return 1;
  return lines.length;
}

function insertionIndex(state, file, anchor) {
  const rows = state.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => Object.hasOwn(line, 'row_id'));
  if (anchor.at === 'table_start') return rows.length ? rows[0].index : emptyTableAnchorIndex(state.lines, file);
  if (anchor.at === 'table_end') return rows.length ? rows.at(-1).index + 1 : emptyTableAnchorIndex(state.lines, file);
  const index = state.lines.findIndex(line => line.row_id === anchor.row_id);
  if (index < 0) throw new Error(`anchor row does not exist: ${anchor.row_id}`);
  return anchor.at === 'before' ? index : index + 1;
}

function applyTableEffect(state, file, effect) {
  if (effect.op === 'row_delete') {
    const index = state.lines.findIndex(line => line.row_id === effect.row_id);
    if (index < 0) throw new Error(`row does not exist: ${effect.row_id}`);
    state.lines.splice(index, 1);
    return;
  }
  if (effect.op !== 'row_upsert') return;
  const existing = state.lines.find(line => line.row_id === effect.row_id);
  if (existing) {
    existing.raw = effect.raw;
    return;
  }
  if (state.usedRowIds.has(effect.row_id)) throw new Error(`row id was already used: ${effect.row_id}`);
  if (!effect.anchor) throw new Error(`new row requires anchor: ${effect.row_id}`);
  if (file === 'follow-ups.md' && state.usedRowIds.size === 0
    && !state.lines.some(line => typeof line.text === 'string' && /^\|[\s:|-]+\|\s*$/.test(line.text))) {
    const existingText = state.lines.map(line => `${line.text ?? ''}${line.eol}`).join('');
    const prefix = existingText ? `${existingText}\n` : '';
    state.lines = splitLegacyLines(`${prefix}${skeleton(file)}`);
  }
  if (!state.exists) {
    state.exists = true;
    state.lines = splitLegacyLines(skeleton(file));
  }
  const index = insertionIndex(state, file, effect.anchor);
  if (index > 0 && state.lines[index - 1].eol === '') state.lines[index - 1].eol = '\n';
  state.lines.splice(index, 0, { row_id: effect.row_id, raw: effect.raw, eol: '\n' });
  state.usedRowIds.add(effect.row_id);
}

function renderTable(store, file) {
  const state = makeTableProjection(store, file);
  if (!state.exists) return null;
  return state.lines.map(line => `${Object.hasOwn(line, 'row_id') ? line.raw : line.text}${line.eol}`).join('');
}

function correspondenceEvents(store, file) {
  return store.db.prepare(`
    SELECT events.id, events.payload
    FROM event_files
    JOIN events ON events.id = event_files.event_id
    WHERE event_files.file = ?
    ORDER BY events.id
  `).all(file).map(row => ({ ...row, payload: JSON.parse(row.payload) }));
}

function renderCorrespondence(store, file) {
  const events = correspondenceEvents(store, file);
  const segments = events
    .map(event => event.payload)
    .filter(payload => Number.isInteger(payload.segment_index) && typeof payload.raw === 'string')
    .sort((left, right) => left.segment_index - right.segment_index)
    .map(payload => payload.raw);
  let result = segments.length ? segments.join('') : null;
  const voided = voidedEventIds(store);
  for (const event of events) {
    if (voided.has(event.id)) continue;
    for (const effect of eventEffects(event.payload, file)) {
      if (effect.op === 'file_replace') result = effect.raw;
    }
  }
  return result;
}

function jsonEvents(store, file) {
  return store.db.prepare(`
    SELECT events.id, events.payload
    FROM event_files
    JOIN events ON events.id = event_files.event_id
    WHERE event_files.file = ?
    ORDER BY events.id
  `).all(file).map(row => ({ ...row, payload: JSON.parse(row.payload) }));
}

function defaultJsonDocument(file) {
  if (JSON_ARRAY_FILES.has(file)) return [];
  if (file === 'contact-links.json') return { version: 1, pins: {} };
  if (file === 'linkedin-connections.json') return undefined;
  return {};
}

function makeJsonProjection(store, file) {
  const voided = voidedEventIds(store);
  const events = jsonEvents(store, file).filter(event => !voided.has(event.id));
  let latestSnapshotIndex = -1;
  for (let index = 0; index < events.length; index++) {
    const payload = events[index].payload;
    if (payload.reason === 'json_snapshot' && payload.file === file) latestSnapshotIndex = index;
  }

  const snapshot = latestSnapshotIndex < 0 ? null : events[latestSnapshotIndex].payload;
  const state = {
    exists: snapshot?.exists === true,
    document: snapshot && Object.hasOwn(snapshot, 'value') ? snapshot.value : undefined,
    raw: snapshot?.format === 'raw' ? snapshot.raw : undefined,
    effectApplied: false,
  };
  for (let index = latestSnapshotIndex + 1; index < events.length; index++) {
    for (const effect of eventEffects(events[index].payload, file)) applyJsonEffect(state, file, effect);
  }
  return state;
}

function ensureJsonDocument(state, file, effect) {
  if (state.document !== undefined) return;
  const initial = defaultJsonDocument(file);
  if (initial === undefined) {
    throw new Error(`${effect.op} requires an existing document for ${file}`);
  }
  state.document = initial;
}

function applyJsonEffect(state, file, effect) {
  if (effect.op === 'json_replace') {
    state.document = JSON.parse(JSON.stringify(effect.value));
    state.exists = true;
    state.effectApplied = true;
    return;
  }
  ensureJsonDocument(state, file, effect);
  if (effect.op === 'json_append') {
    if (!Array.isArray(state.document)) throw new Error(`json_append requires an array document: ${file}`);
    state.document.push(effect.item);
  } else {
    if (!state.document || typeof state.document !== 'object' || Array.isArray(state.document)) {
      throw new Error(`${effect.op} requires an object document: ${file}`);
    }
    if (effect.op === 'json_set') state.document[effect.key] = effect.value;
    else if (effect.op === 'json_delete') delete state.document[effect.key];
  }
  state.exists = true;
  state.effectApplied = true;
}

function renderJson(store, file) {
  const state = makeJsonProjection(store, file);
  if (!state.exists && !state.effectApplied) return null;
  if (!state.effectApplied && state.raw !== undefined) return state.raw;
  return serializeJsonFile(file, state.document);
}

export function renderLegacyFile(store, file) {
  const cache = store[PROJECTION_CACHE];
  if (cache?.has(file)) return cache.get(file);
  let result;
  if (TABLE_FILE_SET.has(file)) result = renderTable(store, file);
  else if (JSON_FILE_SET.has(file)) result = renderJson(store, file);
  else if (correspondenceParts(file)) result = renderCorrespondence(store, file);
  else throw new Error(`unknown legacy file: ${file}`);
  cache?.set(file, result);
  return result;
}

export function listLegacyFiles(store) {
  const files = new Set([...LEGACY_TABLE_FILES, ...LEGACY_JSON_FILES]);
  for (const row of store.db.prepare('SELECT payload FROM events ORDER BY id').all()) {
    const payload = JSON.parse(row.payload);
    if (CORRESPONDENCE_DIR_SET.has(payload.dir) && typeof payload.file === 'string') {
      files.add(`${payload.dir}/${payload.file}`);
    }
    for (const effect of Array.isArray(payload.legacy_effects) ? payload.legacy_effects : []) {
      if (correspondenceParts(effect?.file)) files.add(effect.file);
    }
  }
  return [...files].sort();
}

export function appendEventsWithEffects(store, events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('events must be a non-empty array');
  }
  const affected = new Set();
  for (const [index, event] of events.entries()) {
    const effects = event?.payload?.legacy_effects;
    if (effects === undefined) continue;
    try { validateLegacyEffects(effects); }
    catch (error) { throw new Error(`events[${index}].payload.${error.message}`, { cause: error }); }
    for (const effect of effects) affected.add(effect.file);
  }
  if (events.some(event => event?.type === 'event_undone')) store[PROJECTION_CACHE]?.delete(VOIDED_CACHE_KEY);
  // A void changes what its target's files should say, so those files are re-rendered.
  const filesOf = store.db.prepare('SELECT file FROM event_files WHERE event_id = ?');
  const targetOf = store.db.prepare('SELECT type, corrects_event_id FROM events WHERE id = ?');
  for (const event of events) {
    if (event?.type !== 'event_undone' || !Number.isInteger(event.corrects_event_id)) continue;
    let target = event.corrects_event_id;
    for (let depth = 0; depth < 8 && target; depth++) {
      for (const row of filesOf.all(target)) affected.add(row.file);
      const next = targetOf.get(target);
      target = next?.type === 'event_undone' ? next.corrects_event_id : null;
    }
  }

  return withTransaction(store, () => {
    // Simulate all table and JSON effects, including effects earlier in this batch, inside
    // the write transaction so another process cannot change the rows between the
    // check and the insert. This catches missing/deleted anchors and rows.
    const simulated = new Map();
    for (const event of events) {
      for (const effect of event?.payload?.legacy_effects ?? []) {
        if (!TABLE_FILE_SET.has(effect.file)) continue;
        if (!simulated.has(effect.file)) simulated.set(effect.file, makeTableProjection(store, effect.file));
        applyTableEffect(simulated.get(effect.file), effect.file, effect);
      }
    }
    for (const event of events) {
      for (const effect of event?.payload?.legacy_effects ?? []) {
        if (!JSON_FILE_SET.has(effect.file)) continue;
        if (!simulated.has(effect.file)) simulated.set(effect.file, makeJsonProjection(store, effect.file));
        applyJsonEffect(simulated.get(effect.file), effect.file, effect);
      }
    }
    const ids = insertEvents(store, events);
    for (const file of affected) store[PROJECTION_CACHE]?.delete(file);
    // dirty is a counter: a render only clears the value it saw, so a save that
    // lands mid-render keeps the file dirty for the next pass.
    const mark = store.db.prepare(`
      INSERT INTO legacy_render_state (file, dirty) VALUES (?, 1)
      ON CONFLICT(file) DO UPDATE SET dirty = dirty + 1
    `);
    for (const file of affected) mark.run(file);
    return ids;
  });
}

export function renderDirty(store, dataDir, { writeFile = writeFileAtomic } = {}) {
  const dirty = store.db.prepare(
    'SELECT file, dirty FROM legacy_render_state WHERE dirty > 0 ORDER BY file',
  ).all();
  const rendered = [];
  const failed = [];
  const clear = store.db.prepare('UPDATE legacy_render_state SET dirty = 0 WHERE file = ? AND dirty = ?');
  for (const { file } of dirty) {
    try {
      // Render, write and record under the database write lock, so no save and no
      // other renderer can interleave: a slower renderer can never write older
      // content over newer content and then leave the file marked clean.
      const wrote = withTransaction(store, () => {
        const seen = store.db.prepare('SELECT dirty FROM legacy_render_state WHERE file = ?').get(file)?.dirty ?? 0;
        if (seen <= 0) return false;
        const lastEventId = store.db.prepare('SELECT MAX(id) AS id FROM events').get().id;
        const content = renderLegacyFile(store, file);
        if (content === null) {
          clear.run(file, seen);
          return false;
        }
        const destination = join(dataDir, file);
        if (correspondenceParts(file)) mkdirSync(dirname(destination), { recursive: true });
        writeFile(destination, content);
        const sha256 = createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
        store.db.prepare(`
          UPDATE legacy_render_state
          SET last_event_id = ?, sha256 = ?, rendered_at = ?
          WHERE file = ?
        `).run(lastEventId, sha256, new Date().toISOString(), file);
        clear.run(file, seen);
        return true;
      });
      if (wrote) rendered.push(file);
    } catch (error) {
      failed.push({ file, error });
    }
  }
  return { rendered, failed };
}

export const ABSENT_FILE_SHA256 = 'known-absent';

export function fileMatchesLastRender(store, dataDir, file) {
  const state = store.db.prepare(
    'SELECT sha256 FROM legacy_render_state WHERE file = ?',
  ).get(file);
  if (!state?.sha256) return null;
  const filePath = join(dataDir, file);
  if (state.sha256 === ABSENT_FILE_SHA256) return !existsSync(filePath);
  if (!existsSync(filePath)) return false;
  const actual = createHash('sha256').update(readFileSync(filePath)).digest('hex');
  return actual === state.sha256;
}
