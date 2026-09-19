export const VOID_REASON_CODES = Object.freeze(['not_held', 'wrong_record', 'duplicate', 'erroneous_entry', 'superseded', 'undone_by_owner']);
export const VOID_ACTORS = Object.freeze(['owner', 'dashboard', 'agent', 'bulk_script']);

function isYYYYMMDD(str) {
  if (typeof str !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [year, month, day] = str.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function buildVoidEvent({ target_event_id, reason_code, evidence_ref, actor, script, run_id, occurred_on, definitions_version }) {
  if (!Number.isInteger(target_event_id) || target_event_id <= 0) {
    throw new TypeError('target_event_id');
  }
  if (!VOID_REASON_CODES.includes(reason_code)) {
    throw new TypeError('reason_code');
  }
  if (!VOID_ACTORS.includes(actor)) {
    throw new TypeError('actor');
  }
  if (!isYYYYMMDD(occurred_on)) {
    throw new TypeError('occurred_on');
  }
  if (typeof definitions_version !== 'string' || definitions_version.length === 0) {
    throw new TypeError('definitions_version');
  }
  if (typeof evidence_ref !== 'string' || evidence_ref.length === 0) {
    throw new TypeError('evidence_ref');
  }

  const source = actor === 'owner' || actor === 'dashboard' ? 'dashboard' : 'cli';

  const payload = { reason_code, actor };
  if (actor === 'bulk_script') {
    if (typeof script !== 'string' || script.length === 0) {
      throw new TypeError('script');
    }
    if (typeof run_id !== 'string' || run_id.length === 0) {
      throw new TypeError('run_id');
    }
    payload.script = script;
    payload.run_id = run_id;
  }

  return {
    type: 'event_undone',
    occurred_on,
    source,
    evidence_ref,
    corrects_event_id: target_event_id,
    payload,
    definitions_version
  };
}

export function voidedIds(events) {
  const ids = new Set(events.map((event) => event.id));
  const undone = events.filter((event) => event.type === 'event_undone').sort((x, y) => y.id - x.id);
  const voided = new Set();
  for (const event of undone) {
    if (voided.has(event.id)) continue;
    if (ids.has(event.corrects_event_id)) voided.add(event.corrects_event_id);
  }
  const result = new Set();
  for (const event of events) {
    if (event.type !== 'event_undone' && voided.has(event.id)) result.add(event.id);
  }
  return result;
}

export function visibleEvents(events) {
  const voided = voidedIds(events);
  return events.filter(e => !voided.has(e.id) && e.type !== 'event_undone');
}

export function historyEvents(events) {
  return events.slice();
}

export function countByType(events) {
  const counts = {};
  for (const ev of visibleEvents(events)) {
    const type = ev.type;
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}
