#!/usr/bin/env node
/**
 * spark-prefilter.mjs — score the pending queue on a local model and drop the
 * postings that are obviously not worth a full evaluation.
 *
 * WHY THIS EXISTS: a real evaluation costs a Claude call, and most of a scanned
 * queue does not deserve one. A local model running on your own hardware can make
 * the cheap half of that decision — "is this plausibly in range at all" — for free.
 *
 * WHAT IT IS NOT: this does not evaluate anything. The local model's number is a
 * FILTERING DECISION, not a score, and nothing here writes to reports/,
 * data/pipeline.md or data/applications.md as if it were one. Four candidate
 * models were measured against the real rubric and none matched Claude's judgment
 * closely enough to replace it. What one CAN do, with a threshold validated
 * against audited ground truth, is decline to spend an evaluation.
 *
 * THE ASYMMETRY THAT SHAPES EVERY DEFAULT HERE: discarding a strong posting costs
 * a job. Keeping a weak one costs a single evaluation. So every failure mode —
 * an unreachable endpoint, an unparseable output, a snapshot that cannot be read,
 * a row whose URL cannot be recovered — leaves the row PENDING. There is no code
 * path in this file where "something went wrong" becomes "discard it".
 *
 * OPT-IN: with TJK_SPARK_URL unset this script prints a line and exits 0 without
 * touching anything. It is inert until you configure an endpoint.
 *
 * WHERE IT RUNS in the batch workflow (see AGENTS.md):
 *   2a  gate-pipeline.mjs --apply        liveness
 *   2b  reconcile-triage.mjs --apply     check off what is already handled
 *   2c  spark-prefilter.mjs --apply      <- HERE
 *   2d  reconcile-triage.mjs --apply     check off what 2c just discarded
 *   3   batch evaluation
 * The order is forced, not stylistic: the local model has no web access, so it can
 * only read snapshots resolve-jds.mjs has already written; a row gated dead must
 * never also receive a discard decision; and rows already handled must not be
 * re-filtered on every run.
 *
 * Usage:
 *   node spark-prefilter.mjs              # dry run: report the split, write nothing
 *   node spark-prefilter.mjs --apply      # write the discard rows
 *   node spark-prefilter.mjs --limit 20   # score only the first N pending rows
 *   node spark-prefilter.mjs --audit 12   # size of the random audit sample
 *
 * HOLDBACK: a fixed share of would-be discards (TJK_SPARK_HOLDBACK_RATE, default
 * 0.1) is left PENDING instead, so it gets a full evaluation like any survivor.
 * Without it, a strong role the filter wrongly drops never receives a score and
 * no later measurement can see the miss. Held-back rows are logged to
 * data/spark-prefilter/holdback.tsv so their evaluations can be found again.
 * Set the rate to 0 to disable.
 *
 * Exit code: 0 unless the script itself failed. A low or high discard rate is a
 * result, not an error.
 */

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { sourceUrlFromSnapshot } from './lib/snapshot-url.mjs';
import { canonicalUrl } from './lib/identity.mjs';
import { appendTriageResults } from './lib/triage-results.mjs';
import { appendGateHistory } from './lib/gate-history.mjs';
import { readPipelineRows } from './lib/pipeline.mjs';
import { localToday } from './lib/local-date.mjs';
import {
  SPARK_URL, SPARK_MODEL, SPARK_CONCURRENCY, isConfigured, buildPreamble, scoreMany,
} from './lib/spark-eval.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.TJK_DATA_DIR ? resolve(process.env.TJK_DATA_DIR) : join(ROOT, 'data');
const PIPELINE = join(DATA_DIR, 'pipeline.md');
const TRIAGE_RESULTS = join(DATA_DIR, 'triage-results.tsv');
const GATE_HISTORY = join(DATA_DIR, 'gate-history.tsv');

// The threshold is a certified operating point of one model at one endpoint, not a
// preference, which is why it sits beside the endpoint in .env rather than in
// config/profile.yml with the scoring policy. Changing it invalidates whatever
// audit certified it.
const THRESHOLD = Number(process.env.TJK_SPARK_THRESHOLD || 2.0);

/**
 * parseHoldbackRate(raw, dflt) -> a number in [0, 1]
 *
 * An unset, unparseable or out-of-range value falls back to the default rather
 * than to 0. A typo must not silently switch off the only check that can see a
 * wrongly discarded strong role.
 */
