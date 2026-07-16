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
// The public HTTPS clone URL. Installed bundles historically shipped an origin
// with an embedded read-only token for the then-private repo. Now that the repo
// is public, ensureTokenlessOrigin() rewrites any such tokened origin to this
// tokenless URL the first time a tokened fetch fails (e.g. after the token is
// revoked), so anonymous fetch just works. Dev checkouts (SSH or plain-HTTPS
// origins with no embedded token) are left untouched.
const PUBLIC_ORIGIN = 'https://github.com/michaelinghilterra-creator/trajecktory.git';

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
  'next-jd.mjs',
  'verify-pipeline.mjs',
  // Imported at module scope by dashboard-web/server/lib/interview.mjs, which
  // index.mjs imports statically. If it is missing the WHOLE dashboard dies at
  // module-resolution time, not just the Interview tab. Guarded by test-all.mjs §7b.
  'render-runsheet.mjs',
  'verify-runsheets.mjs',
  // Same hazard, pre-existing: dashboard-web/server/lib/obsidian.mjs statically
  // imports scripts/render-obsidian-companion.mjs. scripts/ was never listed, so it
  // was frozen at install time and no fix to it ever reached an updated install.
  'scripts/',
  'dedup-tracker.mjs',
  'normalize-statuses.mjs',
  'cv-sync-check.mjs',
  'update-system.mjs',
  'scan.mjs',
  'discover.mjs',
  'gate-pipeline.mjs',
  'verify-actionable.mjs',
  'doctor.mjs',
  'check-liveness.mjs',
  'liveness-core.mjs',
  'analyze-patterns.mjs',
  'followup-cadence.mjs',
  'test-all.mjs',
  'lib/',
  'dashboard-web/',
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
  'dashboard-web/.env',
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

let _gitExe;
function gitFromRegistry() {
  for (const hive of ['HKCU', 'HKLM']) {
    try {
      const out = execFileSync('reg', ['query', `${hive}\\SOFTWARE\\GitForWindows`, '/v', 'InstallPath'],
        { encoding: 'utf-8', timeout: 8000 });
      const m = out.match(/InstallPath\s+REG_SZ\s+(.+)/i);
      if (m) {
        const exe = join(m[1].trim(), 'cmd', 'git.exe');
        if (existsSync(exe)) return exe;
      }
    } catch { /* key absent on this hive */ }
  }
  return null;
}

// Resolve a usable git. The installed bundle launches its dashboard server
// before the freshly-installed Git for Windows has propagated onto PATH, so a
// bare `git` may not resolve on the first run. Find it explicitly: PATH, then
// the registry (Git for Windows records its InstallPath), then common dirs.
function resolveGit() {
  if (_gitExe) return _gitExe;
  try { execFileSync('git', ['--version'], { stdio: 'ignore', timeout: 8000 }); return (_gitExe = 'git'); } catch {}
  const reg = gitFromRegistry();
  if (reg) return (_gitExe = reg);
  const p = process.env;
  const candidates = [
    p.LOCALAPPDATA && join(p.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe'),
    p.ProgramFiles && join(p.ProgramFiles, 'Git', 'cmd', 'git.exe'),
    p['ProgramFiles(x86)'] && join(p['ProgramFiles(x86)'], 'Git', 'cmd', 'git.exe'),
    p.ProgramW6432 && join(p.ProgramW6432, 'Git', 'cmd', 'git.exe'),
  ].filter(Boolean);
  for (const c of candidates) { if (existsSync(c)) return (_gitExe = c); }
  return (_gitExe = 'git'); // last resort — failures are handled as "offline"
}

// All git calls disable the credential helper and interactive prompts: the
// public repo needs no auth, and this stops a headless updater from hanging on a
// credential prompt or reusing a stale cached credential once the old bundle
// token is revoked.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
function git(...args) {
  return execFileSync(resolveGit(), ['-c', 'credential.helper=', ...args], { cwd: ROOT, encoding: 'utf-8', timeout: 30000, env: GIT_ENV }).trim();
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
    return execFileSync(resolveGit(), ['-c', 'credential.helper=', ...args], { cwd: ROOT, encoding: 'utf-8', timeout: 30000, env: GIT_ENV }).trim();
  } catch {
    return null;
  }
}

function hasGitRepo() {
  return existsSync(join(ROOT, '.git'));
}

