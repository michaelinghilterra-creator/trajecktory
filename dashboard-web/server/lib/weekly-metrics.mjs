/**
 * lib/weekly-metrics.mjs — the week's leading indicators, computed ONE way for
 * both the dashboard tracking view and the weekly review. Pure: every input is
 * injected (the CLI/route wire the real parsers), so it is unit tested with no
 * files touched.
 *
 * Every metric is { value, available, source }. `available:false` means NOT
 * LOGGED, which downstream treats as unknown (never zero, never a pass/fail).
 * This is the antidote to the manufactured-confidence flaw the relaunch plan
 * calls out: a blank data source must read "insufficient data", not "0".
 *
 * A note on screens booked: it is sourced from status events dated IN THE WEEK.
 * The historical backfill that corrupted status-events.tsv is all before the
 * relaunch, so a current-week count is trustworthy even while the old log is not.
 */

// Inclusive date-window test on a YYYY-MM-DD (or ISO) string.
function inRange(dateStr, start, end) {
  if (!dateStr) return false;
  const d = String(dateStr).slice(0, 10);
  return d >= start && d <= end;
}

const M = (value, available, source) => ({ value, available: !!available, source: source || null });

export function weeklyMetrics({
  weekStart, weekEnd,
  correspondence = null,          // [{ direction:'Sent'|'Received', date }] | null
  deliveredReplyRatePct = null,   // precomputed CUMULATIVE contact-based rate | null
  statusEvents = null,            // [{ status, date }] | null
  debriefs = null,                // [{ date, hasObjection }] | null
  connects = null,                // [{ date }] | null (null = no connects log yet)
  cadencePct = null,              // number 0..100 | null
  unservicedApplications = null,  // number | null
} = {}) {
  const start = weekStart, end = weekEnd;

  // Weekly FLOW: touches sent and replies received IN the week (raw counts).
  let verifiedTouches, replies;
  if (Array.isArray(correspondence)) {
    verifiedTouches = M(correspondence.filter(c => c.direction === 'Sent' && inRange(c.date, start, end)).length, true, 'correspondence');
    replies = M(correspondence.filter(c => c.direction === 'Received' && inRange(c.date, start, end)).length, true, 'correspondence');
  } else {
    verifiedTouches = M(0, false, 'correspondence not available');
    replies = M(0, false, 'correspondence not available');
  }

  // Reply RATE is deliberately NOT a same-week ratio: a reply this week can
  // answer a touch from a prior week, so replies/touches within one week can
  // exceed 100% and means nothing. It is a cumulative, contact-based campaign
  // measure (distinct contacts replied / distinct contacts sent verified mail,
  // bounces excluded), computed by the collector and injected here.
  const deliveredReplyRate = (typeof deliveredReplyRatePct === 'number')
    ? M(deliveredReplyRatePct, true, 'cumulative, contact-based, bounces excluded')
    : M(0, false, 'reply rate not available');

  const screensBooked = Array.isArray(statusEvents)
    ? M(statusEvents.filter(e => e.status === 'Phone Screen' && inRange(e.date, start, end)).length, true, 'status events (week-scoped)')
    : M(0, false, 'status events not available');

  const objectionsLogged = Array.isArray(debriefs)
    ? M(debriefs.filter(d => d.hasObjection && inRange(d.date, start, end)).length, true, 'debrief notes')
    : M(0, false, 'debriefs not available');

  // Connections are sent by hand; null (no log file yet) reads not-logged, an
  // empty log this week reads a real zero.
  const linkedinConnects = Array.isArray(connects)
    ? M(connects.filter(c => inRange(c.date, start, end)).length, true, 'linkedin-connects log')
    : M(0, false, 'not logged (no connects log)');

  const cadence = (typeof cadencePct === 'number')
    ? M(cadencePct, true, 'cadence log')
    : M(0, false, 'cadence not available');

  const unserviced = (typeof unservicedApplications === 'number')
    ? M(unservicedApplications, true, 'applications (Applied, no follow-up)')
    : M(0, false, 'applications not available');

  return {
    weekStart: start, weekEnd: end,
    verifiedTouches, replies, deliveredReplyRatePct: deliveredReplyRate,
    screensBooked, objectionsLogged,
    linkedinConnects, cadencePct: cadence,
    unservicedApplications: unserviced,
  };
}

// The Monday (local) of the ISO week containing `date` (a Date), as YYYY-MM-DD,
// plus the Sunday. Kept here so the CLI and route agree on week boundaries.
export function weekBounds(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = d.getDay() === 0 ? 7 : d.getDay(); // Mon=1..Sun=7
  const monday = new Date(d); monday.setDate(d.getDate() - (dow - 1));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const ymd = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  return { weekStart: ymd(monday), weekEnd: ymd(sunday) };
}
