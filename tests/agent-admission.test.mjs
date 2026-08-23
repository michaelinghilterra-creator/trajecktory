#!/usr/bin/env node
/**
 * agent-admission.test.mjs — the concurrency admission matrix (Slice 7.4).
 *
 * WHY THIS EXISTS:
 * The old lock was global single-flight. 7.4 relaxes it so a deep-dive/triage can
 * run alongside a long rolling Evaluate, while keeping the one guarantee that
 * matters: no two operations write data/pipeline.md at once. `scan` is the only
 * cross-process pipeline.md writer (scan.mjs appends from a child), so it MUST
 * stay fully exclusive; everything else is single-flight per mode but may overlap.
 * This pins that matrix — a regression here risks either a corrupt queue (scan
 * overlapping a write) or the old lock-out returning.
 *
 * Run: node tests/agent-admission.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { activeAgents, admitAgent } from '../dashboard-web/server/routes/agent.mjs';

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  ✅ ${name}`);
  else { console.log(`  ❌ ${name}`); failures++; }
}
const allow = (mode) => admitAgent(mode) === null;
const block = (mode) => typeof admitAgent(mode) === 'string';
function reset() { activeAgents.clear(); }

// ── nothing running: everything may start ──
reset();
for (const m of ['scan', 'pipeline', 'triage', 'deep']) check(`${m} may start when idle`, allow(m));

// ── a pipeline chain is running: deep and triage may overlap; scan and a 2nd pipeline may not ──
reset(); activeAgents.add('pipeline');
check('deep may run during a pipeline chain', allow('deep'));
check('triage may run during a pipeline chain', allow('triage'));
check('a second pipeline is refused', block('pipeline'));
check('scan is refused during a pipeline chain (it would race the queue write)', block('scan'));

// ── scan is exclusive: nothing else may start while it runs ──
reset(); activeAgents.add('scan');
for (const m of ['scan', 'pipeline', 'triage', 'deep']) check(`${m} is refused while a scan runs`, block(m));

// ── scan itself needs an empty field ──
reset(); activeAgents.add('deep');
check('scan is refused while a deep runs (scan needs exclusivity)', block('scan'));
check('a second deep is refused', block('deep'));
check('pipeline may still start alongside a deep', allow('pipeline'));

// ── per-mode single-flight for the overlappable modes ──
reset(); activeAgents.add('triage');
check('a second triage is refused', block('triage'));
check('deep may run alongside a triage', allow('deep'));

reset();
if (failures) { console.log(`\n❌ agent-admission: ${failures} check(s) failed`); process.exit(1); }
console.log('\n✅ agent-admission: all checks passed');
