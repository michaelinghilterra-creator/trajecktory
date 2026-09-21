#!/usr/bin/env node
import { join } from 'node:path';
import { openEventStore } from '../lib/event-store.mjs';
import { appendEventsWithEffects, renderLegacyFile } from '../lib/legacy-files.mjs';
import { buildVoidEvent } from '../lib/void-events.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
function throws(fn) {
  try { fn(); return false; } catch { return true; }
}
let seq = 0;
function liveEvent(effects) {
  seq += 1;
  return {
    type: 'note_added',
    occurred_on: '2030-08-09',
    source: 'cli',
    definitions_version: 'fixture-v1',
    dedupe_key: `fixture-nested-append-${seq}`,
    payload: { legacy_effects: effects },
  };
}

console.log('legacy-files-nested-append.test.mjs');
const root = makeSandbox('legacy-files-nested-append-test');
const store = openEventStore(join(root, 'store.db'));

function renderedDoc() {
  return JSON.parse(renderLegacyFile(store, 'app-notes.json'));
}

// 1. Append into a new key.
const itemOne = { timestamp: '2030-01-01T00:00:00.000Z', text: 'Invented note one' };
const [firstId] = appendEventsWithEffects(store, [
  liveEvent([{ file: 'app-notes.json', op: 'json_nested_append', key: '900001', item: itemOne }]),
]);
check(Array.isArray(renderedDoc()['900001']), 'key 900001 exists as an array after the first append');
check(renderedDoc()['900001'].length === 1, 'key 900001 has one item after the first append');
check(JSON.stringify(renderedDoc()['900001'][0]) === JSON.stringify(itemOne), 'the appended item matches what was sent');

// 2. Append into an existing key.
const itemTwo = { timestamp: '2030-01-02T00:00:00.000Z', text: 'Invented note two' };
appendEventsWithEffects(store, [
  liveEvent([{ file: 'app-notes.json', op: 'json_nested_append', key: '900001', item: itemTwo }]),
]);
check(renderedDoc()['900001'].length === 2, 'key 900001 has two items after the second append');
check(renderedDoc()['900001'][0].text === 'Invented note one' && renderedDoc()['900001'][1].text === 'Invented note two', 'items are in append order');

// 3. Two different keys don't collide.
const itemThree = { timestamp: '2030-01-03T00:00:00.000Z', text: 'Invented note three' };
appendEventsWithEffects(store, [
  liveEvent([{ file: 'app-notes.json', op: 'json_nested_append', key: '900002', item: itemThree }]),
]);
check(renderedDoc()['900001'].length === 2, 'key 900001 is unaffected by a different key');
check(renderedDoc()['900002'].length === 1, 'key 900002 has its own one item');

// 4. Voiding the leader event drops its append on replay.
appendEventsWithEffects(store, [
  buildVoidEvent({
    target_event_id: firstId,
    reason_code: 'erroneous_entry',
    actor: 'agent',
    evidence_ref: 'fixture:legacy-files-nested-append-test',
    occurred_on: '2030-08-10',
    definitions_version: 'fixture-v1',
  }),
]);
check(renderedDoc()['900001'].length === 1, 'voiding the first append drops it from the replay');
check(renderedDoc()['900001'][0].text === 'Invented note two', 'only the second (unvoided) item remains under 900001');
check(renderedDoc()['900002'].length === 1, 'an unrelated key is untouched by the void');

// 5. Validation rejects a missing key.
check(throws(() => appendEventsWithEffects(store, [
  liveEvent([{ file: 'app-notes.json', op: 'json_nested_append', item: itemOne }]),
])), 'json_nested_append with no key throws');

// 6. Validation rejects a missing item.
check(throws(() => appendEventsWithEffects(store, [
  liveEvent([{ file: 'app-notes.json', op: 'json_nested_append', key: '900003' }]),
])), 'json_nested_append with no item throws');

// 7. Validation rejects a non-array value at the target key.
appendEventsWithEffects(store, [
  liveEvent([{ file: 'app-notes.json', op: 'json_set', key: '900004', value: 'not an array' }]),
]);
check(throws(() => appendEventsWithEffects(store, [
  liveEvent([{ file: 'app-notes.json', op: 'json_nested_append', key: '900004', item: itemOne }]),
])), 'json_nested_append onto a non-array existing value throws');

console.log(`legacy-files-nested-append.test.mjs: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
