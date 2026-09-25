import { claimPostEvalChain } from '../dashboard-web/server/routes/workflow.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { passed += 1; console.log(`PASS ${message}`); }
  else { failed += 1; console.log(`FAIL ${message}`); }
}

const chains = new Map();
const first = claimPostEvalChain('eval-invented-1', chains, () => 1234);
const second = claimPostEvalChain('eval-invented-1', chains, () => 5678);
const other = claimPostEvalChain('eval-invented-2', chains, () => 9012);
const missing = claimPostEvalChain('', chains);

check(first.started === true && first.run.startedAt === 1234, 'first page claims the Evaluate chain');
check(second.skipped === 'already-ran', 'second page is skipped for the same Evaluate job');
check(second.run === first.run, 'duplicate request receives the existing run');
check(other.started === true && chains.size === 2, 'a different Evaluate job gets its own chain');
check(missing.error === 'evaluateJobId required', 'missing Evaluate job id is refused');

console.log(`workflow-post-eval: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
