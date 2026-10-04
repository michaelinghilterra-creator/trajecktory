// Passed step 6 (UI): the status lists the dashboard offers list Passed, not the four retired labels, and a
// Passed row's badge names its reason. Runs the real lines from data.js and checks the badge sources.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = join(process.cwd());
const dataJs = readFileSync(join(root, 'dashboard-web/src/data.js'), 'utf8');
const pipelineJsx = readFileSync(join(root, 'dashboard-web/src/pipeline.jsx'), 'utf8');
const sharedJsx = readFileSync(join(root, 'dashboard-web/src/shared.jsx'), 'utf8');

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

const context = { window: {} };
vm.createContext(context);
vm.runInContext([
  'window.INTERVIEW_STAGES',
  'window.PASSED_REASON_LABEL',
  'window.passedReasonLabel',
  'window.STATUSES',
].map((p) => lineStartingWith(dataJs, p)).join('\n'), context);
const { STATUSES, passedReasonLabel, PASSED_REASON_LABEL } = context.window;

for (const retired of ['SKIP', 'Not a Fit', 'Discarded', 'Closed']) {
  check(!STATUSES.includes(retired), `window.STATUSES no longer lists ${retired}`);
}
check(STATUSES.includes('Passed'), 'window.STATUSES lists Passed');
check(STATUSES.includes('Rejected') && STATUSES.includes('No Response'), 'Rejected and No Response are still listed');

check(passedReasonLabel('not_a_fit') === 'not a fit', 'not_a_fit reads "not a fit"');
check(passedReasonLabel('skip') === 'skipped', 'skip reads "skipped"');
check(passedReasonLabel('posting_closed') === 'posting closed', 'posting_closed reads "posting closed"');
check(passedReasonLabel('withdrew') === 'withdrew', 'withdrew reads "withdrew"');
check(passedReasonLabel('low_score') === 'low score', 'low_score reads "low score"');
check(passedReasonLabel(null) === 'discarded' && passedReasonLabel('nope') === 'discarded', 'a missing or unknown reason reads "discarded"');
check(Object.keys(PASSED_REASON_LABEL).length === 6, 'every Passed reason has a label (matches PASSED_REASONS in lib/passed.mjs)');

const { PASSED_REASONS } = await import('../lib/passed.mjs');
check(PASSED_REASONS.every((r) => r in PASSED_REASON_LABEL), 'the label table covers every reason lib/passed.mjs defines');

check(/function StatusBadge\(\{ status, size = 'md', reason \}\)/.test(pipelineJsx), 'Pipeline StatusBadge takes the reason');
check((pipelineJsx.match(/<StatusBadge status=\{a\.status\} reason=\{a\.passedReason\} \/>/g) || []).length === 2, 'both Pipeline table badges pass the row reason');
check(/<window\.StatusPill status=\{app\.status\} reason=\{app\.passedReason\} \/>/.test(pipelineJsx), 'the drawer pill passes the row reason');
check(/StatusPill\(\{ status, size = "md", reason \}\)/.test(sharedJsx), 'StatusPill takes the reason');
check(!/window\.oldStatus\(a\); m\[old\]/.test(pipelineJsx), 'status chip counts no longer double count under an old label');

console.log(`passed-ui-lists: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
