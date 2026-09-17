#!/usr/bin/env node
/**
 * event-store.test.mjs pins the transactional, append-only SQLite event store.
 *
 * Run: node tests/event-store.test.mjs (exit 0 = pass, 1 = fail)
 */

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  appendEvents,
  insertEvents,
  openEventStore,
  readEvents,
  reserveIds,
} from '../lib/event-store.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

function event(overrides = {}) {
  return {
    type: 'posting_evaluated',
    occurred_on: '2030-01-04',
    source: 'cli',
    definitions_version: 'test-v1',
    ...overrides,
  };
}

function throwsMatching(fn, pattern) {
  try {
    fn();
    return false;
  } catch (error) {
    return pattern.test(String(error?.message || error));
  }
}

console.log('event-store.test.mjs');
const dir = makeSandbox('event-store-test');

{
  const store = openEventStore(join(dir, 'pragmas.db'));
  check(store.db.prepare('PRAGMA busy_timeout').get().timeout === 5000, 'open sets busy_timeout to 5000');
  check(store.db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1, 'open enables foreign_keys');
  store.close();
}

{
  const store = openEventStore(join(dir, 'round-trip.db'));
  check(
    throwsMatching(() => insertEvents(store, [event()]), /requires an active database transaction/),
    'insertEvents rejects writes outside a transaction',
  );
  check(readEvents(store).length === 0, 'rejected insertEvents writes no event');
  const ids = appendEvents(store, [event({
    occurred_at: '2030-01-04T14:30:00Z',
    application_id: 'app-1',
    payload: { score: 1.23, recommendation: 'apply' },
  })]);
  const rows = readEvents(store);
  check(ids.length === 1 && Number.isInteger(ids[0]) && ids[0] > 0, 'a valid event returns its new id');
  check(rows.length === 1 && rows[0].id === ids[0], 'the appended event can be read');
  check(rows[0].payload.score === 1.23 && rows[0].payload.recommendation === 'apply', 'payload round-trips as an object');
  check(typeof rows[0].recorded_at === 'string' && rows[0].recorded_at.length > 0, 'appendEvents sets recorded_at');
  store.close();
}

{
  const store = openEventStore(join(dir, 'corrections.db'));
  const missing = throwsMatching(() => appendEvents(store, [
    event({ dedupe_key: 'before-missing-correction' }),
    event({ type: 'event_undone', corrects_event_id: 999999 }),
  ]), /FOREIGN KEY|foreign key/i);
  check(missing, 'a missing corrects_event_id throws');
  check(readEvents(store).length === 0, 'a missing corrects_event_id rolls back the whole batch');

  const [originalId] = appendEvents(store, [event({ dedupe_key: 'original-event' })]);
  const [correctionId] = appendEvents(store, [event({
    type: 'event_undone',
    corrects_event_id: originalId,
  })]);
  const correction = readEvents(store).find(row => row.id === correctionId);
  check(correction?.corrects_event_id === originalId, 'a valid corrects_event_id pointing at an earlier event succeeds');
  store.close();
}

{
  const store = openEventStore(join(dir, 'filters.db'));
  appendEvents(store, [
    event({ type: 'note_added', occurred_on: '2030-01-03', application_id: 'app-a', person_id: 'person-a' }),
    event({ type: 'status_changed', occurred_on: '2030-01-02', application_id: 'app-b', person_id: 'person-b' }),
    event({ type: 'note_added', occurred_on: '2030-01-03', application_id: 'app-b', person_id: 'person-a' }),
  ]);
  const all = readEvents(store);
  check(all.map(row => row.type).join(',') === 'status_changed,note_added,note_added', 'events order by occurred_on and then id');
  check(readEvents(store, { type: 'note_added' }).length === 2, 'type filter works');
  check(readEvents(store, { applicationId: 'app-b' }).length === 2, 'applicationId filter works');
  check(readEvents(store, { personId: 'person-a' }).length === 2, 'personId filter works');
  check(readEvents(store, { type: 'note_added', applicationId: 'app-b', personId: 'person-a' }).length === 1, 'filters combine');
  store.close();
}

{
  const store = openEventStore(join(dir, 'append-only.db'));
  const [id] = appendEvents(store, [event({ payload: { state: 'original' } })]);
  check(
    throwsMatching(() => store.db.prepare('UPDATE events SET source = ? WHERE id = ?').run('import', id), /append-only/),
    'direct updates are rejected with append-only',
  );
  check(
    throwsMatching(() => store.db.prepare('DELETE FROM events WHERE id = ?').run(id), /append-only/),
    'direct deletes are rejected with append-only',
  );
  const [row] = readEvents(store);
  check(row.source === 'cli' && row.payload.state === 'original', 'the protected row remains unchanged');
  store.close();
}

