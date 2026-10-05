import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { RETIRED_STATES, withRetiredStates, reasonForOldStatus } from '../lib/passed.mjs';
import * as server from '../dashboard-web/server/lib/statuses.mjs';
import * as defs from '../lib/definitions.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const same = (a, b) => JSON.stringify([...a]) === JSON.stringify([...b]);
const sameSet = (a, b) => same([...a].sort(), [...b].sort());

const expectedAliases = {
  Discarded: ['descartado', 'descartada', 'cerrada', 'cancelada'],
  SKIP: ['no_aplicar', 'no aplicar', 'skip', 'monitor'],
  Closed: ['no longer available', 'expired', 'nla', 'posting closed', 'role closed'],
  'Not a Fit': ['not a fit', 'naf', 'no fit', 'poor fit'],
};
const retiredLabels = ['Discarded', 'SKIP', 'Closed', 'Not a Fit'];

check(same(RETIRED_STATES.map(s => s.label), retiredLabels), 'retired labels are listed in order');
for (const state of RETIRED_STATES) {
  check(same(state.aliases, expectedAliases[state.label]), `${state.label} aliases are exact`);
}
check(Object.isFrozen(RETIRED_STATES), 'retired states array is frozen');
check(RETIRED_STATES.every(s => Object.isFrozen(s)), 'each retired state is frozen');
check(RETIRED_STATES.every(s => Object.isFrozen(s.aliases)), 'each retired alias list is frozen');

const inputStates = [{ id: 'evaluated', label: 'Evaluated' }, { id: 'passed', label: 'Passed' }, { id: 'no_response', label: 'No Response' }];
const inputBefore = JSON.stringify(inputStates);
const withPassed = withRetiredStates(inputStates);
check(same(withPassed.map(s => s.label), ['Evaluated', 'Discarded', 'SKIP', 'Closed', 'Not a Fit', 'Passed', 'No Response']), 'withRetiredStates inserts retired states before Passed');
check(JSON.stringify(inputStates) === inputBefore, 'withRetiredStates does not mutate the input list');
check(same(withRetiredStates([{ id: 'x', label: 'X' }]).map(s => s.label), ['X', 'Discarded', 'SKIP', 'Closed', 'Not a Fit']), 'withRetiredStates appends retired states when Passed is absent');
check(same(withRetiredStates(undefined).map(s => s.label), retiredLabels), 'withRetiredStates treats undefined as empty');
withPassed.find(s => s.label === 'Discarded').aliases.push('new alias');
check(!RETIRED_STATES.find(s => s.label === 'Discarded').aliases.includes('new alias'), 'returned aliases are copies');

const doc = yaml.load(readFileSync(join(root, 'templates', 'states.yml'), 'utf8'));
const retiredIds = ['discarded', 'skip', 'closed', 'not_a_fit'];
const allAliases = Object.values(expectedAliases).flat();
check(!doc.states.some(s => retiredIds.includes(s.id)), 'states.yml has no retired status ids');
check(!doc.states.some(s => (s.aliases || []).some(a => allAliases.includes(a))), 'states.yml has no retired aliases');

check(same(server.ALL_STATUSES, ['Evaluated', 'Applied', 'Phone Screen', '1st Interview', '2nd Interview', '3rd Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP', 'Closed', 'Not a Fit', 'Passed', 'No Response']), 'server status labels preserve the derived order');
for (const state of RETIRED_STATES) {
  check(server.canonicalStatus(state.label) === state.label, `${state.label} canonical label maps to itself`);
  for (const alias of state.aliases) {
    check(server.canonicalStatus(alias.toUpperCase()) === state.label, `${alias} canonical alias maps case insensitively`);
  }
}
check(same([...server.CLOSED_STATUSES], ['Rejected', 'Discarded', 'SKIP', 'Closed', 'Not a Fit', 'Passed', 'No Response']), 'closed statuses include the retired labels');
check(same([...server.OUTREACH_DEAD_STATUSES], ['Rejected', 'Discarded', 'SKIP', 'Closed', 'Not a Fit', 'Passed', 'No Response']), 'outreach dead statuses include the retired labels');

check(sameSet(defs.RETIRING_STATUSES, retiredLabels), 'definitions retiring statuses carry the four retired labels');
check(defs.APPLICATION_STATUSES.filter(s => s.group === 'retiring').every(s => s.retiresInto === 'Passed'), 'definitions retiring entries all fold into Passed');

check(reasonForOldStatus('Not a Fit') === 'not_a_fit', 'Not a Fit maps to not_a_fit');
check(reasonForOldStatus('SKIP') === 'skip', 'SKIP maps to skip');
check(reasonForOldStatus('Discarded') === 'discarded', 'Discarded maps to discarded');
check(reasonForOldStatus('Closed') === 'posting_closed', 'Closed maps to posting_closed');

console.log(`retired-labels: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
