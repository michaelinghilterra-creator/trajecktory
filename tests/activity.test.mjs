#!/usr/bin/env node
/**
 * activity.test.mjs — actions over time + application cohorts (lib/activity.mjs).
 *
 * Two things worth locking here, both silent when wrong.
 *
 * 1. WEEK BOUNDARIES. weekStartOf parses date-only strings as UTC on purpose. A
 *    local-time parse shifts them by a day for anyone west of UTC, which moves
 *    Sunday's applications into the previous week's cohort. The cohort table would
 *    still render, still add up, and still be wrong.
 *
 * 2. NOT-LOGGED IS NOT ZERO. Touches and connects have no log yet, and they must
 *    report available:false rather than a zero series. A flat zero line reads as
 *    "you did nothing"; the truth is "nothing is recording this yet", and only one
 *    of those is the user's fault.
 *
 * Run: node tests/activity.test.mjs   (exit 0 = pass, 1 = fail)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

// Sandbox before the module loads: config.mjs resolves DATA_DIR at import time,
// and reading the real apply-dates.json would make assertions depend on live data.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-activity-'));
process.env.TJK_DATA_DIR = tmp;
fs.writeFileSync(path.join(tmp, 'apply-dates.json'), JSON.stringify({
  101: '2026-06-15',  // Mon
  102: '2026-06-21',  // Sun, same ISO week as 101
  103: '2026-06-22',  // Mon, next week
  104: '2026-07-01',
  105: { date: '2026-07-02' },  // object form, both shapes exist in the wild
  106: 'not-a-date',            // must be ignored, never crash
}, null, 2));
fs.writeFileSync(path.join(tmp, 'applications.md'), [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
  '| 101 | 2026-06-15 | Northwind | RevOps Director | 4.0/5 | Rejected | ❌ | — | — | [reached: Phone Screen] | https://e.test/1 |',
  '| 102 | 2026-06-21 | Aster | Analytics Director | 3.5/5 | Applied | ❌ | — | — | sent | https://e.test/2 |',
  '| 103 | 2026-06-22 | Bellhaven | RevOps Lead | 3.2/5 | Applied | ❌ | — | — | sent | https://e.test/3 |',
  '',
].join('\n'));

const { weekStartOf, actionSeries, applicationCohorts } = await import('../dashboard-web/server/lib/activity.mjs');

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };

console.log('activity.test.mjs');

try {
  // ── week boundaries, the UTC trap ──────────────────────────────────────────
  check(weekStartOf('2026-06-15') === '2026-06-15', 'a Monday is its own week start');
  check(weekStartOf('2026-06-21') === '2026-06-15', 'a SUNDAY belongs to the week that began the previous Monday');
  check(weekStartOf('2026-06-22') === '2026-06-22', 'the next Monday starts a new week');
  check(weekStartOf('nonsense') === null, 'an unparseable date yields null, never a wrong week');

  // ── actions: applications are real, the rest are not logged yet ────────────
  const a = actionSeries({ days: 60, today: new Date('2026-07-10T12:00:00Z') });
  const applied = a.series.find(s => s.key === 'applications');
  const touches = a.series.find(s => s.key === 'touches');
  const connects = a.series.find(s => s.key === 'connects');
  check(applied.available === true, 'applications report available when dates exist');
  check(applied.total === 5, `the malformed date is ignored, the object form is not (got ${applied.total}, want 5)`);
  check(applied.points.length === 60, 'one point per day in the window, gaps filled with zero');
  check(touches && touches.available === false && connects && connects.available === false,
    'touches and connects are DECLARED as not-logged, not omitted and not zeroed');
  check(a.series.length === 3, 'all three action series are present even when two have no data');

  // ── cohorts ────────────────────────────────────────────────────────────────
  const c = applicationCohorts({ weeks: 8, today: new Date('2026-07-10T12:00:00Z') });
  const byWeek = Object.fromEntries(c.weeks.map(w => [w.week, w]));
  check(byWeek['2026-06-15'] && byWeek['2026-06-15'].sent === 2,
    'the Monday and the Sunday land in the SAME cohort (the boundary bug)');
  check(byWeek['2026-06-22'] && byWeek['2026-06-22'].sent === 1, 'the next Monday opens its own cohort');
  check(byWeek['2026-06-15'].replied === 1 && byWeek['2026-06-15'].screened === 1,
    'a row that reached Phone Screen counts as both replied and screened');
  check(byWeek['2026-06-15'].replyPct === 50, `reply percent is per cohort (got ${byWeek['2026-06-15'].replyPct}, want 50)`);
  // An apply date whose tracker row was pruned is a real condition, not a parse
  // failure. Counting it keeps `sent` reconcilable with the sidecar instead of
  // quietly shrinking the denominator, which would flatter every rate.
  const orphanWeek = byWeek['2026-06-29'] || byWeek['2026-07-01'] || null;
  const totalSent = c.weeks.reduce((n, w) => n + w.sent, 0);
  const totalOrphan = c.weeks.reduce((n, w) => n + w.orphaned, 0);
  check(totalSent === 5, `every valid apply date lands in some cohort (got ${totalSent}, want 5)`);
  check(totalOrphan === 2, `apply dates with no tracker row are counted, not dropped (got ${totalOrphan}, want 2)`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
