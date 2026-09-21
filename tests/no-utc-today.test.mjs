#!/usr/bin/env node
// Static guard: the UTC "today" idiom must not come back. new Date().toISOString().slice(0, 10) is the UTC
// calendar date, which is already tomorrow for a US user after about 7pm, so any date stored or compared with
// it is a day off in the evening. Use localToday() / localStamp() from lib/local-date.mjs instead.
//
// Pure date-string arithmetic done in UTC (parsing 'YYYY-MM-DDT00:00:00Z', adding days, reading the result
// back) is correct and is listed in ALLOWED. A stale ALLOWED entry fails too, so the list cannot rot.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'tests', 'data', 'output', 'reports', 'jds', 'dist', 'logs']);
const SOURCE = /\.(mjs|js|jsx|cjs)$/;

const FORBIDDEN = /toISOString\(\)\s*\.\s*(?:slice|substring)\(\s*0\s*,\s*1[06]\s*\)|toISOString\(\)\s*\.\s*split\(\s*['"]T['"]|toISOString\(\)\s*\.\s*replace\(\s*['"]T['"]/;

const ALLOWED = [
  { file: 'agent-edit.mjs', text: 'parsed.toISOString().slice(0, 10) !== value', why: 'validates a typed date round-trips' },
  { file: 'dashboard-web/server/lib/activity.mjs', text: 'return d.toISOString().slice(0, 10);', why: 'week start arithmetic on a date string' },
  { file: 'dashboard-web/server/lib/activity.mjs', text: 'const start = new Date(new Date(', why: 'series window arithmetic from a local date string' },
  { file: 'dashboard-web/server/lib/activity.mjs', text: 'const ymd = new Date(new Date(', why: 'series point arithmetic on a date string' },
  { file: 'dashboard-web/server/lib/cadence-start.mjs', text: 'parsed.toISOString().slice(0, 10) === value', why: 'validates a date string' },
  { file: 'dashboard-web/server/lib/outreach-policy.mjs', text: 'return d.toISOString().slice(0, 10);', why: 'addDays on a date string' },
  { file: 'dashboard-web/server/lib/sequences.mjs', text: 'return d.toISOString().slice(0, 10);', why: 'addDays on a date string' },
  { file: 'dashboard-web/server/lib/statuses.mjs', text: 'parsed.toISOString().slice(0, 10) === ymd', why: 'validates a date string' },
  { file: 'dashboard-web/server/lib/twc-events.mjs', text: 'parsed.toISOString().slice(0, 10) === value', why: 'validates a date string' },
  { file: 'dashboard-web/server/lib/twc.mjs', text: 'return d.toISOString().slice(0, 10);', why: 'week start arithmetic on a date string' },
  { file: 'dashboard-web/server/routes/applications.mjs', text: 'parsed.toISOString().slice(0, 10) !== eventDate', why: 'validates a typed date round-trips' },
  { file: 'dashboard-web/src/charts.jsx', text: 'const k = d.toISOString().slice(0, 10);', why: 'chart bucket key from date arithmetic' },
  { file: 'dashboard-web/src/charts.jsx', text: 'const k = d.toISOString().slice(0,10);', why: 'chart bucket key from date arithmetic' },
  { file: 'docs/onboarding/capture-dashboard.mjs', text: 'd.toISOString().slice(0, 10)', why: 'docs tooling series arithmetic' },
  { file: 'followup-cadence.mjs', text: "return result.toISOString().split('T')[0];", why: 'unwired legacy script date arithmetic' },
  { file: 'lib/provenance.mjs', text: 'date.toISOString().slice(0, 10) === value', why: 'validates a date string' },
  { file: 'lib/weekly-review.mjs', text: '.toISOString().slice(0, 10)', why: 'week arithmetic on a date string' },
];

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walk(path.join(dir, entry.name), out);
    } else if (SOURCE.test(entry.name) && !entry.name.includes('.test.')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

console.log('no-utc-today.test.mjs');

// The guard must not go inert: prove the pattern still catches the idiom and only the idiom.
check(FORBIDDEN.test('const d = new Date().toISOString().slice(0, 10);'), 'the pattern matches slice(0, 10)');
check(FORBIDDEN.test('x.toISOString().slice(0,10)'), 'the pattern matches slice(0,10) without a space');
check(FORBIDDEN.test("new Date().toISOString().split('T')[0]"), 'the pattern matches split T');
check(FORBIDDEN.test("new Date(ms).toISOString().replace('T', ' ').slice(0, 16)"), 'the pattern matches the T to space stamp replace');
check(!FORBIDDEN.test('const d = localToday();'), 'the pattern ignores localToday()');
check(!FORBIDDEN.test('new Date().toISOString()'), 'the pattern ignores a whole ISO instant');
check(!FORBIDDEN.test('d.toISOString().slice(11, 19)'), 'the pattern ignores a time-of-day slice');

const used = new Array(ALLOWED.length).fill(0);
const offenders = [];
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (/^(\/\/|\*|\/\*)/.test(trimmed) || !FORBIDDEN.test(line)) return;
    const hit = ALLOWED.findIndex((entry) => entry.file === rel && line.includes(entry.text));
    if (hit >= 0) used[hit]++;
    else offenders.push(`${rel}:${index + 1} UTC date idiom: ${trimmed}`);
  });
}

for (const offender of offenders) check(false, offender);
if (!offenders.length) check(true, 'no UTC today idiom outside the allowlist');

const stale = ALLOWED.filter((entry, i) => !used[i]);
for (const entry of stale) check(false, `stale allowlist entry ${entry.file}: ${entry.text}`);
if (!stale.length) check(true, 'every allowlist entry is still used');

console.log(`\nno-utc-today: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
