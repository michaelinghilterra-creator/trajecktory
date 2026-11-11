#!/usr/bin/env node
// An interview excluded in the Work Search overrides (it never took place) must stop the export gate from asking
// about it, not only drop it from the counted log. Invented data.
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

const tmp = makeSandbox('twc-exclude-interview');
process.env.TJK_DATA_DIR = tmp;

const app = (id, company, role) => `| ${id} | 2030-01-02 | ${company} | ${role} | 0.01/5 | Phone Screen | ❌ | - | - |  | https://jobs.zorblax.example/${id} |`;
fs.writeFileSync(path.join(tmp, 'applications.md'), [
  '# Applications Tracker', '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
  app(900001, 'Zorblax Widgetry', 'Example Cog Lead'),
  app(900002, 'Zorblax Widgetry', 'Example Flange Engineer'),
  app(900003, 'Quennox Ratchet Works', 'Example Gear Manager'),
].join('\n') + '\n');
fs.writeFileSync(path.join(tmp, 'apply-dates.json'), JSON.stringify({ 900001: '2030-01-05', 900002: '2030-01-05', 900003: '2030-01-05' }));
fs.writeFileSync(path.join(tmp, 'status-events.tsv'),
  'app#\tdate\tstatus\tcompany\tlogged\n'
  + '900001\t2030-03-05\tPhone Screen\tZorblax Widgetry\t2030-03-05\n'
  + '900002\t2030-03-05\tPhone Screen\tZorblax Widgetry\t2030-03-05\n'
  + '900003\t2030-03-05\tPhone Screen\tQuennox Ratchet Works\t2030-03-05\n');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const { twcGateWarnings } = await import('../dashboard-web/server/lib/twc-gate.mjs');
const range = { from: '2030-03-01', to: '2030-03-10', today: '2030-04-01', interviewRecords: new Map(), strictInterviews: true };
const ids = (result) => result.warnings.map((w) => w.id).sort().join();

console.log('twc-exclude-interview.test.mjs');
check(ids(twcGateWarnings(range)) === '900001,900002,900003', 'with no exclusion, all three unrecorded interview lines are listed');

fs.writeFileSync(path.join(tmp, 'twc-overrides.json'), JSON.stringify({
  applications: {}, interviews: [], add: [],
  exclude: [{ date: '2030-03-05', kind: 'interview', contact: '', company: 'Zorblax Widgetry', note: 'Call never took place' }],
}, null, 2));
check(ids(twcGateWarnings(range)) === '900003', 'an interview exclusion removes that company and date from the gate, and only that one');

fs.writeFileSync(path.join(tmp, 'twc-overrides.json'), JSON.stringify({
  applications: {}, interviews: [], add: [],
  exclude: [{ date: '2030-03-06', kind: 'interview', contact: '', company: 'Zorblax Widgetry', note: 'Wrong date' }],
}, null, 2));
check(ids(twcGateWarnings(range)) === '900001,900002,900003', 'an exclusion on a different date changes nothing');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\ntwc exclude interview: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
