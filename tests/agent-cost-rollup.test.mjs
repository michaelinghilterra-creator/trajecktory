#!/usr/bin/env node
/**
 * agent-cost-rollup.test.mjs — the per-day cost/machine-time rollup engine.
 *
 * Pins the pure aggregation that turns run records (one per line in
 * logs/agent-runs.*.log) into the weekly post-mortem's numbers:
 *   - UTC-date bucketing (deterministic, timezone-independent)
 *   - inclusive from/to range filtering
 *   - per-mode split (scan vs pipeline)
 *   - legacy records with no duration count as 0 machine time, not NaN
 *   - float sums are rounded so a week total is clean JSON, not 0.30000000004
 *   - sumRollup collapses the days into one total (cost, time, runs, byMode)
 *
 * Run: node tests/agent-cost-rollup.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { rollupByDay, sumRollup } from '../dashboard-web/server/lib/agent-log.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('agent-cost-rollup.test.mjs');

// A week of runs. Two on Mon, one on Tue, one outside the window.
const records = [
  { ts: '2026-07-27T09:00:00.000Z', mode: 'scan',     cost: 0.10, durationMs: 30000,  durationApiMs: 20000 },
  { ts: '2026-07-27T14:30:00.000Z', mode: 'pipeline', cost: 0.20, durationMs: 120000, durationApiMs: 90000 },
  { ts: '2026-07-28T11:00:00.000Z', mode: 'pipeline', cost: 0.05, durationMs: 60000,  durationApiMs: 45000 },
  { ts: '2026-08-03T08:00:00.000Z', mode: 'scan',     cost: 0.99, durationMs: 10000,  durationApiMs: 5000 },
];

// ── bucketing + ordering ──────────────────────────────────────────────────────
const all = rollupByDay(records);
check(all.length === 3, `one bucket per distinct UTC date (got ${all.length})`);
check(all[0].date === '2026-07-27' && all[2].date === '2026-08-03', 'days returned oldest-first');

const mon = all.find(d => d.date === '2026-07-27');
check(mon.runs === 2, 'Monday has 2 runs');
check(Math.abs(mon.cost - 0.30) < 1e-9, `Monday cost sums to 0.30 (got ${mon.cost})`);
check(mon.machineTimeMs === 150000, 'Monday wall-clock machine time sums (30s + 120s)');
check(mon.machineTimeApiMs === 110000, 'Monday API machine time sums (20s + 90s)');

// ── float rounding — 0.1 + 0.2 must not leak 0.30000000000000004 ──────────────
check(mon.cost === 0.3, 'cost sum is rounded clean (=== 0.3, not float noise)');

// ── per-mode split (scan vs pipeline) ─────────────────────────────────────────
check(mon.byMode.scan.runs === 1 && mon.byMode.pipeline.runs === 1, 'Monday splits scan vs pipeline runs');
check(mon.byMode.scan.cost === 0.1 && mon.byMode.pipeline.cost === 0.2, 'Monday splits cost by mode');
check(mon.byMode.pipeline.machineTimeMs === 120000, 'Monday pipeline machine time isolated');

// ── inclusive from/to filtering (the "for a given week" query) ────────────────
const week = rollupByDay(records, { from: '2026-07-27', to: '2026-08-02' });
check(week.length === 2, `week window excludes the Aug 3 run (got ${week.length} days)`);
check(!week.some(d => d.date === '2026-08-03'), 'Aug 3 run is outside the Mon–Sun window');
const edge = rollupByDay(records, { from: '2026-07-28', to: '2026-07-28' });
check(edge.length === 1 && edge[0].date === '2026-07-28', 'from/to bounds are inclusive');

// ── legacy records: no duration field → 0 machine time, never NaN ─────────────
const legacy = rollupByDay([{ ts: '2026-07-27T09:00:00.000Z', mode: 'scan', cost: 0.02 }]);
check(legacy[0].machineTimeMs === 0, 'a record with no durationMs contributes 0, not NaN');
check(legacy[0].cost === 0.02, 'legacy record cost still counts');

// ── malformed input is skipped, not thrown ────────────────────────────────────
const messy = rollupByDay([null, { mode: 'scan' }, { ts: 'not-a-date' }, { ts: '2026-07-27T00:00:00Z', mode: 'scan', cost: 1 }]);
check(messy.length === 1 && messy[0].cost === 1, 'null / ts-less / bad-ts records are ignored');
check(rollupByDay([]).length === 0 && rollupByDay(undefined).length === 0, 'empty and undefined input give []');

// ── sumRollup — week total across the days ────────────────────────────────────
const total = sumRollup(week);
check(total.runs === 3, `week total run count (got ${total.runs})`);
check(total.cost === 0.35, `week total cost = 0.10+0.20+0.05 (got ${total.cost})`);
check(total.machineTimeMs === 210000, 'week total wall-clock time = 150s + 60s');
check(total.byMode.pipeline.runs === 2 && total.byMode.scan.runs === 1, 'week total keeps the mode split');
check(total.byMode.pipeline.cost === 0.25, 'week total pipeline cost = 0.20 + 0.05');
check(sumRollup([]).runs === 0 && sumRollup(undefined).runs === 0, 'sumRollup of nothing is a zeroed total');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
