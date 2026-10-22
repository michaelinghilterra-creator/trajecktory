#!/usr/bin/env node

import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadCoverageCleanupReport } from '../coverage-cleanup-report.mjs';
import { makeRepoSandbox } from './helpers/sandbox.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = makeRepoSandbox(ROOT, 'coverage-cleanup');
const portalsPath = join(sandbox, 'portals.yml');
const coveragePath = join(sandbox, 'scan-coverage.json');
const applicationsPath = join(sandbox, 'applications.md');
let passed = 0;
let failed = 0;

function check(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ok ${message}`);
  } else {
    failed++;
    console.log(`  FAIL ${message}`);
  }
}

function run({ companies, coverage, rows = '', days = 90 }) {
  const companyYaml = companies.map((company) => [
    `  - name: ${company.name}`,
    `    api: ${company.api}`,
    `    enabled: ${company.enabled !== false}`,
  ].join('\n')).join('\n');
  writeFileSync(portalsPath, `tracked_companies:\n${companyYaml}\n`, 'utf8');
  writeFileSync(coveragePath, JSON.stringify(coverage), 'utf8');
  writeFileSync(applicationsPath, rows, 'utf8');
  return loadCoverageCleanupReport({
    portalsPath,
    coveragePath,
    applicationsPath,
    days,
    today: '2030-05-01',
  });
}

const zorblax = { name: 'Zorblax Widgetry', api: 'https://example.test/zorblax' };
const quennox = { name: 'Quennox Ratchet Works', api: 'https://example.test/quennox' };

console.log('coverage-cleanup-report.test.mjs');

{
  const report = run({
    companies: [zorblax],
    coverage: { [zorblax.api]: { matchSince: '2030-01-01', matched: 0 } },
  });
  check(report.counts.measuredForDays === 1, 'a company measured for 120 days is counted as measured');
  check(report.candidates.join(',') === 'Zorblax Widgetry', 'a measured company with no match or tracker row is a candidate');
}

{
  const tracker = [
    '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
    '| 900001 | 2030-04-01 | Quennox Ratchet Works | Widget Director | 4.0/5 | Applied | X | X | X | X | https://example.test/jobs/900001 |',
  ].join('\n');
  const report = run({
    companies: [quennox],
    coverage: { [quennox.api]: { matchSince: '2030-01-01', matched: 0 } },
    rows: tracker,
  });
  check(report.counts.candidates === 0, 'a tracker row in any status prevents candidacy');
}

{
  const report = run({
    companies: [zorblax],
    coverage: { [zorblax.api]: { matchSince: '2030-04-01', matched: 0 } },
  });
  check(report.counts.stillMeasuring === 1, 'a company measured for only 30 days is still measuring');
  check(report.candidates.length === 0, 'a company still measuring is not a candidate');
}

{
  const report = run({
    companies: [zorblax],
    coverage: { [zorblax.api]: { matchSince: '2030-01-01', lastMatched: '2030-04-21', matched: 1 } },
  });
  check(report.counts.measuredForDays === 1, 'a recently matched company remains measured');
  check(report.candidates.length === 0, 'a title match 10 days ago prevents candidacy');
}

{
  const report = run({
    companies: [zorblax, quennox, { ...zorblax, enabled: false }],
    coverage: {
      [zorblax.api]: { matchSince: '2030-01-01', matched: 0 },
      [quennox.api]: { matchSince: '2030-01-01', matched: 0 },
    },
    days: 100,
  });
  check(report.days === 100, 'the day window can be overridden');
  check(report.counts.enabledCompanies === 2, 'disabled portal entries are excluded');
  check(report.candidates.join(',') === 'Quennox Ratchet Works,Zorblax Widgetry', 'candidate names are sorted');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
