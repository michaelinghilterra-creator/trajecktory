import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../config.mjs';

// ── Workspace trust preflight ─────────────────────────────────────────────────
// Claude Code only honours a project's .claude/settings.json permissions.allow
// list if the workspace has been TRUSTED, recorded as
//   projects["<cwd>"].hasTrustDialogAccepted: true
// in the user's home .claude.json. When it is not trusted the CLI prints
//   "Ignoring N permissions.allow entries from .claude/settings.json: this
//    workspace has not been trusted."
// on stderr and drops the allow list — then keeps running.
//
// That silent degradation is the whole reason this module exists. Agent Scan and
// Triage spawn `claude -p` with --permission-mode acceptEdits, which re-grants
// Write and Edit but NOT WebSearch and WebFetch. Both agent prompts are built
// around "read the JD with WebFetch first and WebSearch as a fallback", so an
// untrusted workspace produces a run that burns turns and real money, reports
// success, and scores almost nothing. Observed 2026-07-21: 17 turns, $0.32, one
// role scored, with the agent's own activity line reading "I need permission to
// use WebFetch to read the job descriptions".
//
// Two behaviours were verified empirically against the installed CLI rather than
// assumed, because both are load-bearing here and neither is documented:
//
//  1. The lookup key is the POSIX-style path (forward slashes) even on Windows.
//     A backslash-spelled entry for the very same folder is NOT consulted. This
//     machine had both spellings present and disagreeing (backslash true,
//     forward slash false) and the CLI honoured the forward-slash false.
//  2. A folder with NO entry at all behaves exactly like an explicit false: the
//     allow list is dropped, and the headless run does not create an entry. So
//     "missing" is a real defect to report, not an unknown to wave through.
//
// Consequence of (1): normalising ROOT_DIR to forward slashes is the correct
// lookup, not a convenience. Consequence of (2): absent and false are one case.

const HOME = process.env.USERPROFILE || process.env.HOME || '';
export const CLAUDE_CONFIG_PATH = path.join(HOME, '.claude.json');

// The exact key Claude Code looks up for a given working directory.
export const trustKeyFor = (dir) => path.resolve(dir).replace(/\\/g, '/');

// Read the project's own allow list. If a workspace grants nothing, an untrusted
// workspace costs nothing either — there is no point alarming the user about a
// dropped list that is empty.
function projectAllowList(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8');
    const allow = JSON.parse(raw)?.permissions?.allow;
    return Array.isArray(allow) ? allow : [];
  } catch { return []; }
}

// Tools that --permission-mode acceptEdits does NOT re-grant, so losing them
// actually changes what a run can do. Used to phrase the warning concretely.
const NOT_COVERED_BY_ACCEPT_EDITS = new Set(['WebSearch', 'WebFetch']);

/**
 * Inspect the trust state of a workspace. Never throws: a missing or malformed
 * .claude.json yields ok:true with reason 'unknown' so a preflight can never be
 * the thing that blocks a run it cannot actually diagnose.
 *
 * @returns {{ok: boolean, reason: string, trustKey: string, configPath: string,
 *            allow: string[], losing: string[], message: string}}
 */
export function checkWorkspaceTrust(dir = ROOT_DIR) {
  const trustKey = trustKeyFor(dir);
  const allow = projectAllowList(dir);
  const losing = allow.filter(t => NOT_COVERED_BY_ACCEPT_EDITS.has(t));
  const base = { trustKey, configPath: CLAUDE_CONFIG_PATH, allow, losing };

  if (!allow.length) return { ...base, ok: true, reason: 'no-allowlist', message: '' };

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CLAUDE_CONFIG_PATH, 'utf8'));
  } catch {
    // No config yet (fresh Claude Code install) or unreadable. Fail OPEN: let the
    // run proceed and let the CLI's own stderr be the source of truth.
    return { ...base, ok: true, reason: 'unknown', message: '' };
  }

  const trusted = config?.projects?.[trustKey]?.hasTrustDialogAccepted === true;
  if (trusted) return { ...base, ok: true, reason: 'trusted', message: '' };

  const present = Object.prototype.hasOwnProperty.call(config?.projects || {}, trustKey);
  const lost = losing.length ? losing.join(' and ') : allow.join(', ');
  return {
    ...base,
    ok: false,
    reason: present ? 'not-trusted' : 'missing',
    message:
      `This folder is not marked as trusted for Claude Code, so its ${allow.length} permission ` +
      `settings are ignored and the agent loses ${lost}. Scan and Triage read job descriptions ` +
      `with those tools, so a run would cost money and score almost nothing. Fix it once in ` +
      `Setup, or set projects["${trustKey}"].hasTrustDialogAccepted to true in ${CLAUDE_CONFIG_PATH}.`,
  };
}

/**
 * Mark the workspace trusted. Only ever called from an explicit user action (the
 * Setup button) — never automatically, because silently flipping a security flag
 * on the user's behalf is exactly the behaviour the trust dialog exists to stop.
 *
 * Writes with JSON.stringify(obj, null, 2), which round-trips this file byte for
 * byte (verified before shipping). A .bak copy is left beside it regardless.
 */
export function trustWorkspace(dir = ROOT_DIR) {
  const trustKey = trustKeyFor(dir);
  const raw = fs.readFileSync(CLAUDE_CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw);
  config.projects = config.projects || {};
  config.projects[trustKey] = { ...(config.projects[trustKey] || {}), hasTrustDialogAccepted: true };
  fs.writeFileSync(`${CLAUDE_CONFIG_PATH}.bak`, raw, 'utf8');
  fs.writeFileSync(CLAUDE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  return { trustKey, backup: `${CLAUDE_CONFIG_PATH}.bak` };
}
