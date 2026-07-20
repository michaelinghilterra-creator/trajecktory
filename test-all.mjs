#!/usr/bin/env node

/**
 * test-all.mjs — Comprehensive test suite for career-ops
 *
 * Run before merging any PR or pushing changes.
 * Tests: syntax, scripts, dashboard, data contract, personal data, paths.
 *
 * Usage:
 *   node test-all.mjs           # Run all tests
 *   node test-all.mjs --quick   # Skip dashboard build (faster)
 */

import { execSync, execFileSync } from 'child_process';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const QUICK = process.argv.includes('--quick');

let passed = 0;
let failed = 0;
let warnings = 0;

function pass(msg) { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌ ${msg}`); failed++; }
function warn(msg) { console.log(`  ⚠️  ${msg}`); warnings++; }

function run(cmd, args = [], opts = {}) {
  try {
    if (Array.isArray(args) && args.length > 0) {
      return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
    }
    return execSync(cmd, { cwd: ROOT, encoding: 'utf-8', timeout: 30000, ...opts }).trim();
  } catch (e) {
    return null;
  }
}

function fileExists(path) { return existsSync(join(ROOT, path)); }
function readFile(path) { return readFileSync(join(ROOT, path), 'utf-8'); }

console.log('\n🧪 career-ops test suite\n');

// ── 1. SYNTAX CHECKS ────────────────────────────────────────────

console.log('1. Syntax checks');

const mjsFiles = readdirSync(ROOT).filter(f => f.endsWith('.mjs'));
for (const f of mjsFiles) {
  const result = run('node', ['--check', f]);
  if (result !== null) {
    pass(`${f} syntax OK`);
  } else {
    fail(`${f} has syntax errors`);
  }
}

// ── 2. SCRIPT EXECUTION ─────────────────────────────────────────

console.log('\n2. Script execution (graceful on empty data)');

const scripts = [
  { name: 'cv-sync-check.mjs', expectExit: 1, allowFail: true }, // fails without cv.md (normal in repo)
  { name: 'verify-pipeline.mjs', expectExit: 0 },
  // Validates templates/runsheet-example.run.md (tracked) plus any user boards under
  // interview-prep/ (gitignored). In CI only the example exists, which is the point:
  // this line used to pass vacuously because the walk covered the user layer ONLY,
  // so a broken shipped example was green.
  { name: 'verify-runsheets.mjs', expectExit: 0 },
  { name: 'normalize-statuses.mjs', expectExit: 0 },
  { name: 'dedup-tracker.mjs', expectExit: 0 },
  { name: 'merge-tracker.mjs', expectExit: 0 },
  { name: 'update-system.mjs check', expectExit: 0 },
];

for (const { name, allowFail } of scripts) {
  const result = run('node', name.split(' '), { stdio: ['pipe', 'pipe', 'pipe'] });
  if (result !== null) {
    pass(`${name} runs OK`);
  } else if (allowFail) {
    warn(`${name} exited with error (expected without user data)`);
  } else {
    fail(`${name} crashed`);
  }
}

// ── 3. LIVENESS CLASSIFICATION ──────────────────────────────────

console.log('\n3. Liveness classification');

try {
  const { classifyLiveness } = await import(pathToFileURL(join(ROOT, 'liveness-core.mjs')).href);

  const expiredChromeApply = classifyLiveness({
    finalUrl: 'https://example.com/jobs/closed-role',
    bodyText: 'Company Careers\nApply\nThe job you are looking for is no longer open.',
    applyControls: [],
  });
  if (expiredChromeApply.result === 'expired') {
    pass('Expired pages are not revived by nav/footer "Apply" text');
  } else {
    fail(`Expired page misclassified as ${expiredChromeApply.result}`);
  }

  const activeWorkdayPage = classifyLiveness({
    finalUrl: 'https://example.workday.com/job/123',
    bodyText: [
      '663 JOBS FOUND',
      'Senior AI Engineer',
      'Join our applied AI team to ship production systems, partner with customers, and own delivery across evaluation, deployment, and reliability.',
    ].join('\n'),
    applyControls: ['Apply for this Job'],
  });
  if (activeWorkdayPage.result === 'active') {
    pass('Visible apply controls still keep real job pages active');
  } else {
    fail(`Active job page misclassified as ${activeWorkdayPage.result}`);
  }
} catch (e) {
  fail(`Liveness classification tests crashed: ${e.message}`);
}

// ── 5. DATA CONTRACT ────────────────────────────────────────────

console.log('\n5. Data contract validation');

// Check system files exist
const systemFiles = [
  'CLAUDE.md', 'VERSION', 'DATA_CONTRACT.md',
  'modes/_shared.md', 'modes/_profile.template.md',
  'modes/oferta.md', 'modes/pdf.md', 'modes/scan.md',
  'templates/states.yml', 'templates/cv-template.html',
  '.claude/skills/trajecktory/SKILL.md',
];

for (const f of systemFiles) {
  if (fileExists(f)) {
    pass(`System file exists: ${f}`);
  } else {
    fail(`Missing system file: ${f}`);
  }
}

// Check user files are NOT tracked (gitignored)
const userFiles = [
  'config/profile.yml', 'modes/_profile.md', 'portals.yml',
];
for (const f of userFiles) {
  const tracked = run('git', ['ls-files', f]);
  if (tracked === '') {
    pass(`User file gitignored: ${f}`);
  } else if (tracked === null) {
    pass(`User file gitignored: ${f}`);
  } else {
    fail(`User file IS tracked (should be gitignored): ${f}`);
  }
}

// ── 6. PERSONAL DATA LEAK CHECK ─────────────────────────────────

console.log('\n6. Personal data leak check');

// Upstream-author patterns stay hardcoded (original OSS author; verifies the
// santifer→owner migration stayed scrubbed). The CURRENT owner's patterns are
// derived from config/profile.yml at runtime, NOT hardcoded, so this file ships
// with no owner name/email/phone literal and the check works for any deployment.
// profile.yml is gitignored (present locally, never shipped); on a fresh clone
// it is absent and only the upstream patterns apply.
//
// Only patterns that are safe to PUBLISH belong here: this file is tracked, so
// every literal below ships to end users. The upstream author's name and site
// are required MIT attribution and are already public. His personal phone and
// personal email address are NOT, so they are deliberately absent — a
// leak-checker must not be the leak. Coverage is unchanged: the 'santifer.io'
// domain pattern still substring-matches any address at that domain.
const leakPatterns = [
  'Santiago', 'santifer.io', 'Santifer iRepair', 'Zinkee', 'ALMAS',
  '/Users/santifer/',
];
try {
  const prof = readFileSync(join(ROOT, 'config', 'profile.yml'), 'utf8');
  for (const key of ['full_name', 'email', 'phone']) {
    const m = prof.match(new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+)`, 'm'));
    if (!m || !m[1].trim()) continue;
    const val = m[1].trim();
    leakPatterns.push(val);
    if (key === 'full_name') { const s = val.split(/\s+/).pop(); if (s && s.length > 2) leakPatterns.push(s); }
    if (key === 'email') leakPatterns.push(val.split('@')[0]);
  }
} catch { /* no config/profile.yml on a fresh clone — upstream patterns only */ }

