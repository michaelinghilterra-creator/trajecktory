import { assessInterviewRecord } from './interview-records.mjs';
import { isCalendarDate } from './interview-dates.mjs';

export function gateTwcExport({ range, today, interviews, mismatches, rows }) {
  const { from, to } = range;

  if (!isCalendarDate(today)) {
    throw new TypeError('today');
  }
  if (!isCalendarDate(from)) {
    throw new TypeError('from');
  }
  if (!isCalendarDate(to)) {
    throw new TypeError('to');
  }
  if (from > to) {
    throw new TypeError('from');
  }

  const blockers = [];

  for (const record of interviews) {
    const { id, stage, scheduled_for, held_on } = record;

    const inRange = (date) => date !== undefined && date !== null && isCalendarDate(date) && date >= from && date <= to;

    if (inRange(scheduled_for) || inRange(held_on)) {
      const result = assessInterviewRecord(record, { today });

      if (result.state === 'unconfirmed') {
        blockers.push({ type: 'unconfirmed_interview', id, ...(stage !== undefined && { stage }), reasons: result.reasons });
      } else if (result.state === 'scheduled') {
        blockers.push({ type: 'scheduled_in_range', id, ...(stage !== undefined && { stage }) });
      }
    }
  }

  for (const mismatch of mismatches) {
    const { application_id, type, dated_on } = mismatch;

    if (dated_on !== undefined && dated_on !== null && isCalendarDate(dated_on) && dated_on >= from && dated_on <= to) {
      blockers.push({ type: 'status_mismatch', id: application_id, mismatch_type: type });
    }
  }

  if (blockers.length > 0) {
    return { allowed: false, blockers, rows: [], appendix: [], footer: null };
  }

  const kept = [];
  const excluded = { future_date: 0, no_evidence: 0, bad_date: 0 };

  for (const row of rows) {
    const { id, kind, date, evidence_ref } = row;

    if (!isCalendarDate(date)) {
      excluded.bad_date++;
      continue;
    }

    if (date < from || date > to) {
      continue;
    }

    if (date > today) {
      excluded.future_date++;
      continue;
    }

    if (typeof evidence_ref !== 'string' || evidence_ref === '') {
      excluded.no_evidence++;
      continue;
    }

    kept.push({ id, kind, date, evidence_ref });
  }

  kept.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    return a.id - b.id;
  });
  const counted = kept.map(({ id, kind, date }) => ({ id, kind, date }));
  const appendix = kept.map(({ id, evidence_ref }) => ({ id, evidence_ref }));

  const footer = {
    counted: counted.length,
    excluded: excluded.future_date + excluded.no_evidence + excluded.bad_date,
    excluded_reasons: { ...excluded }
  };

  return {
    allowed: true,
    blockers: [],
    rows: counted,
    appendix,
    footer
  };
}
