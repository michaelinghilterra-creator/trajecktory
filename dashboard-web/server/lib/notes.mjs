import fs from 'fs';
import { APP_NOTES_PATH, DATA_DIR } from '../config.mjs';
import { logWritesEnabled, openDataStore, withLogWrite } from '../../../lib/log-writes.mjs';
import { activeLegacyFileEvents, appendEventsWithEffects, renderLegacyFile } from '../../../lib/legacy-files.mjs';
import { buildVoidEvent } from '../../../lib/void-events.mjs';
import { localToday } from '../../../lib/local-date.mjs';

// ── Per-application interview/meeting notes ──────────────────────────────────
// An append-only, timestamped log kept OUT of applications.md (which stays a
// fixed 10-column table). Shape, keyed by application id:
//   { "<appId>": [ { timestamp: ISO8601, text: "...", msgId?, threadId?, sender? }, ... ] }
// Separate JSON sidecar, mirroring apply-dates.json / followup-snooze.json so
// the tracker schema and its analytics are never perturbed.
function readAppNotes() {
  try { return JSON.parse(fs.readFileSync(APP_NOTES_PATH, 'utf8')) || {}; }
  catch { return {}; }
}
function writeAppNotes(map) {
  fs.writeFileSync(APP_NOTES_PATH, JSON.stringify(map, null, 2) + '\n');
}

function projectedNotes() {
  if (!logWritesEnabled(DATA_DIR)) return readAppNotes();
  const store = openDataStore(DATA_DIR);
  const text = renderLegacyFile(store, 'app-notes.json');
  return text ? JSON.parse(text) : {};
}

export function noteEffect(appId, text, meta) {
  const clean = String(text == null ? '' : text).trim();
  if (!clean) return null;
  const item = { timestamp: new Date().toISOString(), text: clean };
  for (const field of ['msgId', 'threadId', 'sender']) {
    if (meta?.[field] != null && String(meta[field])) item[field] = String(meta[field]);
  }
  return { item, effect: { file: 'app-notes.json', op: 'json_nested_append', key: String(appId), item } };
}

// Chronological (oldest → newest) note history for one application.
function getNotes(appId) {
  const list = projectedNotes()[String(appId)] || [];
  return [...list].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function findNoteByMsgId(msgId) {
  const needle = msgId == null ? '' : String(msgId);
  if (!needle) return null;
  const map = projectedNotes();
  for (const [appId, notes] of Object.entries(map)) {
    if (Array.isArray(notes) && notes.some(note => String(note?.msgId || '') === needle)) return appId;
  }
  return null;
}

// Append a timestamped entry. No-op on empty text. Returns the updated history.
function addNote(appId, text, meta) {
  const built = noteEffect(appId, text, meta);
  if (!built) { const history = getNotes(appId); history.added = false; return history; }
  const msgId = meta?.msgId == null ? '' : String(meta.msgId);
  if (msgId && findNoteByMsgId(msgId)) { const history = getNotes(appId); history.added = false; return history; }
  if (logWritesEnabled(DATA_DIR)) {
    withLogWrite(DATA_DIR, (s) => appendEventsWithEffects(s, [{
      type: 'note_added',
      occurred_on: built.item.timestamp.slice(0, 10),
      source: 'dashboard',
      application_id: String(appId),
      definitions_version: 'v1',
      payload: { legacy_effects: [built.effect] },
    }]));
  } else {
    const map = readAppNotes();
    const key = String(appId);
    if (!map[key]) map[key] = [];
    map[key].push(built.item);
    writeAppNotes(map);
  }
  const history = getNotes(appId);
  history.added = true;
  return history;
}

// Remove a single entry by its timestamp. Returns the updated history.
function deleteNote(appId, timestamp) {
  if (logWritesEnabled(DATA_DIR)) {
    const store = openDataStore(DATA_DIR);
    const key = String(appId);
    const target = activeLegacyFileEvents(store, 'app-notes.json').find((event) => (
      event.payload?.legacy_effects?.some((effect) => effect.op === 'json_nested_append'
        && effect.file === 'app-notes.json'
        && effect.key === key
        && effect.item?.timestamp === timestamp)
    ));
    if (target != null && target.type !== 'event_undone') {
      withLogWrite(DATA_DIR, (s) => appendEventsWithEffects(s, [buildVoidEvent({
        target_event_id: target.id,
        reason_code: 'erroneous_entry',
        evidence_ref: 'owner',
        actor: 'owner',
        occurred_on: localToday(),
        definitions_version: 'v1',
      })]));
    }
  } else {
    const map = readAppNotes();
    const key = String(appId);
    if (map[key]) {
      map[key] = map[key].filter((n) => n.timestamp !== timestamp);
      if (!map[key].length) delete map[key];
      writeAppNotes(map);
    }
  }
  return getNotes(appId);
}

export { readAppNotes, writeAppNotes, getNotes, findNoteByMsgId, addNote, deleteNote };
