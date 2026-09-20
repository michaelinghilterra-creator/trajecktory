// lib/passed.mjs: the reason tag and the mapping back to the four old labels.
import { PASSED_REASONS, passedReasonOf, stripPassedReason, withPassedReason, reasonForOldStatus, oldLabel, isPostingClosed } from '../lib/passed.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

check(passedReasonOf('[passed: not_a_fit] Wrong level') === 'not_a_fit', 'reads the tag at the front');
check(passedReasonOf('Wrong level [passed: skip]') === 'skip', 'reads the tag anywhere in the notes');
check(passedReasonOf('[PASSED:  Posting_Closed ] x') === 'posting_closed', 'case and spacing are forgiving');
check(passedReasonOf('[passed: nonsense] x') === null, 'an unknown reason is no reason');
check(passedReasonOf('') === null && passedReasonOf(undefined) === null && passedReasonOf(null) === null, 'empty notes have no reason');

check(withPassedReason('Wrong level', 'skip') === '[passed: skip] Wrong level', 'the tag goes to the front');
check(withPassedReason('', 'skip') === '[passed: skip]', 'a tag alone for empty notes');
check(withPassedReason('[passed: skip] Wrong level', 'discarded') === '[passed: discarded] Wrong level', 'a second call replaces the tag, never doubles it');
check(stripPassedReason('[passed: skip] Wrong level') === 'Wrong level' && stripPassedReason('Wrong level') === 'Wrong level', 'strip removes only the tag');
let threw = false;
try { withPassedReason('x', 'bogus'); } catch { threw = true; }
check(threw, 'an unknown reason is refused when writing');
check(withPassedReason(withPassedReason('a | b', 'skip'), 'skip') === '[passed: skip] a | b', 'writing twice is idempotent');

// Round trip: every old label survives a trip through Passed.
for (const old of ['Not a Fit', 'SKIP', 'Discarded', 'Closed']) {
  const reason = reasonForOldStatus(old, 'some note');
  check(PASSED_REASONS.includes(reason) && oldLabel('Passed', withPassedReason('some note', reason)) === old, `${old} round trips through Passed`);
}
check(reasonForOldStatus('Discarded', 'auto-discarded: score 2.4 < 3.0. x') === 'low_score' && oldLabel('Passed', '[passed: low_score] auto-discarded: score 2.4 < 3.0. x') === 'Discarded', 'a low score auto discard keeps its finer reason and is still Discarded');
check(reasonForOldStatus('Discarded', 'auto-discarded: agent recommends against. x') === 'discarded', 'a recommends against discard is plain discarded');
check(reasonForOldStatus('Applied', 'x') === null && reasonForOldStatus('Passed', 'x') === null, 'only the four old labels map to a reason');
check(oldLabel('Passed', '[passed: withdrew]') === 'Discarded' && oldLabel('Passed', 'no tag') === 'Discarded', 'withdrew and an untagged Passed read as Discarded');
check(oldLabel('Applied', '[passed: skip]') === 'Applied' && oldLabel('Rejected', '') === 'Rejected', 'other statuses are returned unchanged');
check(isPostingClosed({ status: 'Closed' }) && isPostingClosed({ status: 'Passed', notes: '[passed: posting_closed]' }), 'posting closed is Closed or Passed for posting_closed');
check(!isPostingClosed({ status: 'Passed', notes: '[passed: skip]' }) && !isPostingClosed({ status: 'Discarded' }) && !isPostingClosed(null), 'nothing else is a closed posting');

console.log(`passed: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
