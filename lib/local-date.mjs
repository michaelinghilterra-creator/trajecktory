// The user's own calendar date and wall-clock stamp. This module has no dependencies on purpose, so CLI
// scripts and the dashboard can share one definition without pulling in the event store.
//
// Never derive a "today" for stored data or a due/cap decision from new Date().toISOString(): that is the
// UTC date, which is already tomorrow for a US user after about 7pm, and every value written or compared
// with it is a day off in the evening. tests/no-utc-today.test.mjs enforces this.
export function localToday(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// 'YYYY-MM-DD HH:MM' in local wall-clock time, the format of the correspondence store's timestamps.
export function localStamp(date = new Date()) {
  return `${localToday(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
