#!/usr/bin/env node
/**
 * workday-repair.test.mjs - guards repair-workday-urls.mjs, which rewrites the url
 * cell of rows in the user's irreplaceable tracker.
 *
 * The failure mode is silent: a shifted cell still makes a valid row. So the
 * script-level checks assert on the SHAPE of the whole file (line count, every
 * carried cell, every untouched line byte-identical), not on the url cell alone.
 *
 * Runs the real script inside a throwaway sandbox (it resolves every path relative
 * to its own location). All names, ids and dates are invented: tenants zorblax and
 * quennox, ids from 900001, dates in 2030.
 *
 * Run: node tests/workday-repair.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { mkdirSync, writeFileSync, readFileSync, copyFileSync, cpSync, readdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { makeRepoSandbox } from './helpers/sandbox.mjs';
import { isSitelessWorkdayUrl, buildWorkdaySiteMap, repairWorkdayUrl } from '../lib/workday-repair.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ok ${msg}`); passed++; }
  else { console.log(`  fail ${msg}`); failed++; }
}

console.log('workday-repair.test.mjs');

// 1. Pure helpers
console.log('\n1. Helpers');
{
  const Z = 'https://zorblax.wd1.myworkdayjobs.com';
  const job = '/job/Example-City/Widget-Manager_JR900001-1';
  check(isSitelessWorkdayUrl(`${Z}${job}`), 'a site-less posting link is detected');
  check(!isSitelessWorkdayUrl(`${Z}/ZorblaxCareers${job}`), 'a link with a site is not');
  check(!isSitelessWorkdayUrl(`${Z}/ZorblaxCareers`), 'a board link is not');
  check(!isSitelessWorkdayUrl('https://jobs.example.test/zorblax/1') && !isSitelessWorkdayUrl('') && !isSitelessWorkdayUrl(null), 'non-Workday and empty values are not');

  const map = buildWorkdaySiteMap([
    { name: 'A', careers_url: `${Z}/ZorblaxCareers` },
    { name: 'A again', careers_url: `${Z}/zorblaxcareers` },                      // same site, other spelling
    { name: 'B', careers_url: 'https://quennox.wd5.myworkdayjobs.com/en-US/QuennoxEast' },   // locale stripped
    { name: 'C', api: 'https://quennox.wd5.myworkdayjobs.com/QuennoxWest' },     // read from api too
    { name: 'D', careers_url: 'https://boards.example.test/zorblax' },           // not Workday
    { name: 'E' },                                                              // no urls
  ]);
  check(map.get('zorblax.wd1').size === 1, 'two spellings of one site are one site');
  check([...map.get('quennox.wd5').values()].sort().join() === 'QuennoxEast,QuennoxWest', 'locale is stripped and api is read');
  check(!map.has('boards'), 'non-Workday entries are ignored');

  const ok = repairWorkdayUrl(`${Z}${job}`, map);
  check(ok.status === 'repaired' && ok.url === `${Z}/ZorblaxCareers${job}` && ok.site === 'ZorblaxCareers', 'a single-site tenant is repaired to the exact link');
  check(repairWorkdayUrl(`https://ZORBLAX.WD1.myworkdayjobs.com${job}`, map).url === `https://ZORBLAX.WD1.myworkdayjobs.com/ZorblaxCareers${job}`, 'the host spelling is kept and the tenant lookup ignores case');
  check(repairWorkdayUrl(`https://quennox.wd5.myworkdayjobs.com${job}`, map).status === 'ambiguous', 'a tenant with two sites is ambiguous, never guessed');
  check(repairWorkdayUrl(`https://vandelay.wd3.myworkdayjobs.com${job}`, map).status === 'no-site', 'an unknown tenant has no site');
  check(repairWorkdayUrl(`${Z}/ZorblaxCareers${job}`, map).status === 'not-siteless', 'an already-correct link is left alone');
}

// 2. Script, in a sandbox
const sandbox = makeRepoSandbox(ROOT, 'wdrepair-test');
mkdirSync(join(sandbox, 'data'), { recursive: true });
mkdirSync(join(sandbox, 'batch/tracker-additions'), { recursive: true });
copyFileSync(join(ROOT, 'repair-workday-urls.mjs'), join(sandbox, 'repair-workday-urls.mjs'));
copyFileSync(join(ROOT, 'liveness-core.mjs'), join(sandbox, 'liveness-core.mjs'));
cpSync(join(ROOT, 'lib'), join(sandbox, 'lib'), { recursive: true });

const APPS = join(sandbox, 'data/applications.md');
const Z = 'https://zorblax.wd1.myworkdayjobs.com';
const jobPath = (n) => `/job/Example-City/Widget-Manager_JR9000${n}-1`;
const L = (n, co, url, notes = 'n') =>
  `| ${n} | 2030-01-0${n - 900000} | ${co} | Director, Widget Operations | 4.0/5 | Evaluated | X | - | [${n}](reports/${n}-x-2030-01-01.md) | ${notes} |${url === null ? '' : ` ${url} |`}`;

const seed = [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
  L(900001, 'Zorblax Widgetry', `${Z}${jobPath(1)}`),                                   // repaired
  L(900002, 'Zorblax Widgetry', `${Z}/ZorblaxCareers${jobPath(2)}`),                     // already correct
  L(900003, 'Quennox Ratchet Works', `https://quennox.wd5.myworkdayjobs.com${jobPath(3)}`), // ambiguous
  L(900004, 'Vandelay Industrial', `https://vandelay.wd3.myworkdayjobs.com${jobPath(4)}`),  // no site
  L(900005, 'Globex Example', 'https://boards.example.test/globex/900005'),               // not Workday
  L(900006, 'Zorblax Widgetry', `https://ZORBLAX.WD1.myworkdayjobs.com${jobPath(6)}`),     // repaired, host case kept
  L(900007, 'Zorblax Widgetry', null),                                                   // no url cell
  L(900008, 'Zorblax Widgetry', 'https://boards.example.test/zorblax/900008', `see ${Z}${jobPath(8)} for context`), // link only in notes
  '',
].join('\n');
writeFileSync(APPS, seed);

writeFileSync(join(sandbox, 'portals.yml'), [
  'tracked_companies:',
  '  - name: Zorblax Widgetry',
  `    careers_url: ${Z}/ZorblaxCareers`,
  '  - name: Quennox East',
  '    careers_url: https://quennox.wd5.myworkdayjobs.com/QuennoxEast',
  '  - name: Quennox West',
  '    careers_url: https://quennox.wd5.myworkdayjobs.com/QuennoxWest',
  '',
].join('\n'));

const run = (args = []) => {
  try {
    return { out: execFileSync('node', [join(sandbox, 'repair-workday-urls.mjs'), ...args], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }), code: 0 };
  } catch (e) {
    return { out: (e.stdout || '') + (e.stderr || ''), code: e.status ?? 1 };
  }
};
const rowsOf = (text) => text.split('\n').filter((l) => /^\|\s*\d/.test(l));
const cells = (l) => l.split('|').map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
const backups = () => readdirSync(join(sandbox, 'data')).filter((f) => f.includes('workday-url-repair'));

console.log('\n2. Dry run');
const beforeText = readFileSync(APPS, 'utf-8');
{
  const dry = run();
  check(dry.code === 0, 'dry run exits 0');
  check(readFileSync(APPS, 'utf-8') === beforeText, 'dry run leaves the tracker byte-identical');
  check(/site-less Workday links\s*:\s*4/.test(dry.out), 'counts 4 site-less links (the two correct and the notes-only ones are not counted)');
  check(/will be repaired\s*:\s*2/.test(dry.out), 'plans 2 repairs');
  check(/ambiguous \(several sites\)\s*:\s*1/.test(dry.out), 'reports 1 ambiguous');
  check(/no site known in portals\.yml\s*:\s*1/.test(dry.out), 'reports 1 with no known site');
  check(backups().length === 0, 'dry run writes no backup');
}

console.log('\n3. Merge-in-flight guard');
{
  writeFileSync(join(sandbox, 'batch/tracker-additions/900100-pending.tsv'), 'x\n');
  const blocked = run(['--apply']);
  check(blocked.code === 1, '--apply refuses while an unmerged TSV is pending');
  check(readFileSync(APPS, 'utf-8') === beforeText, 'refusal leaves the tracker untouched');
  rmSync(join(sandbox, 'batch/tracker-additions/900100-pending.tsv'));
}

console.log('\n4. Missing portals config');
{
  const bad = run(['--apply', '--portals', join(sandbox, 'does-not-exist.yml')]);
  check(bad.code === 1, 'a missing portals file is refused');
  check(readFileSync(APPS, 'utf-8') === beforeText, 'and nothing is written');
}

console.log('\n5. Apply');
{
  const applied = run(['--apply']);
  check(applied.code === 0, '--apply exits 0');
  const after = readFileSync(APPS, 'utf-8');
  const b = rowsOf(beforeText), a = rowsOf(after);
  check(a.length === b.length && after.split('\n').length === beforeText.split('\n').length, 'row and line counts are unchanged');
  check(cells(a[0])[10] === `${Z}/ZorblaxCareers${jobPath(1)}`, 'row 1 url is exactly the repaired link');
  check(cells(a[5])[10] === `https://ZORBLAX.WD1.myworkdayjobs.com/ZorblaxCareers${jobPath(6)}`, 'row 6 keeps its host spelling');
  const untouched = [1, 2, 3, 4, 6, 7].every((i) => a[i] === b[i]);
  check(untouched, 'ambiguous, unknown, correct, non-Workday, url-less and notes-only rows are byte-identical');
  let othersSame = true;
  for (let i = 0; i < b.length; i++) {
    const cb = cells(b[i]), ca = cells(a[i]);
    if (cb.length !== ca.length) { othersSame = false; continue; }
    for (let k = 0; k < cb.length; k++) if (k !== 10 && cb[k] !== ca[k]) othersSame = false;
  }
  check(othersSame, 'every non-url cell of every row is byte-identical');
  check(after.split('\n').filter((l) => !/^\|\s*\d/.test(l)).join('\n') === beforeText.split('\n').filter((l) => !/^\|\s*\d/.test(l)).join('\n'), 'header, separator and blank lines are untouched');
  check(backups().length === 1, 'one timestamped backup was written');
  check(readFileSync(join(sandbox, 'data', backups()[0]), 'utf-8') === beforeText, 'the backup is the exact pre-run file');
}

console.log('\n6. Idempotent');
{
  const afterFirst = readFileSync(APPS, 'utf-8');
  const again = run(['--apply']);
  check(again.code === 0 && /will be repaired\s*:\s*0/.test(again.out), 'a second run finds nothing to repair');
  check(readFileSync(APPS, 'utf-8') === afterFirst, 'and leaves the file untouched');
  check(backups().length === 1, 'and writes no second backup');
}

console.log('\n7. JSON summary');
{
  const j = run(['--json']);
  let parsed = null;
  try { parsed = JSON.parse(j.out); } catch { /* checked below */ }
  check(parsed && parsed.ok === true && parsed.applied === false && parsed.repaired === 0 && parsed.ambiguous.length === 1 && parsed.noSite.length === 1, '--json reports the summary');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
