export const PROVENANCE_SOURCES = Object.freeze(['dashboard_action', 'importer', 'bulk_script', 'agent', 'hand_edit']);

const MILLIS_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isValidIsoWithMillis(value) {
  return typeof value === 'string'
    && MILLIS_ISO.test(value)
    && !Number.isNaN(new Date(value).getTime());
}

function isRealCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function buildProvenance({ source, script, run_id, recorded_at }) {
  if (!PROVENANCE_SOURCES.includes(source)) throw new TypeError('source is not a known provenance source');
  if (!isValidIsoWithMillis(recorded_at)) throw new TypeError('recorded_at must be an ISO timestamp with milliseconds');
  if (source !== 'bulk_script') return { source, recorded_at };
  if (typeof script !== 'string' || script === '') throw new TypeError('script is required for a bulk_script source');
  if (typeof run_id !== 'string' || run_id === '') throw new TypeError('run_id is required for a bulk_script source');
  return { source, recorded_at, script, run_id };
}

export function detectUnverifiedNote({ timestamp, slot_start, confirmation }) {
  if (!isValidIsoWithMillis(timestamp)) return { unverified: !hasValidConfirmation(confirmation), reasons: ['bad_timestamp'] };
  const reasons = [];
  if (timestamp.endsWith('.000Z')) reasons.push('second_boundary');
  if (isValidIsoWithMillis(slot_start) && new Date(timestamp) < new Date(slot_start)) reasons.push('before_slot');
  return { unverified: reasons.length > 0 && !hasValidConfirmation(confirmation), reasons };
}

function hasValidConfirmation(confirmation) {
  return Boolean(confirmation) && typeof confirmation === 'object' && isRealCalendarDate(confirmation.confirmed_on);
}

export function noteSupportsCountedInterview(note) {
  return !detectUnverifiedNote(note).unverified;
}
