/**
 * lib/spark-compare.mjs — the pure half of spark-compare.mjs: build a labelled
 * comparison set from Claude's own evaluations, and measure how a local model's
 * pre-filter decisions line up against them.
 *
 * WHY THIS EXISTS: the Spark pre-filter's threshold is a certified operating point
 * of ONE model at ONE endpoint (see spark-prefilter.mjs). Swapping the model, say
 * one Qwen generation for the next, invalidates it, and general benchmarks cannot
 * re-certify it because they do not measure this rubric. The only honest question
 * is the one production asks: on postings Claude has already scored, how many
 * strong ones would this model have thrown away, and how many evaluations would it
 * have saved?
 *
 * THE METRIC THAT DECIDES IT is `strongMisses`: postings Claude rated at or above
 * the strong cutoff that the model scored below the threshold. Discarding one of
 * those costs a job; keeping a weak one costs a single evaluation. Correlation and
 * error figures are reported beside it because they explain a result, but a model
 * with a better Spearman and one more strong miss is the worse filter.
 *
 * GROUND TRUTH is Claude's report RE-DERIVED under the current config/profile.yml,
 * not the number stored in the report. The local model's output is derived by the
 * same code under the same config (lib/spark-eval.mjs productionVerdict), so both
 * sides pass through identical ceilings, floors and weights. Comparing a stored
 * headline against a freshly derived one would measure config drift, not the model.
 *
 * No file or network I/O lives here, so every function is unit-tested directly.
 */

// ---------------------------------------------------------------------------
// Seeded sampling
// ---------------------------------------------------------------------------

// Same generator spark-prefilter.mjs uses for its audit sample: a recorded seed
// means the set cannot be quietly re-rolled until it flatters a model.
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(items, seed) {
  const rnd = mulberry32(seed);
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * dedupeBySnapshot(candidates) -> one candidate per JD snapshot, highest id wins.
 *
 * A re-evaluation writes a new report against the same snapshot. Keeping both would
 * score the same prompt twice and count it twice, so the newest report (highest
 * report number, which the monotonic counter guarantees is the latest) stands.
 */
export function dedupeBySnapshot(candidates) {
  const best = new Map();
  for (const c of candidates) {
    const prev = best.get(c.jdSnapshot);
    if (!prev || Number(c.reportId) > Number(prev.reportId)) best.set(c.jdSnapshot, c);
  }
  return [...best.values()];
}

/**
 * stratifiedSample(candidates, { size, strong, seed, strongShare }) -> { items, strata }
 *
 * Strong postings are rare in a real queue, and a set drawn at the natural rate can
 * hold two or three of them, which cannot tell one model from another on the only
 * metric that matters. So the strong stratum is oversampled up to `strongShare` of
 * the set (all of it, if there are fewer), and the rest is filled from the others.
 *
 * Oversampling distorts any rate computed over the set, so every item carries its
 * stratum's population weight (population / sampled). Rates meant to describe the
 * real queue, like "share of evaluations saved", are computed with those weights.
 * Counts, like strong misses, are reported raw: each one is a specific posting.
 */
export function stratifiedSample(candidates, { size = 120, strong = 4.0, seed = 1, strongShare = 0.4 } = {}) {
  const hi = candidates.filter((c) => c.claudeScore >= strong);
  const lo = candidates.filter((c) => c.claudeScore < strong);
  const nHi = Math.min(hi.length, Math.max(0, Math.round(size * strongShare)));
  const nLo = Math.min(lo.length, Math.max(0, size - nHi));
  // If the weak stratum ran short, give the leftover slots back to the strong one.
  const nHi2 = Math.min(hi.length, nHi + (size - nHi - nLo));
  const pickHi = seededShuffle(hi, seed).slice(0, nHi2);
  const pickLo = seededShuffle(lo, seed + 1).slice(0, nLo);
  const wHi = pickHi.length ? hi.length / pickHi.length : 0;
  const wLo = pickLo.length ? lo.length / pickLo.length : 0;
  const items = [
    ...pickHi.map((c) => ({ ...c, stratum: 'strong', weight: wHi })),
    ...pickLo.map((c) => ({ ...c, stratum: 'other', weight: wLo })),
  ].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    items,
    strata: {
      strong: { population: hi.length, sampled: pickHi.length, weight: wHi },
      other: { population: lo.length, sampled: pickLo.length, weight: wLo },
    },
  };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2 || ys.length !== n) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// Average ranks for ties. Scores here are on a 0.1 grid, so ties are the norm, and
