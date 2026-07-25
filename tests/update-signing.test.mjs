#!/usr/bin/env node
/**
 * update-signing.test.mjs — the signed-update trust anchor (update-system.mjs).
 *
 * When `trusted-signers` ships in an install, self-update is pinned to release
 * tags carrying a valid SSH signature from a key in that file. Everything about
 * that had been checked only by hand, which is the weakest possible position for
 * a security gate: a gate only ever observed ACCEPTING things is not known to be
 * a gate at all, and a refactor could turn it into `return true` with every other
 * suite still green. The PII gate learned this the hard way (its in-suite section
 * was inert three separate ways while reporting success).
 *
 * So these tests do plant-and-catch. They mint a THROWAWAY ssh key, sign a tag in
 * a temp repo, and assert the gate accepts that one and refuses the three ways it
 * can be cheated: no signature at all, a real signature from an untrusted key, and
 * a signature over different content.
 *
 * No dependency on the maintainer's real key, so this runs anywhere git and
 * ssh-keygen exist. It never touches the real repo, its tags, or its remote.
 *
 * Run: node tests/update-signing.test.mjs   (exit 0 = pass, 1 = fail)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { verifyTag, signedUpdatesEnabled, SYSTEM_PATHS } from '../update-system.mjs';

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };

console.log('update-signing.test.mjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-signing-'));
const repo = path.join(tmp, 'repo');
const run = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

try {
  // ── a throwaway signing identity, and a second one that is NOT trusted ──────
  const keyDir = path.join(tmp, 'keys');
  fs.mkdirSync(keyDir, { recursive: true });
  const mkKey = (name) => {
    const kp = path.join(keyDir, name);
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', `${name}@test.invalid`, '-f', kp], { stdio: 'ignore' });
    return { priv: kp, pub: fs.readFileSync(`${kp}.pub`, 'utf-8').trim() };
  };
  const trusted = mkKey('trusted');
  const stranger = mkKey('stranger');

  const signersFile = path.join(tmp, 'trusted-signers');
  fs.writeFileSync(signersFile, `# throwaway test key\ntrusted@test.invalid ${trusted.pub}\n`);

  // ── a temp repo with one signed tag and one unsigned tag ───────────────────
  fs.mkdirSync(repo, { recursive: true });
  run(['init', '-q', '-b', 'main']);
  run(['config', 'user.name', 'Test Runner']);
  run(['config', 'user.email', 'trusted@test.invalid']);
  run(['config', 'gpg.format', 'ssh']);
  run(['config', 'user.signingkey', trusted.priv.replace(/\\/g, '/')]);
  fs.writeFileSync(path.join(repo, 'VERSION'), '9.9.9\n');
  run(['add', 'VERSION']);
  run(['commit', '-q', '-m', 'chore: seed']);

  run(['tag', '-s', 'v9.9.9', '-m', 'signed release']);
  run(['tag', '-a', 'v9.9.8', '-m', 'unsigned release']);
  run(['-c', 'user.signingkey=' + stranger.priv.replace(/\\/g, '/'), 'tag', '-s', 'v9.9.7', '-m', 'signed by a stranger']);

  const opts = { signers: signersFile, cwd: repo };

  // ── the gate ACCEPTS a genuinely signed tag ────────────────────────────────
  check(verifyTag('v9.9.9', opts) === true, 'a tag signed by a trusted key verifies');

  // ── and REFUSES every way of cheating it ───────────────────────────────────
  check(verifyTag('v9.9.8', opts) === false, 'an unsigned tag is refused');
  check(verifyTag('v9.9.7', opts) === false, 'a real signature from an untrusted key is refused');
  check(verifyTag('v9.9.6-does-not-exist', opts) === false, 'a missing tag is refused, not treated as absent-therefore-fine');

  // An empty allowed-signers file must not mean "allow anything".
  const emptySigners = path.join(tmp, 'empty-signers');
  fs.writeFileSync(emptySigners, '# no keys here\n');
  check(verifyTag('v9.9.9', { signers: emptySigners, cwd: repo }) === false, 'a signers file with no keys trusts nothing');

  // Tampering: the signature covers the tag object, so re-pointing the tag at
  // different content must not still verify.
  fs.writeFileSync(path.join(repo, 'VERSION'), '9.9.9-tampered\n');
  run(['add', 'VERSION']);
  run(['commit', '-q', '-m', 'chore: tamper']);
  run(['tag', '-f', '-a', 'v9.9.9-moved', '-m', 'moved']);
  check(verifyTag('v9.9.9-moved', opts) === false, 'a tag re-created over different content does not inherit a signature');

  // ── signedUpdatesEnabled: the opt-in switch ────────────────────────────────
  check(signedUpdatesEnabled(signersFile) === true, 'a signers file with a real key turns signed updates on');
  check(signedUpdatesEnabled(emptySigners) === false, 'a comment-only signers file leaves signed updates off');
  check(signedUpdatesEnabled(path.join(tmp, 'nope')) === false, 'a missing signers file leaves signed updates off');

  // ── the trust anchor cannot be replaced BY an update ───────────────────────
  // If `trusted-signers` were a system path, a compromised update could ship a new
  // key and authorize all its successors. This is the whole security model.
  check(!SYSTEM_PATHS.some(p => p.includes('trusted-signers')),
    'trusted-signers is not in SYSTEM_PATHS, so an update cannot replace the trust anchor');

  // ── the shipped anchor is real, and reaches installs ───────────────────────
  // A trust anchor that never ships means every install silently falls back to
  // tracking main unsigned, which looks identical to working.
  const shipped = path.join(ROOT, 'trusted-signers');
  check(fs.existsSync(shipped) && signedUpdatesEnabled(shipped), 'the repo ships a non-empty trusted-signers');
  const tracked = execFileSync('git', ['ls-tree', '-r', 'HEAD', '--name-only'], { cwd: ROOT, encoding: 'utf-8' });
  check(/^trusted-signers$/m.test(tracked), 'trusted-signers is tracked, so git archive carries it into the installer payload');

  // ── the CLI still runs (the import guard did not disable the entry point) ──
  // update-system.mjs only executes its switch when invoked directly. If that
  // check ever stops matching, `node update-system.mjs check` becomes a silent
  // no-op: updates stop being offered and nothing errors. Prove it still fires.
  let usage = '', code = 0;
  try {
    usage = execFileSync(process.execPath, [path.join(ROOT, 'update-system.mjs'), 'nonsense-subcommand'],
      { encoding: 'utf-8', timeout: 30000 });
  } catch (e) { usage = String(e.stdout || ''); code = e.status; }
  check(/Usage: node update-system\.mjs/.test(usage) && code === 1,
    'invoked as a script the CLI still dispatches (import guard has not disabled it)');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
