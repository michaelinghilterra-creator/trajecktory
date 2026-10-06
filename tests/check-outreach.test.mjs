#!/usr/bin/env node
/**
 * check-outreach.test.mjs — the command-line outreach gate.
 *
 * check-outreach.mjs exists so a headless agent (the contacto mode, a script) hits
 * the same caps the dashboard routes enforce, instead of a limit that only lives
 * in an instruction file. The contract a caller depends on is the EXIT CODE: 0 allowed,
 * 1 blocked, 2 could-not-decide. The one that matters most is 2. A failure to
 * decide must never read as 0, and must never be confused with 1 either, so a
 * missing contact, bad arguments and a crashed import all land on 2.
 *
 * Two layers, because the script intentionally has no flag for changing the clock
 * (a flag that lets a caller pick "today" is a flag that lets an agent walk past
 * every gap rule):
 *   - the date-dependent rules run in-process against a fixed clock in 2030;
 *   - the exit-code contract runs the real script as a subprocess, using only
 *     outcomes that do not depend on the date.
 *
 * Reads neither a user's data/ nor their config/profile.yml: both are pinned to a
 * sandbox. Every fixture is invented: companies Zorblax Widgetry and Quennox
 * Ratchet Works, people Example Personone and onward, ids from 900001, dates in
 * 2030, addresses at example.test.
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
const rule = Array(16).fill('---').join('|');
const AS_OF = new Date('2030-03-15T12:00:00Z');
const TODAY = '2030-03-15';

const person = (id, company, last, slug) =>
  `| ${id} | ${company} | ${last} | Example |  |  |  |  |  |  | ${slug}@example.test | n/a | Sent |  |  |  |\n`;
fs.writeFileSync(path.join(sandbox, 'target-talent.md'),
  '# Target Talent\n\n' +
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n' +
  `|${rule}|\n` +
  person(900001, 'Zorblax Widgetry', 'Personone', 'example.personone') +      // messaged on the as-of day
  person(900002, 'Quennox Ratchet Works', 'Persontwo', 'example.persontwo') + // never messaged
  person(900003, 'Zorblax Widgetry', 'Personthree', 'example.personthree') +  // never messaged, but Zorblax is full that day
  person(900004, 'Zorblax Widgetry', 'Personfour', 'example.personfour') +    // messaged on the as-of day
  person(900005, 'Zorblax Widgetry', 'Personfive', 'example.personfive') +    // messaged on the as-of day
  person(900006, 'Quennox Ratchet Works', 'Personsix', 'example.personsix'),  // cold cap reached, no reply
  'utf8');

const corrDir = path.join(sandbox, 'target-talent-correspondence');
fs.mkdirSync(corrDir, { recursive: true });
const sentOnAsOf = `## ${TODAY} 09:00 | Sent | Hello\n\nA substantive note.\n`;
for (const id of [900001, 900004, 900005]) fs.writeFileSync(path.join(corrDir, `${id}.md`), sentOnAsOf, 'utf8');
fs.writeFileSync(path.join(corrDir, '900006.md'),
  '## 2030-01-01 09:00 | Sent | One\n\nA substantive note.\n\n' +
  '## 2030-01-10 09:00 | Sent | Two\n\nA substantive note.\n\n' +
  '## 2030-01-20 09:00 | Sent | Three\n\nA substantive note.\n', 'utf8');

const policyFile = path.join(sandbox, 'profile.yml');
fs.writeFileSync(policyFile,
  'outreach:\n  enabled: true\n  minDaysBetweenTouches: 3\n  maxTouchesPer30d: 6\n  awaitingReplyHold: 3\n' +
  '  coldOutreachCap:\n    linkedin: 3\n    email: 3\n  perCompanyPerDay: 3\n', 'utf8');

// Both are read at import time, so they must be set before the script loads.
process.env.TJK_DATA_DIR = sandbox;
process.env.TJK_PROFILE_YML = policyFile;
const { check, parseArgs } = await import('../check-outreach.mjs');

const run = (args) => spawnSync(process.execPath, [path.join(root, 'check-outreach.mjs'), ...args], {
  encoding: 'utf8',
  env: { ...process.env, TJK_DATA_DIR: sandbox, TJK_PROFILE_YML: policyFile },
});
const ruleNames = result => result.blocks.map(b => b.rule);

let passed = 0, failed = 0;
const check_ = (cond, msg) => { if (cond) { console.log(`  ✅ ${msg}`); passed++; } else { console.log(`  ❌ ${msg}`); failed++; } };
console.log('check-outreach.test.mjs');

console.log('\nRules, against a fixed clock in 2030');
let r = await check({ source: 'ta', id: '900002', channel: 'email' }, AS_OF);
check_(r.status === 'allowed', 'a contact never messaged is allowed');

r = await check({ source: 'ta', id: '900001', channel: 'email' }, AS_OF);
check_(r.status === 'blocked' && ruleNames(r).includes('minDaysBetweenTouches'), 'a contact messaged the same day is blocked by the minimum gap');

r = await check({ source: 'ta', id: '900003', channel: 'email' }, AS_OF);
check_(r.status === 'blocked' && ruleNames(r).includes('perCompanyPerDay'), 'an untouched contact at a company already reached 3 times that day is blocked');

r = await check({ source: 'ta', id: '900006', channel: 'email' }, AS_OF);
check_(r.status === 'blocked' && ruleNames(r).includes('coldOutreachCap'), 'three unanswered cold emails hit the cold outreach cap');
check_(r.nextEligible === null, 'a cold cap has no next-eligible date until they reply');

r = await check({ isNew: true, company: 'Zorblax Widgetry', channel: 'email' }, AS_OF);
check_(r.status === 'blocked' && ruleNames(r).includes('perCompanyPerDay'), 'a brand-new person at a company already reached 3 times that day is blocked');
r = await check({ isNew: true, company: 'Quennox Ratchet Works', channel: 'email' }, AS_OF);
check_(r.status === 'allowed', 'a brand-new person at a quiet company is allowed');

r = await check({ source: 'ta', id: '999999', channel: 'email' }, AS_OF);
check_(r.status === 'error', 'an unknown contact is an error result, not allowed');

console.log('\nArguments');
check_(parseArgs(['--source', 'nope', '--id', '900001']).error, 'a bad --source is rejected');
check_(parseArgs(['--source', 'ta', '--id', 'abc']).error, 'a non-numeric --id is rejected');
check_(parseArgs(['--source', 'ta', '--id', '900001', '--channel', 'fax']).error, 'a bad --channel is rejected');
check_(parseArgs(['--new']).error, '--new without --company is rejected');
check_(parseArgs(['--source', 'ta', '--id', '900001', '--override']).error, 'there is no override flag');
check_(parseArgs(['--source', 'ta', '--id', '900001', '--as-of', '2030-01-01']).error, 'there is no flag for changing the clock');

console.log('\nExit codes, real script (date-independent outcomes only)');
r = run(['--source', 'ta', '--id', '900002', '--json']);
check_(r.status === 0 && JSON.parse(r.stdout).status === 'allowed', 'allowed is exit 0');
r = run(['--source', 'ta', '--id', '900006', '--json']);
check_(r.status === 1 && JSON.parse(r.stdout).blocks.some(b => b.rule === 'coldOutreachCap'), 'blocked is exit 1');
r = run(['--source', 'ta', '--id', '900006']);
check_(r.status === 1 && /^BLOCKED/.test(r.stdout), 'plain-text output leads with BLOCKED');
r = run(['--source', 'ta', '--id', '999999']);
check_(r.status === 2, 'an unknown contact is exit 2, not 0');
r = run(['--source', 'nope', '--id', '900001']);
check_(r.status === 2, 'bad arguments are exit 2');
r = run(['--source', 'ta', '--id', '900001', '--override']);
check_(r.status === 2, 'an override flag is exit 2');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
