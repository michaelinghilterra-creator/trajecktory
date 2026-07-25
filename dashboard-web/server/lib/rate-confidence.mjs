/**
 * lib/rate-confidence.mjs — sample-size gate + confidence interval for the reply
 * and response rates the Insights engine reports.
 *
 * This is the "stop manufacturing false confidence" work from the relaunch plan,
 * applied to rates: a percentage computed from a handful of applications is noise,
 * and a bare point estimate ("0%", "29%") hides that it is noise. Two guards:
 *
 *   1. A minimum-sample GATE. Below MIN_SAMPLE the rate is not reported as a
 *      number at all — `sufficient:false` tells the UI to show "not enough data"
 *      instead of a confident percent. This is the same philosophy weekly-metrics
 *      already uses (available:false reads "insufficient", never zero).
 *   2. A confidence RANGE. At or above the gate the rate carries a 95% interval,
 *      so a wide band on a thin-but-passing sample reads as "roughly this, but we
 *      can't be precise" rather than a hard figure.
 *
 * Pure and dependency-free, so it is unit tested with no files or network.
 */

// The gate. 10 applications is the floor below which a response rate says nothing
// useful; the relaunch plan set it deliberately strict so per-cohort cuts
// (archetype, sector, channel) that lack the volume read "insufficient data"
// rather than inviting a decision off three data points — the exact error that
// cost the Sales Development track in June.
export const MIN_SAMPLE = 10;

// Wilson score interval for a binomial proportion. Preferred over the normal
// (Wald) approximation because it stays inside [0,1] and behaves at the extremes
// (0 of n, n of n) and at small n — which is this entire dataset. `z` defaults to
// 1.96 (95%). Returns integer percents for the point estimate and both bounds.
export function wilson(k, n, z = 1.96) {
  if (!n) return { rate: 0, lo: 0, hi: 0 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom;
  const clampPct = (x) => Math.round(Math.max(0, Math.min(1, x)) * 100);
  return { rate: Math.round(p * 100), lo: clampPct(center - margin), hi: clampPct(center + margin) };
}

// The honest rate object every cohort should carry to the UI. `sufficient:false`
// means "too few to report" and callers MUST render that state rather than the
// percent. `k` of `n` are always exposed so the UI can show the raw fraction,
// which is the most honest thing to show when the rate itself is withheld.
export function rateStat(k, n, minSample = MIN_SAMPLE) {
  const { rate, lo, hi } = wilson(k, n);
  return { k, n, rate, lo, hi, sufficient: n >= minSample };
}
