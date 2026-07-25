/**
 * lib/activity.mjs — actions over time, and application cohorts.
 *
 * WHY THIS EXISTS
 * The Overview's activity band plotted rows ENTERING THE TRACKER, which is what
 * the scanner produces. That line rises on a day the user does nothing at all,
 * because a scheduled scan added forty rows, and it does not move on a day they
 * send ten applications by hand. A chart whose slope is set by a cron job cannot
 * tell you whether you worked.
 *
 * So this counts ACTIONS: things the user did. Today that is applications, dated
 * from data/apply-dates.json. Verified touches and LinkedIn connects are declared
 * here with empty series rather than omitted, because the difference between "you
 * sent none" and "nothing is logging this yet" is exactly the distinction the
 * weekly metrics already protect with `available`. Their logs start filling from
 * the first week of the search motion; until then they must read as unlogged, not
 * as zero.
 *
 * COHORTS
 * Every other view here is a snapshot: it tells you where the pipeline stands, not
 * whether a change you made worked. A cohort answers "of the applications I sent
 * in week N, what became of them", which is the only shape that can compare one
 * week's approach against another's. Cohorts are keyed by the week the application
 * was SENT, not the week the row was created, because those differ by up to months
 * on re-evaluated rows.
 *
 * Pure apart from the two sidecar reads, so it is unit-testable.
 */
import { readApplyDates } from './sidecars.mjs';
import { parseApplicationsMd } from './applications.mjs';
import { FUNNEL_ORDER } from './statuses.mjs';

// ISO week start (Monday) for a YYYY-MM-DD string, returned as YYYY-MM-DD.
// Parsed as UTC deliberately: a local-time parse shifts a date-only string across
// a week boundary for anyone west of UTC, which silently moves Sunday's work into
// the previous cohort.
export function weekStartOf(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const dow = d.getUTCDay();            // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1; // Monday-based
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Daily action counts over the last `days`, plus the two series that are not
 * logging yet. Shape mirrors the weekly metrics: every series carries `available`
 * so the UI can render "not logged" instead of a flat zero line.
 */
export function actionSeries({ days = 60, today = new Date() } = {}) {
  const applyDates = readApplyDates();
  const end = today.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10);

  const counts = new Map();
  let dated = 0;
  for (const v of Object.values(applyDates)) {
    const ymd = typeof v === 'string' ? v : (v && v.date);
    if (!isYmd(ymd)) continue;
    dated++;
    if (ymd < start || ymd > end) continue;
    counts.set(ymd, (counts.get(ymd) || 0) + 1);
  }

  const points = [];
  for (let i = 0; i < days; i++) {
    const ymd = new Date(new Date(`${start}T00:00:00Z`).getTime() + i * 86400000).toISOString().slice(0, 10);
    points.push({ date: ymd, value: counts.get(ymd) || 0 });
  }

  return {
    start, end, days,
    series: [
      {
        key: 'applications', label: 'Applications sent', available: dated > 0,
        source: 'data/apply-dates.json', total: points.reduce((a, p) => a + p.value, 0), points,
      },
      // Declared, not omitted. An absent series reads as "this does not exist";
      // an empty one with available:false reads as "this has not started", which
      // is the truth from now until the first week of the motion.
      { key: 'touches',  label: 'Verified touches', available: false, source: 'starts with the outreach motion', total: 0, points: [] },
      { key: 'connects', label: 'LinkedIn connects', available: false, source: 'no connects log yet', total: 0, points: [] },
    ],
  };
}

/**
 * Application cohorts by send-week. Each cohort reports how many of that week's
 * applications ever reached each rung, so a later week can be compared to an
 * earlier one on equal terms.
 */
export function applicationCohorts({ weeks = 8, today = new Date() } = {}) {
  const applyDates = readApplyDates();
  const apps = parseApplicationsMd();
  const byId = new Map(apps.map(a => [a.id, a]));
  const iApplied = FUNNEL_ORDER.indexOf('Applied');
  const iResponded = FUNNEL_ORDER.indexOf('Responded');
  const iScreen = FUNNEL_ORDER.indexOf('Phone Screen');

  const cohorts = new Map();
  for (const [id, v] of Object.entries(applyDates)) {
    const ymd = typeof v === 'string' ? v : (v && v.date);
    if (!isYmd(ymd)) continue;
    const wk = weekStartOf(ymd);
    if (!wk) continue;
    const row = byId.get(Number(id));
    const idx = row ? FUNNEL_ORDER.indexOf(row.reached) : -1;
    const c = cohorts.get(wk) || { week: wk, sent: 0, replied: 0, screened: 0, orphaned: 0 };
    c.sent++;
    // An apply date with no tracker row is a real condition, not a parse failure:
    // rows get pruned. Counted rather than dropped, so a cohort's sent total always
    // reconciles with the sidecar.
    if (!row) c.orphaned++;
    if (idx >= iResponded) c.replied++;
    if (idx >= iScreen) c.screened++;
    cohorts.set(wk, c);
  }

  const out = [...cohorts.values()].sort((a, b) => a.week.localeCompare(b.week)).slice(-weeks);
  for (const c of out) {
    c.replyPct = c.sent ? Math.round((c.replied / c.sent) * 1000) / 10 : null;
    c.screenPct = c.sent ? Math.round((c.screened / c.sent) * 1000) / 10 : null;
  }
  return { weeks: out, note: 'Keyed by the week the application was SENT, not when the row was created.' };
}
