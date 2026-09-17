import fs from 'fs';
import { randomUUID } from 'crypto';
import { DATA_DIR, TWC_EVENTS_PATH } from '../config.mjs';
import { appendEventsWithEffects, renderLegacyFile } from '../../../lib/legacy-files.mjs';
import { localToday, logWritesEnabled, withLogWrite } from '../../../lib/log-writes.mjs';

function projectedEvents(store) {
  const text = renderLegacyFile(store, 'twc-events.json');
  if (text === null) return [];
  try { const value = JSON.parse(text); return Array.isArray(value) ? value : []; }
  catch { return []; }
}

export const TWC_EVENT_TYPES = [
  'Networking event or job club',
  'Job fair',
  'Employment workshop',
  'WorkInTexas.com activity',
  'Résumé posted to a job board',
  'Workforce Solutions reemployment services',
  'Other work search activity',
];

export const TWC_EVENT_METHODS = ['In person', 'Online', 'Phone', 'Email'];

const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function cleanString(value, label, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') return { error: `${label} must be a string` };
  if (CONTROL_RE.test(value)) return { error: `${label} contains control characters` };
  const clean = value.trim();
  if (required && !clean) return { error: `${label} is required` };
  if (clean.length > max) return { error: `${label} must be ${max} characters or fewer` };
  return { value: clean };
}

export function readEvents() {
  try {
    const value = JSON.parse(fs.readFileSync(TWC_EVENTS_PATH, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeEvents(events) {
  fs.writeFileSync(TWC_EVENTS_PATH, JSON.stringify(events, null, 2) + '\n');
}

export function addEvent(input) {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const date = cleanString(body.date, 'date', 10, true);
  if (date.error || !validDate(date.value)) return { ok: false, error: 'date must be a valid YYYY-MM-DD date' };
  const type = cleanString(body.type, 'type', 80, true);
  if (type.error || !TWC_EVENT_TYPES.includes(type.value)) return { ok: false, error: 'type is not allowed' };
  const method = cleanString(body.method, 'method', 20, true);
  if (method.error || !TWC_EVENT_METHODS.includes(method.value)) return { ok: false, error: 'method is not allowed' };

  const organizer = cleanString(body.organizer, 'organizer', 120, true);
  if (organizer.error) return { ok: false, error: organizer.error };
  const contact = cleanString(body.contact, 'contact', 120);
  if (contact.error) return { ok: false, error: contact.error };
  const notes = cleanString(body.notes, 'notes', 500);
  if (notes.error) return { ok: false, error: notes.error };

  if (logWritesEnabled(DATA_DIR)) {
    return withLogWrite(DATA_DIR, store => addToEvents(projectedEvents(store), store));
  }
  const events = readEvents();
  const result = addToEvents(events);
  writeEvents(events);
  return result;

  function addToEvents(events, store) {
    const ids = new Set(events.map(event => String(event && event.id || '')));
    let id;
    do { id = randomUUID(); } while (ids.has(id));
    const event = {
      id, date: date.value, type: type.value, organizer: organizer.value,
      contact: contact.value, method: method.value, notes: notes.value,
      createdAt: new Date().toISOString(),
    };
    events.push(event);
    if (store) appendEventsWithEffects(store, [{
      type: 'work_search_event_logged', occurred_on: event.date, source: 'dashboard', definitions_version: 'v1',
      payload: {
        file: 'twc-events.json', id: event.id, date: event.date, kind: event.type,
        legacy_effects: [{ file: 'twc-events.json', op: 'json_append', item: event }],
      },
    }]);
    return { ok: true, event };
  }
}

export function deleteEvent(id) {
  const enabled = logWritesEnabled(DATA_DIR);
  if (enabled) {
    return withLogWrite(DATA_DIR, store => removeFromEvents(projectedEvents(store), store));
  }
  const events = readEvents();
  const removed = removeFromEvents(events);
  if (removed) writeEvents(events.filter(event => String(event && event.id) !== String(id)));
  return removed;

  function removeFromEvents(events, store) {
    const kept = events.filter(event => String(event && event.id) !== String(id));
    if (kept.length === events.length) return false;
    if (store) appendEventsWithEffects(store, [{
      type: 'legacy_record', occurred_on: localToday(), source: 'dashboard', definitions_version: 'v1',
      payload: {
        reason: 'work_search_event_removed', id,
        legacy_effects: [{ file: 'twc-events.json', op: 'json_replace', value: kept }],
      },
    }]);
    return true;
  }
}
