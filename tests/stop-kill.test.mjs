#!/usr/bin/env node
/**
 * stop-kill.test.mjs — Stop actually TERMINATES the in-flight eval child.
 *
 * WHY THIS EXISTS:
 * The Stop button used to only set a flag that refused the NEXT batch — the
 * running `claude -p` kept going (and kept billing) until it finished on its own,
 * so Stop looked broken. killAgentChild() now hard-kills the tracked child. This
 * proves the mechanism against a real long-running child process (no paid eval):
 * register it in agentChildren, kill it, and confirm it exits. Cross-platform —
 * Windows kills the process tree (taskkill /T /F), POSIX sends SIGTERM.
 *
 * Run: node tests/stop-kill.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { spawn } from 'child_process';
import { agentChildren, killAgentChild } from '../dashboard-web/server/routes/agent.mjs';

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ✅ ${name}`);
  else { console.log(`  ❌ ${name}`); failures++; }
}

async function main() {
  // A child that would run effectively forever unless killed.
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 100000)'], { windowsHide: true });
  const jobId = 'stop-kill-test';
  agentChildren.set(jobId, child);

  const exited = new Promise((resolve) => {
    child.on('exit', () => resolve(true));
    child.on('close', () => resolve(true));
  });

  // Give it a moment to be fully up, confirm it is alive, then Stop-kill it.
  await new Promise((r) => setTimeout(r, 250));
  check('child is alive before the kill', child.exitCode === null && !child.killed);

  const killedReturn = killAgentChild(jobId);
  check('killAgentChild reports it acted', killedReturn === true);

  const didExit = await Promise.race([
    exited,
    new Promise((r) => setTimeout(() => r(false), 5000)),
  ]);
  check('the child process actually exited after the kill', didExit === true);

  // A missing job is a harmless no-op, never a throw.
  agentChildren.delete(jobId);
  check('killing an unknown job is a safe no-op', killAgentChild('no-such-job') === false);

  if (failures) { console.log(`\n❌ stop-kill: ${failures} check(s) failed`); process.exit(1); }
  console.log('\n✅ stop-kill: all checks passed');
  process.exit(0);
}

main().catch((e) => { console.log('❌ stop-kill threw:', e.message); process.exit(1); });
