#!/usr/bin/env node
/**
 * auto-close-stale.test.mjs — pins the phantom-pipeline auto-close eligibility.
 *
 * findStaleApplied selects rows that are BOTH cold ("Applied", never past Applied)
 * AND stale (applied >= N calendar days ago). It must never select a warm row (any
 * reply or interview ever) or a row that is already closed. Pure: rows, applyDates,
 * and a fixed `today` are injected, no files or clock.
 *
 * Run: node tests/auto-close-stale.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { findStaleApplied, calendarDaysAgo } from '../auto-close-stale.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('auto-close-stale.test.mjs');

const TODAY = new Date('2026-07-24T12:00:00');
// calendarDaysAgo sanity
check(calendarDaysAgo('2026-07-03', TODAY) === 21, '2026-07-03 is 21 days before 2026-07-24');
check(calendarDaysAgo('2026-07-24', TODAY) === 0, 'same day is 0 days');
check(calendarDaysAgo('not-a-date', TODAY) === null, 'a bad date returns null');

// Invented rows in parseApplicationsMd shape (id, status, reached, company, notes).
const r = (o) => ({ id: o.id, status: o.status, reached: o.reached ?? null, company: o.company, role: o.role || 'Ops Lead', date: o.date || '2026-05-01', notes: o.notes || '' });
const rows = [
  r({ id: 1, status: 'Applied', reached: 'Applied', company: 'Kestrel' }),                 // 25d → eligible
  r({ id: 2, status: 'Applied', reached: 'Applied', company: 'Northwind' }),               // 10d → too fresh
  r({ id: 3, status: 'Applied', reached: 'Responded', company: 'Bexad' }),                  // warm (replied) → never
  r({ id: 4, status: 'Responded', reached: 'Responded', company: 'Cobalt' }),               // not Applied → skip
  r({ id: 5, status: 'No Response', reached: 'Applied', company: 'Vela' }),                  // already closed → skip
  r({ id: 6, status: 'Applied', reached: 'Applied', company: 'Meridian', date: '2026-06-29' }), // no apply-date → tracker-date fallback, 25d → eligible
  r({ id: 7, status: 'Applied', reached: '1st Interview', company: 'Aster' }),               // warm (HM interview) → never
  r({ id: 8, status: 'Applied', reached: 'Applied', company: 'Delta' }),                     // exactly 21d → eligible
  r({ id: 9, status: 'Applied', reached: 'Applied', company: 'Umbra' }),                     // 20d → one short
  r({ id: 10, status: 'Applied', reached: 'Applied', company: 'Sable', notes: 'remote [self-sourced]' }), // 30d self-sourced → eligible + flagged
];
const applyDates = {
  '1': '2026-06-29',  // 25d
  '2': '2026-07-14',  // 10d
  '3': '2026-06-01',
  '4': '2026-06-01',
  '7': '2026-06-01',
  '8': '2026-07-03',  // 21d
  '9': '2026-07-04',  // 20d
  '10': '2026-06-24', // 30d
  // no entry for 6 → falls back to its tracker date 2026-06-29 (25d)
};

const stale = findStaleApplied(rows, applyDates, { today: TODAY, days: 21 });
const ids = stale.map(s => s.id);

check(JSON.stringify([...ids].sort((a, b) => a - b)) === JSON.stringify([1, 6, 8, 10]),
  `selects exactly the cold+stale rows {1,6,8,10} (got ${JSON.stringify(ids)})`);
check(!ids.includes(2), '#2 applied 10d ago is too fresh → not closed');
check(!ids.includes(3), '#3 reached Responded (warm) → never closed');
check(!ids.includes(4), '#4 status Responded (not Applied) → skipped');
check(!ids.includes(5), '#5 already No Response → skipped');
check(!ids.includes(7), '#7 reached 1st Interview (warm) → never closed');
check(!ids.includes(9), '#9 applied 20d ago is one day short of 21 → not closed');

const six = stale.find(s => s.id === 6);
check(six && six.anchorSource === 'tracker-date', '#6 with no apply-date uses the tracker date as the anchor');
const one = stale.find(s => s.id === 1);
check(one && one.anchorSource === 'apply-date' && one.daysSince === 25, '#1 uses its apply-date anchor (25d)');
const ten = stale.find(s => s.id === 10);
check(ten && ten.selfSourced === true, '#10 is flagged self-sourced so it can be eyeballed in the dry run');

// sorted by days-silent descending (stalest first)
check(stale[0].daysSince >= stale[stale.length - 1].daysSince, 'output is sorted stalest-first');

// threshold is honored: at 26 days only the 30d and 25d ones… actually only >=26
const strict = findStaleApplied(rows, applyDates, { today: TODAY, days: 26 });
check(JSON.stringify(strict.map(s => s.id).sort((a, b) => a - b)) === JSON.stringify([10]),
  `a 26-day threshold selects only the 30d row #10 (got ${JSON.stringify(strict.map(s => s.id))})`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
