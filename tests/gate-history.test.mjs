#!/usr/bin/env node
/**
 * gate-history.test.mjs — pins the gate-history.tsv audit-trail writer.
 *
 * This is the permanent fix for a real gap found on 2026-08-06: gate-pipeline.mjs
 * wrote its liveness verdicts (live/dead/uncertain) ONLY into data/pipeline.md
 * itself, as "- [!] ... — gated: <reason>" text. When pipeline.md was
 * accidentally wiped that day (an unrelated ingestion script bug), every
 * disposition gate-pipeline had ever computed was lost with it — recovery could
 * tell WHICH urls had existed (from scan-history.tsv), but not which of them
 * had already been checked and found dead, so the whole queue had to be
 * re-gated from scratch. This file makes that specific loss impossible: every
 * verdict is also appended to a separate, append-only log.
 *
 * Run: node tests/gate-history.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { appendGateHistory, lastVerdictFor, HEADER } from '../lib/gate-history.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('gate-history.test.mjs');
const dir = mkdtempSync(join(tmpdir(), 'gate-history-test-'));

// ── appendGateHistory ─────────────────────────────────────────────────────
{
  const file = join(dir, 'fresh.tsv');
  const r = appendGateHistory(file, [
    { url: 'https://a.example/1', company: 'Acme', role: 'Dir RevOps', result: 'active', reason: '' },
  ], '2026-08-06');
  const text = readFileSync(file, 'utf8');
  check(text.startsWith(HEADER + '\n'), 'creates the file with the header row when missing');
  check(r.appended === 1, 'appends exactly one row');
  check(text.includes('2026-08-06\thttps://a.example/1\tAcme\tDir RevOps\tactive\t'), 'row is tab-separated in the expected column order');
}
{
  // THE CORE GUARANTEE, same shape as triage-results.mjs: appending never
  // touches pre-existing bytes.
  const file = join(dir, 'accumulate.tsv');
  writeFileSync(file, `${HEADER}\n2026-08-01\thttps://old.example/1\tOld Co\tRole\texpired\tclosed\n`, 'utf8');
  const before = readFileSync(file, 'utf8');
  appendGateHistory(file, [{ url: 'https://new.example/1', company: 'New Co', role: 'Role2', result: 'active', reason: '' }], '2026-08-06');
  const after = readFileSync(file, 'utf8');
  check(after.startsWith(before), 'every pre-existing byte survives unchanged after a new append');
  check(after.includes('Old Co') && after.includes('New Co'), 'both old and new rows present');
}
{
  // A log, not a state table: the same URL re-checked on a later run is
  // supposed to add a SECOND row, not overwrite the first — the whole point is
  // to see the history of dispositions, including ones that later changed.
  const file = join(dir, 'rechecked.tsv');
  appendGateHistory(file, [{ url: 'https://x.example/1', company: 'X', role: 'Y', result: 'active', reason: '' }], '2026-08-01');
  appendGateHistory(file, [{ url: 'https://x.example/1', company: 'X', role: 'Y', result: 'expired', reason: 'closed' }], '2026-08-06');
  // Exact column match, not a substring test — "https://x.example/1" is also a
  // substring of "https://x.example/10", so `l.includes(...)` would silently
  // count an unrelated row (CodeQL js/incomplete-url-substring-sanitization).
  const lines = readFileSync(file, 'utf8').split('\n').filter(l => l.split('\t')[1] === 'https://x.example/1');
  check(lines.length === 2, 'a URL checked twice produces two rows, not an overwrite');
}
{
  // Invalid rows are skipped, not fatal to the rest of a real run's rows.
  const file = join(dir, 'validation.tsv');
  const r = appendGateHistory(file, [
    { url: '', company: 'X', role: 'Y', result: 'active' },              // no url
    { url: 'https://ok.example/1', company: 'X', role: 'Y', result: 'bogus' }, // invalid result
    { url: 'https://ok.example/2', company: 'X', role: 'Y', result: 'expired', reason: 'closed' },
  ], '2026-08-06');
  check(r.appended === 1, 'invalid entries are dropped, only the one valid row is written');
  const text = readFileSync(file, 'utf8');
  check(text.includes('ok.example/2') && !text.includes('ok.example/1'), 'the specific valid row landed, the invalid ones did not');
}
{
  // Tabs/newlines in free-text reason fields must not corrupt the TSV shape.
  const file = join(dir, 'sanitize.tsv');
  appendGateHistory(file, [{ url: 'https://y.example/1', company: 'Y\tCo', role: 'Role', result: 'expired', reason: 'nav error:\nsomething\tbroke' }], '2026-08-06');
  const line = readFileSync(file, 'utf8').split('\n').find(l => l.includes('y.example'));
  check(line.split('\t').length === 6, 'a tab or newline embedded in company/reason does not add extra TSV columns');
}
{
  // A malformed entry (no `result` field at all) does not throw.
  const file = join(dir, 'no-throw.tsv');
  let threw = false;
  try { appendGateHistory(file, [null, undefined, { url: 'https://z.example/1' }, {}], '2026-08-06'); }
  catch { threw = true; }
  check(!threw, 'garbage entries in the rows array never throw');
}

// ── lastVerdictFor ────────────────────────────────────────────────────────
{
  const file = join(dir, 'lookup.tsv');
  appendGateHistory(file, [{ url: 'https://q.example/1', company: 'Q', role: 'R', result: 'active', reason: '' }], '2026-08-01');
  appendGateHistory(file, [{ url: 'https://q.example/1', company: 'Q', role: 'R', result: 'expired', reason: 'closed' }], '2026-08-06');
  const v = lastVerdictFor(file, 'https://q.example/1');
  check(v && v.result === 'expired' && v.date === '2026-08-06', 'returns the MOST RECENT verdict when a URL was checked more than once');
  check(lastVerdictFor(file, 'https://never-seen.example/1') === null, 'an unknown URL returns null, not a throw');
  check(lastVerdictFor(join(dir, 'does-not-exist.tsv'), 'https://q.example/1') === null, 'a missing file returns null, not a throw');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
