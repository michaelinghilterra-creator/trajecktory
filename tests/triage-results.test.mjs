#!/usr/bin/env node
/**
 * triage-results.test.mjs — pins the triage-results.tsv single-owner writer.
 *
 * This is the permanent fix for two real incidents on 2026-08-06: the triage
 * agent used to write data/triage-results.tsv itself, directly, and that
 * either silently failed (~50% of runs) or once silently REVERTED ~108 already-
 * scored rows by writing back a stale snapshot it had read early in a long
 * turn. Neither failure mode is possible with this design: the agent only
 * ever emits structured output in its final response; the SERVER parses and
 * appends, and the append is `fs.appendFileSync` -- which cannot truncate or
 * overwrite existing bytes, so the lost-update incident specifically cannot
 * recur even if this file has a bug.
 *
 * Run: node tests/triage-results.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { canonicalUrl } from '../lib/identity.mjs';
import { parseTriageOutput, appendTriageResults, START_MARKER, END_MARKER, HEADER } from '../lib/triage-results.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('triage-results.test.mjs');
const dir = mkdtempSync(join(tmpdir(), 'triage-results-test-'));

// ── parseTriageOutput ─────────────────────────────────────────────────────
{
  const good = [
    { url: 'https://a.example/1', company: 'Acme', title: 'Director, RevOps', score: 4.2, rationale: 'Strong archetype fit.' },
    { url: 'https://a.example/2', company: 'Beta', title: 'Manager, Sales Ops', score: '3.5', rationale: 'Downlevel from target.' },
  ];
  const text = `Some prose the agent writes before the block.\n\n${START_MARKER}\n${JSON.stringify(good)}\n${END_MARKER}\n\nAnd a closing sentence.`;
  const { rows, errors } = parseTriageOutput(text);
  check(errors.length === 0, 'valid block: no errors');
  check(rows.length === 2, 'valid block: both rows parsed');
  check(rows[1].score === 3.5, 'a numeric-string score coerces to a number');
  check(rows[0].url === 'https://a.example/1', 'url preserved verbatim');
}
{
  const { rows, errors } = parseTriageOutput('no markers anywhere in this text');
  check(rows.length === 0 && errors.length === 1, 'missing markers: 0 rows, 1 error, does not throw');
}
{
  const text = `${START_MARKER}\nnot valid json {{{\n${END_MARKER}`;
  const { rows, errors } = parseTriageOutput(text);
  check(rows.length === 0 && /not valid JSON/.test(errors[0]), 'malformed JSON inside markers: reported, not thrown');
}
{
  // Real incident (2026-08-06): the agent's response got cut off by its own
  // length limit right at the start of the array ("[{"), because a long
  // prose summary was written BEFORE the JSON block. The prompt now says put
  // the block first; this pins that a truncated array still fails CLEANLY
  // (no partial/guessed rows) rather than silently accepting garbage.
  const text = `${START_MARKER}\n[{\n${END_MARKER}`;
  const { rows, errors } = parseTriageOutput(text);
  check(rows.length === 0 && /not valid JSON/.test(errors[0]), 'a truncated array fails cleanly, never partially parsed');
}
{
  // Defense in depth: the agent wraps the array in a markdown code fence
  // despite being told not to (a common LLM habit) -- the parser strips a
  // fence spanning the whole block rather than failing on it.
  const good = [{ url: 'https://f.example/1', company: 'Fenced', title: 'Role', score: 3.0, rationale: 'wrapped in a code fence anyway' }];
  const text = `${START_MARKER}\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\`\n${END_MARKER}`;
  const { rows, errors } = parseTriageOutput(text);
  check(errors.length === 0 && rows.length === 1 && rows[0].company === 'Fenced', 'a whole-block markdown code fence is stripped, not treated as a parse error');
}
{
  const bad = [
    { url: '', company: 'X', title: 'Y', score: 3, rationale: 'r' },           // no url
    { url: 'https://b.example/1', company: 'X', title: 'Y', score: 9, rationale: 'r' }, // score out of range
    { url: 'https://b.example/2', company: 'X', title: 'Y', score: 'nope', rationale: 'r' }, // non-numeric score
    { url: 'https://b.example/3', company: 'X', title: 'Y', score: 3 },        // no rationale
    { url: 'https://b.example/4', company: 'X', title: 'Y', score: 4.0, rationale: 'ok this one is fine' },
  ];
  const text = `${START_MARKER}\n${JSON.stringify(bad)}\n${END_MARKER}`;
  const { rows, errors } = parseTriageOutput(text);
  check(rows.length === 1 && rows[0].url === 'https://b.example/4', 'one bad entry among five: only the valid one survives');
  check(errors.length === 4, 'each invalid entry reported individually, run not aborted');
}

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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