// ordinal ranks would make the coefficient depend on input order.
export function rankAvg(xs) {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

export function spearman(xs, ys) {
  if (xs.length < 2 || ys.length !== xs.length) return null;
  return pearson(rankAvg(xs), rankAvg(ys));
}

// ---------------------------------------------------------------------------
// Decisions at a threshold
// ---------------------------------------------------------------------------

/**
 * joinRun(setItems, runResults) -> rows of { id, claudeScore, weight, stratum, ok, score, ... }
 *
 * Joined by set item id. An item the run never reached, or reached with an endpoint
 * error, is `missing`: it says nothing about the model and is excluded from every
 * metric, but counted so an incomplete run cannot pass for a finished one.
 */
export function joinRun(setItems, runResults) {
  const byId = new Map((runResults || []).map((r) => [r.id, r]));
  return setItems.map((s) => {
    const r = byId.get(s.id);
    if (!r || r.endpointError) return { ...s, missing: true, ok: false };
    return {
      ...s, missing: false, ok: Boolean(r.ok && Number.isFinite(r.score)),
      score: r.score, reason: r.reason, ms: r.ms,
      promptTokens: r.promptTokens, completionTokens: r.completionTokens,
      retried: r.retried, finishReason: r.finishReason,
    };
  });
}

/**
 * decide(rows, t) -> per-threshold outcome.
 *
 * Mirrors splitAtThreshold in spark-prefilter.mjs exactly: a score EQUAL to the
 * threshold survives, and anything without a finite score is unfiltered (kept),
 * never discarded. A comparison that treated an unparseable output as a discard
 * would reward the model that fails most.
 */
export function decide(rows, t, strong) {
  const scored = rows.filter((r) => !r.missing);
  const discarded = scored.filter((r) => r.ok && r.score < t);
  const strongMisses = discarded.filter((r) => r.claudeScore >= strong);
  const weightAll = scored.reduce((a, r) => a + (r.weight || 1), 0);
  const weightDiscarded = discarded.reduce((a, r) => a + (r.weight || 1), 0);
  return {
    t,
    discarded: discarded.length,
    strongMisses: strongMisses.length,
    strongMissIds: strongMisses.map((r) => r.id),
    // Weighted back to the population, so oversampling the strong stratum does not
    // understate how much of the real queue the filter removes.
    savedShare: weightAll ? weightDiscarded / weightAll : 0,
  };
}

// Thresholds on the 0.1 grid scores live on. Rounded so 2.0000000004 never appears.
export function thresholdGrid(lo = 1.0, hi = 4.0, step = 0.1) {
  const out = [];
  for (let k = Math.round(lo / step); k <= Math.round(hi / step); k++) out.push(Math.round(k * step * 10) / 10);
  return out;
}

/**
 * safeThreshold(rows, strong, grid) -> the highest threshold with ZERO strong
 * misses, and what it saves. Null if even the lowest grid point drops one.
 *
 * This is the fairest single head-to-head number: each model at its own best safe
 * operating point, rather than both at a threshold certified for only one of them.
 * It is optimistic by construction (chosen after seeing the answers), so it is a
 * ceiling on what the model can do, and any threshold adopted from it still needs
 * the holdback to confirm it on postings the set never saw.
 */
export function safeThreshold(rows, strong, grid = thresholdGrid()) {
  let best = null;
  for (const t of grid) {
    const d = decide(rows, t, strong);
    if (d.strongMisses === 0) best = d;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Run summary and head-to-head
// ---------------------------------------------------------------------------

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function percentile(xs, p) {
  if (!xs.length) return null;
  const a = xs.slice().sort((x, y) => x - y);
  const k = Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1));
  return a[k];
}

/**
 * summarizeRun(rows, { threshold, strong, wallSeconds }) -> every figure the report prints.
 */
export function summarizeRun(rows, { threshold, strong, wallSeconds = null } = {}) {
  const present = rows.filter((r) => !r.missing);
  const ok = present.filter((r) => r.ok);
  const xs = ok.map((r) => r.claudeScore);
  const ys = ok.map((r) => r.score);
  const diffs = ok.map((r) => r.score - r.claudeScore);
  const strongRows = ok.filter((r) => r.claudeScore >= strong);
  return {
    n: rows.length,
    missing: rows.length - present.length,
    parsed: ok.length,
    unparseable: present.length - ok.length,
    retried: present.filter((r) => r.retried).length,
    spearman: spearman(xs, ys),
    pearson: pearson(xs, ys),
    mae: diffs.length ? mean(diffs.map(Math.abs)) : null,
    bias: diffs.length ? mean(diffs) : null,
    // How low does the model score the postings Claude liked? The minimum is the
    // number that sets how high a safe threshold can go.
    strongMin: strongRows.length ? Math.min(...strongRows.map((r) => r.score)) : null,
    strongCount: strongRows.length,
    atThreshold: decide(rows, threshold, strong),
    safe: safeThreshold(rows, strong),
    msP50: percentile(present.map((r) => r.ms).filter(Number.isFinite), 50),
    msP90: percentile(present.map((r) => r.ms).filter(Number.isFinite), 90),
    completionTokensMean: mean(present.map((r) => r.completionTokens).filter(Number.isFinite)),
    promptTokensMean: mean(present.map((r) => r.promptTokens).filter(Number.isFinite)),
    wallSeconds,
    perMinute: wallSeconds ? (present.length / wallSeconds) * 60 : null,
  };
}

/**
 * headToHead(rowsA, rowsB, t, strong) -> where two models' decisions disagree.
 *
 * Paired on the same postings, so it isolates the model: same JD, same prompt,
 * same threshold. `onlyA` are strong postings A discarded and B kept.
 */
export function headToHead(rowsA, rowsB, t, strong) {
  const b = new Map(rowsB.map((r) => [r.id, r]));
  const out = { bothKept: 0, bothDiscarded: 0, onlyADiscarded: 0, onlyBDiscarded: 0, strongOnlyA: [], strongOnlyB: [], compared: 0 };
  for (const ra of rowsA) {
    const rb = b.get(ra.id);
    if (!rb || ra.missing || rb.missing) continue;
    out.compared++;
    const da = ra.ok && ra.score < t;
    const db = rb.ok && rb.score < t;
    if (da && db) out.bothDiscarded++;
    else if (!da && !db) out.bothKept++;
    else if (da) { out.onlyADiscarded++; if (ra.claudeScore >= strong) out.strongOnlyA.push(ra.id); }
    else { out.onlyBDiscarded++; if (rb.claudeScore >= strong) out.strongOnlyB.push(rb.id); }
  }
  return out;
}
