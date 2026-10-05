// The metrics core (Definitions v1.2): every dashboard number is computed here, from data the caller has
// already loaded, so each tab shows the same value for the same metric. Pure: nothing here reads a file or
// the clock; the caller passes `today` as a local (Central) YYYY-MM-DD date.
//
// The application list is the TWC one (dashboard-web/server/lib/twc.mjs buildActivities): evidence dated,
// same day voids and repeat applications to one posting left out. So a count here always matches the export.
// Interviews count only when held with evidence (the interview record's `counted` state, Definitions v1.1).

import { LADDER, INTERVIEW_STAGES } from '../definitions.mjs';
import { weekOf, recentWeeks } from '../weekly-review.mjs';
import { wilson } from '../../dashboard-web/server/lib/rate-confidence.mjs';
import { DEFINITIONS_VERSION, MIN_RATE_SAMPLE, MATURE_DAYS } from './dictionary.mjs';

const DAY_MS = 86400000;
const PHONE_SCREEN = LADDER.indexOf('Phone Screen');
const OFFER = LADDER.indexOf('Offer');
const LATER_INTERVIEWS = new Set(INTERVIEW_STAGES.filter(stage => stage !== 'Phone Screen'));

const isYmd = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const dayNumber = ymd => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / DAY_MS;

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from, to) {
  return Math.round(dayNumber(to) - dayNumber(from));
}

/**
 * A rate the UI can show honestly: k of n always, the percent and 95% Wilson band only once n reaches the
 * minimum sample. `pct` is null (never 0) when n is 0.
 */
export function rate(k, n, minSample = MIN_RATE_SAMPLE) {
  if (!n) return { k: 0, n: 0, pct: null, lo: null, hi: null, sufficient: false };
  const { rate: pct, lo, hi } = wilson(k, n);
  return { k, n, pct, lo, hi, sufficient: n >= minSample };
}

// How far one application got: 0 nothing heard, 1 heard back, 2 phone screen held, 3 later interview held,
// 4 offer. Each rung includes every rung below it, so funnel counts can only fall.
function outcomeFor(app, replies, records) {
  const reachedIdx = app ? LADDER.indexOf(app.reached) : -1;
  const counted = records.filter(record => record.state === 'counted');
  const offer = reachedIdx >= OFFER;
  const laterHeld = counted.some(record => LATER_INTERVIEWS.has(record.stage));
  const screenHeld = counted.length > 0;
  const heard = replies.length > 0 || records.length > 0 || reachedIdx >= PHONE_SCREEN || app?.status === 'Rejected';
  const level = offer ? 4 : laterHeld ? 3 : screenHeld ? 2 : heard ? 1 : 0;
  const positive = level >= 2 || records.length > 0 || reachedIdx >= PHONE_SCREEN
    || replies.some(reply => reply.sentiment === 'positive');
  return { level, positive };
}

/**
 * One row per application in the TWC list, joined to its tracker row, logged human replies and interview
 * records: { appId, date, level, positive, warm, referral, archetype, source }.
 */
export function applicationOutcomes({ activities = [], apps = [], replies = {}, interviews = [] }) {
  const appById = new Map(apps.map(app => [String(app.id), app]));
  const recordsByApp = new Map();
  for (const record of interviews) {
    const key = String(record.appId);
    if (!recordsByApp.has(key)) recordsByApp.set(key, []);
    recordsByApp.get(key).push(record);
  }
  const seen = new Set();
  const out = [];
  for (const activity of activities) {
    if (activity.kind !== 'application' || !isYmd(activity.date)) continue;
    // A TWC correction can add an application that has no tracker row. It counts in weekly totals, but with no
    // row there is no way to know what came of it, so it is left out of every rate (see unlinkedApplications).
    if (activity.appId === undefined || activity.appId === null || activity.appId === '') continue;
    const appId = String(activity.appId);
    if (seen.has(appId)) continue;
    seen.add(appId);
    const app = appById.get(appId);
    const { level, positive } = outcomeFor(app, replies[appId] || [], recordsByApp.get(appId) || []);
    out.push({
      appId,
      date: activity.date,
      level,
      positive,
      warm: app?.warm === true,
      referral: app?.referral === true,
      archetype: app?.archetype || 'Unclassified',
      source: app?.source || 'Unknown',
    });
  }
  return out;
}

