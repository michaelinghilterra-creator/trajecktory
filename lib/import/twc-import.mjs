import { isDeepStrictEqual } from 'node:util';
import { TWC_EVENT_METHODS, TWC_EVENT_TYPES } from '../../dashboard-web/server/lib/twc-events.mjs';
import { TWC_KINDS } from '../../dashboard-web/server/lib/twc.mjs';
import { appendEvents, readEvents } from '../event-store.mjs';
import { companyKey } from '../identity-store.mjs';

const EVENTS_FILE = 'twc-events.json';
const OVERRIDES_FILE = 'twc-overrides.json';
const TWC_RESULTS = new Set([
  'Submitted job application',
  'Sent a résumé',
  'Interviewed',
  'Hired',
  'Not hired',
  'No reply',
  'Other',
]);
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

const isYmd = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

function overrideString(value, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return null;
  const clean = value.trim();
  if ((required && !clean) || clean.length > max) return null;
  return clean;
}

// Mirrors the private validExcludeOverride and validAddOverride functions in
// dashboard-web/server/lib/twc.mjs so this report agrees with the current sheet.
function validExcludeOverride(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const contact = overrideString(value.contact, 120);
  const company = overrideString(value.company, 120);
  const note = overrideString(value.note, 500);
  return isYmd(value.date) && TWC_KINDS.includes(value.kind)
    && contact !== null && company !== null && note !== null && Boolean(contact || company);
}

function validAddOverride(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = [
    overrideString(value.activity, 120, true),
    overrideString(value.company, 120),
    overrideString(value.role, 120),
    overrideString(value.contact, 120),
    overrideString(value.method, 120),
    overrideString(value.note, 500),
  ];
  return isYmd(value.date) && TWC_KINDS.includes(value.kind)
    && TWC_RESULTS.has(value.result) && fields.every(field => field !== null);
}

function parseFile(text, file, expected, flags) {
  if (text === null) return { missing: true, value: null };
  try {
    const value = JSON.parse(text);
    if (!expected(value)) throw new Error('unexpected shape');
    return { missing: false, value };
  } catch {
    flags.push({ type: 'unreadable_file', file });
    return { missing: false, value: null };
  }
}

function addCount(target, value) {
  const key = value === undefined || value === null ? '' : String(value);
  target[key] = (target[key] ?? 0) + 1;
}

function digits(value) {
  const text = String(value ?? '');
  return /^\d+$/.test(text) ? text : null;
}

function trackerApplicationIds(store, trackerFile) {
  const prefix = `${trackerFile}#line`;
  const rows = store.db.prepare(`
    SELECT payload
    FROM events
    WHERE type = 'posting_evaluated'
      AND substr(evidence_ref, 1, ?) = ?
    ORDER BY id
  `).all(prefix.length, prefix);
  return new Set(rows.map(row => String(JSON.parse(row.payload).num ?? '')));
}

function submittedApplicationIds(store) {
  return new Set(store.db.prepare(`
    SELECT application_id
    FROM events
    WHERE type = 'application_submitted' AND application_id IS NOT NULL
    ORDER BY id
  `).all().map(row => String(row.application_id)));
}

function statusStagesByApplication(store) {
  const stages = new Map();
  for (const row of store.db.prepare(`
    SELECT application_id, payload
    FROM events
    WHERE type = 'status_changed' AND application_id IS NOT NULL
    ORDER BY id
  `).all()) {
    const payload = JSON.parse(row.payload);
    const stage = String(payload.status ?? payload.cells?.[2] ?? '').trim();
    if (!stages.has(String(row.application_id))) stages.set(String(row.application_id), new Set());
    stages.get(String(row.application_id)).add(stage);
  }
  return stages;
}

function submittedCompanyDates(store) {
  const pairs = new Set();
  const rows = store.db.prepare(`
    SELECT e.occurred_on, c.name
    FROM events e
    JOIN postings p ON p.id = e.posting_id
    JOIN companies c ON c.id = p.company_id
    WHERE e.type = 'application_submitted'
    ORDER BY e.id
  `).all();
  for (const row of rows) {
    try {
      pairs.add(`${companyKey(row.name)}\u0000${row.occurred_on}`);
    } catch {
      // Identity creation already rejects empty company keys. Keep this defensive.
    }
  }
  return pairs;
}

function entrySignature(entry) {
  return JSON.stringify([
    entry?.date,
    entry?.type,
    entry?.organizer,
    entry?.method,
  ]);
}

