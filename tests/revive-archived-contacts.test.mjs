#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++;
  } else { console.log(`  FAIL ${message}`); failed++; }
}

console.log('revive-archived-contacts.test.mjs');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = makeRepoSandbox(root, 'revive-archived-contacts');
const applications = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
  '| 1 | 2031-03-01 | Alpha Works Software | Widget Lead | 4.2/5 | Applied | | | | | https://jobs.example.test/1 |',
  '| 2 | 2031-03-02 | Beta Labs | Sprocket Lead | 4.0/5 | Rejected | | | | | https://jobs.example.test/2 |',
  '',
].join('\n');
const targetTalent = [
  '# Target Talent',
  '',
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |',
  '|---|---------|------|-------|--------|-------|------|-------|-----|-------|-------|----------|--------|------------|-------|---------|',
  '| 1 | Alpha Works | Morgan | Alex | | Recruiter | | | | | secret.one@example.test | https://linkedin.example.test/secret-one | Archived | 2031-03-03 | Warm thread · [was:Replied] | |',
  '| 2 | Alpha Works | Rivera | Casey | | Recruiter | | | | | | | Archived | 2031-03-04 | | |',
  '| 3 | Beta Labs | Chen | Jordan | | Recruiter | | | | | | | Archived | 2031-03-05 | | |',
  '| 4 | Alpha Works | Patel | Taylor | | Recruiter | | | | | | | Archived | | Archived 2031-03-06: left the company | |',
  '| 5 | Alpha Works | Kim | Avery | | Recruiter | | | | | | | Archived | | [no-revive] | |',
  '',
].join('\n');
fs.writeFileSync(path.join(dataDir, 'applications.md'), applications, 'utf8');
fs.writeFileSync(path.join(dataDir, 'target-talent.md'), targetTalent, 'utf8');
fs.writeFileSync(path.join(dataDir, 'event-store.json'), '{"writes":"off"}\n', 'utf8');

const run = (args = []) => {
  const result = spawnSync(process.execPath, ['revive-archived-contacts.mjs', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, TJK_DATA_DIR: dataDir },
  });
  return { ...result, stdout: result.stdout || '', stderr: result.stderr || '', spawnError: result.error || null };
};

const before = fs.readFileSync(path.join(dataDir, 'target-talent.md'), 'utf8');
const dry = run();
check(!dry.spawnError && dry.status === 0 && dry.stdout.includes('Total: 2'), 'dry run reports two revivals');
check(dry.stdout.includes('Skipped manual archive marker: 1')
  && dry.stdout.includes('Skipped [no-revive]: 1')
  && dry.stdout.includes('Skipped no live application: 1'), 'dry run reports every skip reason');
check(fs.readFileSync(path.join(dataDir, 'target-talent.md'), 'utf8') === before, 'dry run leaves target talent unchanged');
check(!fs.readdirSync(dataDir).some(name => name.includes('backups-manual-')), 'dry run creates no backup');
check(!dry.stdout.includes('Alex')
  && !dry.stdout.includes('secret.one@example.test')
  && !dry.stdout.includes('linkedin.example.test'), 'output omits names, email addresses, and LinkedIn URLs');

const applied = run(['--apply']);
const after = fs.readFileSync(path.join(dataDir, 'target-talent.md'), 'utf8');
const contactRows = new Map(after.split(/\r?\n/)
  .filter(line => /^\|\s*\d/.test(line))
  .map(line => {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    return [Number(cells[0]), cells];
  }));
check(applied.status === 0 && applied.stdout.includes('Applied: 2'), 'apply revives both qualifying rows');
check(contactRows.get(1)?.[12] === 'Replied' && contactRows.get(1)?.[13] === '2031-03-03'
  && contactRows.get(1)?.[14] === 'Warm thread', 'apply restores the tagged status and cleans the tag');
check(contactRows.get(2)?.[12] === 'Sent' && contactRows.get(2)?.[13] === '2031-03-04', 'apply falls back to Sent without changing last touch');
check(contactRows.get(3)?.[12] === 'Archived'
  && contactRows.get(4)?.[12] === 'Archived'
  && contactRows.get(5)?.[12] === 'Archived', 'apply leaves skipped rows archived');
const backupName = fs.readdirSync(dataDir).find(name => name.includes('backups-manual-'));
check(!!backupName, 'apply creates the manual backup folder');
check(!!backupName
  && fs.readFileSync(path.join(dataDir, backupName, 'target-talent.md'), 'utf8') === before
  && fs.readFileSync(path.join(dataDir, backupName, 'event-store.json'), 'utf8') === '{"writes":"off"}\n', 'backup contains exact target talent and event store copies');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
