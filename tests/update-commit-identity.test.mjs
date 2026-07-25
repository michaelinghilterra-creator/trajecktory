#!/usr/bin/env node
/**
 * update-commit-identity.test.mjs — the updater must commit on a machine with NO
 * configured git identity (update-system.mjs).
 *
 * A clean Windows install with a freshly-installed Git for Windows has no
 * user.name/user.email. `git commit` is the first thing the self-updater does that
 * needs one, so on such a machine it threw, a bare `catch {}` swallowed it as
 * "nothing to commit", and the half-applied update reported failure and never
 * restarted — every clean install was silently stranded on updates. The fix forces
 * a committer identity via GIT_ENV (exported as UPDATER_IDENTITY). This proves it:
 * a commit in a repo with no configured identity FAILS without it and SUCCEEDS with
 * it, authored by the updater identity.
 *
 * Hermetic: an isolated global config with user.useConfigOnly=true, so git never
 * guesses an identity from the host and "no identity configured" is deterministic
 * regardless of who runs the suite. Never touches the real repo or the user's git
 * config. Runs anywhere git exists.
 *
 * Run: node tests/update-commit-identity.test.mjs   (exit 0 = pass, 1 = fail)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { UPDATER_IDENTITY } from '../update-system.mjs';

let passed = 0, failed = 0;
const check = (c, m) => { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.log(`  ❌ ${m}`); failed++; } };

console.log('update-commit-identity.test.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-commit-id-'));
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo, { recursive: true });

// An isolated global config that guarantees git will NOT guess an identity from
// the host (user.useConfigOnly), so "no identity configured" is deterministic and
// independent of whoever runs the suite. A separate empty file stands in for the
// system config, and NOSYSTEM belt-and-braces skips the real one.
const globalCfg = path.join(tmp, 'gitconfig-global');
fs.writeFileSync(globalCfg, '[user]\n\tuseConfigOnly = true\n');
const emptySystem = path.join(tmp, 'gitconfig-system-empty');
fs.writeFileSync(emptySystem, '');

// Base env: isolate from the real global/system git config AND strip any inherited
// identity env, so the maintainer's own identity can never leak in and make the
// negative case pass by accident.
const ISO = {
  ...process.env,
  GIT_CONFIG_GLOBAL: globalCfg,
  GIT_CONFIG_SYSTEM: emptySystem,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
};
for (const k of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete ISO[k];

const run = (args, env) => execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], env });

try {
  run(['init', '-q'], ISO);
  run(['config', 'commit.gpgsign', 'false'], ISO);

  // Baseline: with an identity-less config, a commit MUST fail — otherwise the test
  // proves nothing (the environment already carried an identity).
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one');
  run(['add', 'a.txt'], ISO);
  let negativeThrew = false;
  try { run(['commit', '-m', 'no identity'], ISO); } catch { negativeThrew = true; }
  check(negativeThrew, 'commit FAILS when no git identity is configured (baseline)');

  // The fix: with UPDATER_IDENTITY supplied, the same commit succeeds.
  const withId = { ...ISO, ...UPDATER_IDENTITY };
  let positiveOk = true;
  try { run(['commit', '-m', 'chore: auto-update system files to v9.9.9'], withId); }
  catch (e) { positiveOk = false; console.log('   (commit error: ' + ((e && (e.stderr?.toString?.() || e.message)) || e) + ')'); }
  check(positiveOk, 'commit SUCCEEDS with the forced updater identity');

  if (positiveOk) {
    const author = run(['log', '-1', '--format=%an <%ae>'], withId).trim();
    const want = `${UPDATER_IDENTITY.GIT_AUTHOR_NAME} <${UPDATER_IDENTITY.GIT_AUTHOR_EMAIL}>`;
    check(author === want, `commit is authored by the updater identity (got: ${author})`);
  }
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

console.log(`\n${failed === 0 ? '✅' : '❌'} update-commit-identity: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
