import fs from 'fs';
import { CONNECTS_PATH, DATA_DIR } from '../config.mjs';
import { appendEventsWithEffects, renderLegacyFile } from '../../../lib/legacy-files.mjs';
import { localToday, logWritesEnabled, withLogRead, withLogWrite } from '../../../lib/log-writes.mjs';

// Manual LinkedIn-connect tally. Connections are sent by hand (never automated),
// so the count is logged here, one entry per invite. Returns null when no log
// exists yet, so the weekly metric reads "not logged" rather than a false zero;
// an existing-but-empty log reads a real zero.
function readConnects() {
  if (logWritesEnabled(DATA_DIR)) {
    return withLogRead(DATA_DIR, store => {
      const text = renderLegacyFile(store, 'linkedin-connects.json');
      if (text === null) return null;
      try {
        const value = JSON.parse(text);
        return Array.isArray(value) ? value : (Array.isArray(value?.connects) ? value.connects : []);
      } catch { return []; }
    });
  }
  if (!fs.existsSync(CONNECTS_PATH)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(CONNECTS_PATH, 'utf8'));
    return Array.isArray(j) ? j : (Array.isArray(j?.connects) ? j.connects : []);
  } catch { return []; }
}

// Normalized name, matching lib/twc.mjs normNm, so a name-keyed dedup here agrees
// with the tracker's name-keyed dedup.
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// The durable identity of a connect is (contact id, source): the ledger records a
// connection request to a SPECIFIC contact record, and joining that back by id is
// exact where joining by a name string is fragile (nicknames, middle initials,
// a surname edited after the fact). Name is retained for readability and as the
// fallback key for legacy entries that predate id capture. Same-day dedup so the
// same invite marked sent twice (a page reload re-enabling the button) is one row.
function connectKey(e) {
  const date = String(e.date || '').slice(0, 10);
  const src = String(e.source || '');
  return (e.id !== undefined && e.id !== null && e.id !== '')
    ? `${date}|id:${e.id}|${src}`
    : `${date}|nm:${normName(e.name)}|${src}`;
}

function logConnect({ name = '', source = '', id = null, date = null } = {}) {
  if (logWritesEnabled(DATA_DIR)) {
    return withLogWrite(DATA_DIR, store => {
      const projected = renderLegacyFile(store, 'linkedin-connects.json');
      const parsed = (() => {
        try { return projected === null ? [] : JSON.parse(projected); }
        catch { return []; }
      })();
      const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.connects) ? parsed.connects : []);
      const entry = {
        date: date || new Date().toISOString().slice(0, 10),
        name: String(name).slice(0, 120),
        source: String(source).slice(0, 40),
      };
      if (id !== undefined && id !== null && id !== '') entry.id = id;
      const key = connectKey(entry);
      if (list.some(e => connectKey(e) === key)) return list;
      const appended = [...list, entry];
      const effect = !Array.isArray(parsed) && Array.isArray(parsed?.connects)
        ? { file: 'linkedin-connects.json', op: 'json_replace', value: appended }
        : { file: 'linkedin-connects.json', op: 'json_append', item: entry };
      appendEventsWithEffects(store, [{
        type: 'connection_request_sent', occurred_on: localToday(), source: 'dashboard', definitions_version: 'v1',
        payload: {
          file: 'linkedin-connects.json', ref: entry.id !== undefined ? `ta:${entry.id}` : null, date: entry.date,
          legacy_effects: [effect],
        },
      }]);
      return appended;
    });
  }
  const list = readConnects() || [];
  const entry = {
    date: date || new Date().toISOString().slice(0, 10),
    name: String(name).slice(0, 120),
    source: String(source).slice(0, 40),
  };
  // Only record an id when one was supplied. A null/blank id is omitted rather
  // than stored, so legacy readers and the name-fallback dedup keep working and
  // the backfill can tell an un-migrated entry from an id-keyed one.
  if (id !== undefined && id !== null && id !== '') entry.id = id;
  // Idempotent on the durable key: id-keyed when an id is present, name-keyed
  // otherwise. A pre-backfill name-keyed row and its post-backfill id-keyed twin
  // are reconciled by the backfill, not here.
  const key = connectKey(entry);
  if (list.some(e => connectKey(e) === key)) return list;
  list.push(entry);
  fs.writeFileSync(CONNECTS_PATH, JSON.stringify(list, null, 2) + '\n');
  return list;
}

export { readConnects, logConnect, connectKey, normName };