export function importTwc(store, {
  eventsText = null,
  overridesText = null,
  definitionsVersion,
  importedOn,
  trackerFile = 'applications.md',
}) {
  const flags = [];
  const parsedEvents = parseFile(eventsText, EVENTS_FILE, Array.isArray, flags);
  const parsedOverrides = parseFile(
    overridesText,
    OVERRIDES_FILE,
    value => value !== null && typeof value === 'object' && !Array.isArray(value),
    flags,
  );
  const counts = {
    events: parsedEvents.value?.length ?? 0,
    events_by_type: {},
    overrides_by_section: {},
    add_by_kind: {},
    add_by_result: {},
    exclude_by_kind: {},
    interview_by_stage: {},
    applications_include_counts: {},
    files_missing: [parsedEvents, parsedOverrides].filter(file => file.missing).length,
  };
  const events = [];

  if (parsedEvents.value) {
    const seenIds = new Set();
    const seenEvents = new Set();
    for (let index = 0; index < parsedEvents.value.length; index++) {
      const entry = parsedEvents.value[index];
      const validDate = isCalendarDate(entry?.date);
      addCount(counts.events_by_type, entry?.type);
      if (!validDate) flags.push({ type: 'invalid_date', section: 'events', index });
      if (!TWC_EVENT_TYPES.includes(entry?.type)) {
        flags.push({ type: 'unknown_event_type', section: 'events', index });
      }
      if (!TWC_EVENT_METHODS.includes(entry?.method)) {
        flags.push({ type: 'unknown_method', section: 'events', index });
      }
      const hasId = entry !== null && typeof entry === 'object'
        && entry.id !== undefined && entry.id !== null;
      if (hasId && seenIds.has(entry.id)) {
        flags.push({ type: 'duplicate_event_id', section: 'events', index });
      }
      if (hasId) seenIds.add(entry.id);
      const signature = entrySignature(entry);
      if (seenEvents.has(signature)) {
        flags.push({ type: 'duplicate_event', section: 'events', index });
      }
      seenEvents.add(signature);
      events.push({
        type: 'work_search_event_logged',
        occurred_on: validDate ? entry.date : importedOn,
        source: 'import',
        evidence_ref: `${EVENTS_FILE}#index${index}`,
        dedupe_key: `import:${EVENTS_FILE}:index:${index}`,
        definitions_version: definitionsVersion,
        payload: { file: EVENTS_FILE, index, entry },
      });
    }
    events.push({
      type: 'legacy_record',
      occurred_on: importedOn,
      source: 'import',
      evidence_ref: EVENTS_FILE,
      dedupe_key: `import:${EVENTS_FILE}:file_format`,
      definitions_version: definitionsVersion,
      payload: { file: EVENTS_FILE, is_array: true, reason: 'file_format' },
    });
  }

  if (parsedOverrides.value) {
    const document = parsedOverrides.value;
    const topLevelOrder = jsonObjectKeyOrder(overridesText);
    const knownSections = new Set(['applications', 'interviews', 'exclude', 'add']);
    const sectionsPresent = topLevelOrder.filter(section => knownSections.has(section));
    const trackerIds = trackerApplicationIds(store, trackerFile);
    const applicationIds = submittedApplicationIds(store);
    const statusStages = statusStagesByApplication(store);
    const applicationCompanyDates = submittedCompanyDates(store);

    if (document.applications && typeof document.applications === 'object'
      && !Array.isArray(document.applications)) {
      const keys = jsonNestedObjectKeyOrder(overridesText, 'applications');
      counts.overrides_by_section.applications = keys.length;
      for (let position = 0; position < keys.length; position++) {
        const key = keys[position];
        const value = document.applications[key];
        const applicationId = digits(key);
        addCount(counts.applications_include_counts,
          value?.include === true ? 'true' : value?.include === false ? 'false' : 'other');
        if (!trackerIds.has(String(key))) {
          flags.push({ type: 'override_app_without_tracker_row', section: 'applications', key });
        }
        if (applicationId && value?.include === false && applicationIds.has(applicationId)) {
          flags.push({ type: 'excluded_app_has_application', section: 'applications', key });
        }
        events.push({
          type: 'legacy_record',
          occurred_on: importedOn,
          source: 'import',
          evidence_ref: `${OVERRIDES_FILE}#applications:${key}`,
          dedupe_key: `import:${OVERRIDES_FILE}:applications:${key}`,
          definitions_version: definitionsVersion,
          ...(applicationId ? { application_id: applicationId } : {}),
          payload: {
            file: OVERRIDES_FILE,
            section: 'applications',
            key,
            value,
            position,
            reason: 'twc_application_override',
          },
        });
      }
    }

    const arraySections = [
      ['interviews', 'twc_interview_override'],
      ['exclude', 'twc_exclude_override'],
      ['add', 'twc_add_override'],
    ];
    for (const [section, reason] of arraySections) {
      if (!Array.isArray(document[section])) continue;
      counts.overrides_by_section[section] = document[section].length;
      for (let index = 0; index < document[section].length; index++) {
        const item = document[section][index];
        const validDate = isCalendarDate(item?.date);
        const applicationId = section === 'interviews' ? digits(item?.appId) : null;
        if (!validDate) flags.push({ type: 'invalid_date', section, index });
        if (section === 'interviews') {
          const stage = typeof item?.stage === 'string' ? item.stage.trim() : '';
          addCount(counts.interview_by_stage, stage);
          if (!applicationId || !validDate || !stage) {
            flags.push({ type: 'invalid_interview_override', section, index });
          }
          if (!trackerIds.has(String(item?.appId ?? ''))) {
            flags.push({ type: 'override_app_without_tracker_row', section, index });
          }
          if (applicationId && !statusStages.get(applicationId)?.has(stage)) {
            flags.push({ type: 'interview_override_without_status_event', section, index });
          }
        } else if (section === 'exclude') {
          addCount(counts.exclude_by_kind, item?.kind);
          if (!validExcludeOverride(item)) {
            flags.push({ type: 'invalid_exclude_override', section, index });
          }
        } else {
          addCount(counts.add_by_kind, item?.kind);
          addCount(counts.add_by_result, item?.result);
          if (!validAddOverride(item)) {
            flags.push({ type: 'invalid_add_override', section, index });
          }
          if (item?.kind === 'application' && validDate) {
            try {
              if (applicationCompanyDates.has(`${companyKey(item.company)}\u0000${item.date}`)) {
                flags.push({ type: 'add_application_matches_existing', section, index });
              }
            } catch {
              // The validator flag is sufficient when the company cannot form a key.
            }
          }
        }
        events.push({
          type: 'legacy_record',
          occurred_on: validDate ? item.date : importedOn,
          source: 'import',
          evidence_ref: `${OVERRIDES_FILE}#${section}:${index}`,
          dedupe_key: `import:${OVERRIDES_FILE}:${section}:${index}`,
          definitions_version: definitionsVersion,
          ...(applicationId ? { application_id: applicationId } : {}),
          payload: { file: OVERRIDES_FILE, section, index, item, reason },
        });
      }
    }

    events.push({
      type: 'legacy_record',
      occurred_on: importedOn,
      source: 'import',
      evidence_ref: OVERRIDES_FILE,
      dedupe_key: `import:${OVERRIDES_FILE}:file_format`,
      definitions_version: definitionsVersion,
      payload: {
        file: OVERRIDES_FILE,
        key_order: topLevelOrder,
        sections_present: sectionsPresent,
        reason: 'file_format',
      },
    });
  }

  if (events.length) appendEvents(store, events);
  return { counts, flags };
}

