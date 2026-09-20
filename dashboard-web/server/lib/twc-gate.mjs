// D-11: what to look at before a Work Search log for a date range is sent. This is the WARNING form of the
// export gate: it lists unconfirmed interviews, scheduled interviews and status mismatches inside the range
// and never blocks the export. It becomes blocking only after the interview lines have their evidence and
// Michael approves the switch (decision of 2026-09-19).
import { parseApplicationsMd } from './applications.mjs';
import { readAppNotes } from './notes.mjs';
import { buildActivities, interviewGateLines } from './twc.mjs';
import { readInterviewRecords } from './interview-events.mjs';
import { interviewKey } from '../../../lib/interview-store.mjs';
import { gateTwcExport } from '../../../lib/export-gate.mjs';
import { statusMismatchReport } from '../../../lib/data-review.mjs';
import { isCalendarDate } from '../../../lib/interview-dates.mjs';
import { localToday } from '../../../lib/log-writes.mjs';

/**
 * { from, to, today, warn_only: true, count, other_replies_in_range, warnings: [{ type, id, stage?, date?, reasons?, mismatch_type?, company, role }] }.
 * Throws a TypeError naming the argument when the range is not two real dates in order.
 */
export function twcGateWarnings({ from, to, today = localToday(), interviewRecords } = {}) {
  if (!isCalendarDate(from)) throw new TypeError('from');
  if (!isCalendarDate(to)) throw new TypeError('to');
  if (from > to) throw new TypeError('from');

  const records = interviewRecords || readInterviewRecords();
  const applications = parseApplicationsMd();
  const byId = new Map(applications.map((app) => [String(app.id), app]));
  const activities = buildActivities({ interviewRecords: records, today });
  const interviews = interviewGateLines(activities, records, today);
  // Only a rejection that the status missed is a warning. A plain reply on a No Response application is mostly a
  // receipt or an acknowledgement the reply classifier cannot tell from a person, so it is counted, not listed.
  const allMismatches = statusMismatchReport(applications.map((app) => ({ id: app.id, status: app.status })), readAppNotes()).mismatches;
  const mismatches = allMismatches.filter((mismatch) => mismatch.type === 'rejection_after_no_response');
  const otherReplies = allMismatches.filter((mismatch) => mismatch.dated_on >= from && mismatch.dated_on <= to && mismatch.type !== 'rejection_after_no_response').length;

  // rows stay empty: only the blockers matter here, and a warning never withholds anything.
  const gate = gateTwcExport({ range: { from, to }, today, interviews, mismatches, rows: [] });
  const lineByKey = new Map(interviews.map((line) => [interviewKey(line.id, line.stage), line]));
  const warnings = gate.blockers.map((blocker) => {
    const app = byId.get(String(blocker.id));
    const line = blocker.stage === undefined ? undefined : lineByKey.get(interviewKey(blocker.id, blocker.stage));
    const date = line ? (line.held_on ?? line.scheduled_for) : undefined;
    return { ...blocker, ...(date !== undefined && { date }), company: app?.company ?? '', role: app?.role ?? '' };
  });
  return { from, to, today, warn_only: true, count: warnings.length, warnings, other_replies_in_range: otherReplies };
}
