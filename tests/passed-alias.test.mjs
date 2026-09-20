// Passed is live but written by nothing yet (Passed Status Migration Plan, step 1). Every reader must give a
// Passed row the same answer it gives the closest old label, so a row that reaches Passed by hand cannot
// change a count. The four old labels stay canonical and are not rewritten into Passed.
import * as server from '../dashboard-web/server/lib/statuses.mjs';
import { resultForStatus } from '../dashboard-web/server/lib/twc.mjs';
import { evaluateStatusChange } from '../lib/status-guards.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

check(server.ALL_STATUSES.includes('Passed'), 'the server knows Passed');
check(['SKIP', 'Not a Fit', 'Discarded', 'Closed'].every((s) => server.ALL_STATUSES.includes(s)), 'the four old labels are still canonical');
check(!server.FUNNEL_ORDER.includes('Passed') && !server.ACTIVE_STATUSES.includes('Passed'), 'Passed is off the funnel and not active');
check(server.CLOSED_STATUSES.includes('Passed') === server.CLOSED_STATUSES.includes('Discarded'), 'Passed is closed like Discarded');
check(server.OUTREACH_DEAD_STATUSES.includes('Passed') && !server.OUTREACH_ELIGIBLE_STATUSES.includes('Passed'), 'Passed is dead for outreach, never eligible');
check(server.RESPONSE_DECISION_BUCKETS.candidateSide.has('Passed'), 'Passed is a candidate side close in the response buckets');
check(!server.RESPONSE_DECISION_BUCKETS.employerNo.has('Passed') && !server.RESPONSE_DECISION_BUCKETS.advance.has('Passed'), 'Passed is neither an employer no nor an advance');
check(server.hasResponded({ status: 'Passed' }) === server.hasResponded({ status: 'Discarded' }) && server.hasResponded({ status: 'Passed' }) === false, 'a Passed row did not respond, as with Discarded');
check(server.hasResponded({ status: 'Passed', reached: 'Phone Screen' }) === true, 'a Passed row that reached a screen still counts as a response');
check(server.enteredFunnel({ status: 'Passed' }) === server.enteredFunnel({ status: 'Discarded' }) && server.enteredFunnel({ status: 'Passed' }) === true, 'a Passed row entered the funnel, as Discarded does');
check(resultForStatus('Passed') === 'Other' && resultForStatus('Passed') === resultForStatus('Discarded'), 'the Work Search result for Passed is Other, as for Discarded');
check(evaluateStatusChange({ to: 'Passed' }).allowed === true, 'the guard allows Passed');

console.log(`passed-alias: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
