/**
 * lib/spark-eval.mjs — score a job description against the rubric on a local,
 * OpenAI-compatible inference endpoint.
 *
 * WHY THIS EXISTS: evaluating a JD properly costs a Claude call, and most of the
 * queue does not deserve one. A local model cannot replace the evaluation — four
 * candidate models were measured against the real rubric and none matched Claude's
 * judgment — but it can decide, safely, which postings are obviously not worth an
 * evaluation. That is a filtering decision, not a score, and everything here is
 * shaped by that distinction.
 *
 * TWO RULES THIS MODULE ENFORCES, both learned the expensive way:
 *
 * 1. VALIDITY IS DECIDED BY PRODUCTION, NOT BY THIS MODULE. An output counts only
 *    if deriveReportScore admits it and can derive a score from it, with zero
 *    adaptation. An earlier harness checked for a `headline` field it had asked
 *    for itself; a contract production rejects outright still measured a Pearson
 *    of 0.574 that way, because the harness was grading its own homework.
 *
 * 2. FAILURE IS NEVER EVIDENCE OF A WEAK ROLE. A truncated completion, a parse
 *    error, an unreachable endpoint — each returns ok:false, and the caller must
 *    treat that as "not filtered", never as "discard". Discarding a live strong
 *    posting costs a job; keeping a weak one costs one evaluation.
 *
 * PROMPT SHAPE is deliberate, for prefix caching on vLLM:
 *   [ byte-identical preamble: rubric / profile / CV / output contract ]  <- FIRST
 *   [ the job description ]                                              <- LAST
 * Measured on this hardware: a shared prefix placed first gives a ~59% cache hit
 * and ~2.8x faster prefill, and must exceed the engine's attention block (~2,400
 * tokens) or nothing caches at all. The same text placed last caches nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The endpoint is INFRASTRUCTURE, not scoring policy, so it lives in .env rather
// than config/profile.yml. There is deliberately NO default host: an unset
// TJK_SPARK_URL means "no local endpoint configured", and every caller must treat
// that as a no-op. Baking in an address would both publish one machine's network
// layout and silently point every other install at a host that is not theirs.
export const SPARK_URL = (process.env.TJK_SPARK_URL || '').replace(/\/+$/, '');
export const SPARK_MODEL = process.env.TJK_SPARK_MODEL || '';
export const SPARK_CONCURRENCY = Number(process.env.TJK_SPARK_CONCURRENCY || 16);
export const SPARK_MAXTOK = Number(process.env.TJK_SPARK_MAXTOK || 10000);

export function isConfigured() {
  return Boolean(SPARK_URL && SPARK_MODEL);
}

// ---------------------------------------------------------------------------
// Preamble
// ---------------------------------------------------------------------------

// User-layer files (cv.md, modes/_profile.md, article-digest.md) are gitignored
// and absent on a fresh clone. A missing one omits its section rather than
// throwing: a user who has not filled in a CV yet should get a weaker filter, not
// a crash. config/profile.yml missing is different — without it there are no
// thresholds to apply, and buildPreamble's caller checks that separately.
function rd(rel, { required = true } = {}) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (err) {
    if (!required && err && (err.code === 'ENOENT' || err.code === 'EISDIR')) return null;
    throw err;
  }
}

// Only the scoring-relevant sections of the profile. Narrative, outreach,
// integrations, outputs, credentials and candidate are not read by the scoring
// path, and sending them is prefill spend for nothing — which on this hardware is
// a whole-box budget shared with every other request, not a per-call cost.
function profileScoringOnly() {
  const KEEP = ['target_roles', 'location', 'compensation', 'scoring'];
  const raw = (rd('config/profile.yml', { required: false }) || '').split(/\r?\n/);
  const out = [];
  let keeping = false;
  for (const l of raw) {
    if (/^[a-zA-Z_]/.test(l)) keeping = KEEP.includes(l.split(':')[0]);
    if (keeping) out.push(l);
  }
  return out.join('\n');
}

// The output contract. Field names here are consumed verbatim by deriveReportScore,
// so every rename is a breaking change measured in rejected outputs, not in tests.
//
// ceilingBasis is REQUIRED whenever scoreCeiling is set, and that requirement is
// load-bearing: compute-scores.mjs recomputes a comp ceiling from the profile's own
// floor only when the basis declares itself as "comp". Without the field, a model's
// comp cap is taken on trust — which is precisely the inverted-arithmetic defect
// the comp ceiling was moved into code to prevent.
const OUTPUT_CONTRACT = [
  '# Output contract',
  '',
  'You are scoring ONE job description against the rubric above.',
  'Apply the scoreCeiling rules from the evaluation mode exactly as written,',
  'using the thresholds in config/profile.yml above.',
  'Reply with a SINGLE JSON object and nothing else. No prose, no code fence.',
  'Use these field names EXACTLY as given. They are consumed verbatim by code.',
  '',
  '{"schema":"trajecktory-report/v1","company":str,"role":str,',
  ' "summary":{"archetypeDetected":str,"seniority":str,"compStated":str},',
  ' "levelMatch":{"jdLevel":str},',
  ' "globalScore":[{"key":str,"dim":str,"val":num,"max":num,"evidence":str}],',
  ' "scoreCeiling":num|null,"ceilingBasis":str,"ceilingReason":str,"recommendation":str}',
  '',
  '"schema" is that exact literal string.',
  '"val" is the 0-5 rating for that dimension. Name it "val", not "score".',
  '"evidence" is the justification. Name it "evidence", not "why". Max 15 words.',
  '"dim" is a short human label for the dimension.',
  '"summary.compStated" is the pay VERBATIM as the posting states it, including',
  'whether a figure is base or OTE and any currency marker. Empty string if none',
  'is stated. Do not convert, round, or infer it.',
  '"levelMatch.jdLevel" and "summary.seniority" are the level the POSTING sits at,',
  'in its own words (for example "Director", "Senior IC, no people management").',
  'Set "scoreCeiling" to null, "ceilingBasis" to "" and "ceilingReason" to "" when',
  'no blocker applies.',
  '"ceilingBasis" is REQUIRED whenever "scoreCeiling" is a number. It names WHICH',
  'blocker set the cap, as one of exactly: "comp" | "location" | "level" |',
  '"buildDepth" | "requirement" | "visa" | "other". Declare it; do not leave the',
  'reader to infer it from your prose.',
  'Do NOT emit a headline or score field: the code computes the headline from',
  'these dimensions. Use the rubric dimension keys exactly.',
  'Keep the whole object under 700 tokens so it is never cut off. Close every bracket.',
].join('\n');

/**
 * buildPreamble() -> the shared prefix, byte-identical across every call.
 *
 * The full evaluation mode is sent, not a trimmed slice. An earlier trim existed
 * only to fit a 32,768-token window; at a larger window the untrimmed preamble
 * measured better on the same comparison set, and the trim was never shown to be
 * free. If your endpoint's window cannot hold this, raise the window rather than
 * cutting the rubric — cutting it is a scoring change wearing a performance
 * costume.
 */