function skipWhitespace(text, state) {
  while (/\s/.test(text[state.index] ?? '')) state.index++;
}

function readJsonString(text, state) {
  const start = state.index++;
  let escaped = false;
  while (state.index < text.length) {
    const character = text[state.index++];
    if (escaped) escaped = false;
    else if (character === '\\') escaped = true;
    else if (character === '"') return JSON.parse(text.slice(start, state.index));
  }
  throw new Error('unterminated JSON string');
}

function skipJsonValue(text, state) {
  skipWhitespace(text, state);
  const opening = text[state.index];
  if (opening === '"') {
    readJsonString(text, state);
    return;
  }
  if (opening === '{' || opening === '[') {
    const closing = opening === '{' ? '}' : ']';
    state.index++;
    while (state.index < text.length) {
      skipWhitespace(text, state);
      if (text[state.index] === closing) {
        state.index++;
        return;
      }
      if (opening === '{') {
        readJsonString(text, state);
        skipWhitespace(text, state);
        state.index++;
      }
      skipJsonValue(text, state);
      skipWhitespace(text, state);
      if (text[state.index] === ',') state.index++;
    }
    throw new Error('unterminated JSON container');
  }
  while (state.index < text.length && !/[\s,}\]]/.test(text[state.index])) state.index++;
}

function readObjectOrder(text, state, nestedKey = null) {
  skipWhitespace(text, state);
  if (text[state.index++] !== '{') throw new Error('expected JSON object');
  const keys = [];
  let nested = [];
  while (state.index < text.length) {
    skipWhitespace(text, state);
    if (text[state.index] === '}') {
      state.index++;
      return { keys, nested };
    }
    const key = readJsonString(text, state);
    keys.push(key);
    skipWhitespace(text, state);
    if (text[state.index++] !== ':') throw new Error('expected colon');
    skipWhitespace(text, state);
    if (nestedKey !== null && key === nestedKey && text[state.index] === '{') {
      nested = readObjectOrder(text, state).keys;
    } else {
      skipJsonValue(text, state);
    }
    skipWhitespace(text, state);
    if (text[state.index] === ',') state.index++;
  }
  throw new Error('unterminated JSON object');
}