// Rewrite a bundle origin that still carries the old embedded token to the
// tokenless public URL. Returns true only if it actually rewrote, so a caller
// can retry a failed fetch once. Matched precisely on `x-access-token` so a
// developer's SSH (git@github.com:...) or plain-HTTPS origin is never touched.
function ensureTokenlessOrigin() {
  if (!hasGitRepo()) return false;
  const url = gitQuiet('remote', 'get-url', REMOTE);
  if (url && /x-access-token/i.test(url)) {
    gitQuiet('remote', 'set-url', REMOTE, PUBLIC_ORIGIN);
    return true;
  }
  return false;
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

// ── Signed-update verification (opt-in trust anchor) ────────────
// When a non-empty `trusted-signers` file ships in the install (baked into the
// bundle and deliberately NOT in SYSTEM_PATHS, so self-update can never replace
// it — it is a fixed trust anchor per installed .exe), updates are pinned to
// SSH-SIGNED release tags: fetch tags, verify each candidate against
// trusted-signers with `git verify-tag`, and only ever check out from a verified
// tag. Absent the file (the default today), the updater tracks `main` as before.
// See docs/RELEASING.md for how to generate a key, sign tags, and activate this.
const TRUSTED_SIGNERS = join(ROOT, 'trusted-signers');

function signedUpdatesEnabled() {
  if (!existsSync(TRUSTED_SIGNERS)) return false;
  return readFileSync(TRUSTED_SIGNERS, 'utf-8')
    .split('\n').some(l => l.trim() && !l.trim().startsWith('#'));
}

// True iff annotated tag `tag` carries a valid signature from a key in
// trusted-signers. gitQuiet returns null on non-zero exit (bad/missing sig or
// untrusted signer), so a non-null result means the signature verified.
function verifyTag(tag) {
  // Forward slashes: git config VALUES treat backslashes as escapes, so a Windows
  // path (C:\...\trusted-signers) must be normalized or the file is not found.
  const signers = TRUSTED_SIGNERS.replace(/\\/g, '/');
  return gitQuiet('-c', `gpg.ssh.allowedSignersFile=${signers}`, 'verify-tag', tag) !== null;
}

// Fetch tags (anonymous, with the tokenless self-heal), then return the highest
// version tag greater than localVer whose signature verifies. Result is one of:
//   { status: 'update', tag, ver } | { status: 'up-to-date' }
//   { status: 'unverified' }  (a newer tag exists but no valid signature)
//   { status: 'offline' }
function findSignedUpdate(localVer) {
  let ft = gitQuiet('fetch', '--force', '--tags', REMOTE);
  if (ft === null && ensureTokenlessOrigin()) ft = gitQuiet('fetch', '--force', '--tags', REMOTE);
  if (ft === null) return { status: 'offline' };
  const raw = gitQuiet('tag', '-l', 'v*') || '';
  const candidates = raw.split('\n')
    .map(t => t.trim())
    .map(t => ({ tag: t, ver: (t.match(/^v?(\d+\.\d+\.\d+)$/i) || [])[1] }))
    .filter(x => x.ver && compareVersions(x.ver, localVer) > 0)
    .sort((a, b) => compareVersions(b.ver, a.ver));
  for (const c of candidates) {
    if (verifyTag(c.tag)) return { status: 'update', tag: c.tag, ver: c.ver };
  }
  return { status: candidates.length ? 'unverified' : 'up-to-date' };
}

// Read the bundle-generation floor from a specific ref (a tag or FETCH_HEAD).
function minBundleFromRef(ref) {
  const raw = gitQuiet('show', `${ref}:MIN_BUNDLE_VERSION`);
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

  // Make sure git itself is reachable. On the first post-install launch the
  // bundled Git for Windows may not be on PATH yet; resolveGit() also checks the
  // registry + known install dirs, so this only fails if git is truly absent.
  if (gitQuiet('--version') === null) {
    console.log(JSON.stringify({ status: 'offline', local, reason: 'git-not-found' }));
    return;
  }

  // SIGNED-UPDATE PATH (opt-in): pin to a signature-verified release tag. Taken
  // only when a trusted-signers trust anchor ships in this install; otherwise
  // fall through to the `main`-tracking path below.
  if (signedUpdatesEnabled()) {
    const r = findSignedUpdate(local);
    if (r.status === 'offline') { console.log(JSON.stringify({ status: 'offline', local })); return; }
    if (r.status === 'unverified') {
      console.error('A newer release tag exists but its signature did not verify against trusted-signers; not offering it.');
      console.log(JSON.stringify({ status: 'up-to-date', local, remote: local, reason: 'unverified-newer' }));
      return;
    }
    if (r.status !== 'update') { console.log(JSON.stringify({ status: 'up-to-date', local, remote: local })); return; }
    let changelog = '';
    const cl = gitQuiet('show', `${r.tag}:CHANGELOG.md`);
    if (cl) changelog = cl.split('\n').slice(0, 40).join('\n').slice(0, 1200);
    const localBundle = localBundleVersion();
    const requiresReinstall = localBundle != null && minBundleFromRef(r.tag) > localBundle;
    console.log(JSON.stringify({ status: 'update-available', local, remote: r.ver, changelog, requiresReinstall, verified: true }));
    return;
  }

  // Shallow-fetch the remote tip so we can read its VERSION / changelog without
  // touching the working tree. Uses origin's configured auth: the embedded
  // read-only token in an installed bundle, or the developer's credentials in a
  // checkout. Network/auth failure is treated as offline (a silent non-event).
  let fetched = gitQuiet('fetch', '--depth', '1', REMOTE, REMOTE_BRANCH);
  // If the tokened bundle origin can no longer authenticate (the read-only token
  // was revoked after the repo went public), self-heal to the tokenless public
  // URL and retry once so the install keeps updating anonymously.
  if (fetched === null && ensureTokenlessOrigin()) {
    fetched = gitQuiet('fetch', '--depth', '1', REMOTE, REMOTE_BRANCH);
  }
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
          resolveGit(), ['diff', lastUpdateHash, 'HEAD', '--', ...SYSTEM_PATHS],
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

    // 3. Resolve the update SOURCE ref. Signed mode pins to a signature-verified
    //    release tag; otherwise track `main` (FETCH_HEAD) as before.
    if (!hasGitRepo()) {
      console.error('No git repo found — this install cannot self-update. Reinstall from the latest installer.');
      if (existsSync(lockFile)) unlinkSync(lockFile);
      process.exit(1);
    }
    let srcRef;
    if (signedUpdatesEnabled()) {
      const r = findSignedUpdate(local);
      if (r.status !== 'update') {
        console.log(r.status === 'unverified'
          ? 'No VERIFIED update available: a newer tag exists but its signature did not verify. Nothing applied.'
          : (r.status === 'offline' ? 'Offline — could not fetch tags.' : 'Already up to date.'));
        if (existsSync(lockFile)) unlinkSync(lockFile);
        return;
      }
      // Re-verify defensively right before we trust the ref.
      if (!verifyTag(r.tag)) {
        console.error(`Refusing to apply: ${r.tag} signature did not verify against trusted-signers.`);
        if (existsSync(lockFile)) unlinkSync(lockFile);
        process.exit(1);
      }
      srcRef = r.tag;
      console.log(`Applying verified release ${r.tag} ...`);
    } else {
      console.log('Fetching latest from upstream...');
      try {
        git('fetch', REMOTE, REMOTE_BRANCH);
      } catch (e) {
        // Self-heal a revoked-token origin to the tokenless public URL, then retry.
        if (ensureTokenlessOrigin()) git('fetch', REMOTE, REMOTE_BRANCH);
        else throw e;
      }
      srcRef = 'FETCH_HEAD';
    }

    // 3b. Minimum-bundle gate: refuse a code-only update that needs a newer heavy
    //     runtime (Node/Chromium) than this installed bundle ships, rather than
    //     half-updating into a broken state. Dev checkouts have no .bundle-version
    //     and are never gated.
    const localBundle = localBundleVersion();
    const remoteMin = minBundleFromRef(srcRef);
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
        git('checkout', srcRef, '--', path);
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
      // --ignore-scripts closes the postinstall lifecycle-script vector (a
      // compromised or typosquatted transitive dep cannot run code on update).
      execSync('npm install --ignore-scripts --silent', { cwd: ROOT, timeout: 60000 });
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
        execFileSync(resolveGit(), ['apply', '--3way', customPatchPath], { cwd: ROOT, encoding: 'utf-8' });
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
