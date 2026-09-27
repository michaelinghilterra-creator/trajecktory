#!/usr/bin/env node
/**
 * spark-compare.mjs — compare local pre-filter models head to head, on postings
 * Claude has already evaluated.
 *
 * WHY THIS EXISTS: the pre-filter threshold is certified for one model at one
 * endpoint (spark-prefilter.mjs). Before switching models — one Qwen generation to
 * the next, or one serving recipe to another — you need to know what the new one
 * would throw away. Benchmarks cannot say; they do not measure this rubric. This
 * scores a frozen set of already-evaluated postings through EXACTLY the production
 * call (lib/spark-eval.mjs: same preamble, same output contract, same derivation),
 * then compares each model's keep/discard decisions against Claude's scores.
 *
 * READ-ONLY on everything that matters. It reads reports/ and jds/, and writes only
 * under data/spark-compare/. It never touches pipeline.md, applications.md,
 * triage-results.tsv or reports. The only network traffic is to TJK_SPARK_URL.
 *
 * ONE MODEL PER RUN. The endpoint and model come from .env (TJK_SPARK_URL,
 * TJK_SPARK_MODEL), the same as the pre-filter, because a model that big owns the
 * whole box: bring one up, run it, bring the other up, run again, then compare.
 *
 * Usage:
 *   node spark-compare.mjs build-set [--size 120] [--strong 4.0] [--seed 20260927] [--force]
 *   node spark-compare.mjs run --label qwen3.6 [--resume] [--force] [--limit N]
 *   node spark-compare.mjs compare [labelA labelB ...] [--threshold 2.0] [--strong 4.0]
 *
 * build-set needs no endpoint. run needs one. compare reads saved runs only.
 *
 * The metric that decides it is STRONG MISSES: postings Claude scored >= --strong
 * that the model scored below the threshold. Each is a role the filter would have
 * hidden from you. Everything else in the report explains that number.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync } from 'fs';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join, resolve, basename } from 'path';
import { hasV1Frontmatter, parseV1 } from './dashboard-web/server/v1-loader.mjs';
import { deriveReportScore } from './compute-scores.mjs';
import { loadScoringWeights } from './lib/score.mjs';
import { localToday } from './lib/local-date.mjs';
import { SPARK_URL, SPARK_MODEL, SPARK_CONCURRENCY, isConfigured, buildPreamble, scoreOne } from './lib/spark-eval.mjs';
import {
  dedupeBySnapshot, stratifiedSample, joinRun, summarizeRun, decide, headToHead,
} from './lib/spark-compare.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
// Where reports/ and jds/ are read from. Only tests point this elsewhere.
const SOURCE_ROOT = process.env.TJK_COMPARE_SOURCE_ROOT ? resolve(process.env.TJK_COMPARE_SOURCE_ROOT) : ROOT;
const DATA_DIR = process.env.TJK_DATA_DIR ? resolve(process.env.TJK_DATA_DIR) : join(ROOT, 'data');
const OUT_DIR = join(DATA_DIR, 'spark-compare');
const SET_FILE = join(OUT_DIR, 'set.json');
const RUNS_DIR = join(OUT_DIR, 'runs');

const SET_SCHEMA = 'spark-compare-set/v1';
const RUN_SCHEMA = 'spark-compare-run/v1';
// A snapshot shorter than this is a failed capture (a cookie wall, an empty SPA
// shell), not a job description. Scoring it measures nothing about the model.
const MIN_JD_CHARS = 300;

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (f) => argv.includes(f);
const opt = (f, dflt) => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const numOpt = (f, dflt) => {
  const n = Number(opt(f, undefined));
  return Number.isFinite(n) ? n : dflt;
};
const positional = () => {
  const out = [];
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { if (!['--resume', '--force', '--include-legacy'].includes(argv[i])) i++; continue; }
    out.push(argv[i]);
  }
  return out;
};

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : '—');
const f2 = (n) => (Number.isFinite(n) ? n.toFixed(2) : '—');
const pct = (n) => (Number.isFinite(n) ? `${(n * 100).toFixed(0)}%` : '—');

function writeJsonAtomic(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, file);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

// A label becomes a filename. Keep it to characters every filesystem accepts.
export function safeLabel(label) {
  const s = String(label || '').trim();
  return /^[A-Za-z0-9._-]{1,64}$/.test(s) ? s : null;
}

// ---------------------------------------------------------------------------
// build-set
// ---------------------------------------------------------------------------

// jdSnapshot is written as "jds/<file>.md". Older pipeline refs carry "local:".
function snapshotRel(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/^local:/, '').trim();
  return s.startsWith('jds/') && !s.includes('..') ? s : null;
}

export function collectCandidates({ includeLegacy = false } = {}) {
  const cfg = loadScoringWeights(join(ROOT, 'config/profile.yml'));
  const dir = join(SOURCE_ROOT, 'reports');
  const skipped = { notV1: 0, noSnapshot: 0, snapshotMissing: 0, snapshotShort: 0, notDerivable: 0 };
  const out = [];
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { /* no reports yet */ }
  for (const f of files) {
    const md = readFileSync(join(dir, f), 'utf8');
    if (!hasV1Frontmatter(md)) { skipped.notV1++; continue; }
    let data;
    try { ({ data } = parseV1(md)); } catch { skipped.notV1++; continue; }
    const rel = snapshotRel(data.jdSnapshot);
    if (!rel) { skipped.noSnapshot++; continue; }
    let jd;
    try { jd = readFileSync(join(SOURCE_ROOT, rel), 'utf8'); } catch { skipped.snapshotMissing++; continue; }
    if (jd.trim().length < MIN_JD_CHARS) { skipped.snapshotShort++; continue; }
    // Ground truth is the report RE-DERIVED under today's profile, the same code and
    // config the local model's output will pass through. A legacy report has no
    // keyed dimensions to re-derive, so its authored number is used only on request.
    const d = deriveReportScore(md, cfg);
    let claudeScore = d.ok ? d.score : null;
    let basis = 'derived';
    if (claudeScore === null && includeLegacy && Number.isFinite(Number(data.score))) {
      claudeScore = Number(data.score); basis = 'legacy';
    }
    if (!Number.isFinite(claudeScore)) { skipped.notDerivable++; continue; }
    const idFromName = Number((f.match(/^(\d+)/) || [])[1]);
    out.push({
      id: rel,
      jdSnapshot: rel,
      jdSha: sha256(jd),
      reportId: Number.isFinite(Number(data.id)) && Number(data.id) > 0 ? Number(data.id) : idFromName,
      reportPath: `reports/${f}`,
      claudeScore,
      basis,
      company: String(data.company || ''),
      role: String(data.role || ''),
    });
  }
  return { candidates: dedupeBySnapshot(out), skipped, reportFiles: files.length };
}

