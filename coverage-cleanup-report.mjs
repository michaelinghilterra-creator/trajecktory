#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import yaml from 'js-yaml';
import { coverageKey } from './lib/scan-coverage.mjs';
import { normalizeCompany } from './lib/identity.mjs';
import { localToday } from './lib/local-date.mjs';
import { parseTracker } from './lib/tracker.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

function dateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : null;
}

export function buildCoverageCleanupReport({ companies, coverage, trackerText, days = 90, today = localToday() }) {
  if (!Number.isInteger(days) || days < 1) throw new Error('days must be a positive integer');
  const todayMs = dateValue(today);
  if (todayMs === null) throw new Error('today must use YYYY-MM-DD');

  const cutoffMs = todayMs - days * 86400000;
  const trackedCompanies = new Set(
    parseTracker(trackerText).map((row) => normalizeCompany(row.company)).filter(Boolean),
  );
  const enabled = (companies || []).filter((company) => company.enabled !== false);
  const candidates = [];
  let measured = 0;

  for (const company of enabled) {
    const rec = coverage?.[coverageKey(company)];
    const matchSinceMs = dateValue(rec?.matchSince);
    if (matchSinceMs === null || matchSinceMs > cutoffMs) continue;
    measured++;

    const lastMatchedMs = dateValue(rec?.lastMatched);
    const recentlyMatched = lastMatchedMs !== null && lastMatchedMs >= cutoffMs;
    const hasApplication = trackedCompanies.has(normalizeCompany(company.name));
    if (!recentlyMatched && !hasApplication) candidates.push(company.name);
  }

  candidates.sort((a, b) => a.localeCompare(b));
  return {
    asOf: today,
    days,
    counts: {
      enabledCompanies: enabled.length,
      measuredForDays: measured,
      candidates: candidates.length,
      stillMeasuring: enabled.length - measured,
    },
    candidates,
  };
}

function readOptional(path, fallback) {
  return existsSync(path) ? readFileSync(path, 'utf8') : fallback;
}

export function loadCoverageCleanupReport({ portalsPath, coveragePath, applicationsPath, days = 90, today } = {}) {
  const dataDir = process.env.TJK_DATA_DIR ? resolve(process.env.TJK_DATA_DIR) : join(ROOT, 'data');
  const resolvedPortals = portalsPath || join(ROOT, 'portals.yml');
  const resolvedCoverage = coveragePath || join(dataDir, 'scan-coverage.json');
  const resolvedApplications = applicationsPath || join(dataDir, 'applications.md');
  const config = yaml.load(readFileSync(resolvedPortals, 'utf8')) || {};
  const coverageText = readOptional(resolvedCoverage, '{}');
  const trackerText = readOptional(resolvedApplications, '');
  return buildCoverageCleanupReport({
    companies: config.tracked_companies || [],
    coverage: JSON.parse(coverageText),
    trackerText,
    days,
    today,
  });
}

function parseDays(args) {
  const index = args.indexOf('--days');
  if (index === -1) return 90;
  const days = Number(args[index + 1]);
  if (!Number.isInteger(days) || days < 1) throw new Error('--days requires a positive integer');
  return days;
}

function printText(report) {
  console.log(`Coverage cleanup report as of ${report.asOf}`);
  console.log(`Window: ${report.days} days`);
  console.log(`Enabled companies: ${report.counts.enabledCompanies}`);
  console.log(`Measured for ${report.days}+ days: ${report.counts.measuredForDays}`);
  console.log(`Candidates: ${report.counts.candidates}`);
  console.log(`Skipped because still measuring: ${report.counts.stillMeasuring}`);
  console.log('Candidate companies:');
  if (report.candidates.length === 0) console.log('(none)');
  for (const name of report.candidates) console.log(`- ${name}`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    const args = process.argv.slice(2);
    const report = loadCoverageCleanupReport({ days: parseDays(args) });
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
    else printText(report);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}
