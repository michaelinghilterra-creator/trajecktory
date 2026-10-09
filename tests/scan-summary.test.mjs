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
import { scanSummary, verifySummary, WORKFLOW_STEPS } from '../dashboard-web/server/lib/workflow.mjs';

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
check(WORKFLOW_STEPS.derive.cmd === 'node compute-scores.mjs --all --apply', 'derive step runs the score computation');
check(WORKFLOW_STEPS.gate.cmd.includes('reconcile-triage.mjs --apply'), 'gate reconciles Spark pre-filter discard rows');
check(WORKFLOW_STEPS.health.cmd === 'node health-check.mjs', 'health step uses the aggregate runner');
check(verifySummary('Flipped 2 entries') === 'Passed 2 dead links', 'verify summary uses the Passed state');
check(!/⚠/.test(s3), 'healthy case: no warning marker');

const mark = ` ${String.fromCharCode(183)} `;
const funnelWithGate = [
  'Companies scanned:     40',
  'Total jobs found:      1204',
  'Filtered by title:     900 removed',
  'Duplicates:            40 skipped',
  'New offers added:      12',
  `3 resolved${mark}0 already local`,
  'Already evaluated: 2 (skipped, not browser-checked)',
  'Reposts suppressed: 1 (active-role reposts)',
  'Duplicate JDs suppressed: 2 (identical text; logged to data/merge-drops.tsv)',
].join('\n');
check(
  scanSummary(funnelWithGate).endsWith(`${mark}5 skipped (2 already evaluated, 1 repost, 2 duplicate JDs)`),
  'suppression counts: appends all parts in order'
);

const duplicateOnly = [
  'Companies scanned:     2',
  'Total jobs found:      7',
  'New offers added:      3',
  'Already evaluated: 0 (skipped, not browser-checked)',
  'Reposts suppressed: 0 (active-role reposts)',
  'Duplicate JDs suppressed: 1 (identical text; logged to data/merge-drops.tsv)',
].join('\n');
check(
  scanSummary(duplicateOnly).endsWith(`${mark}1 skipped (1 duplicate JD)`),
  'suppression counts: keeps only nonzero parts with singular wording'
);

const plainOutput = [
  'Companies scanned:     2',
  'Total jobs found:      7',
  'New offers added:      3',
].join('\n');
const zeroGateOutput = [
  plainOutput,
  'Already evaluated: 0 (skipped, not browser-checked)',
  'Reposts suppressed: 0 (active-role reposts)',
  'Duplicate JDs suppressed: 0 (identical text; logged to data/merge-drops.tsv)',
].join('\n');
check(
  scanSummary(zeroGateOutput) === scanSummary(plainOutput),
  'suppression counts: zero counts do not change summary'
);
check(
  scanSummary(plainOutput) === '3 new (of 7 found)',
  'suppression counts: absent lines do not add a skipped clause'
);

const earlyGateOutput = [
  plainOutput,
  'Already evaluated: 4 (skipped, not browser-checked)',
  '',
  'Reposts suppressed: 1 (active-role reposts)',
  'Duplicate JDs suppressed: 1 (identical text; logged to data/merge-drops.tsv)',
  'Nothing left to liveness-check.',
].join('\n');
check(
  scanSummary(earlyGateOutput).endsWith(`${mark}6 skipped (4 already evaluated, 1 repost, 1 duplicate JD)`),
  'suppression counts: early exit gate output still parses'
);

const midLineOnly = [
  plainOutput,
  'note: already evaluated text appears here but not at line start',
].join('\n');
check(
  scanSummary(midLineOnly) === scanSummary(plainOutput),
  'suppression counts: mid line wording does not count'
);

const noApiWithGate = [
  noApi,
  'Already evaluated: 2 (skipped, not browser-checked)',
].join('\n');
check(scanSummary(noApiWithGate) === s1, 'suppression counts: zero companies return is unchanged');

const deadBoardsWithGate = [
  deadBoards,
  'Duplicate JDs suppressed: 1 (identical text; logged to data/merge-drops.tsv)',
].join('\n');
check(scanSummary(deadBoardsWithGate) === s2, 'suppression counts: zero jobs return is unchanged');

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