const countWhere = (rows, predicate) => rows.filter(predicate).length;

function rateOver(rows, predicate) {
  return rate(countWhere(rows, predicate), rows.length);
}

/** Groups of `key` with at least `minN` applications, largest first; the rest are summed into `small`. */
export function segments(outcomes, key, minN = MIN_RATE_SAMPLE) {
  const groups = new Map();
  for (const row of outcomes) {
    const name = row[key];
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  const rows = [];
  const small = { groups: 0, n: 0 };
  for (const [name, members] of groups) {
    if (members.length < minN) {
      small.groups += 1;
      small.n += members.length;
      continue;
    }
    rows.push({
      key: name,
      n: members.length,
      response: rateOver(members, row => row.level >= 1),
      interview: rateOver(members, row => row.level >= 2),
    });
  }
  rows.sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key)));
  return { rows, small };
}

/**
 * Score bands half a point wide from 1.0 to 5.0 (5.0 lands in the top band). `applied` counts rows in the
 * application list. The applied average uses one scorer version only, the most common among applied rows,
 * so a rescoring cannot make it drift.
 */
export function scoreBands(apps, appliedIds) {
  const bands = [];
  for (let lo = 1; lo < 5; lo += 0.5) bands.push({ lo, hi: lo + 0.5, total: 0, applied: 0 });
  let unscored = 0;
  const appliedScored = [];
  for (const app of apps) {
    const score = Number(app.score);
    if (app.score === null || app.score === undefined || app.score === '' || !Number.isFinite(score) || score < 1 || score > 5) {
      unscored += 1;
      continue;
    }
    const band = bands[Math.min(bands.length - 1, Math.floor((score - 1) / 0.5))];
    band.total += 1;
    if (appliedIds.has(String(app.id))) {
      band.applied += 1;
      appliedScored.push({ score, version: app.scorerVersion || null });
    }
  }
  const byVersion = new Map();
  for (const row of appliedScored) byVersion.set(row.version, (byVersion.get(row.version) || 0) + 1);
  // Scores made by a scorer version beat 'authored' (model-written) and unknown ones, even when those are more
  // numerous: the average is meant to compare like with like. With no stamped version at all, the majority wins.
  const stamped = [...byVersion.keys()].filter(v => v !== null && v !== 'authored');
  let version = null;
  let best = -1;
  for (const [v, n] of byVersion) {
    if (stamped.length && !stamped.includes(v)) continue;
    if (n > best) { version = v; best = n; }
  }
  const sameVersion = appliedScored.filter(row => row.version === version);
  const avg = sameVersion.length ? Math.round((sameVersion.reduce((sum, row) => sum + row.score, 0) / sameVersion.length) * 100) / 100 : null;
  return { bands, unscored, appliedAvg: { value: avg, n: sameVersion.length, version } };
}

/**
 * Human reply rate per channel over people contacted. Each contact is { channel: 'email' | 'linkedin',
 * touched, replied, bounced }. A bounced email contact was never reached, so it leaves the email denominator.
 */
export function outreachReplyRate(contacts = []) {
  const out = {};
  for (const channel of ['email', 'linkedin']) {
    const reached = contacts.filter(c => c.channel === channel && c.touched && !(channel === 'email' && c.bounced));
    out[channel] = rateOver(reached, c => c.replied === true);
  }
  return out;
}

const inRange = (date, week) => isYmd(date) && date >= week.from && date <= week.to;

function weekCounts(activities, interviews, week) {
  const count = kind => countWhere(activities, a => a.kind === kind && inRange(a.date, week));
  return {
    applications: count('application'),
    followups: count('followup'),
    linkedin: count('outreach'),
    screensHeld: countWhere(interviews, r => r.state === 'counted' && inRange(r.held_on, week)),
  };
}

