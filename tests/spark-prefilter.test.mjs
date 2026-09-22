#!/usr/bin/env node
/**
 * spark-prefilter.test.mjs — pins the two decisions the local pre-filter makes.
 *
 * The pre-filter discards postings from the queue without evaluating them, so the
 * cost of a wrong decision is asymmetric and permanent: a discarded strong role is
 * a job that never got applied to, while a kept weak one costs one evaluation.
 * Every assertion here exists because getting it backwards is silent.
 *
 * THE THRESHOLD BOUNDARY is the sharpest of them. Several ceiling rules pin a role
 * at exactly the threshold value rather than below it, so `<` versus `<=` is the
 * difference between parking those roles on the line and discarding all of them on
 * no evidence. A measured backlog had 25 of 73 survivors sitting at exactly 2.0.
 *
 * THE SURVIVOR/DISCARD ASYMMETRY is the most dangerous. reconcile-triage.mjs treats
 * any URL in triage-results.tsv as handled and checks its pipeline row off. If the
 * pre-filter wrote rows for survivors too, every survivor would be checked off, the
 * batch — which processes only "- [ ]" — would evaluate nothing, and the run would
 * report success. That is asserted directly below.
 *
 * Run: node tests/spark-prefilter.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { splitAtThreshold, discardRows } from '../spark-prefilter.mjs';
import { appendTriageResults } from '../lib/triage-results.mjs';
import { appendGateHistory } from '../lib/gate-history.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('spark-prefilter.test.mjs');
const dir = makeSandbox('spark-prefilter-test');

const row = (id, over) => ({
  id, ok: true, score: 3, sourceUrl: `https://zorblax.example/jobs/${id}`,
  data: { company: 'Zorblax Widgetry', role: 'Director of Revenue Operations' },
  ...over,
});

// ── the threshold boundary ────────────────────────────────────────────────
{
  const scored = [
    row('at', { score: 2.0 }),
    row('just-below', { score: 1.9 }),
    row('just-above', { score: 2.1 }),
  ];
  const { survivors, discarded } = splitAtThreshold(scored, 2.0);
  check(survivors.some(r => r.id === 'at'), 'a score EQUAL to the threshold survives, it is not discarded');
  check(survivors.some(r => r.id === 'just-above'), 'a score above the threshold survives');
  check(discarded.length === 1 && discarded[0].id === 'just-below', 'only the score strictly below the threshold is discarded');
}

// ── failure is never evidence of a weak role ──────────────────────────────
{
  const scored = [
    row('good', { score: 4.2 }),
    { id: 'unparseable', ok: false, reason: 'no-json' },
    { id: 'truncated', ok: false, reason: 'bad-json' },
    row('no-score', { ok: true, score: undefined }),
    row('nan-score', { ok: true, score: NaN }),
  ];
  const { survivors, discarded, unfiltered } = splitAtThreshold(scored, 2.0);
  check(discarded.length === 0, 'NOTHING is discarded on the basis of a failed or unscoreable output');
  check(unfiltered.length === 4, 'every non-finite result lands in unfiltered, where it stays pending');
  check(survivors.length === 1, 'only the genuinely scored row is treated as a survivor');
  check(!unfiltered.some(r => r.id === 'good'), 'a valid score is not swept into unfiltered');
}

// ── the survivor trap ─────────────────────────────────────────────────────
{
  const scored = [row('keep', { score: 4.0 }), row('drop', { score: 1.0 })];
  const { survivors, discarded } = splitAtThreshold(scored, 2.0);
  const rows = discardRows(discarded, 2.0);
  check(rows.length === 1, 'discardRows returns exactly one row for one discard');
  check(!rows.some(r => r.url.endsWith('/keep')), 'a SURVIVOR produces ZERO triage-results rows — if it produced one, reconcile-triage would check every survivor off and the batch would evaluate nothing');
  check(survivors.length === 1 && rows.every(r => r.url.endsWith('/drop')), 'the only row written belongs to the discarded posting');
}

// ── the provenance marker ─────────────────────────────────────────────────
{
  const rows = discardRows([row('x', { score: 1.2, data: { company: 'Quennox Ratchet Works', role: 'Renewals Lead', ceilingReason: 'Stated pay is below the hard floor' } })], 2.0);
  check(rows[0].rationale.startsWith('Spark pre-filter, below T=2'), 'the rationale carries the provenance prefix a later reader greps for');
  check(rows[0].rationale.includes('below the hard floor'), 'the ceiling reason is carried through so the discard explains itself');
  check(rows[0].rationale.length <= 180, 'the rationale is truncated so one long recommendation cannot bloat the TSV');
  check(rows[0].company === 'Quennox Ratchet Works' && rows[0].title === 'Renewals Lead', 'company and role come from the model output');
}
{
  // Tabs in a model-authored field would add TSV columns and shift every field
  // after it. The writer sanitizes too, but a row built wrong here would be
  // wrong in the raw JSON archive as well.
  const rows = discardRows([row('t', { score: 1, data: { company: 'A\tB', role: 'C\tD', recommendation: 'no' } })], 2.0);
  check(!rows[0].company.includes('\t') && !rows[0].title.includes('\t'), 'tabs in company or role are stripped before they reach the TSV');
}

// ── the log accepts the new disposition ───────────────────────────────────
{
  const file = join(dir, 'gate.tsv');
  const r = appendGateHistory(file, [
    { url: 'https://zorblax.example/jobs/1', company: 'Zorblax Widgetry', role: 'Dir RevOps', result: 'prefiltered', reason: 'scored 1.4 < 2' },
  ], '2030-01-15');
  check(r.appended === 1, "'prefiltered' is a valid gate-history result, so a discard is recoverable from the log alone");
  check(readFileSync(file, 'utf8').includes('\tprefiltered\t'), 'the disposition is written in its own column');
}

// ── end to end through the real writer ────────────────────────────────────
{
  const file = join(dir, 'triage.tsv');
  const scored = [row('keep1', { score: 4.0 }), row('keep2', { score: 2.0 }), row('drop1', { score: 1.1 })];
  const { discarded } = splitAtThreshold(scored, 2.0);
  const res = appendTriageResults(file, discardRows(discarded, 2.0), '2030-01-15');
  const text = readFileSync(file, 'utf8');
  check(res.appended === 1, 'exactly one row reaches triage-results.tsv for three scored postings');
  check(!text.includes('/keep1') && !text.includes('/keep2'), 'neither survivor appears anywhere in the file');
  check(text.split('\n').filter(Boolean).length === 2, 'the file holds the header and one data row, nothing else');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
