/**
 * E-7: what to look at before a Work Search report is made. Pure functions over data the caller has loaded;
 * nothing here reads or writes a file. Weeks run Sunday to Saturday and are named by calendar dates, so the
 * caller decides what "today" is (Central time).
 *
 * For each week:
 *   unconfirmed_interviews  interview lines dated in the week that cite no evidence that resolves
 *   scheduled               interview lines dated after today (arranged, not held)
 *   newer_messages          applications whose newest employer message is newer than their last status change
 *   unmatched_replies       logged replies that reply matching cannot place on the application they sit on
 */

import { classifyStatusSignal } from './employer-status.mjs';
import { matchReply } from './reply-match.mjs';
import { normalizeCompany } from './identity.mjs';

const DAY_MS = 86400000;

function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function shiftDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The Sunday to Saturday week that holds `date`. */
export function weekOf(date) {
  if (!isRealDate(date)) throw new TypeError('date must be a valid YYYY-MM-DD calendar date');
  const [y, m, d] = date.split('-').map(Number);
  const from = shiftDays(date, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
  return { from, to: shiftDays(from, 6) };
}

/** The last `count` weeks ending with the week that holds `today`, oldest first. */
export function recentWeeks(today, count) {
  if (!Number.isInteger(count) || count < 1) throw new TypeError('count must be a positive integer');
  const current = weekOf(today);
  return Array.from({ length: count }, (_, i) => {
    const from = shiftDays(current.from, -7 * (count - 1 - i));
    return { from, to: shiftDays(from, 6) };
  });
}

const inWeek = (date, week) => isRealDate(date) && date >= week.from && date <= week.to;

/**
 * Interview lines the person still has to back with evidence, and those only arranged. A line normally sorts
 * itself by date (after today is scheduled, on or before with no evidence is unconfirmed), but the caller can
 * set `bucket: 'scheduled' | 'unconfirmed'` to say directly which it is instead — needed for a line recorded
 * in the event store, where a held date can itself still be in the future (an owner confirmation entered
 * ahead of the day), which the date-only rule would otherwise read as merely scheduled.
 */
export function interviewItems(interviews, today) {
  const unconfirmed = [];
  const scheduled = [];
  for (const line of Array.isArray(interviews) ? interviews : []) {
    if (!isRealDate(line?.date)) continue;
    const item = { application_id: line.appId, stage: line.stage, date: line.date };
    const bucket = line.bucket === 'scheduled' || line.bucket === 'unconfirmed'
      ? line.bucket
      : (line.date > today ? 'scheduled' : (line.evidence_ok !== true ? 'unconfirmed' : null));
    if (bucket === 'scheduled') scheduled.push(item);
    else if (bucket === 'unconfirmed') unconfirmed.push(item);
  }
  return { unconfirmed, scheduled };
}

/**
 * Applications whose newest employer message (a rejection or another human reply) is newer than the date of
 * their last status change. repliesByApp: Map of application id to messages; lastStatusDate: Map of id to date.
 */
export function newerMessages(applications, repliesByApp, lastStatusDate) {
  const items = [];
  for (const app of applications) {
    const messages = (repliesByApp.get(String(app.id)) ?? [])
      .map((m) => ({ m, signal: classifyStatusSignal(m) }))
      .filter((x) => x.signal === 'rejection' || x.signal === 'human_reply')
      .sort((a, b) => (a.m.sent_on === b.m.sent_on ? (a.m.message_id < b.m.message_id ? -1 : 1) : (a.m.sent_on < b.m.sent_on ? -1 : 1)));
    const newest = messages[messages.length - 1];
    if (!newest) continue;
    const last = lastStatusDate.get(String(app.id));
    if (last !== undefined && last !== null && newest.m.sent_on <= last) continue;
    items.push({ application_id: app.id, status: app.status, message_id: newest.m.message_id, dated_on: newest.m.sent_on, kind: newest.signal });
  }
  return items;
}

/**
 * Replies that reply matching cannot place on the application they are filed on, or places on another one.
 * Matching runs among the applications at the same employer.
 */
export function unmatchedReplies(applications, repliesByApp, applyDates = {}) {
  const byEmployer = new Map();
  for (const app of applications) {
    const key = normalizeCompany(app.company);
    if (!byEmployer.has(key)) byEmployer.set(key, []);
    byEmployer.get(key).push({ id: app.id, company: app.company, role: app.role, apply_date: applyDates[String(app.id)] ?? null, thread_ids: [] });
  }
  const items = [];
  for (const app of applications) {
    const messages = repliesByApp.get(String(app.id)) ?? [];
    if (messages.length === 0) continue;
    const candidates = byEmployer.get(normalizeCompany(app.company)) ?? [];
    for (const message of messages) {
      const result = matchReply({ message_id: message.message_id, message_date: message.sent_on, company: app.company, subject: message.subject, body: message.body }, candidates);
      if (result.status === 'unmatched') {
        items.push({ application_id: app.id, message_id: message.message_id, dated_on: message.sent_on, problem: result.reason });
      } else if (result.status === 'matched' && String(result.application_id) !== String(app.id)) {
        items.push({ application_id: app.id, message_id: message.message_id, dated_on: message.sent_on, problem: 'filed_on_another_application', belongs_to: result.application_id });
      }
    }
  }
  return items;
}

/** Everything above, grouped by week. */
export function buildWeeklyReview({ today, weekCount = 4, applications = [], repliesByApp = new Map(), lastStatusDate = new Map(), applyDates = {}, interviews = [] } = {}) {
  if (!isRealDate(today)) throw new TypeError('today must be a valid YYYY-MM-DD calendar date');
  const lines = interviewItems(interviews, today);
  const newer = newerMessages(applications, repliesByApp, lastStatusDate);
  const unmatched = unmatchedReplies(applications, repliesByApp, applyDates);
  const weeks = recentWeeks(today, weekCount).map((week) => {
    const unconfirmed_interviews = lines.unconfirmed.filter((i) => inWeek(i.date, week));
    const scheduled = lines.scheduled.filter((i) => inWeek(i.date, week));
    const newer_messages = newer.filter((i) => inWeek(i.dated_on, week));
    const unmatched_replies = unmatched.filter((i) => inWeek(i.dated_on, week));
    return {
      ...week,
      unconfirmed_interviews,
      scheduled,
      newer_messages,
      unmatched_replies,
      needs_review: unconfirmed_interviews.length + scheduled.length + newer_messages.length + unmatched_replies.length,
    };
  });
  return { today, weeks, needs_review: weeks.reduce((sum, w) => sum + w.needs_review, 0) };
}
