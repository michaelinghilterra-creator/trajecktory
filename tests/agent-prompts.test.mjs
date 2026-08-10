#!/usr/bin/env node
/**
 * agent-prompts.test.mjs — pin the dedup instructions in the headless agent
 * prompts.
 *
 * WHY THIS EXISTS:
 * modes/scan.md tells the agent to dedup against three sources, but the prompt
 * the dashboard actually injects for mode='scan' had that instruction missing
 * entirely — it said only "Add new live postings to data/pipeline.md as usual".
 * The mode file and the shipped prompt had drifted apart, and nothing noticed,
 * because a prompt is a string: no type checks it, no test read it, and the
 * agent's output looks plausible either way.
 *
 * This cannot verify the model OBEYS the instruction. Only the deterministic
 * gates can do that (gate-pipeline.mjs, and the triage route filter). What it
 * verifies is that the instruction is still THERE, which is the part that
 * silently regressed.
 *
 * Run: node tests/agent-prompts.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('agent-prompts.test.mjs');

const src = readFileSync(join(ROOT, 'dashboard-web/server/routes/agent.mjs'), 'utf8');

// Isolate each mode's prompt branch so a sentence in one mode cannot satisfy
// the assertion for another.
function branch(mode) {
  const start = src.indexOf(`if (mode === '${mode}')`);
  if (start === -1) return '';
  const end = src.indexOf('\n  if (mode ===', start + 10);
  return src.slice(start, end === -1 ? src.length : end);
}

const scan = branch('scan');
check(scan.length > 0, "scan-mode prompt branch exists");
check(/dedup/i.test(scan), 'scan prompt still instructs the agent to dedup');
check(/scan-history\.tsv/.test(scan) && /pipeline\.md/.test(scan) && /applications\.md/.test(scan),
  'scan prompt names all three dedup sources');

// The 2026-08-10 fix: the agent must NOT try to write portals.yml (the shared
// eval sandbox denies it, so the discovery half silently dead-ended) and must
// NOT add WebSearch-only roles to pipeline.md (it invented phantom postings).
// It hands companies to the server as a structured PORTAL_ADDITIONS block; the
// server validates + writes. If any of this regresses, the discovery half breaks
// exactly the way it did before, and nothing else would notice.
check(/PORTAL_START/.test(scan) && /PORTAL_END/.test(scan), 'scan prompt injects the PORTAL_ADDITIONS start/end markers');
check(/do NOT edit portals\.yml/i.test(scan), 'scan prompt forbids editing portals.yml directly');
check(/"ats"/.test(scan) && /"slug"/.test(scan), 'scan prompt asks for ats + slug (not a raw URL the server would have to trust)');
check(/do NOT add anything to data\/pipeline\.md yourself/i.test(scan), 'scan prompt forbids the agent adding WebSearch-only roles to the pipeline');

// The server side of that contract must exist: the scan route parses the block
// and merges through the single-owner writer. Pins the wiring, not just the prompt.
check(/parsePortalAdditions/.test(src) && /mergePortalAdditions/.test(src),
  'scan route parses PORTAL_ADDITIONS and merges it server-side');

const triage = branch('triage');
check(triage.length > 0, 'triage-mode prompt branch exists');
check(/SKIP any URL that already appears in data\/applications\.md/.test(triage),
  'triage prompt still instructs skipping already-evaluated URLs');
check(/triage-dismissed\.tsv/.test(triage),
  'triage prompt still instructs skipping user-dismissed URLs');

// The enforced half. If these move, the prompt sentences above stop being
// belt-and-braces and become the only defense again.
const gate = readFileSync(join(ROOT, 'gate-pipeline.mjs'), 'utf8');
check(/identity\.mjs/.test(gate), 'gate-pipeline imports the shared identity module');

const triageRoute = readFileSync(join(ROOT, 'dashboard-web/server/routes/triage.mjs'), 'utf8');
check(/identity\.mjs/.test(triageRoute), 'triage route imports the shared identity module');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