export function parseHoldbackRate(raw, dflt = 0.1) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : dflt;
}
const HOLDBACK_RATE = parseHoldbackRate(process.env.TJK_SPARK_HOLDBACK_RATE);

// The rationale prefix is a provenance marker, and it is load-bearing: it is how a
// later reader can identify rows written by this pre-filter.
// Keep it byte-identical — `grep -c` over it is a valid count of prefiltered rows.
const RATIONALE_PREFIX = 'Spark pre-filter, below T=';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const numArg = (flag, dflt) => {
  const i = argv.indexOf(flag);
  if (i < 0) return dflt;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) ? n : dflt;
};
const LIMIT = numArg('--limit', Infinity);
const AUDIT_N = numArg('--audit', 12);

// Seeded PRNG so the audit sample is reproducible and cannot be quietly re-rolled.
// Selecting the sample after seeing the scores would let the easy cases be picked,
// which is the whole reason this is drawn from a recorded seed instead of at random.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededSample(items, n, seed) {
  const rnd = mulberry32(seed);
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/**
 * splitAtThreshold(scored, t) -> { survivors, discarded, unfiltered }
 *
 * A score EQUAL to the threshold survives. That boundary is not cosmetic: several
 * ceiling rules pin a role at exactly the threshold value, so a `<` here and a
 * `<=` there is the difference between parking those roles on the line and
 * discarding every one of them.
 *
 * Anything that is not a finite score is `unfiltered` and stays pending.
 */
export function splitAtThreshold(scored, t = THRESHOLD) {
  const survivors = [];
  const discarded = [];
  const unfiltered = [];
  for (const r of scored) {
    if (!r || !r.ok || !Number.isFinite(r.score)) { unfiltered.push(r); continue; }
    (r.score >= t ? survivors : discarded).push(r);
  }
  return { survivors, discarded, unfiltered };
}

/**
 * holdbackFraction(url) -> a number in [0, 1)
 *
 * FNV-1a over the canonical URL. Selection is keyed on the posting, not drawn per
 * run, and that is load-bearing: a held-back row stays "- [ ]", so the next run
 * scores it again. A per-run draw would give it a fresh 90% chance of being
 * discarded before anyone evaluated it. Keyed on the URL, the answer never changes.
 */
export function holdbackFraction(url) {
  const key = canonicalUrl(url) || String(url || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // FNV-1a alone barely moves the high bits when only the last characters differ,
  // and ATS URLs usually differ only in a trailing id. The murmur3 finalizer
  // spreads every input bit across the result before it is read as a fraction.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * splitHoldback(discarded, rate) -> { dropped, heldBack }
 *
 * Every would-be discard lands in exactly one of the two. Only `dropped` may
 * reach discardRows: a held-back row written to triage-results.tsv would be
 * checked off by reconcile-triage.mjs and never evaluated, which defeats it.
 */
export function splitHoldback(discarded, rate = HOLDBACK_RATE) {
  const dropped = [];
  const heldBack = [];
  for (const r of discarded) {
    (rate > 0 && holdbackFraction(r.sourceUrl) < rate ? heldBack : dropped).push(r);
  }
  return { dropped, heldBack };
}

const HOLDBACK_HEADER = 'date\turl\tsparkScore\tthreshold\tmodel';

/**
 * appendHoldbackLog(file, heldBack, date, meta) -> { appended, skippedDuplicate }
 *
 * Append-only, one row per posting ever held back. A URL already in the file is
 * not written again, because the same pending row is re-scored on every run until
 * it is evaluated.
 */
export function appendHoldbackLog(file, heldBack, date, { threshold = THRESHOLD, model = SPARK_MODEL } = {}) {
  const seen = new Set();
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/).slice(1)) {
      const url = line.split('\t')[1];
      if (url) seen.add(canonicalUrl(url) || url);
    }
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, HOLDBACK_HEADER + '\n');
  }
  let appended = 0, skippedDuplicate = 0;
  const clean = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  for (const r of heldBack) {
    const key = canonicalUrl(r.sourceUrl) || r.sourceUrl;
    if (seen.has(key)) { skippedDuplicate++; continue; }
    seen.add(key);
    appendFileSync(file, [date, clean(r.sourceUrl), Number(r.score).toFixed(1), threshold, clean(model)].join('\t') + '\n');
    appended++;
  }
  return { appended, skippedDuplicate };
}

