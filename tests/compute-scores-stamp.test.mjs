#!/usr/bin/env node
/**
 * compute-scores-stamp.test.mjs - scorerVersion stamping on derived reports.
 */
import { deriveReportScore, stampScorerVersion, withScorerVersion } from '../compute-scores.mjs';
import { SCORER_VERSION } from '../lib/score.mjs';
import { parseV1 } from '../dashboard-web/server/v1-loader.mjs';

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('compute-scores-stamp.test.mjs');

const body = '# Zorblax Widgetry - Example Cog Lead\n\nNarrative body that must stay byte-identical.\n';
const baseData = {
  schema: 'trajecktory-report/v1',
  id: 900001,
  company: 'Zorblax Widgetry',
  role: 'Example Cog Lead',
  date: '2030-03-01',
  url: 'https://jobs.zorblax.example/900001',
  score: 0,
  globalScore: [
    { key: 'fit', dim: 'Fit / CV Match', val: 4, max: 5, evidence: 'invented fit' },
    { key: 'northStar', dim: 'North Star Alignment', val: 5, max: 5 },
    { key: 'level', dim: 'Level Match', val: 4, max: 5 },
    { key: 'comp', dim: 'Comp', val: 3, max: 5 },
    { key: 'location', dim: 'Location / Logistics', val: 5, max: 5 },
    { key: 'redFlags', dim: 'Red Flags', val: 5, max: 5 },
  ],
};
const mdOf = (data, customBody = body) => `---\n${JSON.stringify(data, null, 2)}\n---\n${customBody}`;
const keyOrder = data => Object.keys(data);

const derived = deriveReportScore(mdOf(baseData));
const derivedData = parseV1(derived.newMd).data;
const keys = keyOrder(derivedData);
check(derived.ok && derivedData.scorerVersion === SCORER_VERSION, 'deriving stamps scorerVersion');
check(keys.indexOf('scorerVersion') === keys.indexOf('score') + 1, 'scorerVersion is positioned immediately after score');

const derivedAgain = deriveReportScore(derived.newMd);
check(derivedAgain.ok && derivedAgain.changed === false && derivedAgain.newMd === derived.newMd, 'deriving a stamped report again changes nothing');

const original = { schema: 'trajecktory-report/v1', score: 4.2, scorerVersion: 'old', role: 'Example' };
const replaced = withScorerVersion(original, 'new');
check(original.scorerVersion === 'old' && replaced.scorerVersion === 'new', 'withScorerVersion is pure and replaces old values');
check(eq(keyOrder(replaced), ['schema', 'score', 'scorerVersion', 'role']), 'withScorerVersion keeps the stamp after score');
check(eq(keyOrder(withScorerVersion({ schema: 'x', role: 'No score' }, 'v')), ['schema', 'role', 'scorerVersion']), 'withScorerVersion appends when there is no score key');

const unstampedData = { ...derivedData };
delete unstampedData.scorerVersion;
const unstampedMd = mdOf(unstampedData);
const stamped = stampScorerVersion(unstampedMd);
const stampedData = parseV1(stamped.newMd).data;
check(stamped.ok && stamped.stamped === true, 'stampScorerVersion stamps a derived report with no stamp');
const restampedData = { ...stampedData };
delete restampedData.scorerVersion;
check(stampedData.scorerVersion === SCORER_VERSION && eq(restampedData, unstampedData), 'stampScorerVersion changes only the stamp key in parsed frontmatter');
check(parseV1(stamped.newMd).body === parseV1(unstampedMd).body, 'stampScorerVersion preserves the body bytes');

const already = stampScorerVersion(derived.newMd);
check(already.ok && already.stamped === false && already.newMd === derived.newMd, 'current stamped report is returned unchanged');

const oldData = { ...derivedData, scorerVersion: 'old-version' };
const oldStamped = stampScorerVersion(mdOf(oldData));
check(oldStamped.ok && oldStamped.stamped === true && parseV1(oldStamped.newMd).data.scorerVersion === SCORER_VERSION, 'old but reproducing stamp is refreshed');

const alteredData = { ...derivedData, scorerVersion: 'old-version', score: 1.1 };
const altered = stampScorerVersion(mdOf(alteredData));
check(!altered.ok && altered.reason === 'differs', 'altered stored score is refused as differs');

const indented = `---\n${JSON.stringify(unstampedData, null, 4)}\n---\n${body}`;
const format = stampScorerVersion(indented);
check(!format.ok && format.reason === 'format-differs', 'noncanonical frontmatter formatting is refused');

const notDerivedData = { ...unstampedData };
delete notDerivedData.scoreSource;
delete notDerivedData.scoreBasis;
const notDerived = stampScorerVersion(mdOf(notDerivedData));
check(!notDerived.ok && notDerived.reason === 'not-derived', 'v1 keyed dimensions without scoreSource are not-derived');

check(stampScorerVersion('# Plain markdown\n').reason === 'not-v1', 'not-v1 passes through from derive step');
const noKeyed = stampScorerVersion(mdOf({ ...baseData, globalScore: [{ dim: 'CV Match', val: 4, max: 5 }] }));
check(!noKeyed.ok && noKeyed.reason === 'no-keyed-dims', 'no-keyed-dims passes through from derive step');
check(!altered.newMd || altered.newMd === mdOf(alteredData), 'a refused report is not returned as changed');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