function cmdBuildSet() {
  if (existsSync(SET_FILE) && !flag('--force')) {
    const s = readJson(SET_FILE);
    console.log(`A comparison set already exists (${s.items.length} postings, built ${s.created}).`);
    console.log('Every run is measured against it, so it is not rebuilt silently. Runs against an');
    console.log('old set cannot be compared with runs against a new one.');
    console.log('Re-run with --force to replace it.');
    return 1;
  }
  const size = numOpt('--size', 120);
  const strong = numOpt('--strong', 4.0);
  const seed = numOpt('--seed', Number(String(localToday()).replace(/-/g, '')));
  const { candidates, skipped, reportFiles } = collectCandidates({ includeLegacy: flag('--include-legacy') });
  console.log(`reports read: ${reportFiles}   usable: ${candidates.length}`);
  console.log(`  skipped: ${skipped.notV1} not v1, ${skipped.noSnapshot} no jdSnapshot, ` +
    `${skipped.snapshotMissing} snapshot missing, ${skipped.snapshotShort} snapshot too short, ` +
    `${skipped.notDerivable} not derivable${flag('--include-legacy') ? '' : ' (add --include-legacy to use authored legacy scores)'}`);
  if (!candidates.length) {
    console.log('\nNothing to build a set from. Evaluations need a jdSnapshot in their frontmatter');
    console.log('and the snapshot file present under jds/.');
    return 1;
  }
  const { items, strata } = stratifiedSample(candidates, { size, strong, seed });
  const set = {
    schema: SET_SCHEMA,
    setId: sha256(items.map((i) => `${i.id}:${i.jdSha}`).join('\n')).slice(0, 12),
    created: new Date().toISOString(),
    seed, size, strong, strata,
    preambleSha: sha256(buildPreamble()),
    items,
  };
  writeJsonAtomic(SET_FILE, set);
  console.log(`\nset ${set.setId}: ${items.length} postings, seed ${seed}`);
  console.log(`  strong (Claude >= ${strong}): ${strata.strong.sampled} of ${strata.strong.population}`);
  console.log(`  other:                      ${strata.other.sampled} of ${strata.other.population}`);
  if (strata.strong.sampled < 10) {
    console.log(`\nWARNING: only ${strata.strong.sampled} strong postings. Strong misses are the deciding`);
    console.log('metric, and a handful cannot separate two models. Treat the result as directional.');
  }
  console.log(`\nwrote ${SET_FILE}`);
  console.log('NEXT: bring up one model, set TJK_SPARK_URL / TJK_SPARK_MODEL, then');
  console.log('      node spark-compare.mjs run --label <name>');
  return 0;
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

async function listModels() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(`${SPARK_URL}/v1/models`, { signal: ctl.signal });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const j = await res.json();
    return { ok: true, ids: (j.data || []).map((m) => m.id) };
  } catch (err) {
    return { ok: false, reason: err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function cmdRun() {
  const label = safeLabel(opt('--label'));
  if (!label) {
    console.log('run needs --label <name> (letters, digits, dot, dash, underscore), e.g. --label qwen3.6');
    return 1;
  }
  if (!isConfigured()) {
    console.log('No endpoint configured: set TJK_SPARK_URL and TJK_SPARK_MODEL in .env. Nothing was sent.');
    return 1;
  }
  if (!existsSync(SET_FILE)) {
    console.log('No comparison set yet. Run: node spark-compare.mjs build-set');
    return 1;
  }
  const set = readJson(SET_FILE);
  const runFile = join(RUNS_DIR, `${label}.json`);
  let prior = null;
  if (existsSync(runFile)) {
    if (flag('--resume')) prior = readJson(runFile);
    else if (!flag('--force')) {
      console.log(`A run labelled "${label}" already exists. Use --resume to finish it, or --force to start over.`);
      return 1;
    }
  }

  const models = await listModels();
  if (!models.ok) {
    console.log(`Endpoint ${SPARK_URL} did not answer /v1/models (${models.reason}). Nothing was scored.`);
    return 1;
  }
  if (!models.ids.includes(SPARK_MODEL)) {
    console.log(`Endpoint serves [${models.ids.join(', ')}], not "${SPARK_MODEL}". Fix TJK_SPARK_MODEL. Nothing was scored.`);
    return 1;
  }

  const preamble = buildPreamble();
  const preambleSha = sha256(preamble);
  if (prior) {
    if (prior.setId !== set.setId) { console.log('That run was made against a different set. Use --force to start over.'); return 1; }
    if (prior.model !== SPARK_MODEL) { console.log(`That run used model "${prior.model}", not "${SPARK_MODEL}". Use a new label.`); return 1; }
    if (prior.preambleSha !== preambleSha) {
      console.log('Your CV, profile or evaluation mode changed since that run began, so the prompt is different.');
      console.log('Mixing the two halves would not measure one model. Use --force to start over.');
      return 1;
    }
  }
  if (preambleSha !== set.preambleSha) {
    console.log('NOTE: the prompt differs from when the set was built (CV, profile or mode edited).');
    console.log('That is fine as long as every model you compare is run with the SAME prompt;');
    console.log('compare checks that and warns if they differ.\n');
  }

  const done = new Map((prior?.results || []).filter((r) => !r.endpointError).map((r) => [r.id, r]));
  const limit = numOpt('--limit', Infinity);
  const todo = [];
  const stale = [];
  for (const it of set.items) {
    if (done.has(it.id)) continue;
    let jd;
    try { jd = readFileSync(join(SOURCE_ROOT, it.jdSnapshot), 'utf8'); } catch { stale.push(it.id); continue; }
    // A snapshot rewritten since the set was built is a different prompt from the one
    // the other model saw. Skipping it keeps the pairing honest.
    if (sha256(jd) !== it.jdSha) { stale.push(it.id); continue; }
    todo.push({ id: it.id, jdText: jd });
    if (todo.length >= limit) break;
  }

  console.log(`endpoint ${SPARK_URL}  model ${SPARK_MODEL}  concurrency ${SPARK_CONCURRENCY}`);
  console.log(`set ${set.setId}: ${set.items.length} postings, ${done.size} already scored, ${todo.length} to score` +
    (stale.length ? `, ${stale.length} skipped (snapshot missing or changed)` : ''));

  const run = {
    schema: RUN_SCHEMA, label, setId: set.setId, model: SPARK_MODEL, endpoint: SPARK_URL,
    preambleSha, started: prior?.started || new Date().toISOString(), finished: null,
    concurrency: SPARK_CONCURRENCY, wallSeconds: prior?.wallSeconds || 0,
    results: [...done.values()],
  };
  const save = () => writeJsonAtomic(runFile, run);
  save();

  const t0 = Date.now();
  let next = 0, n = 0, endpointErrors = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(SPARK_CONCURRENCY, todo.length)) }, async () => {
    for (;;) {
      const k = next++;
      if (k >= todo.length) return;
      const s = Date.now();
      const r = await scoreOne(todo[k], { preamble });
      r.ms = Date.now() - s;
      if (r.endpointError) endpointErrors++;
      run.results.push(r);
      if (++n % 10 === 0 || n === todo.length) {
        run.wallSeconds = (prior?.wallSeconds || 0) + (Date.now() - t0) / 1000;
        save();
        process.stdout.write(`  ${n}/${todo.length}\n`);
      }
    }
  }));
  run.wallSeconds = (prior?.wallSeconds || 0) + (Date.now() - t0) / 1000;
  // Finished means every posting in the set has a verdict, not just that this pass
  // ended cleanly: a --limit pass or a skipped snapshot leaves the run incomplete.
  const scoredIds = new Set(run.results.filter((r) => !r.endpointError).map((r) => r.id));
  if (set.items.every((it) => scoredIds.has(it.id))) run.finished = new Date().toISOString();
  save();

  const rows = joinRun(set.items, run.results);
  const threshold = numOpt('--threshold', Number(process.env.TJK_SPARK_THRESHOLD || 2.0));
  const s = summarizeRun(rows, { threshold, strong: set.strong, wallSeconds: run.wallSeconds });
  console.log(`\nscored ${s.n - s.missing} of ${s.n} in ${f1(run.wallSeconds)}s   parsed ${s.parsed}, unparseable ${s.unparseable}`);
  console.log(`  at T=${threshold}: ${s.atThreshold.strongMisses} strong misses, ${pct(s.atThreshold.savedShare)} of evaluations saved`);
  if (endpointErrors) {
    console.log(`\nENDPOINT FAILED on ${endpointErrors} postings. They are not counted against the model.`);
    console.log(`Finish them with: node spark-compare.mjs run --label ${label} --resume`);
  }
  console.log(`\nwrote ${runFile}`);
  console.log('NEXT: swap models and run again with another label, then: node spark-compare.mjs compare');
  return 0;
}

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

