#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DATABASE_FILE,
  SWITCH_FILE,
  readEventStoreSwitch,
} from '../lib/event-store-switch.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

console.log('event-store-switch.test.mjs');
const dir = makeSandbox('event-store-switch-test');
check(SWITCH_FILE === 'event-store.json' && DATABASE_FILE === 'trajecktory.db', 'file constants are exact');
check(JSON.stringify(readEventStoreSwitch(dir)) === JSON.stringify({ writes: 'off', flipped_at: null, state: 'missing' }), 'missing switch is safely off');
writeFileSync(join(dir, SWITCH_FILE), '{not json', 'utf8');
check(readEventStoreSwitch(dir).writes === 'off' && readEventStoreSwitch(dir).state === 'invalid', 'invalid JSON is safely off');
writeFileSync(join(dir, SWITCH_FILE), JSON.stringify({ writes: 'yes', flipped_at: '2030-02-03T00:00:00.000Z' }), 'utf8');
check(readEventStoreSwitch(dir).writes === 'off' && readEventStoreSwitch(dir).state === 'invalid', 'unknown writes value is safely off');
writeFileSync(join(dir, SWITCH_FILE), JSON.stringify({ writes: 'off', flipped_at: null }), 'utf8');
check(readEventStoreSwitch(dir).writes === 'off' && readEventStoreSwitch(dir).state === 'ok', 'exact off switch is valid and disabled');
writeFileSync(join(dir, SWITCH_FILE), JSON.stringify({ writes: 'on', flipped_at: '2030-02-03T00:00:00.000Z' }), 'utf8');
const enabled = readEventStoreSwitch(dir);
check(enabled.writes === 'on' && enabled.state === 'ok' && enabled.flipped_at === '2030-02-03T00:00:00.000Z', 'exact on switch is accepted');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
