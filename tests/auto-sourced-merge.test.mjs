import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox } from './helpers/sandbox.mjs';
import { parseTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  pass ${message}`);
    passed += 1;
  } else {
    console.log(`  fail ${message}`);
    failed += 1;
  }
}

function report(url) {
  const boundary = '-'.repeat(3);
  return `${boundary}\n{"schema":"trajecktory-report/v1","url":"${url}"}\n${boundary}\n\n# Fixture\n`;
}

function addition({ num, company, role, score, reportPath, notes = '' }) {
  return [num, '2032-01-01', company, role, 'Evaluated', score, 'x', `[${num}](${reportPath})`, notes].join('\t') + '\n';
}

function runCase({ num, url, company = 'Quennox Ratchet Works', role = 'Revenue Systems Director', score = '4.0/5', notes = '', listed = false, pipeline = false }) {
  const sandbox = makeRepoSandbox(root, 'auto-sourced-merge');
  for (const dir of ['data', 'batch/tracker-additions', 'reports', 'lib', 'templates', 'dashboard-web/server']) {
    fs.mkdirSync(path.join(sandbox, dir), { recursive: true });
  }
  fs.copyFileSync(path.join(root, 'merge-tracker.mjs'), path.join(sandbox, 'merge-tracker.mjs'));
  for (const module of [
    'discard.mjs', 'tracker.mjs', 'scan-core.mjs', 'identity.mjs', 'pipeline.mjs',
    'log-writes.mjs', 'local-date.mjs', 'event-store.mjs', 'event-store-switch.mjs',
    'legacy-files.mjs', 'atomic-write.mjs', 'void-events.mjs', 'passed.mjs',
  ]) {
    fs.copyFileSync(path.join(root, 'lib', module), path.join(sandbox, 'lib', module));
  }
  fs.copyFileSync(path.join(root, 'templates', 'states.yml'), path.join(sandbox, 'templates', 'states.yml'));
  fs.copyFileSync(path.join(root, 'dashboard-web', 'server', 'v1-loader.mjs'), path.join(sandbox, 'dashboard-web', 'server', 'v1-loader.mjs'));
  fs.writeFileSync(path.join(sandbox, 'data', 'applications.md'), [
    '# Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR, '',
  ].join('\n'));
  fs.writeFileSync(path.join(sandbox, 'batch', 'obsidian-auto-sourced.txt'), listed ? `${url}\n` : '\n');
  if (pipeline) fs.writeFileSync(path.join(sandbox, 'data', 'pipeline.md'), `- [ ] ${url} | ${company} | ${role}\n`);
  const reportPath = `reports/${num}-fixture.md`;
  fs.writeFileSync(path.join(sandbox, reportPath), report(url));
  fs.writeFileSync(path.join(sandbox, 'batch', 'tracker-additions', `${num}-fixture.tsv`), addition({
    num, company, role, score, reportPath, notes,
  }));

  execFileSync(process.execPath, [path.join(sandbox, 'merge-tracker.mjs')], { encoding: 'utf8' });

  const rows = fs.readFileSync(path.join(sandbox, 'data', 'applications.md'), 'utf8')
    .split(/\r?\n/).map(parseTrackerLine).filter(Boolean);
  const sourceLog = fs.existsSync(path.join(sandbox, 'data', 'source-corrections.tsv'))
    ? fs.readFileSync(path.join(sandbox, 'data', 'source-corrections.tsv'), 'utf8') : '';
  return { row: rows[0], sourceLog };
}

const tagged = runCase({ num: 1001, url: 'https://jobs.example.test/roles/11?utm_source=fixture', listed: true });
check(/\[auto-sourced\]/i.test(tagged.row.notes), 'listed URL receives the auto sourced tag');
check(!/\[self-sourced\]/i.test(tagged.row.notes), 'listed URL does not receive the self sourced tag');
check(/added-auto-sourced/.test(tagged.sourceLog), 'auto sourced addition is logged');

const replaced = runCase({ num: 1002, url: 'https://jobs.example.test/roles/12', listed: true, notes: '[self-sourced] Invented note' });
check(/\[auto-sourced\]/i.test(replaced.row.notes) && !/\[self-sourced\]/i.test(replaced.row.notes), 'stray self sourced tag is replaced');

const ordinary = runCase({ num: 1003, url: 'https://jobs.example.test/roles/13' });
check(/\[self-sourced\]/i.test(ordinary.row.notes), 'unlisted URL remains self sourced');

const scanned = runCase({ num: 1004, url: 'https://jobs.example.test/roles/14', listed: true, pipeline: true, notes: '[self-sourced] Invented note' });
check(!/\[(?:self-sourced|auto-sourced)\]/i.test(scanned.row.notes), 'pipeline URL has neither source tag');

const lowAuto = runCase({ num: 1005, url: 'https://jobs.example.test/roles/15', listed: true, score: '2.0/5' });
const lowSelf = runCase({ num: 1006, url: 'https://jobs.example.test/roles/16', score: '2.0/5' });
check(lowAuto.row.status === 'Passed', 'low scoring auto sourced row is passed');
check(lowSelf.row.status === 'Evaluated', 'low scoring self sourced row stays evaluated');

const referral = runCase({
  num: 1007,
  url: 'https://jobs.example.test/roles/17',
  company: 'Zorblax Widgetry',
  role: 'Revenue Systems Director',
  listed: true,
  notes: '[referral: Invented Name] Introduced for an invented role',
});
check(/\[referral: Invented Name\]/.test(referral.row.notes), 'referral tag is preserved');
check(!/\[auto-sourced\]/i.test(referral.row.notes), 'referral row receives no auto sourced tag');

console.log(`auto sourced merge fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