const scanExtensions = ['md', 'yml', 'html', 'mjs', 'js', 'jsx', 'sh', 'json'];
const allowedFiles = [
  // English README (legitimately credits the upstream author, santifer)
  'README.md',
  // Standard project files
  'LICENSE', 'CITATION.cff', 'CONTRIBUTING.md',
  'package.json', '.github/FUNDING.yml', 'CLAUDE.md', 'test-all.mjs',
  // Community + attribution files that legitimately reference the maintainer's
  // contact email or the upstream author (santifer) for credit.
  'CODE_OF_CONDUCT.md', 'SECURITY.md', 'SUPPORT.md', '.github/SECURITY.md',
  'NOTICE.md', 'AGENTS.md',
];

// Build pathspec for git grep — only scan tracked files matching these
// extensions. This is what `grep -rn` was trying to do, but git-aware:
// untracked files (debate artifacts, AI tool scratch, local plans/) and
// gitignored files can't trigger false positives because they were never
// going to reach a commit anyway.
const grepPathspec = scanExtensions.map(e => `'*.${e}'`).join(' ');

let leakFound = false;
for (const pattern of leakPatterns) {
  // No `2>/dev/null` here. This suite runs on Windows, where cmd has no /dev/null:
  // the redirect made every invocation fail with "The system cannot find the path
  // specified", run() swallowed the error, result came back empty, and the loop
  // reported a green "no leaks" having never actually grepped. run() already
  // try/catches, and git grep exits 1 on no-match, which is the same empty result.
  const result = run(`git grep -n "${pattern}" -- ${grepPathspec}`);
  if (result) {
    for (const line of result.split('\n')) {
      const file = line.split(':')[0];
      if (allowedFiles.some(a => file.includes(a))) continue;
      warn(`Possible upstream-author residue in ${file}: "${pattern}"`);
      leakFound = true;
    }
  }
}
if (!leakFound) {
  pass('No upstream-author residue outside allowed files');
}

