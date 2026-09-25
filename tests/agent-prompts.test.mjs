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
 * gates can do that (gate-pipeline.mjs). What it
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
  // End at the next mode branch, OR (for the last branch, 'deep') the builder's
  // terminal `return '';`. Without the second bound, branch('deep') ran to EOF
  // and swept in unrelated later route code — its local:jds assertion would then
  // pass off code that has nothing to do with the deep prompt.
  const nextBranch = src.indexOf('\n  if (mode ===', start + 10);
  const fnEnd = src.indexOf("\n  return '';", start + 10);
  const ends = [nextBranch, fnEnd].filter(i => i !== -1);
  const end = ends.length ? Math.min(...ends) : src.length;
  return src.slice(start, end);
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

// STALL HARDENING (2026-08-21): the discovery step is open-ended, and a small
// model sometimes narrates it and quits without a single WebSearch. The prompt
// half (belt) forbids narration-as-search and requires real calls; the server
// half (braces) detects the zero-search signature and retries on Sonnet. Both
// must stay present — the prompt line alone is advisory, exactly the failure
// mode this whole test file exists to catch.
check(/WebSearch tool/i.test(scan) && /at least \d+ WebSearch/i.test(scan),
  'scan prompt requires actually CALLING WebSearch a minimum number of times');
check(/narration is not a search/i.test(scan) || /narrating[\s\S]*is a FAILED run/i.test(scan),
  'scan prompt forbids echoing/describing a search as a stand-in for calling the tool');
check(/scanDiscoveryStalled/.test(src),
  'scan route imports the stall detector (lib/scan-stall.mjs)');
check(/forceModel:\s*'sonnet'/.test(src),
  'scan route retries a stalled discovery on Sonnet');
check(/webSearchCount/.test(src),
  'scan route counts WebSearch calls (the stall discriminator)');

// Agent Scan logging is deferred until the deterministic company merge and any
// stall retry finish, so one record can carry the complete discovery outcome.
check(/mode === 'scan' \? \{ deferLog: true \} : \{\}/.test(src),
  'scan mode defers its first agent-run log record');
check(/forceModel:\s*'sonnet',\s*deferLog:\s*true/.test(src),
  'scan stall retry also defers its agent-run log record');
check(/finally\s*\{[\s\S]*buildScanDiscoverySummary[\s\S]*logAgentRun/.test(src),
  'scan records are enriched and written in a finally block');
check(/outputTail:\s*\(resultText \|\| job\.output \|\| ''\)\.slice\(-2000\)/.test(src),
  'agent-run outputTail prefers the final result text');
check(/jobId,\s*\n\s*mode,/.test(src),
  'agent-run records include the job id');

// Pasted JD text is persisted as a local:jds snapshot. The agent must resolve
// that path against the repository root.
const deep = branch('deep');
check(deep.length > 0, 'deep-mode prompt branch exists');
check(/local:jds/.test(deep) && /data\/jds/.test(deep),
  'deep prompt disambiguates the local:jds base path from data/jds');

check(/set the tracker note to include \[self-sourced\]/.test(deep),
  'direct deep evaluation records paste-box origin');

// The enforced half. If these move, the prompt sentences above stop being
// belt-and-braces and become the only defense again.
const gate = readFileSync(join(ROOT, 'gate-pipeline.mjs'), 'utf8');
check(/identity\.mjs/.test(gate), 'gate-pipeline imports the shared identity module');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