/**
 * Build the triage-results rows for the DISCARDS ONLY.
 *
 * NEVER call this with survivors. reconcile-triage.mjs treats any URL present in
 * triage-results.tsv as already handled and checks its pipeline row off; a survivor
 * row would therefore flip every survivor to "- [x]", and the batch — which
 * processes only "- [ ]" — would evaluate nothing at all. That failure reports a
 * clean run and produces no output, which is the hardest kind to notice.
 */
export function discardRows(discarded, t = THRESHOLD) {
  return discarded.map((r) => {
    const why = String(r.data?.ceilingReason || r.data?.recommendation || '').replace(/\s+/g, ' ').trim();
    const rationale = `${RATIONALE_PREFIX}${t}, not fully evaluated. ${why}`.slice(0, 180);
    return {
      url: r.sourceUrl,
      company: String(r.data?.company || r.company || '').replace(/\t/g, ' ').trim(),
      title: String(r.data?.role || r.role || '').replace(/\t/g, ' ').trim(),
      score: r.score,
      rationale,
    };
  });
}

// Collect the pending rows this script can actually score. A row is scoreable only
// if it points at a local snapshot: the model has no web access, so an unresolved
// http(s) row is not "weak", it is unreadable, and it stays pending.
function collectItems() {
  const rows = readPipelineRows(PIPELINE, 'open');
  const items = [];
  const skipped = [];
  for (const row of rows) {
    if (!row.url.startsWith('local:')) {
      skipped.push({ url: row.url, why: 'not resolved to a local snapshot' });
      continue;
    }
    const rel = row.url.replace(/^local:/, '').trim();
    let jdText;
    try {
      jdText = readFileSync(join(ROOT, rel), 'utf8');
    } catch {
      skipped.push({ url: row.url, why: 'snapshot unreadable' });
      continue;
    }
    const sourceUrl = sourceUrlFromSnapshot(row.url);
    if (!sourceUrl) {
      // Without the original URL there is nothing to write a triage-results row
      // against, and a row keyed on "local:..." would never reconcile.
      skipped.push({ url: row.url, why: 'no source URL recoverable from the snapshot' });
      continue;
    }
    items.push({ id: rel, jdText, sourceUrl, localRef: row.url, rest: row.rest });
    if (items.length >= LIMIT) break;
  }
  return { items, skipped };
}

