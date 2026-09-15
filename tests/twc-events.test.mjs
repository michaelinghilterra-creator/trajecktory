#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('twc-events');
process.env.TJK_DATA_DIR = sandbox;

const { readEvents, addEvent, deleteEvent } = await import('../dashboard-web/server/lib/twc-events.mjs');

let passed = 0, failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  ✅ ${message}`); passed += 1; }
  else { console.log(`  ❌ ${message}`); failed += 1; }
};

console.log('twc-events.test.mjs');

check(readEvents().length === 0, 'a missing events file returns an empty list');
fs.writeFileSync(path.join(sandbox, 'twc-events.json'), '{bad json');
check(readEvents().length === 0, 'an invalid events file returns an empty list');

const valid = {
  date: '2026-09-10',
  type: 'Networking event or job club',
  organizer: 'North Loop Job Club',
  contact: 'Taylor Reed',
  method: 'In person',
  notes: 'Practiced interview introductions',
};

check(addEvent({ ...valid, date: 'September 10' }).ok === false, 'a bad date is rejected');
check(addEvent({ ...valid, type: 'Lunch' }).ok === false, 'a bad type is rejected');
check(addEvent({ ...valid, notes: 'x'.repeat(501) }).ok === false, 'over-long notes are rejected');
check(addEvent({ ...valid, organizer: 'North Loop\nJob Club' }).ok === false, 'control characters are rejected');

const added = addEvent({ ...valid, date: ' 2026-09-10 ', type: ' Networking event or job club ',
  organizer: '  North Loop Job Club  ', contact: '  Taylor Reed  ', method: ' In person ' });
const stored = readEvents();
check(added.ok && added.event.id && stored.length === 1, 'a valid event is added and can be read');
check(stored[0].organizer === 'North Loop Job Club' && stored[0].contact === 'Taylor Reed', 'stored strings are trimmed');
check(deleteEvent(added.event.id) === true && readEvents().length === 0, 'the added event can be deleted');
check(deleteEvent(added.event.id) === false, 'deleting a missing event reports no removal');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
