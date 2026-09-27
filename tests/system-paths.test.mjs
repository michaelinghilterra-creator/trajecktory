// Verify every tracked root script is listed in SYSTEM_PATHS
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function pass(msg) {
  passed++;
  console.log(`  ok ${msg}`);
}

function fail(msg) {
  failed++;
  console.log(`  FAIL ${msg}`);
}

const src = readFileSync(join(ROOT, 'update-system.mjs'), 'utf8');
const block = src.match(/SYSTEM_PATHS\s*=\s*\[([\s\S]*?)\n\]/);
const entries = block
  ? [...block[1].replace(/\/\/[^\n]*/g, '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  : [];

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean);
const rootScripts = tracked.filter((f) => !f.includes('/') && f.endsWith('.mjs'));

const EXCLUDED = {
  'eslint.config.mjs': 'contributor lint config, never run by an install',
};

const covered = (f) => entries.some((e) => (e.endsWith('/') ? f.startsWith(e) : f === e));

if (entries.length === 0) {
  fail('could not parse SYSTEM_PATHS from update-system.mjs');
} else {
  pass(`parsed ${entries.length} entries from SYSTEM_PATHS`);
}

if (rootScripts.includes('update-system.mjs') === false) {
  fail('git ls-files returned no root scripts, so this test would pass vacuously');
} else {
  pass(`found ${rootScripts.length} tracked root scripts`);
}

for (const f of rootScripts) {
  if (f in EXCLUDED) {
    continue;
  }
  if (covered(f)) {
    pass(f);
  } else {
    fail(`${f} is a tracked root script missing from SYSTEM_PATHS in update-system.mjs, so no installed copy receives it. Add it there, or add it to EXCLUDED in this test with the reason.`);
  }
}

for (const k of Object.keys(EXCLUDED)) {
  if (rootScripts.includes(k) === false) {
    fail(`EXCLUDED lists ${k}, which is not a tracked root script. Remove the stale entry.`);
  } else if (covered(k)) {
    fail(`${k} is in EXCLUDED and also in SYSTEM_PATHS. Pick one.`);
  } else {
    pass(`${k} excluded: ${EXCLUDED[k]}`);
  }
}

console.log(`\nsystem-paths: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
