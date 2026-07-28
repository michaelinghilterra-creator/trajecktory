#!/usr/bin/env node
/**
 * scan-summary.test.mjs — the API Scan summary shown in the dashboard step.
 *
 * WHY THIS EXISTS
 * The zero-token API Scan only hits Greenhouse/Ashby/Lever. If every ENABLED
 * company is Workday/custom (or the API-backed ones were disabled — an agent did
 * exactly this on a beta tester's machine, tagging them "not enterprise focus"),
 * the scan queries nothing and the old summary read "0 new (of 0 found)", which
 * looks like an empty scan rather than a config problem. The guard must name the
 * cause and the fix, and must stay distinct from a scan that queried real boards
 * but got nothing back (dead slugs / blocked fetches).
 *
 * Run: node tests/scan-summary.test.mjs   (exit 0 = pass, 1 = fail)
 */
import { scanSummary } from '../dashboard-web/server/lib/workflow.mjs';

let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) { console.log(`  ✅ ${msg}`); passed++; } else { console.log(`  ❌ ${msg}`); failed++; } };

console.log('scan-summary.test.mjs');

const noApi = [
  'Scanning 0 companies via API (8 skipped — no API detected)',
  '  not scanned by platform: workday 8',
  'Companies scanned:     0',
  'Total jobs found:      0',
  'New offers added:      0',
].join('\n');
const s1 = scanSummary(noApi);
check(/0 companies scanned/i.test(s1), 'no-API case: says 0 companies scanned');
check(/portals\.yml|Agent Scan/i.test(s1), 'no-API case: names a fix (portals.yml / Agent Scan)');
check(/\b8\b/.test(s1), 'no-API case: reports how many were skipped for no API');

const deadBoards = [
  'Scanning 12 companies via API (0 skipped — no API detected)',
  'Companies scanned:     12',
  'Total jobs found:      0',
  'New offers added:      0',
].join('\n');
const s2 = scanSummary(deadBoards);
check(/0 jobs found/i.test(s2) && /12/.test(s2), 'dead-boards case: scanned 12 but found 0');
check(/error/i.test(s2), 'dead-boards case: points at per-company errors');
check(s1 !== s2, 'the two zero cases are distinguishable');

const healthy = [
  'Companies scanned:     40',
  'Total jobs found:      1200',
  'Filtered by title:     900 removed',
  'Duplicates:            248 skipped',
  'New offers added:      2',
].join('\n');
const s3 = scanSummary(healthy);
check(/^2 new/.test(s3), 'healthy case: leads with new-offer count');
check(/1,200 found/.test(s3), 'healthy case: shows the funnel total');
check(!/⚠/.test(s3), 'healthy case: no warning marker');

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
