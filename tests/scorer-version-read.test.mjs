#!/usr/bin/env node
/**
 * scorer-version-read.test.mjs - dashboard read projection for scorerVersion.
 */
import { scorerVersionOf, v1Header, v1ToCheatsheet } from '../dashboard-web/server/v1-loader.mjs';

let passed = 0;
let failed = 0;
const check = (condition, message) => {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
};

console.log('scorer-version-read.test.mjs');

check(scorerVersionOf({ scoreSource: 'derived', scorerVersion: '2030-01-01' }) === '2030-01-01', 'stamped value wins');
check(scorerVersionOf({ scoreSource: 'derived' }) === null, 'derived without stamp is null');
check(scorerVersionOf({ score: 4.2 }) === 'authored', 'no scoreSource is authored');
check(scorerVersionOf({ scoreSource: 'legacy' }) === 'authored', 'legacy scoreSource is authored');
check(scorerVersionOf({ scoreSource: 'derived', scorerVersion: '' }) === null, 'empty string stamp falls through');
check(scorerVersionOf(null) === 'authored' && scorerVersionOf(undefined) === 'authored', 'null and undefined data do not throw');

const data = {
  schema: 'trajecktory-report/v1',
  id: 900001,
  company: 'Zorblax Widgetry',
  scoreSource: 'derived',
  scorerVersion: '2030-01-01',
  url: 'https://jobs.zorblax.example/900001',
  summary: { compStated: '$100,000' },
  legitimacy: 'High Confidence',
  globalScore: [],
};
check(v1Header(data).scorerVersion === '2030-01-01', 'v1Header carries scorerVersion');
check(v1ToCheatsheet(data).scorerVersion === '2030-01-01', 'v1ToCheatsheet carries scorerVersion');
check(v1Header({ scoreSource: 'derived' }).scorerVersion === null, 'v1Header carries null for unstamped derived reports');
check(v1Header({ score: 4.1 }).scorerVersion === 'authored', 'v1Header carries authored for v1 reports without scoreSource');

// parseApplicationsMd resolves report paths against the repo reports/ directory,
// not TJK_DATA_DIR. This suite therefore keeps that case on the exported v1Header
// path instead of creating or reading real reports.
check(v1Header({}).scorerVersion === 'authored', 'a markdown report with no v1 frontmatter is represented by authored on the legacy path');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
