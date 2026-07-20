#!/usr/bin/env node
/**
 * sidecars.test.mjs — unit tests for dashboard-web/server/lib/sidecars.mjs, the
 * status-event and apply-date write path.
 *
 * This path had no coverage at all, which is how it shipped hardcoding "today"
 * as every event date: the log recorded when the user clicked, not when the
 * thing happened, so every timing metric silently measured data entry.
 *
 * Runs against a temp DATA_DIR via TJK_DATA_DIR. That override exists for
 * exactly this reason — all of data/ is gitignored, so a test that wrote to the
 * real directory would corrupt the user's job search with no way back.
 *
 * Run: node tests/sidecars.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('sidecars.test.mjs');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-sidecars-'));
process.env.TJK_DATA_DIR = sandbox;

// Imported AFTER the env var is set: config.mjs resolves its paths at module
// evaluation, so a static import would bind the real data/ before we could
// redirect it.
const { logStatusEvent, parseStatusEvents, recordApplyDate, readApplyDates } =
  await import('../dashboard-web/server/lib/sidecars.mjs');
const { STATUS_EVENTS_PATH, APPLY_DATES_PATH } =
  await import('../dashboard-web/server/config.mjs');

const today = new Date().toISOString().slice(0, 10);
const readRows = () => fs.readFileSync(STATUS_EVENTS_PATH, 'utf8').trim().split('\n');

try {
  check(STATUS_EVENTS_PATH.startsWith(sandbox), 'TJK_DATA_DIR redirects STATUS_EVENTS_PATH into the sandbox');
  check(APPLY_DATES_PATH.startsWith(sandbox), 'TJK_DATA_DIR redirects APPLY_DATES_PATH into the sandbox');

  // ── Event date: default vs explicit ─────────────────────────────────────────
  logStatusEvent(1, 'Applied', { company: 'Acme' });
  let rows = readRows();
  check(rows[0] === 'app#\tdate\tstatus\tcompany\tlogged', 'header names the new logged column');
  check(rows[1].split('\t')[1] === today, 'no date given → event dated today (prior behavior preserved)');

  logStatusEvent(2, 'Applied', { company: 'Beta', date: '2024-03-04' });
  rows = readRows();
  const explicit = rows[2].split('\t');
  check(explicit[1] === '2024-03-04', 'explicit date lands in the date column');
  check(explicit[4] === today, 'logged column always records today, not the event date');
  check(explicit[1] !== explicit[4], 'a backdated row has date and logged that disagree');

  // ── Malformed input degrades, never corrupts ────────────────────────────────
  logStatusEvent(3, 'Applied', { company: 'Gamma', date: 'last tuesday' });
  check(readRows()[3].split('\t')[1] === today, 'malformed date falls back to today rather than being written');

  logStatusEvent(4, 'Applied', { company: 'Tab\tInjected\tName', date: '2024-03-05' });
  check(readRows()[4].split('\t').length === 5, 'tabs in a field cannot inject extra columns');

  // ── Non-canonical status: warn, but never lose the row ──────────────────────
  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => warnings.push(a.join(' '));
  logStatusEvent(5, 'Interview', { company: 'Delta' });
  console.warn = realWarn;
  check(warnings.some(w => /non-canonical/.test(w)), 'a non-canonical status warns');
  check(readRows()[5].split('\t')[2] === 'Interview', 'a non-canonical status is still written (history is not dropped)');

  // ── Parsing: new 5-column and legacy 4-column rows ──────────────────────────
  const parsed = parseStatusEvents();
  check(parsed.length === 5, 'parseStatusEvents returns every data row');
  check(parsed[1].date === '2024-03-04' && parsed[1].logged === today, 'parsed row exposes both date and logged');

  fs.writeFileSync(STATUS_EVENTS_PATH,
    'app#\tdate\tstatus\tcompany\n' +
    '10\t2024-01-01\tApplied\tLegacyCo\n' +
    '11\t2024-01-02\tRejected\tLegacyCo\t2024-01-02\n');
  const mixed = parseStatusEvents();
  check(mixed.length === 2, 'legacy 4-column file still parses');
  check(mixed[0].logged === null, 'a legacy row reads logged as null, not undefined or empty string');
  check(mixed[0].date === '2024-01-01' && mixed[0].company === 'LegacyCo', 'legacy row fields are unshifted');
  check(mixed[1].logged === '2024-01-02', '5-column row mixed into a legacy file still reads logged');

  // ── recordApplyDate: first-write-wins unless forced ─────────────────────────
  check(recordApplyDate(100, '2024-03-04') === '2024-03-04', 'explicit apply date is stored');
  check(recordApplyDate(100, '2024-06-30') === '2024-03-04', 'a second write does NOT overwrite the anchor');
  check(recordApplyDate(100, '2024-06-30', { force: true }) === '2024-06-30', 'force overwrites the anchor');
  check(readApplyDates()['100'] === '2024-06-30', 'the forced value is what persisted');
  check(recordApplyDate(101) === today, 'no date given → today (prior single-arg behavior preserved)');
  check(recordApplyDate(102, 'nonsense') === today, 'malformed apply date falls back to today');

  // ── Failure is never fatal to the caller ────────────────────────────────────
  fs.rmSync(sandbox, { recursive: true, force: true });
  let threw = false;
  try { logStatusEvent(6, 'Applied', { company: 'Gone' }); } catch { threw = true; }
  check(!threw, 'an unwritable log warns instead of throwing (a status change must not fail on logging)');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
