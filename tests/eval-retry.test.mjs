#!/usr/bin/env node
/**
 * eval-retry.test.mjs — the bounded per-batch retry decision (Slice 7.6).
 *
 * WHY THIS EXISTS:
 * The rolling Evaluate chain retries a transiently-failed batch instead of
 * dropping the rest of the run. The load-bearing part is knowing WHICH failures
 * are worth retrying: a rate-limit blip, yes; an untrusted workspace, a missing
 * CLI, or a hard billing/credit error, NO — retrying those just burns quota
 * re-hitting the same wall. This pins that decision matrix and the retry-count
 * env parsing, neither of which is otherwise exercised without a paid run.
 *
 * Run: node tests/eval-retry.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { agentJobs, batchRetries, batchRetryable } from '../dashboard-web/server/routes/agent.mjs';

let failures = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✅ ${name}`); }
  else { console.log(`  ❌ ${name}`); failures++; }
}

// ── batchRetryable: which failures are worth a retry ──
check('a clean result is never retried', batchRetryable('nope', { ok: true }) === false);
check('a generic/transient error IS retryable', batchRetryable('nope', { ok: false, error: 'Agent reported an error' }) === true);
check('a rate-limit style error IS retryable', batchRetryable('nope', { ok: false, error: 'overloaded_error (529)' }) === true);
check('an error with no message IS retryable (assume transient)', batchRetryable('nope', { ok: false }) === true);

// Deterministic failures must NOT be retried.
check('CLI-not-found is NOT retried', batchRetryable('nope', { ok: false, error: 'Claude Code CLI not found. Make sure `claude` is installed and on your PATH' }) === false);
check('a hard billing error is NOT retried', batchRetryable('nope', { ok: false, error: 'Your credit balance is insufficient' }) === false);
check('an auth error is NOT retried', batchRetryable('nope', { ok: false, error: 'authentication failed: invalid API key' }) === false);

// An untrusted workspace is deterministic (flagged on the job), so no retry.
agentJobs.set('trust-job', { needsTrust: true, status: 'error' });
check('an untrusted-workspace failure is NOT retried', batchRetryable('trust-job', { ok: false, error: 'workspace not trusted' }) === false);
agentJobs.delete('trust-job');

// ── batchRetries: env parsing (default 1, override, disable) ──
const savedEnv = process.env.TJK_EVAL_BATCH_RETRIES;
delete process.env.TJK_EVAL_BATCH_RETRIES;
check('default retry budget is 1', batchRetries() === 1);
process.env.TJK_EVAL_BATCH_RETRIES = '0';
check('0 disables retries', batchRetries() === 0);
process.env.TJK_EVAL_BATCH_RETRIES = '3';
check('an explicit budget is honored', batchRetries() === 3);
process.env.TJK_EVAL_BATCH_RETRIES = 'garbage';
check('a non-numeric value falls back to the default (1)', batchRetries() === 1);
if (savedEnv === undefined) delete process.env.TJK_EVAL_BATCH_RETRIES; else process.env.TJK_EVAL_BATCH_RETRIES = savedEnv;

if (failures) { console.log(`\n❌ eval-retry: ${failures} check(s) failed`); process.exit(1); }
console.log('\n✅ eval-retry: all checks passed');