// The real gate. The loop above is a migration-hygiene check over an extension
// allowlist, and it calls warn(), which does not affect the exit code — so it
// could never block anything. v1.14.0 shipped a real CV, a real recruiter's work
// email, a real walk-away figure, and real evaluation reports past a green run of
// this file. The .zip was not merely unflagged, it was unreadable: no extension in
// scanExtensions covers an archive, and its contents are compressed anyway.
//
// verify-no-pii.mjs is the enforcing check. It reads every tracked file regardless
// of extension, derives its terms at runtime from the gitignored sources, and
// exits nonzero on a hit. Same engine the installer runs against the built payload
// (build-bundle.ps1 §7), because `git archive HEAD` makes tracked == shipped.
try {
  execFileSync(process.execPath, ['verify-no-pii.mjs'], { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' });
  pass('No personal data in tracked files (verify-no-pii.mjs)');
} catch (e) {
  const out = `${e.stdout || ''}${e.stderr || ''}`.trim();
  fail('Personal data in tracked files — these ship to every user:');
  for (const line of out.split('\n').filter(l => /^\s+\[/.test(l) || /^\s{6}/.test(l))) {
    console.log(`      ${line.trim()}`);
  }
}

// The check above reads FILES. A commit message is published just as surely and is
// not a file, so none of it applies. That gap is not theoretical: while this very
// gate was being written, three commit messages here named the interview
// counterparties and one spelled out a real compensation band and walk-away in prose.
// Every one passed a green run of this suite.
//
// Scope is the unpushed commits, the only window where a message can still be
// amended. A fresh clone has nothing unpushed, so this is a silent no-op there.
try {
  execFileSync(process.execPath, ['verify-no-pii.mjs', '--messages'], { cwd: ROOT, encoding: 'utf-8', stdio: 'pipe' });
  pass('No personal data in unpushed commit messages');
} catch (e) {
  const out = `${e.stdout || ''}${e.stderr || ''}`.trim();
  fail('Personal data in a commit message — amend before pushing:');
  for (const line of out.split('\n').filter(l => /^\s+\[/.test(l) || /^\s{6}/.test(l))) {
    console.log(`      ${line.trim()}`);
  }
}

// ── 7. ABSOLUTE PATH CHECK ──────────────────────────────────────

console.log('\n7. Absolute path check');

// Same git grep approach: only scans tracked files. Untracked AI tool
// outputs, local debate artifacts, etc. can't false-positive here.
const absPathResult = run(
  `git grep -n "/Users/" -- '*.mjs' '*.sh' '*.md' '*.go' '*.yml' 2>/dev/null | grep -v README.md | grep -v LICENSE | grep -v CLAUDE.md | grep -v test-all.mjs`
);
if (!absPathResult) {
  pass('No absolute paths in code files');
} else {
  for (const line of absPathResult.split('\n').filter(Boolean)) {
    fail(`Absolute path: ${line.slice(0, 100)}`);
  }
}

// ── 7b. DASHBOARD ESCAPE-HATCH IMPORTS ──────────────────────────
//
// dashboard-web/server/index.mjs statically imports its routers, so a missing
// module is fatal at RESOLUTION time: the whole dashboard dies, not just one tab.
// SYSTEM_PATHS ships 'dashboard-web/' as a directory but enumerates root-level
// .mjs files INDIVIDUALLY, so any server file importing '../../../foo.mjs' will
// be delivered WITHOUT its target unless foo.mjs is listed. A local test can never
// catch this (the file exists in a dev checkout), so assert the manifest instead.

console.log('\n7b. Dashboard imports that escape dashboard-web/ are shipped');

const sysPathsSrc = readFileSync(join(ROOT, 'update-system.mjs'), 'utf8');
const sysPathsBlock = sysPathsSrc.match(/SYSTEM_PATHS\s*=\s*\[([\s\S]*?)\n\]/);
// Strip // comments BEFORE extracting the quoted entries. The entries are matched
// pairwise on ', so a lone apostrophe anywhere in a comment ("isn't", "doesn't")
// shifts every subsequent quote onto the wrong partner and silently drops real
// entries from the parse — which then fails this check against paths that ARE
// shipped. The manifest is the code; comments are not part of it.
const shipped = sysPathsBlock
  ? [...sysPathsBlock[1].replace(/\/\/[^\n]*/g, '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  : [];
if (!shipped.length) fail('Could not parse SYSTEM_PATHS from update-system.mjs — this check is inert until fixed');

const escapes = [];
const scanImports = (dir) => {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) { scanImports(full); continue; }
    if (!e.name.endsWith('.mjs')) continue;
    const src = readFileSync(full, 'utf-8');
    for (const m of src.matchAll(/^\s*import\s[^'"]*from\s+['"](\.\.[^'"]+)['"]/gm)) {
      // join() normalises the '..' segments for us
      const rel = relative(ROOT, join(dir, m[1])).replace(/\\/g, '/');
      if (rel.startsWith('dashboard-web/')) continue; // stays inside the shipped dir
      escapes.push({ from: relative(ROOT, full).replace(/\\/g, '/'), target: rel });
    }
  }
};
scanImports(join(ROOT, 'dashboard-web', 'server'));

if (!escapes.length) {
  pass('No dashboard server imports escape dashboard-web/');
} else {
  for (const { from, target } of escapes) {
    const covered = shipped.some((p) => p === target || (p.endsWith('/') && target.startsWith(p)));
    if (covered) pass(`${from} -> ${target} (in SYSTEM_PATHS)`);
    else fail(`${from} imports ${target}, which is NOT in SYSTEM_PATHS. An update would ship the importer without the target and kill the entire dashboard at module-resolution time.`);
  }
}

// ── 8. MODE FILE INTEGRITY ──────────────────────────────────────

console.log('\n8. Mode file integrity');

const expectedModes = [
  '_shared.md', '_profile.template.md', 'oferta.md', 'pdf.md', 'scan.md',
  'batch.md', 'apply.md', 'auto-pipeline.md', 'contacto.md', 'deep.md',
  'ofertas.md', 'pipeline.md', 'project.md', 'tracker.md', 'training.md',
];

for (const mode of expectedModes) {
  if (fileExists(`modes/${mode}`)) {
    pass(`Mode exists: ${mode}`);
  } else {
    fail(`Missing mode: ${mode}`);
  }
}

// Check _shared.md references _profile.md
const shared = readFile('modes/_shared.md');
if (shared.includes('_profile.md')) {
  pass('_shared.md references _profile.md');
} else {
  fail('_shared.md does NOT reference _profile.md');
}

// ── 9. CLAUDE.md INTEGRITY ──────────────────────────────────────

console.log('\n9. CLAUDE.md integrity');

const claude = readFile('CLAUDE.md');
const requiredSections = [
  'Data Contract', 'Update Check', 'Ethical Use',
  'Offer Verification', 'Canonical States', 'TSV Format',
  'First Run', 'Onboarding',
];

for (const section of requiredSections) {
  if (claude.includes(section)) {
    pass(`CLAUDE.md has section: ${section}`);
  } else {
    fail(`CLAUDE.md missing section: ${section}`);
  }
}

// ── 10. VERSION FILE ─────────────────────────────────────────────

console.log('\n10. Version file');

if (fileExists('VERSION')) {
  const version = readFile('VERSION').trim();
  if (/^\d+\.\d+\.\d+$/.test(version)) {
    pass(`VERSION is valid semver: ${version}`);
  } else {
    fail(`VERSION is not valid semver: "${version}"`);
  }
} else {
  fail('VERSION file missing');
}

// ── 11. FIXTURE SUITES (tests/) ─────────────────────────────────

console.log('\n11. Fixture suites');

for (const suite of [
  'tests/parser-fixtures.test.mjs',
  'tests/merge-tracker.test.mjs',
  'tests/discard.test.mjs',
  'tests/scan-core.test.mjs',
  'tests/outcome.test.mjs',
  'tests/tracker.test.mjs',
  'tests/liveness-workday.test.mjs',
  'tests/sidecars.test.mjs',
  'tests/metrics.test.mjs',
]) {
  if (!fileExists(suite)) {
    warn(`${suite} missing — skipped`);
    continue;
  }
  try {
    execFileSync(process.execPath, [join(ROOT, suite)], { cwd: ROOT, encoding: 'utf-8', timeout: 60000 });
    pass(`${suite} passed`);
  } catch (e) {
    fail(`${suite} FAILED — run "node ${suite}" for details`);
  }
}

// ── SUMMARY ─────────────────────────────────────────────────────

console.log('\n' + '='.repeat(50));
console.log(`📊 Results: ${passed} passed, ${failed} failed, ${warnings} warnings`);

if (failed > 0) {
  console.log('🔴 TESTS FAILED — do NOT push/merge until fixed\n');
  process.exit(1);
} else if (warnings > 0) {
  console.log('🟡 Tests passed with warnings — review before pushing\n');
  process.exit(0);
} else {
  console.log('🟢 All tests passed — safe to push/merge\n');
  process.exit(0);
}