export function buildPreamble() {
  const parts = [];
  const shared = rd('modes/_shared.md', { required: false });
  if (shared) parts.push(shared);
  const profileMd = rd('modes/_profile.md', { required: false });
  if (profileMd) parts.push(profileMd);
  parts.push(rd('modes/oferta.md'));
  parts.push('# config/profile.yml (scoring-relevant sections)\n\n```yaml\n' + profileScoringOnly() + '\n```');
  const cv = rd('cv.md', { required: false });
  if (cv) parts.push('# Candidate CV\n\n' + cv);
  const digest = rd('article-digest.md', { required: false });
  if (digest) parts.push('# Proof points\n\n' + digest);
  parts.push(OUTPUT_CONTRACT);
  return parts.join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
// Production verdict
// ---------------------------------------------------------------------------

let _verdictDeps = null;
async function verdictDeps() {
  if (_verdictDeps) return _verdictDeps;
  const { deriveReportScore } = await import(pathToFileURL(path.join(ROOT, 'compute-scores.mjs')).href);
  const { loadScoringWeights } = await import(pathToFileURL(path.join(ROOT, 'lib/score.mjs')).href);
  _verdictDeps = { deriveReportScore, cfg: loadScoringWeights(path.join(ROOT, 'config/profile.yml')) };
  return _verdictDeps;
}

/**
 * productionVerdict(text) -> { ok: true, score, data } | { ok: false, reason }
 *
 * Runs the model's raw output through the REAL scoring path, with the pipeline
 * metadata production injects at write time (id/date/url/jdSnapshot) — fields the
 * model is deliberately never asked for, because they are the caller's to own.
 */
export async function productionVerdict(text) {
  const { deriveReportScore, cfg } = await verdictDeps();
  const t = String(text).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s < 0 || e <= s) return { ok: false, reason: 'no-json' };
  let j;
  try { j = JSON.parse(t.slice(s, e + 1)); } catch { return { ok: false, reason: 'bad-json' }; }
  const withMeta = { ...j, id: 0, date: '2026-01-01', url: '', jdSnapshot: '' };
  const md = `---\n${JSON.stringify(withMeta, null, 2)}\n---\n\n## A) Block\n\nbody\n`;
  const r = deriveReportScore(md, cfg);
  return r.ok ? { ok: true, score: r.score, data: j } : { ok: false, reason: r.reason, data: j };
}

