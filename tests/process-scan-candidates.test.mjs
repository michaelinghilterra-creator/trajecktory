#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(cond, label) {
  if (cond) { console.log(`  PASS ${label}`); passed++; }
  else { console.log(`  FAIL ${label}`); failed++; }
}

console.log('process-scan-candidates.test.mjs');
const dir = makeSandbox('process-scan-candidates');
try {
  mkdirSync(join(dir, 'batch'));
  mkdirSync(join(dir, 'data'));
  writeFileSync(join(dir, 'batch', 'scan-candidates.json'), JSON.stringify([{
    url: 'https://jobs.example.test/zorblax/9001',
    company: 'Zorblax Systems',
    title: 'Widget Lead',
    query: 'widget lead',
  }]));
  writeFileSync(join(dir, 'portals.yml'), 'title_filter:\n  positive:\n    - widget\n');
  writeFileSync(join(dir, 'data', 'scan-history.tsv'), 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\n');
  writeFileSync(join(dir, 'data', 'pipeline.md'), '# Discovery Queue\n\nNo pending section yet.\n');
  writeFileSync(join(dir, 'data', 'applications.md'), `# Applications Tracker\n\n${TRACKER_HEADER}\n${TRACKER_SEPARATOR}\n`);

  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const run = spawnSync(process.execPath, [join(root, 'batch', 'process-scan-candidates.mjs')], {
    cwd: dir, encoding: 'utf8', timeout: 5000,
  });
  const pipeline = readFileSync(join(dir, 'data', 'pipeline.md'), 'utf8');
  const headingAt = pipeline.indexOf('## Pendientes');
  const rowAt = pipeline.indexOf('- [ ] https://jobs.example.test/zorblax/9001');
  check(run.status === 0, 'candidate processor exits successfully');
  check(headingAt >= 0, 'a missing pending section is created with the standard heading');
  check(rowAt > headingAt, 'new rows are written under the created pending heading');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
