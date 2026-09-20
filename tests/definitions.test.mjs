// Definitions v1 section 8: one definitions file, and tests that fail when code uses a status name it
// does not define or a status set drifts from it. Reads templates/states.yml and the server status sets.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import * as defs from '../lib/definitions.mjs';
import * as server from '../dashboard-web/server/lib/statuses.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
const same = (a, b) => JSON.stringify([...a]) === JSON.stringify([...b]);
const sameSet = (a, b) => same([...a].sort(), [...b].sort());

// A comparison of a status-named value to a title case literal, in either order. Lowercase literals
// are job or queue states (running, done) and literals with an underscore are constants of other
// vocabularies (a ledger row status); neither is an application or contact status.
const STATUS_NAME = '(?:[\\w$]+\\.)*(?:status|nextStatus|newStatus|prevStatus|oldStatus|toStatus|fromStatus|appStatus)';
const LITERAL = '([\'"])([A-Z0-9][^\'"_\\n]*)\\1';
const LEFT = new RegExp(`(?:^|[^\\w$.])${STATUS_NAME}\\s*[!=]==?\\s*${LITERAL}`, 'g');
const RIGHT = new RegExp(`${LITERAL}\\s*[!=]==?\\s*${STATUS_NAME}(?![\\w$])`, 'g');

function findStatusNames(source) {
  const found = [];
  source.split('\n').forEach((line, index) => {
    const text = line.trim();
    if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return;
    for (const re of [LEFT, RIGHT]) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(line))) found.push({ name: match[2], line: index + 1 });
    }
  });
  return found;
}

function problemsIn(source) {
  const problems = [];
  for (const { name, line } of findStatusNames(source)) {
    if (defs.PLANNED_STATUSES.includes(name)) problems.push(`${name} is planned, not live (line ${line})`);
    else if (!defs.DEFINED_STATUS_NAMES.has(name)) problems.push(`${name} is not defined (line ${line})`);
  }
  return problems;
}

// The scanner must be able to fail.
check(problemsIn("if (app.status === 'Ghosted') {}").length === 1, 'scanner flags an undefined name on the right of ===');
check(problemsIn("if ('Ghosted' !== app.status) {}").length === 1, 'scanner flags an undefined name on the left');
check(problemsIn("if (nextStatus == 'Zzz Nope') {}").length === 1, 'scanner flags a nextStatus comparison');
check(problemsIn("if (app.status === 'Passed') {}").length === 1, 'scanner flags a planned status that is not live');
check(problemsIn("if (app.status === 'Applied') {}").length === 0, 'scanner accepts a defined application status');
check(problemsIn("if (c.status === 'Bounced') {}").length === 0, 'scanner accepts a defined contact status');
check(problemsIn("if (job.status === 'running') {}").length === 0, 'scanner ignores lowercase job states');
check(problemsIn("if (row.status === 'NOT_FOUND') {}").length === 0, 'scanner ignores upper case constants with an underscore');
check(problemsIn("if (c.linkedinStatus === 'Invite Pending') {}").length === 0, 'scanner ignores other status like fields');
check(problemsIn("// app.status === 'Ghosted'").length === 0, 'scanner skips comment lines');

// The file agrees with templates/states.yml.
const doc = yaml.load(readFileSync(join(root, 'templates', 'states.yml'), 'utf8'));
check(sameSet(defs.ALL_APPLICATION_STATUSES, doc.states.map(s => s.label)), 'every application status in states.yml is defined here, and no others');
const contactLabels = new Set([...doc.talent_states, ...doc.referral_states].map(s => s.label));
check(sameSet(defs.CONTACT_STATUSES, contactLabels), 'every contact status in states.yml is defined here, and no others');
check(same(defs.LADDER, doc.states.filter(s => Number.isFinite(s.funnel_order)).sort((a, b) => a.funnel_order - b.funnel_order).map(s => s.label)), 'the ladder matches the funnel order in states.yml');
check(same(defs.INTERVIEW_STAGES, doc.states.filter(s => s.group === 'interview').map(s => s.label)), 'the interview stages match states.yml');

