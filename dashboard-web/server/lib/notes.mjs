import fs from 'fs';
import { APP_NOTES_PATH } from '../config.mjs';

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

// Chronological (oldest → newest) note history for one application.
function getNotes(appId) {
  const list = readAppNotes()[String(appId)] || [];
  return [...list].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function findNoteByMsgId(msgId) {
  const needle = msgId == null ? '' : String(msgId);
  if (!needle) return null;
  const map = readAppNotes();
  for (const [appId, notes] of Object.entries(map)) {
    if (Array.isArray(notes) && notes.some(note => String(note?.msgId || '') === needle)) return appId;
  }
  return null;
}

// Append a timestamped entry. No-op on empty text. Returns the updated history.
function addNote(appId, text, meta) {
  const clean = String(text == null ? '' : text).trim();
  if (!clean) {
    const history = getNotes(appId);
    history.added = false;
    return history;
  }
  const map = readAppNotes();
  const key = String(appId);
  if (!map[key]) map[key] = [];
  const msgId = meta?.msgId == null ? '' : String(meta.msgId);
  if (msgId && findNoteByMsgId(msgId)) {
    const history = getNotes(appId);
    history.added = false;
    return history;
  }
  const entry = { timestamp: new Date().toISOString(), text: clean };
  for (const field of ['msgId', 'threadId', 'sender']) {
    if (meta?.[field] != null && String(meta[field])) entry[field] = String(meta[field]);
  }
  map[key].push(entry);
  writeAppNotes(map);
  const history = getNotes(appId);
  history.added = true;
  return history;
}

// Remove a single entry by its timestamp. Returns the updated history.
function deleteNote(appId, timestamp) {
  const map = readAppNotes();
  const key = String(appId);
  if (map[key]) {
    map[key] = map[key].filter(n => n.timestamp !== timestamp);
    if (!map[key].length) delete map[key];
    writeAppNotes(map);
  }
  return getNotes(appId);
}

export { readAppNotes, writeAppNotes, getNotes, findNoteByMsgId, addNote, deleteNote };
