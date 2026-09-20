// Both client status-change paths (app.jsx's handleAction and Pipeline's own advance in pipeline.jsx) must
// translate the four old close actions into Passed with a reason the SAME way. They drifted once already: one
// translated, the other wrote the old label straight through (found while wiring E-1). Guards against it
// recurring by running the real shared function from data.js, and by checking neither file re-grows its own
// separate mapping.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = join(process.cwd());
const dataJs = readFileSync(join(root, 'dashboard-web/src/data.js'), 'utf8');
const appJsx = readFileSync(join(root, 'dashboard-web/src/app.jsx'), 'utf8');
const pipelineJsx = readFileSync(join(root, 'dashboard-web/src/pipeline.jsx'), 'utf8');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

function lineStartingWith(source, prefix) {
  const line = source.split('\n').find((l) => l.trim().startsWith(prefix));
  if (!line) throw new Error(`not found: ${prefix}`);
  return line.trim();
}

// Run the actual shared function from data.js, not a re-typed copy of it.
const context = { window: {} };
vm.createContext(context);
vm.runInContext(`${lineStartingWith(dataJs, 'window.PASSED_ACTIONS')}\n${lineStartingWith(dataJs, 'window.passedReasonForAction')}`, context);
const passedReasonForAction = context.window.passedReasonForAction;

check(passedReasonForAction('SKIP') === 'skip', 'SKIP maps to reason skip');
check(passedReasonForAction('Not a Fit') === 'not_a_fit', 'Not a Fit maps to reason not_a_fit');
check(passedReasonForAction('Closed') === 'posting_closed', 'Closed maps to reason posting_closed');
check(passedReasonForAction('Discarded') === 'discarded', 'Discarded maps to reason discarded');
check(passedReasonForAction('Passed') === 'discarded', 'Passed itself defaults to reason discarded');
check(passedReasonForAction('Applied') === undefined, 'Applied is not a close action');
check(passedReasonForAction('Rejected') === undefined, 'Rejected is not a close action');
check(passedReasonForAction('Phone Screen') === undefined, 'an interview stage is not a close action');
check(passedReasonForAction(undefined) === undefined, 'no input never throws');

// Neither client file may keep its own separate copy of the mapping — that duplication is exactly how the two
// paths drifted apart the first time.
check(!/const PASSED_ACTIONS\s*=/.test(appJsx), 'app.jsx no longer defines its own PASSED_ACTIONS');
check(!/const PASSED_ACTIONS\s*=/.test(pipelineJsx), 'pipeline.jsx never defined its own PASSED_ACTIONS either');
check(/window\.passedReasonForAction\(newStatus\)/.test(appJsx), 'app.jsx reads the shared function');
check(/window\.passedReasonForAction\(newStatus\)/.test(pipelineJsx), 'pipeline.jsx reads the same shared function');

// Pipeline's own advance() must send the translated status (and the reason) to the server, not the raw action id.
const advanceStart = pipelineJsx.indexOf('const advance = async (a, newStatus, eventDate) => {');
const advanceBody = pipelineJsx.slice(advanceStart, advanceStart + 700);
check(advanceStart > -1, 'advance() is still where this test expects it (update the slice above if it moved)');
check(/status:\s*canonicalStatus/.test(advanceBody), 'advance() sends the canonical status (Passed for a close action), not the raw action id');
check(/if \(passedReason\) body\.passedReason = passedReason;/.test(advanceBody), 'advance() sends the reason along when there is one');
check(!/const body = \{ status: newStatus \};/.test(pipelineJsx), 'advance() no longer builds its PATCH body from the raw newStatus');

console.log(`passed-reason-shared: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
