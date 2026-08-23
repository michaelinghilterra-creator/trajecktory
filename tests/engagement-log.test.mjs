#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';

const tmp = makeSandbox('engagement-week');
process.env.TJK_DATA_DIR = tmp;
const dir = path.join(tmp, 'linkedin-ssi');
const file = path.join(dir, 'engagement-log.md');
const { engagementsInWeek } = await import('../dashboard-web/server/lib/engagement-log.mjs');

let passed = 0, failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  ok ${message}`); passed++; }
  else { console.log(`  not ok ${message}`); failed++; }
};
const write = rows => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, [
    '| Date | Influencer | Action Type | Topic | Message | Response Received | Connection Made | Notes | Logged At |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
  ].join('\n'));
};

console.log('engagement-log.test.mjs');
const now = new Date(2026, 7, 19, 12);
check(engagementsInWeek(now) === 0, 'a missing log returns zero');
write([]);
check(engagementsInWeek(now) === 0, 'an empty log returns zero');
write([
  '| 2026-08-18 | Current Voice | Commented | Topic | Message | No | No | | 2026-08-18T12:00:00Z |',
  '| 2026-08-09 | Prior Voice | Reposted | Topic | Message | No | No | | 2026-08-09T12:00:00Z |',
  '| 2026-08-19 | Connect Voice | Connection request | Topic | Message | No | No | | 2026-08-19T12:00:00Z |',
]);
check(engagementsInWeek(now) === 1, 'only an engagement inside the current week counts');
check(engagementsInWeek(now) !== 2, 'a connection request is excluded from engagements');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
