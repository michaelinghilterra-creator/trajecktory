#!/usr/bin/env node
/**
 * check-outreach.test.mjs — the command-line outreach gate.
 *
 * check-outreach.mjs exists so a headless agent (the contacto mode, a script) hits
 * the same caps the dashboard routes enforce, instead of a limit that only lives
 * in a prompt. The contract a caller depends on is the EXIT CODE, so that is what
 * this pins: 0 allowed, 1 blocked, 2 could-not-decide. The one that matters most
 * is 2. A failure to decide must never read as 0, and must never be confused with
 * 1 either, so a missing contact, bad arguments and a crashed import all land on 2.
 *
 * It runs the real script as a subprocess against a sandbox data dir and a pinned
 * policy file, so it reads neither a user's data/ nor their config/profile.yml.
 * Fixtures are invented people at .example domains.
 *
 * Run: node tests/check-outreach.test.mjs   (exit 0 = pass)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from './helpers/sandbox.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = makeSandbox('check-outreach');
const pad = n => String(n).padStart(2, '0');
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const rule = Array(16).fill('---').join('|');

const person = (id, company, last, first) =>
  `| ${id} | ${company} | ${last} | ${first} |  |  |  |  |  |  | ${first.toLowerCase()}@${company.toLowerCase()}.example | n/a | Sent |  |  |  |\n`;
fs.writeFileSync(path.join(sandbox, 'target-talent.md'),
  '# Target Talent\n\n' +
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n' +
  `|${rule}|\n` +
  person(1, 'Acme', 'Ramirez', 'Jose') +   // messaged today
  person(2, 'Globex', 'Vance', 'Dana') +    // never messaged
  person(3, 'Acme', 'Doe', 'Jane') +        // never messaged, but Acme is full today
  person(4, 'Acme', 'Park', 'Min') +        // messaged today
  person(5, 'Acme', 'Cole', 'Sam') +        // messaged today
  person(6, 'Initech', 'Roe', 'Pat'),       // cold cap reached, no reply
  'utf8');

const corrDir = path.join(sandbox, 'target-talent-correspondence');
fs.mkdirSync(corrDir, { recursive: true });
const sentToday = `## ${today} 09:00 | Sent | Hello\n\nA substantive note.\n`;
for (const id of [1, 4, 5]) fs.writeFileSync(path.join(corrDir, `${id}.md`), sentToday, 'utf8');
fs.writeFileSync(path.join(corrDir, '6.md'),
  '## 2026-01-01 09:00 | Sent | One\n\nA substantive note.\n\n' +
  '## 2026-01-10 09:00 | Sent | Two\n\nA substantive note.\n\n' +
  '## 2026-01-20 09:00 | Sent | Three\n\nA substantive note.\n', 'utf8');

const policyFile = path.join(sandbox, 'profile.yml');
fs.writeFileSync(policyFile,
  'outreach:\n  enabled: true\n  minDaysBetweenTouches: 3\n  maxTouchesPer30d: 6\n  awaitingReplyHold: 3\n' +
  '  coldOutreachCap:\n    linkedin: 3\n    email: 3\n  perCompanyPerDay: 3\n', 'utf8');

const run = (args, env = {}) => spawnSync(process.execPath, [path.join(root, 'check-outreach.mjs'), ...args], {
  encoding: 'utf8',
  env: { ...process.env, TJK_DATA_DIR: sandbox, TJK_PROFILE_YML: policyFile, ...env },
});

let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) { console.log(`  ✅ ${msg}`); passed++; } else { console.log(`  ❌ ${msg}`); failed++; } };
console.log('check-outreach.test.mjs');

let r = run(['--source', 'ta', '--id', '2', '--json']);
check(r.status === 0, 'a contact never messaged is allowed (exit 0)');
check(JSON.parse(r.stdout).status === 'allowed', 'JSON output says allowed');

r = run(['--source', 'ta', '--id', '1', '--json']);
check(r.status === 1, 'a contact messaged today is blocked (exit 1)');
check(JSON.parse(r.stdout).blocks.some(b => b.rule === 'minDaysBetweenTouches'), 'the block names the minimum-gap rule');

r = run(['--source', 'ta', '--id', '3', '--json']);
check(r.status === 1, 'an untouched contact at a company already reached 3 times today is blocked');
check(JSON.parse(r.stdout).blocks.some(b => b.rule === 'perCompanyPerDay'), 'the block names the per-company daily cap');

r = run(['--source', 'ta', '--id', '6', '--json']);
check(r.status === 1 && JSON.parse(r.stdout).blocks.some(b => b.rule === 'coldOutreachCap'), 'three unanswered cold emails hit the cold outreach cap');
check(JSON.parse(r.stdout).nextEligible === null, 'a cold cap has no next-eligible date until they reply');

r = run(['--source', 'ta', '--id', '1']);
check(r.status === 1 && /^BLOCKED/.test(r.stdout), 'plain-text output leads with BLOCKED');

console.log('\nFirst touch (not in the books yet)');
r = run(['--new', '--company', 'Acme', '--json']);
check(r.status === 1 && JSON.parse(r.stdout).blocks.some(b => b.rule === 'perCompanyPerDay'), 'a brand-new person at a company already reached 3 times today is blocked');
r = run(['--new', '--company', 'Globex', '--json']);
check(r.status === 0, 'a brand-new person at a quiet company is allowed');
r = run(['--new']);
check(r.status === 2, '--new without --company is exit 2');

console.log('\nFails closed');
r = run(['--source', 'ta', '--id', '999']);
check(r.status === 2, 'an unknown contact is exit 2, not 0');
r = run(['--source', 'nope', '--id', '1']);
check(r.status === 2, 'a bad --source is exit 2');
r = run(['--source', 'ta', '--id', 'abc']);
check(r.status === 2, 'a non-numeric --id is exit 2');
r = run(['--source', 'ta', '--id', '1', '--channel', 'fax']);
check(r.status === 2, 'a bad --channel is exit 2');
r = run(['--source', 'ta', '--id', '1', '--override']);
check(r.status === 2, 'there is no override flag');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
