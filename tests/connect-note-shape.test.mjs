#!/usr/bin/env node
/**
 * connect-note-shape.test.mjs pins the one-line connection-note contract and
 * its ordering with the 300-character fitter.
 *
 * Run: node tests/connect-note-shape.test.mjs   (exit 0 = pass, 1 = fail)
 */

import {
  flattenConnectNote,
  fitConnectNote,
} from '../dashboard-web/server/lib/linkedin-ssi.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('connect-note-shape.test.mjs');

check(
  flattenConnectNote('Hi Avery, Example Labs caught my eye.\n\nThanks, Jordan')
    === 'Hi Avery, Example Labs caught my eye. Thanks, Jordan',
  'blank line before the sign-off becomes exactly one space',
);
check(
  flattenConnectNote('Hi Avery,\nExample Labs\r\nlooks interesting.\nThanks, Jordan')
    === 'Hi Avery, Example Labs looks interesting. Thanks, Jordan',
  'several line breaks become one line',
);
check(
  flattenConnectNote('Hi Avery, Example Labs caught my eye. Thanks, Jordan')
    === 'Hi Avery, Example Labs caught my eye. Thanks, Jordan',
  'an existing one-line note is unchanged',
);
check(flattenConnectNote('Hi  Avery,   thanks.') === 'Hi Avery, thanks.', 'repeated spaces collapse to one');
check(flattenConnectNote('  Hi Avery.  ') === 'Hi Avery.', 'outer whitespace is trimmed');

for (const value of ['', null, undefined]) {
  let result;
  let threw = false;
  try { result = flattenConnectNote(value); } catch { threw = true; }
  check(!threw && result === '', `${String(value)} safely becomes an empty string`);
}

const body = 'a'.repeat(280);
const rawUnderOnlyAfterFlatten = `${body}\n\n\n\n\n\n\n\n\n\nThanks, Jordan`;
const flattenedUnderCap = flattenConnectNote(rawUnderOnlyAfterFlatten);
const fittedUnderCap = fitConnectNote(flattenedUnderCap, 'Jordan');
check(rawUnderOnlyAfterFlatten.length > 300, 'ordering fixture starts over the cap');
check(flattenedUnderCap.length < 300, 'ordering fixture falls under the cap only after flattening');
check(fittedUnderCap.text === flattenedUnderCap, 'flattening before fitting avoids unnecessary trimming');

const longRaw = `Hi Avery,\n\n${'Example Systems work is relevant to revenue analytics. '.repeat(8)}\n\nThanks, Jordan`;
const fittedLong = fitConnectNote(flattenConnectNote(longRaw), 'Jordan');
check(/Thanks, Jordan$/.test(fittedLong.text), 'long flattened note keeps the sign-off after trimming');
check(!/[\r\n]/.test(fittedLong.text), 'long fitted note contains no newline');
check(fittedLong.length === fittedLong.text.length, 'reported length matches the returned text');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
