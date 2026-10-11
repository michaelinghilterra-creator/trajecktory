#!/usr/bin/env node
/**
 * verify-reports-comp.test.mjs - pins the Comp drift check in verify-reports.mjs.
 *
 * The check used to read block D, which is compensation only in the legacy
 * prose layout. In a v1 report D is "Cultural Signals", so a dollar figure in
 * the culture text raised a false format-drift alarm. For v1 reports the check
 * must ask whether the frontmatter carries comp that the conversion drops.
 *
 * The script reads reports/ next to itself, so the test runs a copy of it in a
 * sandbox with its imports pointed back at the repo.
 *
 * Run: node tests/verify-reports-comp.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import { makeSandbox } from './helpers/sandbox.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ok ${msg}`); passed++; }
  else { console.log(`  fail ${msg}`); failed++; }
}

console.log('verify-reports-comp.test.mjs');

const sandbox = makeSandbox('verify-reports-comp');
mkdirSync(join(sandbox, 'reports'), { recursive: true });

const toUrl = (rel) => pathToFileURL(join(ROOT, rel)).href;
const source = readFileSync(join(ROOT, 'verify-reports.mjs'), 'utf8')
  .replace("'./dashboard-web/server/parser.mjs'", `'${toUrl('dashboard-web/server/parser.mjs')}'`)
  .replace("'./dashboard-web/server/v1-loader.mjs'", `'${toUrl('dashboard-web/server/v1-loader.mjs')}'`)
  .replace("'./lib/pipeline.mjs'", `'${toUrl('lib/pipeline.mjs')}'`);
check(source.includes('file:///'), 'the sandbox copy imports resolve back to the repo');
writeFileSync(join(sandbox, 'verify-reports.mjs'), source);

// Invented v1 report. Block D is culture text carrying a dollar figure.
function report(id, { comp } = {}) {
  const front = {
    schema: 'trajecktory-report/v1',
    id,
    company: 'Zorblax Widgetry',
    role: 'Lead Widget Analyst',
    date: '2030-01-05',
    url: `https://jobs.example.test/zorblax/${id}`,
    jdSnapshot: `jds/${id}-zorblax.md`,
    score: 3.5,
    domain: 'Widgets',
    legitimacy: { tier: 'High Confidence', conclusion: 'Looks real.', signals: [] },
    summary: { compStated: '$100,000-$120,000 USD' },
    ...(comp ? { comp } : {}),
  };
  return `---\n${JSON.stringify(front, null, 2)}\n---\n\n# Report\n\n## C) Comp\n\n$100,000-$120,000.\n\n## D) Cultural Signals / Company Quality\n\nZorblax Widgetry raised $350M and has a remote-first culture.\n\n## E) Red Flags\n\n- None worth noting\n`;
}

const nameOf = (id) => `${id}-zorblax-widgetry-2030-01-05.md`;
writeFileSync(join(sandbox, 'reports', nameOf(900001)), report(900001));
writeFileSync(join(sandbox, 'reports', nameOf(900002)), report(900002, { comp: { stated: '$100,000-$120,000 USD' } }));

const run = spawnSync(process.execPath, [join(sandbox, 'verify-reports.mjs'), '--json'], { cwd: sandbox, encoding: 'utf8' });
let out = null;
try { out = JSON.parse(run.stdout); } catch { /* reported below */ }
check(out !== null, 'the checker prints parseable JSON');

const driftFor = (id) => (out?.drift || []).filter(d => String(d.num) === String(id));
check(out?.total === 2, 'both invented reports were checked');
check(driftFor(900001).length === 0, 'a dollar figure in v1 culture text is not flagged as missing comp');
check(driftFor(900002).length === 0, 'a v1 report whose frontmatter comp converts cleanly is not flagged');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