function jsonObjectKeyOrder(text) {
  return readObjectOrder(text, { index: 0 }).keys;
}

function jsonNestedObjectKeyOrder(text, key) {
  return readObjectOrder(text, { index: 0 }, key).nested;
}

function parsedOriginal(text, expected) {
  if (text === null) return { missing: true, valid: true, value: null };
  try {
    const value = JSON.parse(text);
    return { missing: false, valid: expected(value), value };
  } catch {
    return { missing: false, valid: false, value: null };
  }
}

function fileResult(original, text, rebuilt, originalEntries, rebuiltEntries, orderMatches = true) {
  if (original.missing) {
    return { match: true, bytes_identical: true, original_entries: 0, rebuilt_entries: 0 };
  }
  const match = original.valid && orderMatches && isDeepStrictEqual(original.value, rebuilt);
  return {
    match,
    bytes_identical: original.valid && `${JSON.stringify(rebuilt, null, 2)}\n` === text,
    original_entries: original.valid ? originalEntries : 0,
    rebuilt_entries: rebuiltEntries,
  };
}

export function compareTwc({ eventsText = null, overridesText = null }, store) {
  const rows = readEvents(store);
  const originalEvents = parsedOriginal(eventsText, Array.isArray);
  const rebuiltEvents = eventsText === null ? [] : rows
    .filter(event => event.payload.file === EVENTS_FILE && Number.isInteger(event.payload.index))
    .sort((left, right) => left.payload.index - right.payload.index)
    .map(event => event.payload.entry);
  const eventsResult = fileResult(
    originalEvents,
    eventsText,
    rebuiltEvents,
    originalEvents.value?.length ?? 0,
    rebuiltEvents.length,
  );

  const originalOverrides = parsedOriginal(
    overridesText,
    value => value !== null && typeof value === 'object' && !Array.isArray(value),
  );
  const format = rows.find(event => event.payload.file === OVERRIDES_FILE
    && event.payload.reason === 'file_format');
  const itemRows = rows.filter(event => event.payload.file === OVERRIDES_FILE
    && event.payload.reason !== 'file_format');
  const rebuiltOverrides = {};
  const values = {};
  const applicationRows = itemRows
    .filter(event => event.payload.section === 'applications')
    .sort((left, right) => left.payload.position - right.payload.position);
  const applications = {};
  for (const event of applicationRows) applications[event.payload.key] = event.payload.value;
  values.applications = applications;
  for (const section of ['interviews', 'exclude', 'add']) {
    values[section] = itemRows
      .filter(event => event.payload.section === section)
      .sort((left, right) => left.payload.index - right.payload.index)
      .map(event => event.payload.item);
  }
  for (const key of format?.payload.key_order ?? []) {
    if ((format.payload.sections_present ?? []).includes(key) && Object.hasOwn(values, key)) {
      rebuiltOverrides[key] = values[key];
    }
  }
  const originalEntryCount = originalOverrides.valid
    ? (originalOverrides.value?.applications
      && typeof originalOverrides.value.applications === 'object'
      && !Array.isArray(originalOverrides.value.applications)
      ? Object.keys(originalOverrides.value.applications).length : 0)
      + ['interviews', 'exclude', 'add'].reduce((total, section) => (
        total + (Array.isArray(originalOverrides.value?.[section])
          ? originalOverrides.value[section].length : 0)
      ), 0)
    : 0;
  let orderMatches = originalOverrides.valid;
  if (orderMatches && !originalOverrides.missing) {
    orderMatches = isDeepStrictEqual(jsonObjectKeyOrder(overridesText), format?.payload.key_order ?? [])
      && (!Object.hasOwn(originalOverrides.value, 'applications')
        || isDeepStrictEqual(
          jsonNestedObjectKeyOrder(overridesText, 'applications'),
          applicationRows.map(event => event.payload.key),
        ));
  }
  const overridesResult = fileResult(
    originalOverrides,
    overridesText,
    overridesText === null ? {} : rebuiltOverrides,
    originalEntryCount,
    itemRows.length,
    orderMatches,
  );

  return {
    match: eventsResult.match && overridesResult.match,
    files: {
      [EVENTS_FILE]: eventsResult,
      [OVERRIDES_FILE]: overridesResult,
    },
  };
}