/**
 * Everything the Overview and Analytics read. Inputs:
 *   today        local YYYY-MM-DD
 *   activities   TWC activities ({ kind, date, appId })
 *   apps         tracker rows ({ id, status, reached, score, scorerVersion, warm, referral, archetype, source })
 *   replies      { [appId]: [{ sent_on, sentiment }] } logged human replies only
 *   interviews   [{ appId, stage, state, held_on, scheduled_for }] with state from interviewState
 *   unserviced   { available, count }
 *   contacts     outreach contacts for outreachReplyRate
 */
export function computeCoreMetrics({ today, activities = [], apps = [], replies = {}, interviews = [], unserviced = { available: false, count: null }, contacts = [], weeks = 8 }) {
  if (!isYmd(today)) throw new TypeError('today must be a YYYY-MM-DD date');
  const week = weekOf(today);
  const outcomes = applicationOutcomes({ activities, apps, replies, interviews });
  const mature = outcomes.filter(row => daysBetween(row.date, today) >= MATURE_DAYS);
  const warm = outcomes.filter(row => row.warm);
  const notWarm = outcomes.filter(row => !row.warm);
  const responded = row => row.level >= 1;
  const screened = row => row.level >= 2;

  const current = weekCounts(activities, interviews, week);
  const unconfirmed = countWhere(interviews, r => r.state === 'unconfirmed' && inRange(r.held_on || r.scheduled_for, week));

  const rungs = [
    { id: 'applications', label: 'Applications', level: 0 },
    { id: 'responded', label: 'Heard back', level: 1 },
    { id: 'screen_held', label: 'Phone screen held', level: 2 },
    { id: 'interview_held', label: 'Interview held', level: 3 },
    { id: 'offer', label: 'Offer', level: 4 },
  ];
  const funnel = rungs.map(rung => ({ ...rung, n: countWhere(outcomes, row => row.level >= rung.level) }));
  funnel.forEach((rung, i) => {
    const prev = i === 0 ? null : funnel[i - 1].n;
    rung.ofPrev = prev ? Math.round((rung.n / prev) * 100) : null;
    rung.ofFirst = funnel[0].n ? Math.round((rung.n / funnel[0].n) * 100) : null;
  });

  const trend = recentWeeks(today, weeks).map(w => {
    const cohort = outcomes.filter(row => inRange(row.date, w));
    const ageDays = Math.max(0, daysBetween(w.to, today));
    return {
      from: w.from,
      to: w.to,
      ...weekCounts(activities, interviews, w),
      cohort: {
        n: cohort.length,
        responded: countWhere(cohort, responded),
        screened: countWhere(cohort, screened),
        ageDays,
        mature: ageDays >= MATURE_DAYS,
      },
    };
  });

  const appliedIds = new Set(outcomes.map(row => row.appId));
  const unlinkedApplications = countWhere(activities, a => a.kind === 'application' && isYmd(a.date)
    && (a.appId === undefined || a.appId === null || a.appId === ''));

  return {
    version: DEFINITIONS_VERSION,
    today,
    week,
    ratedApplications: outcomes.length,
    unlinkedApplications,
    thisWeek: {
      ...current,
      screensUnconfirmed: unconfirmed,
      unserviced: unserviced && unserviced.available ? { available: true, count: unserviced.count } : { available: false, count: null },
    },
    results: {
      response: { all: rateOver(outcomes, responded), mature: rateOver(mature, responded), warm: rateOver(warm, responded), notWarm: rateOver(notWarm, responded) },
      positive: { all: rateOver(outcomes, row => row.positive), mature: rateOver(mature, row => row.positive) },
      interview: { all: rateOver(outcomes, screened), mature: rateOver(mature, screened), warm: rateOver(warm, screened), notWarm: rateOver(notWarm, screened) },
      referral: { all: rateOver(outcomes, row => row.referral) },
      outreach: outreachReplyRate(contacts),
    },
    funnel,
    weeks: trend,
    scoreBands: scoreBands(apps, appliedIds),
    segments: { archetype: segments(outcomes, 'archetype'), source: segments(outcomes, 'source') },
  };
}