async function main() {
  if (!isConfigured()) {
    console.log('spark-prefilter: no local endpoint configured (set TJK_SPARK_URL and');
    console.log('TJK_SPARK_MODEL in .env). Nothing was read or written.');
    return;
  }
  if (!existsSync(PIPELINE)) {
    console.log(`spark-prefilter: no pipeline at ${PIPELINE}. Nothing to do.`);
    return;
  }

  const { items, skipped } = collectItems();
  console.log(`endpoint ${SPARK_URL}  model ${SPARK_MODEL}  T=${THRESHOLD}  concurrency ${SPARK_CONCURRENCY}`);
  console.log(`pending rows scoreable: ${items.length}${skipped.length ? `  (skipped ${skipped.length}, left pending)` : ''}\n`);
  if (!items.length) {
    for (const s of skipped) console.log(`  pending  ${s.url}  — ${s.why}`);
    return;
  }

  const preamble = buildPreamble();
  const t0 = Date.now();
  let done = 0;
  const raw = await scoreMany(items, {
    preamble,
    onResult: () => { if (++done % 10 === 0) process.stdout.write(`  ${done}/${items.length}\n`); },
  });
  const scored = raw.map((r, i) => ({ ...r, ...items[i] }));
  const wall = ((Date.now() - t0) / 1000).toFixed(1);

  // An endpoint that went away mid-run is not a verdict on the postings it did not
  // reach. Report it and write nothing, rather than discarding on partial data.
  const endpointErrors = scored.filter((r) => r.endpointError);
  if (endpointErrors.length) {
    console.log(`\nENDPOINT FAILED on ${endpointErrors.length} of ${items.length} rows:`);
    console.log(`  ${endpointErrors[0].reason}`);
    console.log(`\nNothing written. Every row stays pending. Check the endpoint at ${SPARK_URL},`);
    console.log('or skip the optional pre-filter and evaluate the queue directly.');
    return;
  }

  const { survivors, discarded: belowT, unfiltered } = splitAtThreshold(scored, THRESHOLD);
  const { dropped: discarded, heldBack } = splitHoldback(belowT, HOLDBACK_RATE);
  const pct = items.length ? ((discarded.length / items.length) * 100).toFixed(1) : '0.0';
  console.log(`\nscored ${items.length} in ${wall}s`);
  console.log(`  survivors   ${survivors.length}   (score >= ${THRESHOLD}, go to evaluation)`);
  console.log(`  discarded   ${discarded.length}   (${pct}% of the queue removed)`);
  console.log(`  held back   ${heldBack.length}   (below ${THRESHOLD} but kept for evaluation, rate ${HOLDBACK_RATE})`);
  console.log(`  unfiltered  ${unfiltered.length}  (unparseable output — left pending, NOT discarded)`);
  for (const u of unfiltered) console.log(`      ${u.id} — ${u.reason}`);
  for (const s of skipped) console.log(`      ${s.url} — ${s.why}`);

  // The audit sample is drawn from a recorded seed, and drawn from the discards
  // regardless of --apply, so the same sample can be checked before committing to
  // the split. Its purpose is to answer one question: did the filter drop anything
  // it should not have? A single strong role in the sample means the threshold is
  // wrong, not that the sample was unlucky.
  const seed = Number(String(localToday()).replace(/-/g, ''));
  const audit = seededSample(discarded, Math.min(AUDIT_N, discarded.length), seed);
  if (audit.length) {
    console.log(`\naudit sample (${audit.length} of ${discarded.length} discards, seed ${seed}) — evaluate these by hand:`);
    for (const a of audit) console.log(`  ${a.score.toFixed(1)}  ${a.data?.company || ''} — ${a.data?.role || ''}  ${a.sourceUrl}`);
  }

  if (!APPLY) {
    console.log('\n(dry run: nothing written. Re-run with --apply to write the discard rows.)');
    return;
  }

  // Raw model output, one file per scored posting. This is what makes a discard
  // replayable: the decision can be re-derived against a changed profile.yml
  // without paying for the inference again. data/ is user layer and gitignored.
  const outDir = join(DATA_DIR, 'spark-prefilter', localToday());
  mkdirSync(outDir, { recursive: true });
  const heldIds = new Set(heldBack.map((r) => r.id));
  for (const r of scored) {
    const safe = String(r.id).replace(/[\\/]/g, '_');
    writeFileSync(join(outDir, `${safe}.json`), JSON.stringify({
      id: r.id, sourceUrl: r.sourceUrl, ok: r.ok, score: r.score, reason: r.reason,
      finishReason: r.finishReason, promptTokens: r.promptTokens, completionTokens: r.completionTokens,
      model: SPARK_MODEL, threshold: THRESHOLD, heldBack: heldIds.has(r.id), data: r.data,
    }, null, 2));
  }
  const hold = appendHoldbackLog(join(DATA_DIR, 'spark-prefilter', 'holdback.tsv'), heldBack, localToday());

  const rows = discardRows(discarded, THRESHOLD);
  const res = appendTriageResults(TRIAGE_RESULTS, rows, localToday());
  const gate = appendGateHistory(GATE_HISTORY, discarded.map((r) => ({
    url: r.sourceUrl,
    company: r.data?.company || '',
    role: r.data?.role || '',
    result: 'prefiltered',
    reason: `scored ${r.score.toFixed(1)} < ${THRESHOLD} by ${SPARK_MODEL}`,
  })), localToday());

  console.log(`\nwrote ${res.appended} discard rows to ${TRIAGE_RESULTS}` +
    (res.skippedDuplicate ? ` (${res.skippedDuplicate} already present)` : ''));
  console.log(`wrote ${gate.appended} rows to ${GATE_HISTORY}`);
  console.log(`logged ${hold.appended} held-back rows to spark-prefilter/holdback.tsv` +
    (hold.skippedDuplicate ? ` (${hold.skippedDuplicate} already logged)` : ''));
  console.log(`wrote ${scored.length} raw outputs to ${outDir}`);
  console.log('\nNEXT: node reconcile-triage.mjs        # dry run, confirm the count');
  console.log('      node reconcile-triage.mjs --apply # check the discarded rows off');
  console.log('\nTo reverse one discard: delete its row from triage-results.tsv, re-run');
  console.log('reconcile-triage.mjs, and flip its pipeline.md box back to "- [ ]". The');
  console.log(`raw output in ${outDir} says why it was dropped.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
