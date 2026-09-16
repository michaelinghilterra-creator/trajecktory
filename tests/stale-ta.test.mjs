#!/usr/bin/env node
/**
 * stale-ta.test.mjs — regression coverage for computeStaleTA's application gate.
 *
 * Coach and insights still consume this legacy no-argument function, so it must
 * independently suppress stale contacts whose company has no live application.
 */

import fs from 'fs';
import path from 'path';
import { formatTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

const sandbox = makeSandbox('stale-ta');
process.env.TJK_DATA_DIR = sandbox;

const appRow = (num, company, status) => formatTrackerLine({
  num,
  date: '2026-01-01',
  company,
  role: 'Platform Lead',
  score: '4.0/5',
  status,
  pdf: '',
  resume: '',
  report: '',
  notes: '',
  url: '',
});

fs.writeFileSync(path.join(sandbox, 'applications.md'), [
  '# Applications Tracker',
  '',
  TRACKER_HEADER,
  TRACKER_SEPARATOR,
  appRow(1, 'Brightwave Labs', 'Applied'),
  appRow(2, 'Northwind Robotics', 'No Response'),
  '',
].join('\n'), 'utf8');

const contactRow = (id, company, status) =>
  `| ${id} | ${company} | Example | Contact${id} |  | Recruiter |  |  |  |  | contact${id}@example.test |  | ${status} | 2020-01-02 |  |  |`;

fs.writeFileSync(path.join(sandbox, 'target-talent.md'), [
  '# Target Talent',
  '',
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  contactRow(1, 'Brightwave Labs', 'Sent'),
  contactRow(2, 'Northwind Robotics', 'Sent'),
  contactRow(3, 'Northwind Robotics', 'Replied'),
  contactRow(4, 'Northwind Robotics', 'Meeting Scheduled'),
  '',
].join('\n'), 'utf8');

const { computeStaleTA } = await import('../dashboard-web/server/lib/followups.mjs');
const result = computeStaleTA();

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

console.log('stale-ta.test.mjs');
check(result.some(row => row.id === 1), 'stale contact at a live application company surfaces');
check(result.every(row => row.company !== 'Northwind Robotics'),
  'No Response company is gated out across all tracked contact statuses');
check(result.length === 1, `only the eligible stale contact surfaces (got ${result.length})`);

try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* best-effort */ }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
