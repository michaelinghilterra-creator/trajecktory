// lib/event-store.mjs is the single owner of the append-only SQLite event log.
//
// WHY THIS EXISTS: trajecktory's durable history currently spans several data
// files. This store provides one transactional log that later migrations can
// adopt without risking partial writes or edits to recorded history.

import { DatabaseSync } from 'node:sqlite';

export const EVENT_TYPES = Object.freeze([
  'posting_evaluated',
  'application_submitted',
  'status_changed',
  'event_undone',
  'note_added',
  'person_added',
  'person_updated',
  'person_tagged',
  'people_merged',
  'people_unmerged',
  'companies_merged',
  'email_found',
  'email_bounced',
  'connection_request_sent',
  'connection_accepted',
  'message_sent',
  'email_received',
  'reply_unmatched',
  'contact_search_run',
  'work_search_event_logged',
  'linkedin_export_imported',
]);

export const SOURCES = Object.freeze([
  'dashboard',
  'gmail',
  'linkedin_export',
  'import',
  'cli',
]);

export const CHANNELS = Object.freeze([
  'email',
  'linkedin_message',
  'inmail',
  'linkedin_request',
]);

export const SCHEMA_VERSION = 1;

const EVENT_TYPE_SET = new Set(EVENT_TYPES);
const SOURCE_SET = new Set(SOURCES);
const CHANNEL_SET = new Set(CHANNELS);
const EVENT_KEYS = new Set([
  'type',
  'occurred_on',
  'occurred_at',
  'person_id',
  'company_id',
  'posting_id',
  'application_id',
  'channel',
  'source',
  'evidence_ref',
  'corrects_event_id',
  'dedupe_key',
  'payload',
  'definitions_version',
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function validationError(index, field, detail) {
  return new Error(`events[${index}].${field}: ${detail}`);
}

function validateEvents(events) {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('events must be a non-empty array');
  }

  return events.map((event, index) => {
    if (!isPlainObject(event)) {
      throw validationError(index, 'event', 'must be a plain object');
    }
    for (const key of Object.keys(event)) {
      if (!EVENT_KEYS.has(key)) {
        throw validationError(index, key, 'unknown field');
      }
    }
    if (!EVENT_TYPE_SET.has(event.type)) {
      throw validationError(index, 'type', 'unknown event type');
    }
    if (!SOURCE_SET.has(event.source)) {
      throw validationError(index, 'source', 'unknown source');
    }
    if (event.channel !== undefined && event.channel !== null && !CHANNEL_SET.has(event.channel)) {
      throw validationError(index, 'channel', 'unknown channel');
    }
    if (!isCalendarDate(event.occurred_on)) {
      throw validationError(index, 'occurred_on', 'must be a real calendar date in YYYY-MM-DD format');
    }
    if (event.definitions_version === undefined
      || event.definitions_version === null
      || String(event.definitions_version).trim() === '') {
      throw validationError(index, 'definitions_version', 'is required');
    }
    if (event.payload !== undefined && !isPlainObject(event.payload)) {
      throw validationError(index, 'payload', 'must be a plain object');
    }
    if (event.corrects_event_id !== undefined
      && event.corrects_event_id !== null
      && (!Number.isInteger(event.corrects_event_id) || event.corrects_event_id <= 0)) {
      throw validationError(index, 'corrects_event_id', 'must be a positive integer');
    }

    let payload;
    try {
      payload = JSON.stringify(event.payload ?? {});
    } catch {
      throw validationError(index, 'payload', 'must be JSON serializable');
    }

    return { event, payload };
  });
}

export function openEventStore(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA journal_mode = WAL');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > SCHEMA_VERSION) {
      throw new Error(`Event store schema version ${version} is newer than supported version ${SCHEMA_VERSION}`);
    }
    if (version === 0) {
      db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          occurred_on TEXT NOT NULL,
          occurred_at TEXT,
          recorded_at TEXT NOT NULL,
          person_id TEXT,
          company_id TEXT,
          posting_id TEXT,
          application_id TEXT,
          channel TEXT,
          source TEXT NOT NULL,
          evidence_ref TEXT,
          corrects_event_id INTEGER REFERENCES events(id),
          dedupe_key TEXT UNIQUE,
          payload TEXT NOT NULL DEFAULT '{}',
          definitions_version TEXT NOT NULL
        );
        CREATE INDEX events_type_idx ON events(type);
        CREATE INDEX events_application_id_idx ON events(application_id);
        CREATE INDEX events_person_id_idx ON events(person_id);
        CREATE INDEX events_occurred_on_idx ON events(occurred_on);
        CREATE TRIGGER events_append_only_update
        BEFORE UPDATE ON events
        BEGIN
          SELECT RAISE(ABORT, 'append-only');
        END;
        CREATE TRIGGER events_append_only_delete
        BEFORE DELETE ON events
        BEGIN
          SELECT RAISE(ABORT, 'append-only');
        END;
        PRAGMA user_version = 1;
        COMMIT;
      `);
    }
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* no active transaction */ }
    db.close();
    throw error;
  }

  return {
    db,
    close() {
      db.close();
    },
  };
}

export function appendEvents(store, events) {
  const validated = validateEvents(events);
  const recordedAt = new Date().toISOString();
  const statement = store.db.prepare(`
    INSERT INTO events (
      type, occurred_on, occurred_at, recorded_at, person_id, company_id,
      posting_id, application_id, channel, source, evidence_ref,
      corrects_event_id, dedupe_key, payload, definitions_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const ids = [];

  store.db.exec('BEGIN IMMEDIATE');
  try {
    for (const { event, payload } of validated) {
      const result = statement.run(
        event.type,
        event.occurred_on,
        event.occurred_at ?? null,
        recordedAt,
        event.person_id ?? null,
        event.company_id ?? null,
        event.posting_id ?? null,
        event.application_id ?? null,
        event.channel ?? null,
        event.source,
        event.evidence_ref ?? null,
        event.corrects_event_id ?? null,
        event.dedupe_key ?? null,
        payload,
        event.definitions_version,
      );
      ids.push(Number(result.lastInsertRowid));
    }
    store.db.exec('COMMIT');
    return ids;
  } catch (error) {
    store.db.exec('ROLLBACK');
    throw error;
  }
}

export function readEvents(store, { type, applicationId, personId } = {}) {
  const where = [];
  const values = [];
  if (type !== undefined) {
    where.push('type = ?');
    values.push(type);
  }
  if (applicationId !== undefined) {
    where.push('application_id = ?');
    values.push(applicationId);
  }
  if (personId !== undefined) {
    where.push('person_id = ?');
    values.push(personId);
  }
  const clause = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const rows = store.db.prepare(`SELECT * FROM events${clause} ORDER BY occurred_on, id`).all(...values);
  return rows.map(row => ({ ...row, payload: JSON.parse(row.payload) }));
}