// ---------------------------------------------------------------------------
// Endpoint calls
// ---------------------------------------------------------------------------

async function callOnce(preamble, jdText, { signal } = {}) {
  const body = {
    model: SPARK_MODEL,
    messages: [{ role: 'user', content: `${preamble}\n\n---\n\n# Job description to score\n\n${jdText}` }],
    max_tokens: SPARK_MAXTOK,
    temperature: 0,
  };
  const res = await fetch(`${SPARK_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    const err = new Error(`HTTP ${res.status} ${detail}`);
    err.httpStatus = res.status;
    throw err;
  }
  const j = await res.json();
  return {
    text: j.choices?.[0]?.message?.content ?? '',
    finishReason: j.choices?.[0]?.finish_reason ?? null,
    promptTokens: j.usage?.prompt_tokens ?? null,
    completionTokens: j.usage?.completion_tokens ?? null,
  };
}

/**
 * scoreOne(item, { preamble }) -> { id, ok, score?, reason?, raw, ... }
 *
 * Retries ONCE on an unparseable output. The retry is not optimism: temperature is
 * 0, so a second identical call returning the same malformed text tells us the
 * contract is wrong, while a different result tells us it was a sampling artifact.
 * Either way it costs one call and removes a whole class of false negatives.
 *
 * NEVER throws for a model-side problem. A rejected output is data.
 */
export async function scoreOne(item, { preamble }) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    try {
      r = await callOnce(preamble, item.jdText);
    } catch (err) {
      // A transport or HTTP failure is the ENDPOINT's problem, not the posting's.
      return { id: item.id, ok: false, reason: `endpoint: ${err.message}`, endpointError: true };
    }
    const verdict = await productionVerdict(r.text);
    last = {
      id: item.id,
      ok: verdict.ok,
      score: verdict.score,
      reason: verdict.reason,
      data: verdict.data,
      raw: r.text,
      finishReason: r.finishReason,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      retried: attempt > 0,
    };
    if (verdict.ok) return last;
  }
  return last;
}

/**
 * scoreMany(items, { preamble, concurrency, onResult }) -> results in input order.
 *
 * A fixed-size pool, not Promise.all over everything. Prefill on this class of box
 * is a WHOLE-BOX budget that does not grow with concurrency — sixteen parallel
 * calls read their prompts serially and simply queue — so unbounded fan-out buys
 * nothing and risks preemption. Only decode overlaps.
 */
export async function scoreMany(items, { preamble, concurrency = SPARK_CONCURRENCY, onResult = null } = {}) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const k = next++;
      if (k >= items.length) return;
      out[k] = await scoreOne(items[k], { preamble });
      if (onResult) onResult(out[k], k, items.length);
    }
  }));
  return out;
}
