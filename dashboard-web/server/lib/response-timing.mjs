import { parseApplicationsMd } from './applications.mjs';
import { weekStartOf } from './activity.mjs';
import { readApplyDates, parseStatusEvents } from './sidecars.mjs';
import {
  FUNNEL_ORDER,
  RESPONSE_DECISION_BUCKETS,
  makeApplyAnchor,
  makeFurthestIdx,
} from './statuses.mjs';

const DAY_MS = 86400000;
const pct = (numerator, denominator) => denominator
  ? Math.round((numerator / denominator) * 1000) / 10
  : null;

function toYmd(today) {
  if (typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today)) return today;
  const date = today instanceof Date ? today : new Date(today);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
  return Number.isFinite(days) ? days : null;
}

function decisionBucket(status) {
  if (RESPONSE_DECISION_BUCKETS.employerNo.has(status)) return 'employerNo';
  if (RESPONSE_DECISION_BUCKETS.advance.has(status)) return 'advance';
  if (RESPONSE_DECISION_BUCKETS.candidateSide.has(status)) return 'candidateSide';
  return null;
}

export function responseProgressStats({
  apps = [],
  applyDates = {},
  events = [],
  today = new Date(),
  windows = [14, 30],
  fastDays = 3,
} = {}) {
  const todayYmd = toYmd(today);
  if (!todayYmd) throw new Error('today must be a valid date');

  const cleanWindows = [...new Set(windows.filter(Number.isFinite))].sort((a, b) => a - b);
  const applyAnchor = makeApplyAnchor({ applyDates, events });
  const { furthestIdx } = makeFurthestIdx(events);
  // Responded is no longer a stage: a row counts as decided when it reached a
  // screen or later (or carries a terminal decision status, handled below).
  const screenIdx = FUNNEL_ORDER.indexOf('Phone Screen');
  let preAnchorDropped = 0;

  const records = [];
  let closedExcluded = 0;
  let noAnchor = 0;
  const anchorSources = { both: 0, event: 0, applyDate: 0, rowDate: 0 };

  for (const app of apps) {
    if (app.status === 'Closed') {
      closedExcluded++;
      continue;
    }
    const anchor = applyAnchor(app);
    if (!anchor.date) {
      noAnchor++;
      continue;
    }
    const sourceKey = anchor.source === 'apply-date' ? 'applyDate'
      : anchor.source === 'row-date' ? 'rowDate'
      : anchor.source;
    anchorSources[sourceKey]++;

    let firstDecision = null;
    for (const event of events) {
      if (String(event.app) !== String(app.id)) continue;
      const bucket = decisionBucket(event.status);
      if (!bucket) continue;
      const elapsed = daysBetween(anchor.date, event.date);
      if (elapsed == null) continue;
      if (elapsed < 0) {
        preAnchorDropped++;
        continue;
      }
      if (!firstDecision || event.date < firstDecision.date) {
        firstDecision = { date: event.date, days: elapsed, bucket };
      }
    }
    const stampedIdx = FUNNEL_ORDER.indexOf(app.reached);
    const reachedIdx = Math.max(furthestIdx(app), stampedIdx);
    const rowDecision = decisionBucket(app.status) !== null || reachedIdx >= screenIdx;
    records.push({
      app,
      anchor,
      age: daysBetween(anchor.date, todayYmd),
      decision: firstDecision,
      rowDecision,
      week: weekStartOf(anchor.date),
    });
  }

  const silence = {};
  for (const window of cleanWindows) {
    let eligible = 0;
    let silent = 0;
    let undated = 0;
    for (const record of records) {
      if (record.age == null || record.age < window) continue;
      if (!record.decision && record.rowDecision) {
        undated++;
        continue;
      }
      eligible++;
      if (!record.decision || record.decision.days > window) silent++;
    }
    silence[String(window)] = { eligible, silent, pct: pct(silent, eligible), undated };
  }

  let fastEligible = 0;
  let decidedFast = 0;
  let fastUndated = 0;
  const composition = { employerNo: 0, advance: 0, candidateSide: 0 };
  for (const record of records) {
    if (record.age == null || record.age < fastDays) continue;
    if (!record.decision && record.rowDecision) {
      fastUndated++;
      continue;
    }
    fastEligible++;
    if (record.decision && record.decision.days <= fastDays) {
      decidedFast++;
      composition[record.decision.bucket]++;
    }
  }

  const cohortsByWeek = new Map();
  for (const record of records) {
    if (!record.week) continue;
    const cohort = cohortsByWeek.get(record.week) || {
      week: record.week,
      sent: 0,
      silent14: 0,
      silent30: 0,
      decidedFast: 0,
      undated: 0,
      silence14Eligible: 0,
      silence30Eligible: 0,
      fastEligible: 0,
    };
    cohort.sent++;
    const undatedDecision = !record.decision && record.rowDecision;
    if (undatedDecision) cohort.undated++;

    for (const window of cleanWindows) {
      if (record.age == null || record.age < window || undatedDecision) continue;
      const eligibleKey = window === 14 ? 'silence14Eligible' : window === 30 ? 'silence30Eligible' : null;
      const silentKey = window === 14 ? 'silent14' : window === 30 ? 'silent30' : null;
      if (!eligibleKey) continue;
      cohort[eligibleKey]++;
      if (!record.decision || record.decision.days > window) cohort[silentKey]++;
    }
    if (record.age != null && record.age >= fastDays && !undatedDecision) {
      cohort.fastEligible++;
      if (record.decision && record.decision.days <= fastDays) cohort.decidedFast++;
    }
    cohortsByWeek.set(record.week, cohort);
  }

  const cohorts = [...cohortsByWeek.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map((cohort) => ({
      week: cohort.week,
      sent: cohort.sent,
      silent14: cohort.silent14,
      silent30: cohort.silent30,
      decidedFast: cohort.decidedFast,
      undated: cohort.undated,
      silent14Pct: pct(cohort.silent14, cohort.silence14Eligible),
      silent30Pct: pct(cohort.silent30, cohort.silence30Eligible),
      decidedFastPct: pct(cohort.decidedFast, cohort.fastEligible),
    }));

  return {
    today: todayYmd,
    fastDays,
    population: { n: records.length, closedExcluded, noAnchor, preAnchorDropped },
    silence,
    fastDecision: {
      eligible: fastEligible,
      decided: decidedFast,
      pct: pct(decidedFast, fastEligible),
      undated: fastUndated,
      composition,
    },
    cohorts,
    anchorSources,
  };
}

export function readResponseProgressStats() {
  return responseProgressStats({
    apps: parseApplicationsMd(),
    applyDates: readApplyDates(),
    events: parseStatusEvents(),
    today: new Date(),
  });
}
