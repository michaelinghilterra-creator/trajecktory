#!/usr/bin/env node
/**
 * workspace-trust.test.mjs — unit tests for
 * dashboard-web/server/lib/workspace-trust.mjs, the preflight that refuses an
 * agent run when Claude Code would silently strip the project's permissions.
 *
 * The regression these lock down is real and dated: on 2026-07-21 a Triage run
 * spent 17 turns and $0.32 and scored ONE role, because the workspace was not
 * trusted and the CLI had quietly dropped WebSearch and WebFetch from the allow
 * list. The agent's own activity line read "I need permission to use WebFetch to
 * read the job descriptions". Nothing failed, nothing turned red, and the run
 * reported done — which is exactly why a preflight exists instead of a log line.
 *
 * Two CLI behaviours are load-bearing here and were verified empirically against
 * the installed CLI, not assumed. Both are asserted below so a future refactor
 * cannot quietly undo them:
 *   1. The trust key is the POSIX-style path, even on Windows. A backslash entry
 *      for the same folder is NOT consulted.
 *   2. A folder with NO entry behaves exactly like an explicit false.
 *
 * Run: node tests/workspace-trust.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkWorkspaceTrust, trustKeyFor } from '../dashboard-web/server/lib/workspace-trust.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('workspace-trust.test.mjs');

// ── trustKeyFor ─────────────────────────────────────────────────────────────
// Behaviour (1). If this ever regresses to native separators on Windows, every
// lookup silently misses and every workspace reads as untrusted.
const key = trustKeyFor('C:\\Users\\x\\proj');
check(!key.includes('\\'), 'trust key contains no backslashes');
check(key.endsWith('proj'), 'trust key keeps the folder');
check(trustKeyFor('C:/Users/x/proj') === trustKeyFor('C:\\Users\\x\\proj'),
  'both spellings of one folder produce the SAME key');

// ── fixtures ────────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-trust-'));
const mk = (name, settings) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  if (settings !== null) fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), JSON.stringify(settings));
  return dir;
};

const withAllow = mk('with-allow', { permissions: { allow: ['WebSearch', 'WebFetch', 'Write', 'Edit'] } });
const emptyAllow = mk('empty-allow', { permissions: { allow: [] } });
const noSettings = mk('no-settings', null);
const editsOnly = mk('edits-only', { permissions: { allow: ['Write', 'Edit'] } });

// ── untrusted with a real allow list ────────────────────────────────────────
// Behaviour (2): these temp dirs have no .claude.json entry at all, which the
// CLI treats identically to false. So this MUST report a defect, not "unknown".
const bad = checkWorkspaceTrust(withAllow);
check(bad.ok === false, 'untrusted workspace with an allow list is NOT ok');
check(bad.reason === 'missing', 'absent entry reports reason "missing"');
check(bad.losing.join() === 'WebSearch,WebFetch',
  'reports losing exactly the tools acceptEdits does NOT re-grant');
check(!bad.losing.includes('Write') && !bad.losing.includes('Edit'),
  'Write/Edit excluded from losing — acceptEdits already covers them');
check(/not marked as trusted/i.test(bad.message) && bad.message.includes(bad.trustKey),
  'message names the problem and the exact key to fix');

// ── nothing to lose ─────────────────────────────────────────────────────────
// An untrusted workspace that grants nothing loses nothing. Blocking a run here
// would be a false alarm that teaches the user to ignore the warning.
check(checkWorkspaceTrust(emptyAllow).ok === true, 'empty allow list → ok (nothing to lose)');
check(checkWorkspaceTrust(emptyAllow).reason === 'no-allowlist', 'empty allow list → reason "no-allowlist"');
check(checkWorkspaceTrust(noSettings).ok === true, 'no settings.json at all → ok');

// An allow list of ONLY edit tools is still fully re-granted by acceptEdits, so
// the run can succeed. It is reported as a defect (the list IS being ignored)
// but with an empty `losing`, so the UI can phrase it honestly.
const edits = checkWorkspaceTrust(editsOnly);
check(edits.losing.length === 0, 'edit-only allow list loses no agent-critical tool');

// ── the live install ────────────────────────────────────────────────────────
// Not asserting ok===true: a dev machine may legitimately be untrusted, and this
// test must not fail for that. Assert the SHAPE, so a caller can always branch.
const live = checkWorkspaceTrust();
check(typeof live.ok === 'boolean' && typeof live.trustKey === 'string' && Array.isArray(live.allow),
  'live check returns a well-formed result');
check(live.ok === true || live.message.length > 0, 'a not-ok result always carries a message');

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
