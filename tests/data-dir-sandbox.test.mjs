#!/usr/bin/env node
/**
 * data-dir-sandbox.test.mjs: a source-level guard, not a behavior test.
 *
 * Every store path must be built from DATA_DIR. Never from ROOT_DIR + 'data'.
 *
 * The two look interchangeable and are not. Only DATA_DIR honors TJK_DATA_DIR
 * (config.mjs), which is the single mechanism that keeps a test run off the
 * user's real tracker. A path assembled from ROOT_DIR silently escapes it.
 *
 * This is not hypothetical. On 2026-08-22 six modules were building data paths
 * that way, and tests/linkedin-acceptance.test.mjs calls saveConnections(),
 * which is a whole-file overwrite. A routine `node test-all.mjs` therefore
 * replaced a real, fully populated LinkedIn export with the two fixture rows
 * from that suite. data/ is gitignored end to end, so there was no version to
 * restore and the export had to be re-imported from a fresh CSV download.
 *
 * No behavior test could have caught it. Each of the six paths was individually
 * correct in production, where ROOT_DIR + 'data' and DATA_DIR resolve to the
 * same folder. They diverge only under TJK_DATA_DIR, which is exactly when a
 * test is running, which is exactly when the damage happens. It is a property
 * of the source tree, so the guard has to be too.
 *
 * Run: node tests/data-dir-sandbox.test.mjs   (exit 0 = pass, 1 = fail)
 */
import { readFileSync, readdirSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let passed = 0, failed = 0;
function check(cond, msg, detail) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); if (detail) for (const d of detail) console.log(`       ${d}`); failed++; }
}

// installer/payload is a build-time copy of the tree and worktrees are full
// checkouts, so scanning either double-reports every finding against a copy
// nobody edits. Same exclusion list and same reasoning as
// tests/identity-single-source.test.mjs.
const SKIP_DIRS = new Set(['node_modules', '.git', 'installer', 'output', 'data', 'reports', 'dist', 'worktrees']);
function sources(dir = ROOT, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.claude') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (SKIP_DIRS.has(e.name)) continue; sources(p, out); }
    else if (/\.mjs$/.test(e.name)) out.push(p);
  }
  return out;
}
const rel = (p) => relative(ROOT, p).split(sep).join('/');

// Matches path.join(ROOT_DIR, 'data', ...) and path.resolve(ROOT_DIR, "data", ...)
// with any spacing and either quote style. Deliberately narrow: it fires only on
// ROOT_DIR immediately followed by a 'data' segment, which is always the bug.
const OFFENDER = /ROOT_DIR\s*,\s*(['"])data\1/;

console.log('\n1. No store path is built from ROOT_DIR + "data"');
{
  const offenders = [];
  for (const f of sources()) {
    // The guard file itself and config.mjs are allowed to name the pattern:
    // config.mjs DEFINES the correct one, and this test documents the wrong one.
    if (rel(f) === 'tests/data-dir-sandbox.test.mjs') continue;
    if (rel(f) === 'dashboard-web/server/config.mjs') continue;
    const text = readFileSync(f, 'utf-8');
    text.split('\n').forEach((line, i) => {
      if (OFFENDER.test(line)) offenders.push(`${rel(f)}:${i + 1} ${line.trim()}`);
    });
  }
  check(offenders.length === 0,
    'every data path resolves through DATA_DIR, so TJK_DATA_DIR sandboxes it', offenders);
}

console.log('\n2. DATA_DIR is the only thing TJK_DATA_DIR redirects');
{
  const cfg = readFileSync(join(ROOT, 'dashboard-web/server/config.mjs'), 'utf-8');
  check(/TJK_DATA_DIR/.test(cfg) && /export const DATA_DIR/.test(cfg),
    'config.mjs still defines DATA_DIR from TJK_DATA_DIR');
}

console.log('\n3. The guard can actually see a violation');
{
  // A guard that has only ever passed is indistinguishable from one that matches
  // nothing. Prove the matcher fires on the real forms before trusting a clean tree.
  const planted = [
    "const FILE = path.join(ROOT_DIR, 'data', 'inmail-usage.json');",
    'const C = path.resolve(ROOT_DIR, "data", "release-notes-cache.json");',
    "const D = path.join( ROOT_DIR ,  'data' , 'x.json');",
  ];
  check(planted.every(s => OFFENDER.test(s)), `detects a planted violation in all ${planted.length} forms`);

  // And prove it does NOT fire on the legitimate neighbours, or it would flag
  // every remaining ROOT_DIR use and get switched off within a week.
  const allowed = [
    "const TEMPLATES_PATH = path.join(ROOT_DIR, 'templates', 'outreach-sequences.json');",
    "const VERSION_FILE = path.resolve(ROOT_DIR, 'VERSION');",
    "import { ROOT_DIR, DATA_DIR } from '../config.mjs';",
    "const FILE = path.join(DATA_DIR, 'inmail-usage.json');",
    "execFileSync('git', ['remote'], { cwd: ROOT_DIR });",
  ];
  const falsePositives = allowed.filter(s => OFFENDER.test(s));
  check(falsePositives.length === 0,
    'does not fire on templates, VERSION, imports, DATA_DIR paths, or cwd', falsePositives);
}

console.log(`\n${failed === 0 ? '🟢' : '🔴'} data-dir-sandbox: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