// The sets say what Definitions v1 says.
check(same(defs.ACTIVE_STATUSES, ['Applied', 'Phone Screen', '1st Interview', '2nd Interview', '3rd Interview', 'Offer']), 'Active is Applied, the interview stages and Offer');
check(!defs.ACTIVE_STATUSES.includes('Evaluated'), 'Evaluated is not active');
check(sameSet(defs.EMPLOYER_END_STATES, ['Rejected', 'No Response']), 'the employer end states are Rejected and No Response');
check(sameSet(defs.RETIRING_STATUSES, ['SKIP', 'Not a Fit', 'Discarded', 'Closed']), 'the retiring statuses are SKIP, Not a Fit, Discarded and Closed');
check(defs.APPLICATION_STATUSES.filter(s => s.group === 'retiring').every(s => s.retiresInto === 'Passed'), 'every retiring status folds into Passed');
check(sameSet(defs.PLANNED_STATUSES, ['Passed']) && !defs.ALL_APPLICATION_STATUSES.includes('Passed'), 'Passed is planned and not a live status');
check(new Set(defs.ALL_APPLICATION_STATUSES).size === defs.ALL_APPLICATION_STATUSES.length, 'no application status is defined twice');

// The server sets agree, except for the listed divergences.
const extraFor = name => defs.KNOWN_DIVERGENCES.filter(d => d.export === name).flatMap(d => d.extra);
check(same(server.INTERVIEW_STAGES, defs.INTERVIEW_STAGES), 'server INTERVIEW_STAGES matches');
check(same(server.FUNNEL_ORDER, defs.LADDER), 'server FUNNEL_ORDER matches the ladder');
check(same(server.OUTREACH_ELIGIBLE_STATUSES, defs.ACTIVE_STATUSES), 'server OUTREACH_ELIGIBLE_STATUSES matches Active');
check(sameSet(server.OUTREACH_DEAD_STATUSES, defs.ALL_APPLICATION_STATUSES.filter(s => !defs.LADDER.includes(s))), 'server OUTREACH_DEAD_STATUSES is everything off the ladder');
check(sameSet(server.ACTIVE_STATUSES, [...defs.ACTIVE_STATUSES, ...extraFor('ACTIVE_STATUSES')]), 'server ACTIVE_STATUSES is Active plus only the listed divergence');
for (const d of defs.KNOWN_DIVERGENCES) {
  check(d.extra.every(s => server[d.export].includes(s)) && !d.extra.some(s => defs.ACTIVE_STATUSES.includes(s)), `the listed divergence is still real: ${d.export} extra ${d.extra.join(', ')}`);
}

// Walk the code.
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git', 'installer', 'fonts'].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(mjs|js|jsx)$/.test(name)) out.push(path);
  }
  return out;
}
const codeFiles = [
  ...readdirSync(root).filter(name => name.endsWith('.mjs')).map(name => join(root, name)),
  ...walk(join(root, 'lib')),
  ...walk(join(root, 'scripts')),
  ...walk(join(root, 'dashboard-web', 'server')),
  ...walk(join(root, 'dashboard-web', 'src')),
];
const rel = file => relative(root, file).replaceAll(sep, '/');
const sources = new Map(codeFiles.map(file => [rel(file), readFileSync(file, 'utf8')]));
check(sources.size > 150, `scanned ${sources.size} code files`);

const undefinedUses = [];
let comparisons = 0;
for (const [name, source] of sources) {
  comparisons += findStatusNames(source).length;
  for (const problem of problemsIn(source)) undefinedUses.push(`${name}: ${problem}`);
}
check(comparisons > 50, `found ${comparisons} status comparisons to check`);
check(undefinedUses.length === 0, `no code compares a status to an undefined name${undefinedUses.length ? `: ${undefinedUses.join('; ')}` : ''}`);

// Which files read each set: every reader is listed, and no listed file has stopped reading it.
for (const [exportName, listed] of Object.entries(defs.SET_READERS)) {
  const word = new RegExp(`\\b${exportName}\\b`);
  const readers = [...sources].filter(([name, source]) => name !== 'dashboard-web/server/lib/statuses.mjs' && name !== 'lib/definitions.mjs' && word.test(source)).map(([name]) => name);
  const unlisted = readers.filter(name => !listed.includes(name));
  const stale = listed.filter(name => !readers.includes(name));
  check(unlisted.length === 0, `${exportName}: every reader is listed${unlisted.length ? `, missing ${unlisted.join(', ')}` : ''}`);
  check(stale.length === 0, `${exportName}: every listed reader still reads it${stale.length ? `, stale ${stale.join(', ')}` : ''}`);
}

console.log(`definitions: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
