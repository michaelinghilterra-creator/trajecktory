#!/usr/bin/env node
/**
 * triage-results.test.mjs — pins the triage-results.tsv single-owner writer.
 *
 * Pins the append-only writer used by the optional Spark pre-filter discard log.
 *
 * Run: node tests/triage-results.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { appendTriageResults, HEADER } from '../lib/triage-results.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('triage-results.test.mjs');
const dir = makeSandbox("triage-results-test");

// ── appendTriageResults ──────────────────────────────────────────────────
{
  const file = join(dir, 'fresh.tsv');
  const r = appendTriageResults(file, [
    { url: 'https://c.example/1', company: 'Gamma', title: 'Dir', score: 4.1, rationale: 'good fit' },
  ], '2026-08-06');
  const text = readFileSync(file, 'utf8');
  check(text.startsWith(HEADER + '\n'), 'creates the file with the header row when missing');
  check(r.appended === 1 && r.skippedDuplicate === 0, 'appends exactly one row');
  check(text.includes('https://c.example/1\tGamma\tDir\t4.1\tgood fit\t2026-08-06'), 'row is formatted correctly');
}
{
  // THE CORE GUARANTEE: appending never touches pre-existing bytes, even across
  // many calls -- this is what makes the lost-update incident structurally
  // impossible, not just less likely.
  const file = join(dir, 'accumulate.tsv');
  writeFileSync(file, `${HEADER}\nhttps://pre-existing.example/1\tOld\tRole\t3.0\tpre-existing row\t2026-08-01\n`, 'utf8');
  const before = readFileSync(file, 'utf8');
  appendTriageResults(file, [
    { url: 'https://new.example/1', company: 'New', title: 'Role2', score: 4.4, rationale: 'fresh scoring' },
  ], '2026-08-06');
  const after = readFileSync(file, 'utf8');
  check(after.startsWith(before), 'every pre-existing byte survives unchanged after a new append');
  check(after.includes('pre-existing row') && after.includes('fresh scoring'), 'both old and new rows present');
}
{
  const file = join(dir, 'dedup.tsv');
  writeFileSync(file, `${HEADER}\nhttps://dup.example/1?utm_source=x\tCo\tRole\t3.0\told score, kept as-is\t2026-08-01\n`, 'utf8');
  const before = readFileSync(file, 'utf8');
  const r = appendTriageResults(file, [
    { url: 'https://dup.example/1', company: 'Co', title: 'Role', score: 4.9, rationale: 'a re-run trying to re-score the same posting' },
    { url: 'https://dup.example/1', company: 'Co', title: 'Role', score: 4.9, rationale: 'the SAME url twice in one run output' },
    { url: 'https://fresh.example/2', company: 'Co2', title: 'Role2', score: 2.0, rationale: 'genuinely new' },
  ], '2026-08-06');
  const after = readFileSync(file, 'utf8');
  check(r.appended === 1 && r.skippedDuplicate === 2, 'dedupes against an existing row (URL variant) AND a duplicate within the same run output');
  check(after.startsWith(before), 'the existing (undesired-duplicate) row is left completely untouched, not overwritten with the new score');
  check(!after.includes('4.9'), 'the duplicate score never gets written at all');
  check(after.includes('genuinely new'), 'the one genuinely new row still lands');
}

{
  const file = join(dir, 'snapshot-dedup.tsv');
  const jds = join(dir, 'jds');
  mkdirSync(jds, { recursive: true });
  const postingUrl = 'https://jobs.example.test/globex/req-88';
  writeFileSync(join(jds, 'globex-widget-smith.md'), `# Widget Smith\n\n**Source URL:** ${postingUrl}\n`, 'utf8');
  writeFileSync(file, `${HEADER}\n${postingUrl}\tGlobex\tWidget Smith\t2.5\tfirst score\t2030-01-01\n`, 'utf8');
  const localAfterReal = appendTriageResults(file, [
    { url: 'local:jds/globex-widget-smith.md', company: 'Globex', title: 'Widget Smith', score: 3.0, rationale: 'same posting' },
  ], '2030-01-02');
  check(localAfterReal.skippedDuplicate === 1, 'a local snapshot dedupes against a triage row keyed by the real URL');

  const reverse = join(dir, 'snapshot-dedup-reverse.tsv');
  writeFileSync(reverse, `${HEADER}\nlocal:jds/globex-widget-smith.md\tGlobex\tWidget Smith\t2.5\tfirst score\t2030-01-01\n`, 'utf8');
  const realAfterLocal = appendTriageResults(reverse, [
    { url: postingUrl, company: 'Globex', title: 'Widget Smith', score: 3.0, rationale: 'same posting' },
  ], '2030-01-02');
  check(realAfterLocal.skippedDuplicate === 1, 'a real URL dedupes against a triage row keyed by its local snapshot');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
