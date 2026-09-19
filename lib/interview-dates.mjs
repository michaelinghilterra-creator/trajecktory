export function isCalendarDate(value) {
  if (typeof value !== 'string') {
    return false;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  if (month < 1 || month > 12) {
    return false;
  }
  if (day < 1 || day > 31) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return false;
  }
  return true;
}

export function interviewDateFields({ booked_on, scheduled_for, held_on, recorded_on }) {
  const result = {};
  const provided = { booked_on, scheduled_for, held_on, recorded_on };
  for (const [field, value] of Object.entries(provided)) {
    if (value !== undefined && value !== null) {
      if (!isCalendarDate(value)) {
        throw new TypeError(field);
      }
      result[field] = value;
    }
  }

  return result;
}

export function weekRange(dateStr) {
  if (!isCalendarDate(dateStr)) {
    throw new TypeError(dateStr);
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = date.getUTCDay();

  const fromOffset = dayOfWeek;
  const toOffset = 6 - dayOfWeek;

  const from = new Date(Date.UTC(year, month - 1, day));
  from.setUTCDate(date.getUTCDate() - fromOffset);
  const to = new Date(Date.UTC(year, month - 1, day));
  to.setUTCDate(date.getUTCDate() + toOffset);

  const fromStr = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, '0')}-${String(from.getUTCDate()).padStart(2, '0')}`;
  const toStr = `${to.getUTCFullYear()}-${String(to.getUTCMonth() + 1).padStart(2, '0')}-${String(to.getUTCDate()).padStart(2, '0')}`;

  return { from: fromStr, to: toStr };
}

export function countedInterviewRows(records, { from, to, today }) {
  if (!isCalendarDate(from)) {
    throw new TypeError(from);
  }
  if (!isCalendarDate(to)) {
    throw new TypeError(to);
  }
  if (!isCalendarDate(today)) {
    throw new TypeError(today);
  }

  const rows = [];
  const excluded = [];

  for (const record of records) {
    const { id, stage, booked_on, scheduled_for, held_on } = record;
    const inWindow = (date) => date !== undefined && date !== null && isCalendarDate(date) && date >= from && date <= to;

    const hasDateInWindow = inWindow(held_on) || inWindow(scheduled_for) || inWindow(booked_on);

    if (!hasDateInWindow) {
      continue;
    }

    if (held_on === undefined || held_on === null) {
      excluded.push({ id, reason: 'not_held' });
      continue;
    }

    if (!isCalendarDate(held_on)) {
      excluded.push({ id, reason: 'bad_held_on' });
      continue;
    }

    if (held_on > today) {
      excluded.push({ id, reason: 'future_date' });
      continue;
    }

    if (held_on >= from && held_on <= to) {
      rows.push({ id, stage, date: held_on });
    }
  }

  rows.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    return a.id - b.id;
  });

  return { rows, excluded };
}
