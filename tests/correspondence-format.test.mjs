#!/usr/bin/env node
/**
 * correspondence-format.test.mjs: the shared on-disk format for both contact
 * message logs.
 *
 * The two stores used to carry their own regex for this format and the two
 * disagreed, under-counting outreach in two different ways: one parser dropped a
 * variant-cased entry entirely, the other kept it but preserved the casing, and
 * every consumer downstream compares direction === 'Sent' exactly. Normalization
 * on BOTH read and write is the fix, so both directions are asserted here.
 *
 * Run: node tests/correspondence-format.test.mjs   (exit 0 = pass)
 */
import { parseCorrespondence, formatCorrespondence } from '../dashboard-web/server/lib/correspondence-format.mjs';

let passed = 0, failed = 0;
const check = (cond, msg) => {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('correspondence-format.test.mjs');

console.log('\n1. Reading normalizes direction and channel');
const text = [
  '## 2026-08-01 | SENT | LINKEDIN | Upper case',
  '',
  'First body',
  '# This heading stays in the body',
  '',
  '## 2026-08-02 09:45 | sent | Linked In | Spaced channel',
  '',
  'Second body',
  '',
  '## 2026-08-03 | Received | Missing channel',
  '',
  'Third body',
  '',
  '## 2026-08-04 | ignored | Email | Unknown direction',
  '',
  'This entry is skipped',
  '',
].join('\n');

const parsed = parseCorrespondence(text);
check(parsed.length === 3, 'an unrecognized direction is skipped, leaving 3 of 4 entries');
check(same(parsed.map(m => m.direction), ['Sent', 'Sent', 'Received']),
  'SENT and sent both normalize to Sent');
check(same(parsed.map(m => m.channel), ['LinkedIn', 'LinkedIn', 'Email']),
  'LINKEDIN and "Linked In" normalize to LinkedIn, and a missing channel is Email');
check(same(parsed.map(m => m.timestamp), ['2026-08-01', '2026-08-02 09:45', '2026-08-03']),
  'timestamps survive with and without a time component');
// A body line starting with # must not be mistaken for the next entry. Only a
// line starting with "## " ends a body, and real message bodies contain headings.
check(/^First body\n# This heading stays in the body$/.test(parsed[0].body),
  'a body line beginning with # does not split the entry');

console.log('\n2. Writing normalizes too');
// Without this, a caller handing over a variant spelling persists it, re-creating
// the exact defect the module exists to remove. Normalizing only on read would
// leave the bad spelling on disk for the next reader of the raw file.
const out = formatCorrespondence([{ timestamp: '2026-08-01', direction: 'SENT', channel: 'LINKEDIN', subject: 's', body: 'b' }]);
check(out === '## 2026-08-01 | Sent | LinkedIn | s\n\nb\n',
  'a variant-spelled message is written in canonical form');
check(formatCorrespondence([{ timestamp: '2026-08-01', direction: 'Sent', channel: 'Email', subject: 's', body: 'b' }])
  === '## 2026-08-01 | Sent | s\n\nb\n',
  'Email is the implied default and is not written, matching legacy rows');
// Draft is the safe fallback: it is the one direction that is not outbound, so it
// can neither satisfy nor trip an outreach guardrail. Defaulting to Sent would
// invent a touch the user never made.
check(formatCorrespondence([{ timestamp: '2026-08-01', direction: 'garbage', channel: '', subject: 's', body: 'b' }])
  .startsWith('## 2026-08-01 | Draft | s'),
  'an unrecognized direction is written as Draft, never as Sent');

console.log('\n3. Round trip is stable');
check(same(parseCorrespondence(formatCorrespondence(parsed)), parsed),
  'parse then format then parse returns an identical array');

console.log(`\n${failed === 0 ? '🟢' : '🔴'} correspondence-format: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
