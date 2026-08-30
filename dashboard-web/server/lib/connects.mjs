import fs from 'fs';
import { CONNECTS_PATH } from '../config.mjs';

// Manual LinkedIn-connect tally. Connections are sent by hand (never automated),
// so the count is logged here, one entry per invite. Returns null when no log
// exists yet, so the weekly metric reads "not logged" rather than a false zero;
// an existing-but-empty log reads a real zero.
function readConnects() {
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
