#!/usr/bin/env node
/**
 * connects.test.mjs — the LinkedIn connects ledger writer (lib/connects.mjs).
 *
 * The durable identity of a connect is (contact id, source), not the name string.
 * These lock the three things that matter and are silent when wrong:
 *  1. logConnect records the id when given, and omits it (not null) when not.
 *  2. Idempotency is id-keyed when an id is present: the same invite logged twice
 *     is one row, even if the name text differs between the two calls.
 *  3. Legacy name-keyed entries still dedup by name when no id is supplied.
 *
 * Run: node tests/connects.test.mjs   (exit 0 = pass, 1 = fail)
 */
import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

const tmp = makeSandbox('connects');
process.env.TJK_DATA_DIR = tmp;

const { logConnect, readConnects, connectKey } = await import('../dashboard-web/server/lib/connects.mjs');
const LEDGER = path.join(tmp, 'linkedin-connects.json');

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };

console.log('connects.test.mjs');
try {
  // 1. An id is stored when supplied.
  logConnect({ name: 'Rich Roe', source: 'ta', id: 302, date: '2026-07-25' });
  let list = readConnects();
  check(list.length === 1 && list[0].id === 302, 'logConnect stores the contact id when given');

  // 2. Idempotent by id even when the NAME text differs between calls.
  logConnect({ name: 'R. Roe', source: 'ta', id: 302, date: '2026-07-25' });
  list = readConnects();
  check(list.length === 1, 'the same (date, id, source) is one row despite a different name string');

  // 3. A different id on the same day is a distinct connect.
  logConnect({ name: 'Jane Doe', source: 'ta', id: 301, date: '2026-07-25' });
  list = readConnects();
  check(list.length === 2, 'a different contact id on the same day is a separate connect');

  // 4. No id supplied → the field is omitted (not stored as null), and dedup is by name.
  logConnect({ name: 'Ghost Lead', source: 'ta', date: '2026-07-26' });
  logConnect({ name: 'Ghost Lead', source: 'ta', date: '2026-07-26' });
  list = readConnects();
  const ghost = list.filter(e => e.name === 'Ghost Lead');
  check(ghost.length === 1, 'an id-less connect dedups by name, staying one row');
  check(!('id' in ghost[0]), 'an id-less connect omits the id field rather than storing null');

  // 5. connectKey uses id when present, name otherwise.
  check(connectKey({ date: '2026-07-25', id: 302, source: 'ta' }) === '2026-07-25|id:302|ta',
    'connectKey is id-keyed when an id is present');
  check(connectKey({ date: '2026-07-26', name: 'Ghost Lead', source: 'ta' }) === '2026-07-26|nm:ghostlead|ta',
    'connectKey falls back to the normalized name when there is no id');

  // 6. readConnects returns null when the ledger does not exist (so the metric reads
  // "not logged", never a false zero).
  fs.rmSync(LEDGER, { force: true });
  check(readConnects() === null, 'readConnects returns null when no ledger file exists');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
