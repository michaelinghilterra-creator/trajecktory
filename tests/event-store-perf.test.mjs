#!/usr/bin/env node

import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { appendEvents, openEventStore } from '../lib/event-store.mjs';
import { appendEventsWithEffects, renderDirty, renderLegacyFile } from '../lib/legacy-files.mjs';
import { resetLogWritesCache, withLogRead, withLogWrite } from '../lib/log-writes.mjs';
import { DATABASE_FILE, SWITCH_FILE } from '../lib/event-store-switch.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

function event(payload = {}, suffix = '') {
  return {
    type: 'legacy_record',
    occurred_on: '2030-09-17',
    source: 'import',
    definitions_version: 'fixture-v1',
    dedupe_key: suffix ? `fixture-${suffix}` : undefined,
    payload,
  };
}

console.log('event-store-perf.test.mjs');
const dataDir = makeSandbox('event-store-perf');
const dbPath = join(dataDir, DATABASE_FILE);
writeFileSync(join(dataDir, SWITCH_FILE), JSON.stringify({
  writes: 'on', flipped_at: '2030-09-17T12:00:00.000Z',
}));
const store = openEventStore(dbPath);

const correspondenceCount = 900;
const contactCount = 1000;
const rows = [];
for (let index = 0; index < contactCount; index++) {
  const id = 900001 + index;
  rows.push(`| ${id} | Zorblax Widgetry | Personone | Example |  | Example Cog Lead |  |  |  |  | example.personone@example.test | https://example.test/person/${id} | Not Connected |  | Invented note | https://example.test/ |`);
}

const correspondenceEvents = [];
const expectedCorrespondence = new Map();
for (let index = 0; index < correspondenceCount; index++) {
  const id = 900001 + index;
  const raw = `## 2030-09-17 12:00 | Sent | Invented subject ${id}\n\nInvented body for Example Personone ${id}.\n`;
  expectedCorrespondence.set(`target-talent-correspondence/${id}.md`, raw);
  correspondenceEvents.push(event({
    reason: 'correspondence_import',
    dir: 'target-talent-correspondence',
    file: `${id}.md`,
    segment_index: 0,
    raw,
  }, `correspondence-${id}`));
}
appendEvents(store, correspondenceEvents);

appendEventsWithEffects(store, [event({
  reason: 'bulk_contacts',
  legacy_effects: rows.map((raw, index) => ({
    file: 'target-talent.md',
    op: 'row_upsert',
    row_id: `target-talent.md#n-${900001 + index}`,
    raw,
    anchor: { at: 'table_end' },
  })),
}, 'contacts')]);

const jsonValue = { 900001: { state: 'Invite Pending', updated: '2030-09-17' } };
appendEventsWithEffects(store, [event({
  reason: 'linkedin_state_fixture',
  legacy_effects: [{ file: 'tt-linkedin.json', op: 'json_replace', value: jsonValue }],
}, 'json')]);

const paddingCount = 20000 - correspondenceCount - 2;
const padding = Array.from({ length: paddingCount }, (_, index) => event({
  reason: 'invented_padding',
  company: index % 2 ? 'Zorblax Widgetry' : 'Quennox Ratchet Works',
  role: `Example Cog Lead`,
  score: '0.01',
}, `padding-${index}`));
appendEvents(store, padding);
check(store.db.prepare('SELECT COUNT(*) AS n FROM events').get().n === 20000,
  'realistic fixture contains 20,000 events');

const lookupSql = `
  SELECT events.id, events.payload
  FROM event_files
  JOIN events ON events.id = event_files.event_id
  WHERE event_files.file = ?
  ORDER BY events.id
`;
const plan = store.db.prepare(`EXPLAIN QUERY PLAN ${lookupSql}`)
  .all('target-talent-correspondence/900001.md')
  .map(row => row.detail);
console.log(`  MEASURE plan: ${plan.join(' | ')}`);
check(!plan.some(detail => /^SCAN events\b/.test(detail)),
  'correspondence query plan does not scan events');

const renderStarted = performance.now();
const renderedOne = renderLegacyFile(store, 'target-talent-correspondence/900001.md');
const renderMs = performance.now() - renderStarted;
console.log(`  MEASURE one correspondence render: ${renderMs.toFixed(3)} ms`);
check(renderedOne === expectedCorrespondence.get('target-talent-correspondence/900001.md') && renderMs < 2,
  'one correspondence file renders byte identically in under 2 ms');

const initialRender = renderDirty(store, dataDir);
check(initialRender.failed.length === 0, 'initial realistic projections render without failures');
store.close();
resetLogWritesCache();
const readUsesNoWriteTransaction = withLogRead(dataDir, active => !active.db.isTransaction);
console.log(`  MEASURE top-level read write transactions: ${readUsesNoWriteTransaction ? '0' : '1'}`);
check(readUsesNoWriteTransaction, 'top-level read does not open a write transaction');
const loopStarted = performance.now();
let totalMessages = 0;
for (let index = 0; index < contactCount; index++) {
  const id = 900001 + index;
  const text = withLogRead(dataDir, active => renderLegacyFile(
    active, `target-talent-correspondence/${id}.md`,
  ));
  if (text !== null) totalMessages++;
}
const loopMs = performance.now() - loopStarted;
console.log(`  MEASURE 1,000 contact read loop: ${loopMs.toFixed(3)} ms`);
check(totalMessages === correspondenceCount && loopMs < 5000,
  '1,000 contact switch-on read loop completes in under 5 seconds');

const header = '# Target Talent\n\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n|---|---------|------|-------|--------|-------|------|-------|-----|-------|-------|----------|--------|------------|-------|---------|\n';
const expectedTable = `${header}${rows.join('\n')}\n`;
const expectedJson = JSON.stringify(jsonValue, null, 2);
let identical = 0;
for (const [file, expected] of expectedCorrespondence) {
  if (withLogRead(dataDir, active => renderLegacyFile(active, file)) === expected) identical++;
}
if (withLogRead(dataDir, active => renderLegacyFile(active, 'target-talent.md')) === expectedTable) identical++;
if (withLogRead(dataDir, active => renderLegacyFile(active, 'tt-linkedin.json')) === expectedJson) identical++;
console.log(`  MEASURE byte-identical projections: ${identical}/${correspondenceCount + 2}`);
check(identical === correspondenceCount + 2,
  'all correspondence, table, and JSON projections are byte identical');

let uncommittedVisible = false;
let cacheInvalidated = false;
withLogWrite(dataDir, active => {
  const file = 'target-talent-correspondence/900001.md';
  const before = renderLegacyFile(active, file);
  const replacement = 'Invented uncommitted replacement for Example Personone.\n';
  appendEventsWithEffects(active, [event({
    legacy_effects: [{ file, op: 'file_replace', raw: replacement }],
  }, 'uncommitted')]);
  const nestedRead = withLogRead(dataDir, joined => renderLegacyFile(joined, file));
  uncommittedVisible = nestedRead === replacement;
  cacheInvalidated = before !== replacement && nestedRead !== before;
});
console.log(`  MEASURE uncommitted read visibility: ${uncommittedVisible ? '1/1' : '0/1'}`);
check(uncommittedVisible, 'read inside write sees the same transaction uncommitted change');
console.log(`  MEASURE projection cache invalidation: ${cacheInvalidated ? '1/1' : '0/1'}`);
check(cacheInvalidated, 'write invalidates a memoized projection in the same transaction');

resetLogWritesCache();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