function loadRuns(labels) {
  let names = labels;
  if (!names.length) {
    try { names = readdirSync(RUNS_DIR).filter((f) => f.endsWith('.json')).map((f) => basename(f, '.json')).sort(); } catch { names = []; }
  }
  const runs = [];
  for (const name of names) {
    const l = safeLabel(name);
    const file = l && join(RUNS_DIR, `${l}.json`);
    if (!file || !existsSync(file)) { console.log(`  no run labelled "${name}" — skipped`); continue; }
    runs.push(readJson(file));
  }
  return runs;
}

function cmdCompare() {
  if (!existsSync(SET_FILE)) { console.log('No comparison set yet. Run: node spark-compare.mjs build-set'); return 1; }
  const set = readJson(SET_FILE);
  const strong = numOpt('--strong', set.strong);
  const threshold = numOpt('--threshold', Number(process.env.TJK_SPARK_THRESHOLD || 2.0));
  const all = loadRuns(positional());
  const runs = all.filter((r) => r.setId === set.setId);
  for (const r of all) if (r.setId !== set.setId) console.log(`  "${r.label}" was run against a different set — excluded`);
  if (!runs.length) { console.log('No runs against the current set. Run: node spark-compare.mjs run --label <name>'); return 1; }

  const T = threshold.toFixed(1);
  const byId = new Map(set.items.map((i) => [i.id, i]));
  const joined = runs.map((r) => ({ run: r, rows: joinRun(set.items, r.results) }));
  const sums = joined.map(({ run, rows }) => ({ run, rows, s: summarizeRun(rows, { threshold, strong, wallSeconds: run.wallSeconds }) }));

  console.log(`set ${set.setId}: ${set.items.length} postings  (strong = Claude >= ${strong}: ${set.strata.strong.sampled}; other: ${set.strata.other.sampled})`);
  console.log(`threshold under test: T=${T}  (a score equal to T survives, as in production)\n`);

  const shas = new Set(runs.map((r) => r.preambleSha));
  if (shas.size > 1) {
    console.log('WARNING: these runs did not see the same prompt (CV, profile or mode changed between them).');
    console.log('Differences below mix the model with the prompt. Re-run the older one with --force.\n');
  }

  const cols = sums.map(({ run }) => run.label);
  const w = Math.max(12, ...cols.map((c) => c.length + 2));
  const line = (name, vals) => console.log(name.padEnd(34) + vals.map((v) => String(v).padStart(w)).join(''));
  line('', cols);
  line('model', sums.map(({ run }) => run.model.length > w - 2 ? run.model.slice(0, w - 3) + '…' : run.model));
  line('complete', sums.map(({ s }) => (s.missing ? `${s.n - s.missing}/${s.n}` : 'yes')));
  console.log('— decisions');
  line(`strong misses @T=${T}  (lower wins)`, sums.map(({ s }) => s.atThreshold.strongMisses));
  line(`evaluations saved @T=${T}`, sums.map(({ s }) => pct(s.atThreshold.savedShare)));
  line('highest safe T (0 strong misses)', sums.map(({ s }) => (s.safe ? s.safe.t.toFixed(1) : 'none')));
  line('  saved at that T', sums.map(({ s }) => (s.safe ? pct(s.safe.savedShare) : '—')));
  line('lowest score on a strong posting', sums.map(({ s }) => f1(s.strongMin)));
  console.log('— agreement with Claude');
  line('Spearman', sums.map(({ s }) => f2(s.spearman)));
  line('mean abs error', sums.map(({ s }) => f2(s.mae)));
  line('bias (model − Claude)', sums.map(({ s }) => (Number.isFinite(s.bias) ? (s.bias >= 0 ? '+' : '') + s.bias.toFixed(2) : '—')));
  line('unparseable (kept, not discarded)', sums.map(({ s }) => s.unparseable));
  console.log('— speed');
  line('postings / minute', sums.map(({ s }) => f1(s.perMinute)));
  line('latency p50 / p90 (s)', sums.map(({ s }) => `${f1(s.msP50 / 1000)}/${f1(s.msP90 / 1000)}`));
  line('completion tokens (mean)', sums.map(({ s }) => (Number.isFinite(s.completionTokensMean) ? Math.round(s.completionTokensMean) : '—')));

  console.log('\nThreshold sweep: strong misses / evaluations saved');
  for (const t of [1.5, 2.0, 2.5, 3.0, 3.5]) {
    line(`  T=${t.toFixed(1)}`, sums.map(({ rows }) => { const d = decide(rows, t, strong); return `${d.strongMisses} / ${pct(d.savedShare)}`; }));
  }

  for (const { run, s } of sums) {
    const ids = s.atThreshold.strongMissIds;
    if (!ids.length) continue;
    console.log(`\n${run.label}: strong postings it would have discarded at T=${T}`);
    const res = new Map(run.results.map((r) => [r.id, r]));
    for (const id of ids) {
      const it = byId.get(id);
      console.log(`  Claude ${f1(it.claudeScore)}  model ${f1(res.get(id)?.score)}  ${it.company} — ${it.role}  (${it.reportPath})`);
    }
  }

  for (let i = 0; i < sums.length; i++) {
    for (let j = i + 1; j < sums.length; j++) {
      const a = sums[i], b = sums[j];
      const h = headToHead(a.rows, b.rows, threshold, strong);
      console.log(`\nhead to head @T=${T}: ${a.run.label} vs ${b.run.label} (${h.compared} paired postings)`);
      console.log(`  same decision: ${h.bothKept + h.bothDiscarded}   only ${a.run.label} discarded: ${h.onlyADiscarded}   only ${b.run.label} discarded: ${h.onlyBDiscarded}`);
      console.log(`  strong postings only ${a.run.label} discarded: ${h.strongOnlyA.length}   only ${b.run.label} discarded: ${h.strongOnlyB.length}`);
    }
  }

  console.log('\nHow to read this:');
  console.log('- Strong misses decide it. Each one is a posting Claude liked that the filter would have hidden.');
  console.log('- "Highest safe T" is chosen after seeing the answers, so it is a best case. If you adopt');
  console.log('  it, keep TJK_SPARK_HOLDBACK_RATE on so real queue traffic can catch what this set missed.');
  if (set.strata.strong.sampled < 20) {
    console.log(`- Only ${set.strata.strong.sampled} strong postings in the set: a difference of one or two misses is noise.`);
  }
  return 0;
}

// ---------------------------------------------------------------------------

const USAGE = `usage:
  node spark-compare.mjs build-set [--size 120] [--strong 4.0] [--seed N] [--include-legacy] [--force]
  node spark-compare.mjs run --label <name> [--resume] [--force] [--limit N]
  node spark-compare.mjs compare [label ...] [--threshold 2.0] [--strong 4.0]`;

async function main() {
  if (cmd === 'build-set') return cmdBuildSet();
  if (cmd === 'run') return cmdRun();
  if (cmd === 'compare') return cmdCompare();
  console.log(USAGE);
  return cmd ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().then((code) => process.exit(code || 0)).catch((e) => { console.error(e); process.exit(1); });
}
