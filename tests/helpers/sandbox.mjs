/**
 * tests/helpers/sandbox.mjs — a temp data dir that cleans itself up, whatever
 * happens to the suite.
 *
 * WHY THIS EXISTS
 * Forty suites create a sandbox with mkdtempSync. Eleven never removed it at all,
 * and the rest called rmSync on the last line, which only runs when the suite
 * reaches the last line. A failing assertion, a thrown error or an early
 * process.exit() all skip it, and a failing run is exactly when sandboxes are
 * created most. They accumulated silently: 931 directories were found on one
 * machine, none of them referenced again after the second they were made.
 *
 * Registering on 'exit' instead of trailing the script covers the normal path,
 * process.exit(), and an uncaught throw, because Node runs exit handlers in all
 * three. It cannot cover SIGKILL, and nothing can.
 *
 * The handler must be SYNCHRONOUS: Node ignores pending async work once 'exit'
 * has fired, so an fs.promises call there silently does nothing.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pending = new Set();
let hooked = false;

function removeAll() {
  for (const dir of pending) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* already gone */ }
  }
  pending.clear();
}

/**
 * Make a temp directory that is removed when the process exits.
 * `prefix` is a short suite name, e.g. 'referrals'; it is namespaced under tjk-
 * so a stray one is still recognizable as ours.
 */
export function makeSandbox(prefix = 'test') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tjk-${prefix}-`));
  pending.add(dir);
  if (!hooked) {
    hooked = true;
    process.on('exit', removeAll);
  }
  return dir;
}

/**
 * Register a directory the suite made itself, so it is removed on exit too.
 *
 * A few suites deliberately create their sandbox INSIDE the repo rather than in
 * the system temp dir, because the code under test resolves paths relative to
 * the repo root. Those are the worst ones to leak: the leftovers are untracked
 * directories in the working tree, not tucked away in temp. Keep where they are
 * created, fix whether they are removed.
 */
export function trackSandbox(dir) {
  pending.add(dir);
  if (!hooked) {
    hooked = true;
    process.on('exit', removeAll);
  }
  return dir;
}

/** Remove the sandboxes now, for a suite that wants to assert on a clean tmpdir. */
export function cleanSandboxes() { removeAll(); }
