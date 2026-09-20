// D-6 guard: No Response is set by hand (Definitions v1 section 3). No script or server code may
// assign it to an application in bulk. The dashboard's own status picker is the hand path and lives
// in the browser code, which this test does not scan.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

// A bulk close is any write that names the status as a value to assign.
const ASSIGNS_NO_RESPONSE = /(?:status\s*:|nextStatus\s*=|status\s*=|after\s*:)\s*['"]No Response['"]/;

// Known exceptions. Remove an entry when its code is removed; the test fails on a stale entry.
const ALLOWED = new Map([
  ['dashboard-web/server/routes/followups.mjs', 'archive-ghosted route, to be removed with the Ghosted feature (Definitions v1 section 3)'],
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git' || name === 'installer') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.mjs')) out.push(path);
  }
  return out;
}

const codeFiles = [
  ...readdirSync(root).filter(name => name.endsWith('.mjs')).map(name => join(root, name)),
  ...walk(join(root, 'lib')),
  ...walk(join(root, 'scripts')),
  ...walk(join(root, 'dashboard-web', 'server')),
];

const offenders = [];
const seenAllowed = new Set();
for (const file of codeFiles) {
  const name = relative(root, file).replaceAll(sep, '/');
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
    if (!ASSIGNS_NO_RESPONSE.test(line)) return;
    if (ALLOWED.has(name)) seenAllowed.add(name);
    else offenders.push(`${name}:${index + 1}`);
  });
}

check(codeFiles.length > 100, `scanned ${codeFiles.length} script and server files`);
check(offenders.length === 0, `no unlisted code assigns No Response${offenders.length ? `: ${offenders.join(', ')}` : ''}`);
for (const name of ALLOWED.keys()) {
  check(seenAllowed.has(name), `the listed exception still exists: ${name}`);
}

// The detector itself must fire on the shapes that caused the earlier bulk closes.
check(ASSIGNS_NO_RESPONSE.test("nextStatus = 'No Response';"), 'detector fires on a nextStatus assignment');
check(ASSIGNS_NO_RESPONSE.test("patchRowInMd(id, { status: 'No Response' })"), 'detector fires on a status property');
check(ASSIGNS_NO_RESPONSE.test('changeStatus({ after: "No Response" })'), 'detector fires on an after property');
check(!ASSIGNS_NO_RESPONSE.test("app.status === 'No Response'"), 'detector ignores a comparison');
check(!ASSIGNS_NO_RESPONSE.test("['Rejected', 'No Response'].includes(status)"), 'detector ignores a list of statuses');

console.log(`bulk-no-response-guard: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