{
  const store = openEventStore(join(dir, 'migration-four-tables.db'));
  const tables = store.db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('legacy_render_state', 'id_counters')
    ORDER BY name
  `).all().map(row => row.name);
  check(tables.join(',') === 'id_counters,legacy_render_state', 'migration 4 creates both mutable state tables');
  store.db.prepare('INSERT INTO legacy_render_state (file, dirty) VALUES (?, ?)').run('applications.md', 1);
  store.db.prepare('UPDATE legacy_render_state SET dirty = 0 WHERE file = ?').run('applications.md');
  store.db.prepare('DELETE FROM legacy_render_state WHERE file = ?').run('applications.md');
  store.db.prepare('INSERT INTO id_counters (name, value) VALUES (?, ?)').run('example_ids', 900001);
  store.db.prepare('UPDATE id_counters SET value = ? WHERE name = ?').run(900002, 'example_ids');
  store.db.prepare('DELETE FROM id_counters WHERE name = ?').run('example_ids');
  check(store.db.prepare('SELECT COUNT(*) AS n FROM legacy_render_state').get().n === 0
    && store.db.prepare('SELECT COUNT(*) AS n FROM id_counters').get().n === 0,
  'migration 4 tables accept UPDATE and DELETE');
  store.close();
}

{
  const dbPath = join(dir, 'reserve-ids.db');
  let store = openEventStore(dbPath);
  check(reserveIds(store, 'example_ids', 3).join(',') === '1,2,3', 'reserveIds hands out consecutive ids');
  check(reserveIds(store, 'example_ids', 2, 900001).join(',') === '900002,900003', 'reserveIds honors its floor');
  store.close();
  store = openEventStore(dbPath);
  check(reserveIds(store, 'example_ids').join(',') === '900004', 'reserveIds survives reopening the database');
  check(throwsMatching(() => reserveIds(store, 'Example-Bad'), /name must match/), 'reserveIds rejects bad names');
  check(throwsMatching(() => reserveIds(store, 'example_ids', 0), /positive integer/)
    && throwsMatching(() => reserveIds(store, 'example_ids', 1.5), /positive integer/),
  'reserveIds rejects bad counts');
  check(throwsMatching(() => reserveIds(store, 'example_ids', 1, -1), /non-negative integer/), 'reserveIds rejects a bad floor');
  store.close();
}

{
  const store = openEventStore(join(dir, 'validate-first.db'));
  const rejected = throwsMatching(() => appendEvents(store, [
    event({ dedupe_key: 'valid-1' }),
    event({ dedupe_key: 'valid-2' }),
    event({ source: 'invalid-source' }),
  ]), /events\[2\]\.source/);
  check(rejected, 'an invalid third event names its index and field');
  check(readEvents(store).length === 0, 'validation failure writes nothing from the batch');
  store.close();
}

{
  const store = openEventStore(join(dir, 'dedupe.db'));
  const within = throwsMatching(() => appendEvents(store, [
    event({ dedupe_key: 'same-batch' }),
    event({ dedupe_key: 'same-batch' }),
  ]), /UNIQUE|unique/i);
  check(within, 'duplicate dedupe_key values within a batch throw');
  check(readEvents(store).length === 0, 'an in-batch duplicate rolls back the whole batch');

  appendEvents(store, [event({ dedupe_key: 'earlier' })]);
  const againstEarlier = throwsMatching(() => appendEvents(store, [
    event({ dedupe_key: 'new-in-batch' }),
    event({ dedupe_key: 'earlier' }),
  ]), /UNIQUE|unique/i);
  check(againstEarlier, 'a dedupe_key from an earlier batch throws');
  const rows = readEvents(store);
  check(rows.length === 1 && rows[0].dedupe_key === 'earlier', 'earlier-batch duplicate rolls back new rows only');
  store.close();
}

{
  const cases = [
    ['type', event({ type: 'unknown' })],
    ['source', event({ source: 'unknown' })],
    ['channel', event({ channel: 'sms' })],
    ['occurred_on', event({ occurred_on: '2030-02-30' })],
    ['definitions_version', event({ definitions_version: '' })],
    ['extra', event({ extra: true })],
  ];
  for (const [field, invalidEvent] of cases) {
    const store = openEventStore(join(dir, `reject-${field}.db`));
    check(
      throwsMatching(() => appendEvents(store, [invalidEvent]), new RegExp(`events\\[0\\]\\.${field}`)),
      `${field} validation rejects the event and names the field`,
    );
    check(readEvents(store).length === 0, `${field} validation writes no row`);
    store.close();
  }
}

{
  const dbPath = join(dir, 'reopen.db');
  let store = openEventStore(dbPath);
  appendEvents(store, [event({ dedupe_key: 'persistent' })]);
  store.close();
  store = openEventStore(dbPath);
  check(readEvents(store).length === 1, 'closing and reopening preserves events');
  check(store.db.prepare('PRAGMA user_version').get().user_version === SCHEMA_VERSION, 'reopening keeps user_version at SCHEMA_VERSION');
  store.close();
}

{
  const dbPath = join(dir, 'future.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
  db.close();
  check(
    throwsMatching(() => openEventStore(dbPath), /newer than supported/),
    'a database above SCHEMA_VERSION is rejected',
  );
}

{
  const dbPath = join(dir, 'version-three.db');
  const db = new DatabaseSync(dbPath);
  for (const migration of MIGRATIONS.slice(0, 3)) db.exec(migration);
  db.exec('PRAGMA user_version = 3');
  db.prepare(`
    INSERT INTO events (type, occurred_on, recorded_at, source, payload, definitions_version)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('posting_evaluated', '2030-01-04', '2030-01-04T00:00:00.000Z', 'cli', '{}', 'test-v1');
  db.close();
  const store = openEventStore(dbPath);
  check(store.db.prepare('PRAGMA user_version').get().user_version === 4, 'reopening a version 3 database migrates it to version 4');
  check(readEvents(store).length === 1, 'version 3 migration preserves existing event rows');
  store.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
