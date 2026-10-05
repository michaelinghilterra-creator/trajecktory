import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const root = join(process.cwd());
const appJsx = readFileSync(join(root, 'dashboard-web/src/app.jsx'), 'utf8');
const reviewJsx = readFileSync(join(root, 'dashboard-web/src/review.jsx'), 'utf8');
const launchpadJsx = readFileSync(join(root, 'dashboard-web/src/launchpad.jsx'), 'utf8');

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

function runRefreshHelper(windowStub) {
  const context = { window: windowStub };
  vm.createContext(context);
  vm.runInContext(`${lineStartingWith(reviewJsx, 'const refreshApplications =')}\nrefreshApplications();`, context);
}

let calls = 0;
runRefreshHelper({ tjkRefreshApps: () => { calls++; } });
check(calls === 1, 'refreshApplications calls window.tjkRefreshApps once when it is a function');

check((() => { try { runRefreshHelper({}); return true; } catch { return false; } })(), 'refreshApplications does not throw when tjkRefreshApps is absent');
check((() => { try { runRefreshHelper({ tjkRefreshApps: () => { throw new Error('sync failed'); } }); return true; } catch { return false; } })(), 'refreshApplications swallows tjkRefreshApps errors');
calls = 0;
check((() => { try { runRefreshHelper({ tjkRefreshApps: 'not a function' }); return calls === 0; } catch { return false; } })(), 'refreshApplications ignores non-function tjkRefreshApps');

const refreshAppsIndex = appJsx.indexOf('const refreshApps = useCallback(');
const publishIndex = appJsx.indexOf('window.tjkRefreshApps = refreshApps');
const publishEffectStart = appJsx.lastIndexOf('useEffect(', publishIndex);
const publishEffectEnd = appJsx.indexOf(');', publishIndex);
const publishEffect = publishEffectStart > -1 && publishEffectEnd > -1
  ? appJsx.slice(publishEffectStart, publishEffectEnd + 2)
  : '';
check(refreshAppsIndex > -1, 'app.jsx still defines refreshApps with useCallback');
check(publishIndex > refreshAppsIndex, 'app.jsx publishes tjkRefreshApps after refreshApps is defined');
check(/useEffect\([\s\S]*window\.tjkRefreshApps = refreshApps[\s\S]*\}, \[refreshApps\]\);/.test(publishEffect), 'app.jsx publishes tjkRefreshApps inside a useEffect depending on refreshApps');

const noAppLine = lineStartingWith(reviewJsx, 'const noApp =');
check(noAppLine.includes("'dismiss'") && noAppLine.includes("'not-related'") && noAppLine.includes("'unmatched'"), 'reply row noApp covers dismiss, not-related, and unmatched');
const noAppIndex = reviewJsx.indexOf(noAppLine);
const replyFetchIndex = reviewJsx.indexOf('fetch(`/api/google/replies/${encodeURIComponent(reply.msgId)}/${action}`', noAppIndex);
const replyThenIndex = reviewJsx.indexOf('.then(res => {', replyFetchIndex);
const replyGuardIndex = reviewJsx.indexOf('res.guard', replyThenIndex);
const replyErrorIndex = reviewJsx.indexOf('res.error', replyThenIndex);
const replyRefreshIndex = reviewJsx.indexOf('if (!noApp) refreshApplications();', replyThenIndex);
const replySetDoneIndex = reviewJsx.indexOf('setDone(', replyThenIndex);
check(replyThenIndex > -1 && replyGuardIndex > replyThenIndex && replyErrorIndex > replyGuardIndex, 'reply row keeps guarded and error early returns in the success handler');
check(replyErrorIndex > -1 && replyRefreshIndex > replyErrorIndex && replyRefreshIndex < replySetDoneIndex, 'reply row refreshes after early returns and before setDone');

const unmatchedFunctionIndex = reviewJsx.indexOf('function UnmatchedList');
const unmatchedFetchIndex = reviewJsx.indexOf('fetch(`/api/google/replies/${encodeURIComponent(item.msgId)}/${action}`', unmatchedFunctionIndex);
const unmatchedThenIndex = reviewJsx.indexOf('.then(res => {', unmatchedFetchIndex);
const unmatchedErrorIndex = reviewJsx.indexOf('res.error', unmatchedThenIndex);
const unmatchedRefreshIndex = reviewJsx.indexOf("if (action === 'log') refreshApplications();", unmatchedThenIndex);
check(unmatchedErrorIndex > -1 && unmatchedRefreshIndex > unmatchedErrorIndex, 'Unmatched list refresh for log is after the error return');

const undoThrowIndex = launchpadJsx.indexOf("throw new Error(body.error || 'Could not undo that.')");
const undoRefreshIndex = launchpadJsx.indexOf('window.tjkRefreshApps()', undoThrowIndex);
const undoLoadIndex = launchpadJsx.indexOf('return load();', undoThrowIndex);
check(undoThrowIndex > -1 && undoRefreshIndex > undoThrowIndex && undoRefreshIndex < undoLoadIndex, 'Recent changes undo refreshes only after successful undo and before reload');

const jsxDir = join(root, 'dashboard-web/src');
for (const file of readdirSync(jsxDir).filter((name) => name.endsWith('.jsx'))) {
  const source = readFileSync(join(jsxDir, file), 'utf8');
  for (const match of source.matchAll(/tjkRefreshApps\(/g)) {
    const before = source.slice(Math.max(0, match.index - 160), match.index);
    const inHelper = file === 'review.jsx' && before.includes('const refreshApplications =');
    const hasTruthyGuard = before.includes('if (window.tjkRefreshApps)');
    const hasTypeGuard = before.includes("typeof window.tjkRefreshApps === 'function'");
    check(inHelper || hasTruthyGuard || hasTypeGuard, `${file} guards tjkRefreshApps call at index ${match.index}`);
  }
}

console.log(`refresh-apps-after-reply: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
