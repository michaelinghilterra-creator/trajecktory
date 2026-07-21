#!/usr/bin/env node
/**
 * workspace-trust.test.mjs — unit tests for
 * dashboard-web/server/lib/workspace-trust.mjs, the preflight that refuses an
 * agent run when Claude Code would silently strip the project's permissions.
 *
 * The regression these lock down is real and dated: on 2026-07-21 a Triage run
 * spent 17 turns and real money and scored ONE role, because the workspace was
 * not trusted and the CLI had quietly dropped WebSearch and WebFetch from the
 * allow list. The agent's own activity line read "I need permission to use
 * WebFetch to read the job descriptions". Nothing failed, nothing turned red,
 * and the run reported done — which is why this is a preflight and not a log
 * line.
 *
 * Two CLI behaviours are load-bearing here and were verified empirically against
 * the installed CLI, not assumed. Both are asserted below so a future refactor
 * cannot quietly undo them:
 *   1. The trust key is the POSIX-style path, even on Windows. A backslash entry
 *      for the same folder is NOT consulted.
 *   2. A folder with NO entry behaves exactly like an explicit false.
 *
 * Every case builds its OWN fixture config and passes the path in. Nothing here
 * reads the developer's real home directory: the first version of this file did,
 * which made it pass locally and fail in CI, where no such config exists.
 *
 * Run: node tests/workspace-trust.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkWorkspaceTrust, trustWorkspace, trustKeyFor } from '../dashboard-web/server/lib/workspace-trust.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('workspace-trust.test.mjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-trust-'));

// A workspace with an allow list, plus the config that may or may not trust it.
const mkWorkspace = (name, allow) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  if (allow !== null) {
    fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow } }));
  }
  return dir;
};
const mkConfig = (name, projects) => {
  const p = path.join(tmp, `${name}.claude.json`);
  fs.writeFileSync(p, JSON.stringify({ projects }, null, 2));
  return p;
};

const AGENT_TOOLS = ['WebSearch', 'WebFetch', 'Write', 'Edit'];
const ws = mkWorkspace('ws', AGENT_TOOLS);
const key = trustKeyFor(ws);

// ── trustKeyFor ─────────────────────────────────────────────────────────────
// Behaviour (1). If this regresses to native separators on Windows, every lookup
// silently misses and every workspace reads as untrusted. Built with path.join
// so the fixture never hardcodes an absolute path (the tracked-tree lint
// forbids one, and rightly: hardcoded home paths are how personal data leaks).
const winStyle = ['C:', 'proj', 'app'].join('\\');
const posixStyle = ['C:', 'proj', 'app'].join('/');
check(!trustKeyFor(winStyle).includes('\\'), 'trust key contains no backslashes');
check(trustKeyFor(winStyle).endsWith('app'), 'trust key keeps the folder');
check(trustKeyFor(winStyle) === trustKeyFor(posixStyle),
  'both spellings of one folder produce the SAME key');

// ── explicitly untrusted ────────────────────────────────────────────────────
const falseCfg = mkConfig('false', { [key]: { hasTrustDialogAccepted: false } });
const bad = checkWorkspaceTrust(ws, falseCfg);
check(bad.ok === false, 'explicit false is NOT ok');
check(bad.reason === 'not-trusted', 'explicit false reports reason "not-trusted"');
check(bad.losing.join() === 'WebSearch,WebFetch',
  'reports losing exactly the tools acceptEdits does NOT re-grant');
check(!bad.losing.includes('Write') && !bad.losing.includes('Edit'),
  'Write/Edit excluded from losing — acceptEdits already covers them');
check(/not marked as trusted/i.test(bad.message) && bad.message.includes(key),
  'message names the problem and the exact key to fix');

// ── absent entry ────────────────────────────────────────────────────────────
// Behaviour (2): a config that simply has no entry for this folder is just as
// broken as an explicit false, and must be reported, not waved through.
const otherCfg = mkConfig('other', { '/somewhere/else': { hasTrustDialogAccepted: true } });
const missing = checkWorkspaceTrust(ws, otherCfg);
check(missing.ok === false, 'absent entry is NOT ok');
check(missing.reason === 'missing', 'absent entry reports reason "missing"');

// ── a backslash entry does not count ────────────────────────────────────────
// The exact shape of the original bug: the same folder trusted under the native
// spelling, untrusted under the POSIX one. The CLI honours the POSIX one, so a
// backslash-only entry must NOT satisfy the check.
const backslashCfg = mkConfig('backslash', { [key.replace(/\//g, '\\')]: { hasTrustDialogAccepted: true } });
check(checkWorkspaceTrust(ws, backslashCfg).ok === false,
  'a backslash-spelled entry does NOT count as trusted');

// ── trusted ─────────────────────────────────────────────────────────────────
const goodCfg = mkConfig('good', { [key]: { hasTrustDialogAccepted: true } });
const good = checkWorkspaceTrust(ws, goodCfg);
check(good.ok === true && good.reason === 'trusted', 'explicit true is ok');
check(good.message === '', 'a trusted result carries no message');

// ── fails open ──────────────────────────────────────────────────────────────
// A config that does not exist, or is not JSON, must never block a run: the
// preflight cannot diagnose it, so the CLI's own stderr stays the authority.
check(checkWorkspaceTrust(ws, path.join(tmp, 'does-not-exist.json')).reason === 'unknown',
  'missing config → reason "unknown"');
check(checkWorkspaceTrust(ws, path.join(tmp, 'does-not-exist.json')).ok === true,
  'missing config fails OPEN');
const junkCfg = path.join(tmp, 'junk.json');
fs.writeFileSync(junkCfg, 'not json at all');
check(checkWorkspaceTrust(ws, junkCfg).ok === true, 'unparseable config fails OPEN');

// ── nothing to lose ─────────────────────────────────────────────────────────
// An untrusted workspace that grants nothing loses nothing. Blocking here would
// be a false alarm, and false alarms teach users to ignore the real one.
const empty = mkWorkspace('empty', []);
const none = mkWorkspace('none', null);
check(checkWorkspaceTrust(empty, falseCfg).ok === true, 'empty allow list → ok (nothing to lose)');
check(checkWorkspaceTrust(empty, falseCfg).reason === 'no-allowlist', 'empty allow list → reason "no-allowlist"');
check(checkWorkspaceTrust(none, falseCfg).ok === true, 'no settings.json at all → ok');

// An allow list of ONLY edit tools is fully re-granted by acceptEdits, so the
// run can still succeed. Reported as a defect (the list IS ignored) but with an
// empty `losing`, so the UI can phrase it honestly.
const editsOnly = mkWorkspace('edits', ['Write', 'Edit']);
check(checkWorkspaceTrust(editsOnly, falseCfg).losing.length === 0,
  'edit-only allow list loses no agent-critical tool');

// ── trustWorkspace repairs, and backs up first ──────────────────────────────
const repairCfg = mkConfig('repair', { [key]: { hasTrustDialogAccepted: false } });
const before = fs.readFileSync(repairCfg, 'utf8');
const res = trustWorkspace(ws, repairCfg);
check(checkWorkspaceTrust(ws, repairCfg).ok === true, 'trustWorkspace makes the check pass');
check(fs.readFileSync(res.backup, 'utf8') === before, 'backup holds the pre-repair config byte for byte');
check(JSON.parse(fs.readFileSync(repairCfg, 'utf8')).projects[key].hasTrustDialogAccepted === true,
  'repaired config still parses and holds the flag');

// Repair must not clobber unrelated entries — this is the user's global config.
const sharedCfg = mkConfig('shared', {
  '/other/project': { hasTrustDialogAccepted: true, someSetting: 42 },
  [key]: { hasTrustDialogAccepted: false, history: ['keep me'] },
});
trustWorkspace(ws, sharedCfg);
const after = JSON.parse(fs.readFileSync(sharedCfg, 'utf8'));
check(after.projects['/other/project'].someSetting === 42, 'unrelated project entries survive repair');
check(after.projects[key].history?.[0] === 'keep me', 'sibling fields on the repaired entry survive');

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
