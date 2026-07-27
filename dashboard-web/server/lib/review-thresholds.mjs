/**
 * lib/review-thresholds.mjs — the single home for the weekly-review floors and
 * the kill criteria. Deterministic, NO LLM: the numbers and the pass/fail live
 * here so the review CLI and the dashboard tracking view read exactly one source.
 * Floors and kill criteria are from the relaunch plan.
 *
 * The build-cap gate is NOT here anymore. It used to be a weekly lock (two
 * consecutive missed weeks), which retired in favour of the live rolling floor
 * (lib/rolling-floor.mjs): a trailing-5-working-day gate with no calendar-week
 * boundary to game. The floors below are still the weekly leading-indicator
 * DISPLAY; they no longer decide whether the build is locked.
 *
 * A design rule that matters: a metric that is NOT LOGGED is judged `null`
 * (unknown), never a pass and never a fail. Missing manual data reads not-logged,
 * not zero, so a week with no data entered cannot silently "pass" a floor or
 * trip the build lock.
 */

// The three floors with teeth. Applications are deliberately uncapped; the WIP
// limit (unserviced applications) governs volume instead of a cap.
export const FLOORS = {
  verifiedTouches:  { min: 13, label: 'Verified touches sent',   unit: '' },
  linkedinConnects: { min: 50, label: 'LinkedIn connects sent',  unit: '' },
  cadencePct:       { min: 70, label: 'Cadence adherence',       unit: '%' },
};

// The WIP gauge that replaces the old application cap.
export const WIP = { unservicedApplications: { max: 20, label: 'Unserviced applications' } };

// Kill criteria (checkpoints). The numeric ones are checkable here; the
// qualitative one (is tenure the objection theme?) is surfaced for a human to
// judge, never auto-decided.
export const KILL = {
  messageWrong:   { windowWeeks: 3, minTouches: 40, minDeliveredReplyRatePct: 8,
    note: 'After 40 verified touches over 3 weeks, a delivered reply rate under 8% means the message is wrong, not the channel. Fix the message before sending more.' },
  outboundInert:  { minReplies: 10,
    note: 'If 10+ replies produce 0 screens, outbound warm is not behaving like inbound warm. Pivot to inbound generation.' },
  wrongDiagnosis: { minObjections: 6,
    note: 'If 6 screen objections come back and tenure is NOT the theme, the resume identity work solved the wrong problem. Stop and re-diagnose.' },
};

// The outreach floor key: the metric the live rolling floor gates the build cap
// on (see lib/rolling-floor.mjs). Still marked per-week in the review history so
// the week-over-week view can show it; it no longer drives a lock.
export const OUTREACH_FLOOR_KEY = 'verifiedTouches';

// Evaluate the three floors against a weekly-metrics object. Each metric is
// { value, available }. `met` is true/false when available, `null` when not.
export function evaluateFloors(metrics) {
  const results = Object.keys(FLOORS).map((key) => {
    const f = FLOORS[key];
    const m = (metrics && metrics[key]) || {};
    if (!m.available) return { key, label: f.label, value: null, floor: f.min, unit: f.unit, met: null, available: false };
    const met = Number(m.value) >= f.min;
    return { key, label: f.label, value: m.value, floor: f.min, unit: f.unit, met, available: true };
  });
  return {
    results,
    missed:    results.filter(r => r.met === false).map(r => r.key),
    notLogged: results.filter(r => r.available === false).map(r => r.key),
    allMet:    results.every(r => r.met === true),
  };
}

// The weekly build-lock decision (two consecutive missed weeks) lived here and
// was retired: the build cap is now the live rolling floor (lib/rolling-floor.mjs),
// which has no calendar-week boundary to game. The rolling floor still governs
// IMPROVEMENT only; repair, data integrity, live-process work, and sub-30-minute
// unblocks stay allowed (surfaced by the Review card, not enforced in code).
