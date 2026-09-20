#!/usr/bin/env node
// Release-time dry run for update-system.mjs's apply(). Checks out a candidate ref into a
// scratch git worktree, copies a token-stripped scratch copy of the real user-layer data
// (data/, reports/, output/, jds/, etc. - see DATA_CONTRACT.md) into it, and runs the
// data-facing health checks against that combination. Never writes to the real data; never
// runs update-system.mjs apply itself.
//
// This exists because update-system.mjs apply() is structurally guaranteed not to touch
// data/ (SYSTEM_PATHS allowlist plus a USER_PATHS runtime tripwire that rolls back on any
// violation), but that guarantee only covers file overwrites. It says nothing about whether
// the NEW system-layer code, once it starts running, still parses and reads an EXISTING
// data/ directory correctly. An update that changes how a script reads applications.md or
// status-events.tsv can pass every existing check on this machine (whose data/ is already
// current-shaped) and still break for another user who updates from an older version.
//
// Usage: node scripts/update-dry-run.mjs [--ref <git-ref>] [--json]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const refIdx = args.indexOf('--ref');
const ref = refIdx >= 0 ? args[refIdx + 1] : 'origin/main';
const jsonMode = args.includes('--json');

function git(a, opts = {}) { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', ...opts }); }
function log(...a) { if (!jsonMode) console.log(...a); }

// Same skip list as spark-runner's backup-data.mjs and every scratch-copy browser check this
// project has done: a dry run never needs live Gmail credentials, and never should carry them.
const SKIP_FILES = new Set(['google-tokens.json', 'buffer-token.json']);

// The full user layer per DATA_CONTRACT.md, not just data/. verify-pipeline.mjs cross-references
// data/applications.md rows against reports/ (and doctor.mjs checks output/, jds/, etc.), so a
// dry run that only copies data/ produces a false "1860 errors" health-check failure that has
// nothing to do with the candidate code - confirmed by running this script against its own HEAD
// before this comment was added.
const USER_LAYER_DIRS = ['data', 'reports', 'output', 'jds', 'writing-samples', 'interview-prep'];
const USER_LAYER_FILES = ['cv.md', 'article-digest.md', 'portals.yml', 'config/profile.yml', 'modes/_profile.md'];

function copyDataScratch(worktree) {
  for (const dir of USER_LAYER_DIRS) {
    const src = path.join(ROOT, dir);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(worktree, dir);
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      if (SKIP_FILES.has(entry)) continue;
      fs.cpSync(path.join(src, entry), path.join(dest, entry), { recursive: true });
    }
  }
  for (const file of USER_LAYER_FILES) {
    const src = path.join(ROOT, file);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(path.join(worktree, file)), { recursive: true });
    fs.cpSync(src, path.join(worktree, file));
  }
}

function main() {
  const checks = [];
  const rec = (name, ok, detail) => checks.push({ name, ok, detail });

  try { git(['fetch', 'origin'], { stdio: 'ignore' }); } catch { /* offline is fine if ref is local */ }
  let resolvedRef;
  try { resolvedRef = git(['rev-parse', ref]).trim(); } catch (e) {
    console.error(`cannot resolve ref "${ref}": ${e.message}`);
    process.exit(2);
  }

  const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-update-dry-run-'));
  const worktree = path.join(scratchRoot, 'code');
  try {
    git(['worktree', 'add', '--detach', worktree, resolvedRef]);
    log(`checked out ${ref} (${resolvedRef.slice(0, 10)}) into a scratch worktree`);

    copyDataScratch(worktree);
    log('copied a scratch, token-stripped copy of the user layer (data/, reports/, output/, jds/, etc.) into the candidate checkout (nothing real is ever written to)');

    const install = spawnSync('npm', ['ci', '--ignore-scripts'], { cwd: worktree, encoding: 'utf8', shell: true, timeout: 300000 });
    rec('npm ci on the candidate code', install.status === 0, install.status === 0 ? 'ok' : `${install.stdout || ''}${install.stderr || ''}`.slice(-3000));

    if (install.status === 0) {
      const doctor = spawnSync('node', ['doctor.mjs', '--json'], { cwd: worktree, encoding: 'utf8', timeout: 120000 });
      let doctorOk = doctor.status === 0;
      let doctorDetail = 'ok';
      try {
        const j = JSON.parse(doctor.stdout);
        doctorOk = doctorOk && !(j.errors && j.errors.length);
        if (!doctorOk) doctorDetail = JSON.stringify(j).slice(0, 2000);
      } catch { doctorOk = false; doctorDetail = `${doctor.stdout || ''}${doctor.stderr || ''}`.slice(-2000); }
      rec('doctor.mjs: candidate code against the real data shape', doctorOk, doctorDetail);

      const vp = spawnSync('node', ['verify-pipeline.mjs'], { cwd: worktree, encoding: 'utf8', timeout: 120000 });
      rec('verify-pipeline.mjs: candidate code against the real data shape', vp.status === 0, vp.status === 0 ? 'ok' : `${vp.stdout || ''}${vp.stderr || ''}`.slice(-3000));
    } else {
      rec('doctor.mjs: candidate code against the real data shape', false, 'skipped: npm ci failed');
      rec('verify-pipeline.mjs: candidate code against the real data shape', false, 'skipped: npm ci failed');
    }
  } finally {
    try { git(['worktree', 'remove', '--force', worktree]); } catch { /* best effort cleanup */ }
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }

  const ok = checks.every((c) => c.ok);
  const report = { ref, resolvedRef, ok, checks };
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const c of checks) log(`${c.ok ? 'PASS' : 'FAIL'} ${c.name}${c.ok ? '' : `\n  ${c.detail}`}`);
    log(ok ? '\nDry run PASSED: the candidate code handled this data shape cleanly.' : '\nDry run FAILED: see above before releasing.');
  }
  process.exit(ok ? 0 : 1);
}

main();
