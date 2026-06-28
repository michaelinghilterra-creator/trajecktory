#!/usr/bin/env node

/**
 * update-system.mjs — Safe auto-updater for trajecktory
 *
 * Updates ONLY system layer files (modes, scripts, dashboard, templates).
 * NEVER touches user data (cv.md, profile.yml, _profile.md, data/, reports/).
 *
 * Usage:
 *   node update-system.mjs check      # Check if update available
 *   node update-system.mjs apply      # Apply update (after user confirms)
 *   node update-system.mjs rollback   # Rollback last update
 *   node update-system.mjs dismiss    # Dismiss update check
 *
 * See DATA_CONTRACT.md for the full system/user layer definitions.
 */

import { execFileSync, execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;

// The updater pulls from the local repo's configured `origin` remote. In an
// installed bundle that remote carries an embedded read-only token (injected at
// build time by installer/build-bundle.ps1), so a PRIVATE repo self-updates with
// no prompt. In a dev checkout `origin` is the developer's own authenticated
// remote. Either way no URL or token is hardcoded here.
const REMOTE = 'origin';
const REMOTE_BRANCH = 'main';

// System layer paths — ONLY these files get updated
const SYSTEM_PATHS = [
  'modes/_shared.md',
  'modes/_profile.template.md',
  'modes/oferta.md',
  'modes/pdf.md',
  'modes/scan.md',
  'modes/batch.md',
  'modes/apply.md',
  'modes/auto-pipeline.md',
  'modes/contacto.md',
  'modes/deep.md',
  'modes/ofertas.md',
  'modes/pipeline.md',
  'modes/project.md',
  'modes/tracker.md',
  'modes/training.md',
  'modes/latex.md',
  'modes/de/',
  'modes/fr/',
  'modes/ja/',
  'modes/pt/',
  'modes/ru/',
  'CLAUDE.md',
  'AGENTS.md',
  'GEMINI.md',
  'generate-pdf.mjs',
  'generate-latex.mjs',
  'merge-tracker.mjs',
  'verify-pipeline.mjs',
  'dedup-tracker.mjs',
  'normalize-statuses.mjs',
  'cv-sync-check.mjs',
  'update-system.mjs',
  'scan.mjs',
  'doctor.mjs',
  'check-liveness.mjs',
  'liveness-core.mjs',
  'analyze-patterns.mjs',
  'followup-cadence.mjs',
  'test-all.mjs',
  'batch/batch-prompt.md',
  'batch/batch-runner.sh',
  'templates/',
  'fonts/',
  '.claude/skills/',
  '.gemini/commands/',
  'docs/',
  'VERSION',
  'DATA_CONTRACT.md',
  'CONTRIBUTING.md',
  'README.md',
  'LICENSE',
  'CITATION.cff',
  '.github/',
  'package.json',
];

// User layer paths — NEVER touch these (safety check)
const USER_PATHS = [
  'cv.md',
  'config/profile.yml',
  'modes/_profile.md',
  'portals.yml',
  'article-digest.md',
  'interview-prep/story-bank.md',
  'data/',
  'reports/',
  'output/',
  'jds/',
  'writing-samples/',
];

function localVersion() {
  const vPath = join(ROOT, 'VERSION');
  return existsSync(vPath) ? readFileSync(vPath, 'utf-8').trim() : '0.0.0';
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
  }
  return 0;
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', timeout: 30000 }).trim();
}

function gitStatusEntries() {
  const status = git('status', '--porcelain');
  if (!status) return [];

  return status.split('\n')
    .filter(Boolean)
    .map(line => ({
      code: line.slice(0, 2),
      path: line.slice(3),
    }));
}

function revertPaths(paths) {
  if (paths.length === 0) return;
  git('checkout', '--', ...paths);
}

function addPaths(paths) {
  if (paths.length === 0) return;
  git('add', '--', ...paths);
}

