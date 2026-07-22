#!/usr/bin/env node
/**
 * identity-single-source.test.mjs — a source-level guard, not a behavior test.
 *
 * Every other suite checks that identity logic is CORRECT. This one checks that
 * there is only ONE of it.
 *
 * That distinction is the whole point. `merge-tracker.mjs` carried its own
 * private copies of roleSignature, setsEqual and a role matcher for months.
 * Every test passed the entire time, because each copy was individually correct.
 * What was wrong was that there were several, keyed on different rules, so a
 * posting could dodge one check while tripping another. No behavior test can see
 * that: it is a property of the source tree, not of any single function's output.
 *
 * The same shape produced the second regression. Three scripts decided "is this
 * the table separator row?" by asking whether the line contained three hyphens.
 * Each was fine until rows began carrying posting URLs, and one major ATS writes
 * spaces in a URL as hyphens, at which point seven live rows became invisible to
 * the merge. `parseTrackerLine` had always known the answer; the hand-rolled
 * version was the bug.
 *
 * So this asserts two rules from AGENTS.md that are otherwise unenforceable:
 *   1. Posting identity is defined in lib/identity.mjs and NOWHERE else.
 *   2. Tracker rows are recognized by lib/tracker.mjs and NOWHERE else.
 *
 * Re-exporting is fine and is not a definition: lib/scan-core.mjs deliberately
 * exposes `canonicalUrl` under its historical name so older callers keep working
 * while still resolving to the one implementation.
 *
 * Run: node tests/identity-single-source.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

let passed = 0, failed = 0;
function check(cond, msg, detail) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); if (detail) for (const d of detail) console.log(`       ${d}`); failed++; }
}

// Source files that actually ship. installer/payload is a build artifact (a copy
// of the tree), so scanning it would double-report every finding.
const SKIP_DIRS = new Set(['node_modules', '.git', 'installer', 'output', 'data', 'reports', 'dist', 'tests']);
function sources(dir = ROOT, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.claude') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      sources(p, out);
    } else if (/\.(mjs|jsx)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}
const files = sources();
const rel = (p) => relative(ROOT, p).split(sep).join('/');

// A DEFINITION, not a mention. Line-anchored and requiring the declaration
// keyword, so a comment naming the function and an `import { sameRole }` both
// pass. Without that precision the guard would fire on the comments explaining
// why the logic moved, and a test that flags its own documentation gets deleted.
function definesAny(text, names) {
  const hits = [];
  for (const n of names) {
    const fn = new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${n}\\s*\\(`, 'm');
    const va = new RegExp(`^\\s*(?:export\\s+)?(?:const|let|var)\\s+${n}\\s*=`, 'm');
    if (fn.test(text) || va.test(text)) hits.push(n);
  }
  return hits;
}

console.log('\n1. Posting identity is defined in exactly one place');
{
  const IDENTITY_FNS = [
    'canonicalUrl', 'normalizeUrl', 'normalizeCompany',
    'sameRole', 'roleSignature', 'roleFuzzyMatch',
    'urlFromReport', 'urlForRow', 'buildDecidedIndex', 'findDecided',
  ];
  const owner = 'lib/identity.mjs';
  const offenders = [];
  for (const f of files) {
    if (rel(f) === owner) continue;
    const hits = definesAny(readFileSync(f, 'utf-8'), IDENTITY_FNS);
    if (hits.length) offenders.push(`${rel(f)} defines ${hits.join(', ')}`);
  }
  check(offenders.length === 0,
    `no file outside ${owner} defines an identity function`, offenders);
}

console.log('\n2. The role vocabulary is not duplicated');
{
  // The stopword and level tables ARE the role matcher. A second copy drifts
  // from the first silently, which is exactly how two matchers with the same
  // name came to disagree.
  const VOCAB = ['ROLE_STOPWORDS', 'LEVEL_CANON'];
  const owner = 'lib/identity.mjs';
  const offenders = [];
  for (const f of files) {
    if (rel(f) === owner) continue;
    const hits = definesAny(readFileSync(f, 'utf-8'), VOCAB);
    if (hits.length) offenders.push(`${rel(f)} defines ${hits.join(', ')}`);
  }
  check(offenders.length === 0, `no file outside ${owner} defines the role vocabulary`, offenders);
}

console.log('\n3. Tracker rows are not recognized by hand');
{
  // Scoped to files that actually read the tracker. `includes('---')` is a
  // perfectly good test elsewhere; it is only wrong as a stand-in for "this is
  // the separator row", because a posting URL can contain that sequence.
  const offenders = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf-8');
    const readsTracker = /applications\.md|parseTracker/.test(text);
    if (!readsTracker) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (/\.includes\(\s*['"]---['"]\s*\)/.test(line)) {
        offenders.push(`${rel(f)}:${i + 1} uses .includes('---') to identify a row`);
      }
    });
  }
  check(offenders.length === 0,
    "no tracker reader detects the separator row with .includes('---')", offenders);
}

console.log('\n4. The guard can actually see a violation');
{
  // A guard that has only ever passed is indistinguishable from one that matches
  // nothing. Prove the matchers fire against synthetic sources before trusting
  // that the real tree is clean.
  const planted = [
    ['function sameRole(a, b) { return a === b; }', ['sameRole']],
    ['const canonicalUrl = (u) => u;', ['canonicalUrl']],
    ['export function normalizeCompany(n) { return n; }', ['normalizeCompany']],
  ];
  let sees = 0;
  for (const [src, expect] of planted) {
    const hits = definesAny(src, ['canonicalUrl', 'normalizeCompany', 'sameRole']);
    if (JSON.stringify(hits) === JSON.stringify(expect)) sees++;
  }
  check(sees === planted.length, `detects a planted definition in all ${planted.length} declaration forms`);

  // And prove it does NOT fire on the forms that are legitimate, or the guard
  // would flag every importer and be switched off within a week.
  const allowed = [
    "import { sameRole, canonicalUrl } from './lib/identity.mjs';",
    "export { canonicalUrl as normalizeUrl } from './identity.mjs';",
    '// normalizeCompany and sameRole now live in lib/identity.mjs',
    'const x = sameRole(a, b) && canonicalUrl(u);',
  ];
  const falsePositives = allowed.filter(s => definesAny(s, ['canonicalUrl', 'normalizeCompany', 'sameRole']).length);
  check(falsePositives.length === 0,
    'does not fire on imports, re-exports, comments, or call sites', falsePositives);
}

console.log(`\n${failed === 0 ? '🟢' : '🔴'} identity-single-source: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
