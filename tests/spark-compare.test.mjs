#!/usr/bin/env node
/**
 * spark-compare.test.mjs — pins the comparison harness for local pre-filter models.
 *
 * The harness exists to answer one question before a model swap: how many postings
 * Claude liked would this model have thrown away? Every assertion below guards a
 * way that number could come out wrong without anything failing loudly:
 *
 * - a score EQUAL to the threshold must survive, exactly as in spark-prefilter.mjs;
 * - an unparseable output must be KEPT, never counted as a discard (that would
 *   reward the model that fails most);
 * - a posting the run never reached must be excluded, not scored as a zero;
 * - oversampling strong postings must not understate how much a filter saves;
 * - the whole thing must write nothing outside data/spark-compare/.
 *
 * The end-to-end half drives the real CLI against a stub OpenAI endpoint on
 * localhost, with invented reports and JDs in a sandbox. No real data is read.
 *
 * Run: node tests/spark-compare.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import {
  spearman, pearson, rankAvg, stratifiedSample, dedupeBySnapshot, joinRun, decide,
  safeThreshold, headToHead, summarizeRun, thresholdGrid,
} from '../lib/spark-compare.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}
const section = (n) => console.log(`\n${n}`);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

console.log('spark-compare.test.mjs');

// ---------------------------------------------------------------------------
section('statistics');
{
  check(near(pearson([1, 2, 3], [2, 4, 6]), 1), 'pearson of a perfect line is 1');
  check(pearson([1, 1, 1], [1, 2, 3]) === null, 'pearson with zero variance is null, not NaN');
  const r = rankAvg([2.0, 1.0, 2.0, 3.0]);
  check(r.join(',') === '2.5,1,2.5,4', `tied scores share an average rank (got ${r.join(',')})`);
  check(near(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1), 'spearman of a monotone pair is 1');
  check(near(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1), 'spearman of a reversed pair is -1');
  const a = spearman([1, 2, 2, 3], [1, 3, 2, 4]);
  const b = spearman([2, 1, 3, 2], [3, 1, 4, 2]);
  check(near(a, b), 'spearman does not depend on input order when there are ties');
  check(thresholdGrid(1.0, 1.3).join(',') === '1,1.1,1.2,1.3', 'threshold grid has no float drift');
}

// ---------------------------------------------------------------------------
section('set construction');
{
  const c = (id, s, rid = 1) => ({ id, jdSnapshot: id, reportId: rid, claudeScore: s });
  const d = dedupeBySnapshot([c('jds/a.md', 3, 5), c('jds/a.md', 4.5, 9), c('jds/b.md', 2, 1)]);
  check(d.length === 2, 'a re-evaluated snapshot appears once');
  check(d.find((x) => x.id === 'jds/a.md').claudeScore === 4.5, 'the newest report (highest id) wins');

  const pool = [
    ...Array.from({ length: 10 }, (_, i) => c(`jds/s${i}.md`, 4.2)),
    ...Array.from({ length: 90 }, (_, i) => c(`jds/o${i}.md`, 2.1)),
  ];
  const s1 = stratifiedSample(pool, { size: 20, strong: 4.0, seed: 7, strongShare: 0.4 });
  const s2 = stratifiedSample(pool, { size: 20, strong: 4.0, seed: 7, strongShare: 0.4 });
  check(s1.items.map((x) => x.id).join() === s2.items.map((x) => x.id).join(), 'the same seed draws the same set');
  check(s1.strata.strong.sampled === 8 && s1.strata.other.sampled === 12, `strong oversampled to its share (8 + 12, got ${s1.strata.strong.sampled} + ${s1.strata.other.sampled})`);
  check(near(s1.strata.strong.weight, 10 / 8) && near(s1.strata.other.weight, 90 / 12), 'each stratum carries its population weight');
  const s3 = stratifiedSample(pool.slice(0, 13), { size: 20, strong: 4.0, seed: 7 });
  check(s3.items.length === 13 && s3.strata.strong.sampled === 10, 'a short weak stratum hands its slots to the strong one');
  const s4 = stratifiedSample(pool, { size: 20, seed: 8 });
  check(s4.items.map((x) => x.id).join() !== s1.items.map((x) => x.id).join(), 'a different seed draws a different set');
}

// ---------------------------------------------------------------------------
section('decisions mirror production');
{
  const set = [
    { id: 'eq', claudeScore: 4.5, weight: 1 },   // model scores exactly T
    { id: 'lo', claudeScore: 4.5, weight: 1 },   // strong, model below T: a strong miss
    { id: 'bad', claudeScore: 4.5, weight: 1 },  // unparseable
    { id: 'gone', claudeScore: 4.5, weight: 1 }, // endpoint error
    { id: 'w', claudeScore: 1.5, weight: 1 },    // weak, correctly discarded
  ];
  const run = [
    { id: 'eq', ok: true, score: 2.0 },
    { id: 'lo', ok: true, score: 1.8 },
    { id: 'bad', ok: false, reason: 'bad-json' },
    { id: 'gone', ok: false, endpointError: true },
    { id: 'w', ok: true, score: 1.0 },
  ];
  const rows = joinRun(set, run);
  const d = decide(rows, 2.0, 4.0);
  check(!d.strongMissIds.includes('eq'), 'a score equal to T survives');
  check(d.strongMissIds.join() === 'lo', `the strong posting below T is the only strong miss (got ${d.strongMissIds.join()})`);
  check(!d.strongMissIds.includes('bad'), 'an unparseable output is kept, never discarded');
  check(rows.find((r) => r.id === 'gone').missing, 'an endpoint error is missing, not a verdict');
  check(d.discarded === 2, `discards counted over reached rows only (got ${d.discarded})`);
  check(near(d.savedShare, 2 / 4), `saved share excludes the missing row (got ${d.savedShare})`);

  const s = summarizeRun(rows, { threshold: 2.0, strong: 4.0 });
  check(s.missing === 1 && s.unparseable === 1 && s.parsed === 3, 'summary separates missing, unparseable and parsed');
  check(s.strongMin === 1.8, 'lowest score on a strong posting is reported');
  check(safeThreshold(rows, 4.0).t === 1.8, `highest safe T sits at the lowest strong score (got ${safeThreshold(rows, 4.0)?.t})`);
  check(safeThreshold(joinRun([{ id: 'x', claudeScore: 5 }], [{ id: 'x', ok: true, score: 0.5 }]), 4.0) === null,
    'no safe threshold when even the lowest grid point drops a strong posting');
}

section('weighted savings');
{
  // 1 strong row standing for 1 posting, 1 weak row standing for 9. Discarding the
  // weak one saves 90% of the real queue, not the 50% an unweighted count says.
  const rows = joinRun(
    [{ id: 's', claudeScore: 4.5, weight: 1 }, { id: 'o', claudeScore: 1.0, weight: 9 }],
    [{ id: 's', ok: true, score: 4.0 }, { id: 'o', ok: true, score: 1.0 }],
  );
  check(near(decide(rows, 2.0, 4.0).savedShare, 0.9), 'savings are reweighted to the population');
}

section('head to head');
{
  const set = [{ id: 'a', claudeScore: 4.5 }, { id: 'b', claudeScore: 1.0 }, { id: 'c', claudeScore: 4.2 }];
  const A = joinRun(set, [{ id: 'a', ok: true, score: 1.0 }, { id: 'b', ok: true, score: 1.0 }, { id: 'c', ok: true, score: 3.0 }]);
  const B = joinRun(set, [{ id: 'a', ok: true, score: 3.0 }, { id: 'b', ok: true, score: 1.0 }, { id: 'c', ok: false }]);
  const h = headToHead(A, B, 2.0, 4.0);
  check(h.compared === 3 && h.bothDiscarded === 1 && h.onlyADiscarded === 1, 'paired decisions are tallied');
  check(h.strongOnlyA.join() === 'a' && h.strongOnlyB.length === 0, 'the strong posting only A discarded is named');
}

// ---------------------------------------------------------------------------
section('end to end: CLI against a stub endpoint');

const box = makeSandbox('spark-compare');
const src = join(box, 'src');
const dataDir = join(box, 'data');
mkdirSync(join(src, 'reports'), { recursive: true });
mkdirSync(join(src, 'jds'), { recursive: true });
mkdirSync(dataDir, { recursive: true });

// Invented postings. The marker tells the stub how to answer.
const dims = (v) => ['fit', 'northStar', 'level', 'comp', 'location', 'buildDepth']
  .map((key) => ({ key, dim: key, val: v, max: 5, evidence: 'x' }))
  .concat([{ key: 'redFlags', dim: 'Red Flags', val: 5, max: 5, evidence: 'x' }]);
const postings = [
  { n: 901, slug: 'example-co', marker: 'STRONG', claude: 5 },
  { n: 902, slug: 'sample-inc', marker: 'MISS', claude: 5 },   // Claude strong, stub-a scores it low
  { n: 903, slug: 'demo-labs', marker: 'WEAK', claude: 0 },
  { n: 904, slug: 'test-corp', marker: 'GARBAGE', claude: 5 }, // the stub answers unparseably
  { n: 905, slug: 'fixture-ltd', marker: 'WEAK', claude: 0 },
];
for (const p of postings) {
  const jd = `jds/${p.n}-${p.slug}.md`;
  writeFileSync(join(src, jd), `# Invented posting ${p.slug}\n\nMARKER:${p.marker}\n\n${'Responsibilities include things. '.repeat(20)}`);
  const fm = {
    schema: 'trajecktory-report/v1', id: p.n, company: p.slug, role: 'Director of Examples',
    date: '2026-01-01', url: '', jdSnapshot: jd,
    summary: { seniority: 'Director', compStated: '' }, levelMatch: { jdLevel: 'Director' },
    globalScore: dims(p.claude), scoreCeiling: null, ceilingBasis: '',
  };
  writeFileSync(join(src, 'reports', `${p.n}-${p.slug}-2026-01-01.md`), `---\n${JSON.stringify(fm, null, 2)}\n---\n\n## A) Block\n\nbody\n`);
}
// A legacy report (no keyed dims) and a report with no snapshot: both must be skipped.
writeFileSync(join(src, 'reports', '906-old-2026-01-01.md'), `---\n${JSON.stringify({ schema: 'trajecktory-report/v1', id: 906, jdSnapshot: 'jds/906.md', score: 4.9, globalScore: [{ dim: 'Fit', val: 5 }] })}\n---\nbody\n`);
writeFileSync(join(src, 'jds', '906.md'), 'MARKER:STRONG ' + 'x'.repeat(400));
writeFileSync(join(src, 'reports', '907-nosnap-2026-01-01.md'), `---\n${JSON.stringify({ schema: 'trajecktory-report/v1', id: 907, globalScore: dims(5) })}\n---\nbody\n`);

const verdict = (v) => JSON.stringify({
  schema: 'trajecktory-report/v1', company: 'x', role: 'y',
  summary: { archetypeDetected: 'x', seniority: 'Director', compStated: '' }, levelMatch: { jdLevel: 'Director' },
  globalScore: dims(v), scoreCeiling: null, ceilingBasis: '', ceilingReason: '', recommendation: '',
});
let chatCalls = 0;
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'stub-a' }, { id: 'stub-b' }] }));
    if (req.url !== '/v1/chat/completions') { res.statusCode = 404; return res.end('{}'); }
    chatCalls++;
    const j = JSON.parse(body);
    const text = j.messages[0].content;
    const marker = (text.match(/MARKER:(\w+)/) || [])[1];
    let content;
    if (marker === 'GARBAGE') content = 'I think this role is great!';
    else if (marker === 'WEAK') content = verdict(0);
    else if (marker === 'MISS') content = verdict(j.model === 'stub-a' ? 0 : 5);
    else content = verdict(5);
    res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

function cli(args, model = 'stub-a') {
  return new Promise((res) => {
    execFile(process.execPath, [join(ROOT, 'spark-compare.mjs'), ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        TJK_COMPARE_SOURCE_ROOT: src, TJK_DATA_DIR: dataDir,
        TJK_SPARK_URL: `http://127.0.0.1:${port}`, TJK_SPARK_MODEL: model,
        TJK_SPARK_CONCURRENCY: '2', TJK_SPARK_THRESHOLD: '2.0',
      },
    }, (err, stdout, stderr) => res({ code: err ? err.code : 0, out: stdout + stderr }));
  });
}

const hashTree = (dir) => createHash('sha256').update(readdirSync(dir).sort().map((f) => f + readFileSync(join(dir, f), 'utf8')).join('\n')).digest('hex');
const reportsBefore = hashTree(join(src, 'reports'));
const jdsBefore = hashTree(join(src, 'jds'));

try {
  let r = await cli(['build-set', '--size', '10', '--seed', '3']);
  check(r.code === 0, `build-set succeeds (exit ${r.code})`);
  const set = JSON.parse(readFileSync(join(dataDir, 'spark-compare', 'set.json'), 'utf8'));
  check(set.items.length === 5, `only the five derivable, snapshotted reports enter the set (got ${set.items.length})`);
  check(!set.items.some((i) => i.id === 'jds/906.md'), 'a legacy report is left out unless asked for');
  check(set.strata.strong.population === 3, `strong stratum counted from re-derived Claude scores (got ${set.strata.strong.population})`);

  r = await cli(['build-set']);
  check(r.code === 1 && /already exists/.test(r.out), 'an existing set is never rebuilt silently');

  r = await cli(['run', '--label', 'a'], 'nope');
  check(r.code === 1 && /not "nope"/.test(r.out), 'a model the endpoint does not serve is refused before scoring');
  check(chatCalls === 0, 'and nothing was sent to it');

  r = await cli(['run', '--label', '../evil']);
  check(r.code === 1, 'a label that is not a safe filename is refused');

  r = await cli(['run', '--label', 'a'], 'stub-a');
  check(r.code === 0, `run a succeeds (exit ${r.code})`);
  r = await cli(['run', '--label', 'b'], 'stub-b');
  check(r.code === 0, `run b succeeds (exit ${r.code})`);
  const runA = JSON.parse(readFileSync(join(dataDir, 'spark-compare', 'runs', 'a.json'), 'utf8'));
  check(runA.results.length === 5 && runA.finished, 'run a scored every posting and is marked finished');

  r = await cli(['run', '--label', 'a'], 'stub-a');
  check(r.code === 1 && /--resume/.test(r.out), 'an existing run is not overwritten without --resume or --force');
  const before = chatCalls;
  r = await cli(['run', '--label', 'a', '--resume'], 'stub-a');
  check(r.code === 0 && chatCalls === before, 'resuming a finished run scores nothing again');
  r = await cli(['run', '--label', 'a', '--resume'], 'stub-b');
  check(r.code === 1 && /Use a new label/.test(r.out), 'resuming under a different model is refused');

  r = await cli(['compare']);
  check(r.code === 0, `compare succeeds (exit ${r.code})`);
  // The label column is 34 wide; the values follow it.
  const row = (name) => (r.out.split('\n').find((l) => l.startsWith(name)) || '').slice(34).trim().split(/\s+/);
  const misses = row('strong misses @T=2');
  check(misses.join() === '1,0', `strong misses: a=1, b=0 (got ${misses.join(',')})`);
  check(/sample-inc — Director of Examples/.test(r.out), 'the strong posting a discarded is named');
  check(/strong postings only a discarded: 1\s+only b discarded: 0/.test(r.out), 'head to head names the difference');
  check(!/test-corp/.test(r.out.split('head to head')[0].split('strong postings it would have discarded')[1] || ''),
    'the unparseable posting is not listed as a discard');

  r = await cli(['compare', 'a', 'nosuch']);
  check(r.code === 0 && /no run labelled "nosuch"/.test(r.out), 'an unknown label is reported and skipped');

  // Read-only: sources untouched, and nothing written outside data/spark-compare.
  check(hashTree(join(src, 'reports')) === reportsBefore, 'reports are byte-identical afterwards');
  check(hashTree(join(src, 'jds')) === jdsBefore, 'JD snapshots are byte-identical afterwards');
  check(readdirSync(dataDir).join() === 'spark-compare', `data/ holds only spark-compare/ (got ${readdirSync(dataDir).join()})`);
  check(!existsSync(join(src, 'data')), 'nothing written under the source root');

  // A snapshot rewritten after the set was built is a different prompt: skipped.
  writeFileSync(join(src, 'jds', '901-example-co.md'), 'MARKER:WEAK ' + 'y'.repeat(400));
  r = await cli(['run', '--label', 'c'], 'stub-b');
  check(/1 skipped \(snapshot missing or changed\)/.test(r.out), 'a changed snapshot is skipped, not re-scored');
  const runC = JSON.parse(readFileSync(join(dataDir, 'spark-compare', 'runs', 'c.json'), 'utf8'));
  check(runC.finished === null, 'a run with a skipped posting is not marked finished');
} finally {
  server.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