function gitQuiet(...args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', timeout: 30000 }).trim();
  } catch {
    return null;
  }
}

function hasGitRepo() {
  return existsSync(join(ROOT, '.git'));
}

// Read a path's contents from the just-fetched remote tip (FETCH_HEAD) without
// modifying the working tree. Returns null if the path doesn't exist upstream.
function showFetchHead(path) {
  return gitQuiet('show', `FETCH_HEAD:${path}`);
}

// The installer writes .bundle-version (the heavy-runtime "generation") into the
// install. A dev checkout has no such file → returns null and the bundle gate is
// skipped entirely (developers update via git, not the bundle path).
function localBundleVersion() {
  const p = join(ROOT, '.bundle-version');
  if (!existsSync(p)) return null;
  const n = parseInt(readFileSync(p, 'utf-8').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

// The minimum bundle generation the latest code requires, read from the fetched
// remote (defaults to 0 when the marker file is absent upstream).
function remoteMinBundleVersion() {
  const raw = showFetchHead('MIN_BUNDLE_VERSION');
  const n = raw != null ? parseInt(raw.trim(), 10) : NaN;
  return Number.isFinite(n) ? n : 0;
}

// ── CHECK ───────────────────────────────────────────────────────

async function check() {
  // Respect dismiss flag
  if (existsSync(join(ROOT, '.update-dismissed'))) {
    console.log(JSON.stringify({ status: 'dismissed' }));
    return;
  }

  const local = localVersion();

  // Self-update needs a real git repo with a remote to pull from. A bare
  // file-drop install (no .git) can't update in place — report offline so
  // session-start / dashboard callers stay quiet.
  if (!hasGitRepo()) {
    console.log(JSON.stringify({ status: 'offline', local, reason: 'no-git' }));
    return;
  }

  // Shallow-fetch the remote tip so we can read its VERSION / changelog without
  // touching the working tree. Uses origin's configured auth: the embedded
  // read-only token in an installed bundle, or the developer's credentials in a
  // checkout. Network/auth failure is treated as offline (a silent non-event).
  const fetched = gitQuiet('fetch', '--depth', '1', REMOTE, REMOTE_BRANCH);
  if (fetched === null) {
    console.log(JSON.stringify({ status: 'offline', local }));
    return;
  }

  const SEMVER_RE = /^v?(\d+\.\d+\.\d+)$/i;
  const rawRemote = showFetchHead('VERSION');
  const match = rawRemote ? rawRemote.trim().match(SEMVER_RE) : null;
  const remote = match ? match[1] : '';
  if (!remote) {
    console.log(JSON.stringify({ status: 'no-remote-version', local }));
    return;
  }

  if (compareVersions(local, remote) >= 0) {
    console.log(JSON.stringify({ status: 'up-to-date', local, remote }));
    return;
  }

  // Best-effort changelog: the top of the upstream CHANGELOG.
  let changelog = '';
  const cl = showFetchHead('CHANGELOG.md');
  if (cl) changelog = cl.split('\n').slice(0, 40).join('\n').slice(0, 1200);

  // Flag the case where the new code needs a newer heavy bundle than this
  // install ships, so the UI can say "download the installer" instead of
  // offering an in-place update that would only half-apply.
  const localBundle = localBundleVersion();
  const requiresReinstall = localBundle != null && remoteMinBundleVersion() > localBundle;

  console.log(JSON.stringify({
    status: 'update-available',
    local,
    remote,
    changelog,
    requiresReinstall,
  }));
}

// ── APPLY ───────────────────────────────────────────────────────

async function apply() {
  const local = localVersion();
  const initialStatusPaths = new Set(gitStatusEntries().map(entry => entry.path));

  // Check for lock
  const lockFile = join(ROOT, '.update-lock');
  if (existsSync(lockFile)) {
    console.error('Update already in progress (.update-lock exists). If stuck, delete it manually.');
    process.exit(1);
  }

  // Create lock
  writeFileSync(lockFile, new Date().toISOString());

  try {
    // 1. Backup: create branch
    const backupBranch = `backup-pre-update-${local}`;
    try {
      git('branch', backupBranch);
      console.log(`Backup branch created: ${backupBranch}`);
    } catch {
      console.log(`Backup branch already exists (${backupBranch}), continuing...`);
    }

    // 2. Save a patch of any local customizations to system files so we can
    //    re-apply them automatically after the upstream overwrite.
    const customPatchPath = join(ROOT, '.trajecktory-custom.patch');
    let customPatchSaved = false;
    let customFileCount = 0;
    try {
      const lastUpdateHash = git('log', '--format=%H', '--grep=auto-update system files to v', '-1').trim();
      if (lastUpdateHash) {
        const patch = execFileSync(
          'git', ['diff', lastUpdateHash, 'HEAD', '--', ...SYSTEM_PATHS],
          { cwd: ROOT, encoding: 'utf-8', timeout: 15000 }
        );
        if (patch.trim()) {
          writeFileSync(customPatchPath, patch);
          customFileCount = (patch.match(/^diff --git/gm) || []).length;
          customPatchSaved = true;
          console.log(`Saved ${customFileCount} customized system file(s) — will re-apply after update`);
        }
      }
    } catch {
      // No previous auto-update commit found (first update) — skip
    }

    // 3. Fetch from the configured remote (authed `origin`)
    console.log('Fetching latest from upstream...');
    if (!hasGitRepo()) {
      console.error('No git repo found — this install cannot self-update. Reinstall from the latest installer.');
      if (existsSync(lockFile)) unlinkSync(lockFile);
      process.exit(1);
    }
    git('fetch', REMOTE, REMOTE_BRANCH);

    // 3b. Minimum-bundle gate: refuse a code-only update that needs a newer heavy
    //     runtime (Node/Chromium) than this installed bundle ships, rather than
    //     half-updating into a broken state. Dev checkouts have no .bundle-version
    //     and are never gated.
    const localBundle = localBundleVersion();
    const remoteMin = remoteMinBundleVersion();
    if (localBundle != null && remoteMin > localBundle) {
      console.log(`BUNDLE_UPDATE_REQUIRED: this update needs a newer trajecktory bundle (have generation ${localBundle}, need ${remoteMin}). Download and run the latest installer — your data (CV, profile, tracker, reports) will be preserved.`);
      if (existsSync(lockFile)) unlinkSync(lockFile);
      process.exit(2);
    }

    // 4. Checkout system files only
    console.log('Updating system files...');
    const updated = [];
    for (const path of SYSTEM_PATHS) {
      try {
        git('checkout', 'FETCH_HEAD', '--', path);
        updated.push(path);
      } catch {
        // File may not exist in remote (new additions), skip
      }
    }

    // 5. Validate: check NO user files were touched
    let userFileTouched = false;
    try {
      for (const entry of gitStatusEntries()) {
        const file = entry.path;
        if (initialStatusPaths.has(file)) continue;
        for (const userPath of USER_PATHS) {
          if (file.startsWith(userPath)) {
            console.error(`SAFETY VIOLATION: User file was modified: ${file}`);
            userFileTouched = true;
          }
        }
      }
    } catch {
      // git status failed, skip validation
    }

    if (userFileTouched) {
      console.error('Aborting: user files were touched. Rolling back...');
      revertPaths(updated);
      process.exit(1);
    }

    // 6. Install any new dependencies
    try {
      execSync('npm install --silent', { cwd: ROOT, timeout: 60000 });
    } catch {
      console.log('npm install skipped (may need manual run)');
    }

    // 7. Commit the upstream update
    const remote = localVersion(); // Re-read after checkout updated VERSION
    try {
      const pathsToStage = [...updated];
      const dismissFile = join(ROOT, '.update-dismissed');
      if (existsSync(dismissFile)) {
        unlinkSync(dismissFile);
        pathsToStage.push('.update-dismissed');
      }
      addPaths(pathsToStage);
      git('commit', '-m', `chore: auto-update system files to v${remote}`);
    } catch {
      // Nothing to commit (already up to date)
    }

    // 8. Re-apply local customizations on top of the upstream changes.
    //    Uses 3-way merge so lines that didn't conflict land automatically.
    let customRestored = false;
    let customConflicted = false;
    if (customPatchSaved && existsSync(customPatchPath)) {
      try {
        execFileSync('git', ['apply', '--3way', customPatchPath], { cwd: ROOT, encoding: 'utf-8' });
        customRestored = true;
        unlinkSync(customPatchPath);
        // Stage and commit restored files as a separate commit for clarity
        const restoredFiles = gitStatusEntries()
          .filter(e => e.code.trim() !== '')
          .map(e => e.path);
        if (restoredFiles.length > 0) {
          addPaths(restoredFiles);
          git('commit', '-m', `restore: re-apply ${customFileCount} custom change(s) after v${remote} update`);
        }
        console.log(`Custom changes: re-applied automatically (${customFileCount} file(s))`);
      } catch {
        customConflicted = true;
        console.log('Custom changes: could not auto-merge — resolve conflicts then run:');
        console.log('  git apply --3way .trajecktory-custom.patch');
      }
    }

    // 9. Post-update sanity checks
    try {
      execSync('node verify-pipeline.mjs', { cwd: ROOT, timeout: 15000, stdio: 'pipe' });
      console.log('Pipeline integrity: OK');
    } catch {
      console.log('Pipeline integrity: issues found — run: node verify-pipeline.mjs');
    }

    console.log(`\nUpdate complete: v${local} → v${remote}`);
    console.log(`Updated ${updated.length} system paths.`);
    if (customConflicted) console.log('Action required: resolve custom patch conflicts (see above).');
    console.log(`Rollback available: node update-system.mjs rollback`);

  } finally {
    // Remove lock
    if (existsSync(lockFile)) unlinkSync(lockFile);
  }
}

// ── ROLLBACK ────────────────────────────────────────────────────

function rollback() {
  // Find most recent backup branch
  try {
    const branches = git('for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads/backup-pre-update-*');
    const branchList = branches.split('\n').map(b => b.trim()).filter(Boolean);

    if (branchList.length === 0) {
      console.error('No backup branches found. Nothing to rollback.');
      process.exit(1);
    }

    const latest = branchList[0];
    console.log(`Rolling back to: ${latest}`);

    // Checkout system files from backup branch
    for (const path of SYSTEM_PATHS) {
      try {
        git('checkout', latest, '--', path);
      } catch {
        // File may not have existed in backup
      }
    }

    addPaths(SYSTEM_PATHS);
    git('commit', '-m', `chore: rollback system files from ${latest}`);

    console.log(`Rollback complete. System files restored from ${latest}.`);
    console.log('Your data (CV, profile, tracker, reports) was not affected.');
  } catch (err) {
    console.error('Rollback failed:', err.message);
    process.exit(1);
  }
}

// ── DISMISS ─────────────────────────────────────────────────────

function dismiss() {
  writeFileSync(join(ROOT, '.update-dismissed'), new Date().toISOString());
  console.log('Update check dismissed. Run "node update-system.mjs check" or say "check for updates" to re-enable.');
}

// ── MAIN ────────────────────────────────────────────────────────

const cmd = process.argv[2] || 'check';

switch (cmd) {
  case 'check': await check(); break;
  case 'apply': await apply(); break;
  case 'rollback': rollback(); break;
  case 'dismiss': dismiss(); break;
  default:
    console.log('Usage: node update-system.mjs [check|apply|rollback|dismiss]');
    process.exit(1);
}
