import { isDeepStrictEqual } from 'node:util';
import { appendEvents, readEvents } from '../event-store.mjs';
import {
  findPerson,
  findPersonByAlias,
  linkedinIdentifier,
} from '../identity-store.mjs';

const FILES = Object.freeze({
  connects: 'linkedin-connects.json',
  sidecar: 'tt-linkedin.json',
  connections: 'linkedin-connections.json',
});

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

const MONTHS = Object.freeze({
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
});

function parseConnectedDate(value) {
  const match = typeof value === 'string'
    ? value.match(/^(\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})$/)
    : null;
  if (!match) return null;
  const day = Number(match[1]);
  const month = MONTHS[match[2]];
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month
    || date.getUTCDate() !== day) return null;
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
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

function topLevelObjectKeys(text) {
  const keys = [];
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/.test(text[index] ?? '')) index++;
  };
  const readString = () => {
    const start = index++;
    let escaped = false;
    while (index < text.length) {
      const character = text[index++];
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') return JSON.parse(text.slice(start, index));
    }
    throw new Error('unterminated JSON string');
  };
  const skipValue = () => {
    let depth = 0;
    let inString = false;
    let escaped = false;
    while (index < text.length) {
      const character = text[index];
      if (inString) {
        index++;
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        index++;
      } else if (character === '{' || character === '[') {
        depth++;
        index++;
      } else if (character === '}' || character === ']') {
        if (depth === 0) return;
        depth--;
        index++;
      } else if (character === ',' && depth === 0) {
        return;
      } else {
        index++;
      }
    }
  };

  skipWhitespace();
  if (text[index++] !== '{') throw new Error('expected JSON object');
  while (index < text.length) {
    skipWhitespace();
    if (text[index] === '}') break;
    if (text[index] === ',') {
      index++;
      skipWhitespace();
    }
    if (text[index] !== '"') throw new Error('expected JSON object key');
    keys.push(readString());
    skipWhitespace();
    if (text[index++] !== ':') throw new Error('expected colon');
    skipWhitespace();
    skipValue();
  }
  return keys;
}

function eventRows(store) {
  return readEvents(store);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function dayDifference(from, to) {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export function importLinkedIn(store, {
  connectsText = null,
  sidecarText = null,
  connectionsText = null,
  definitionsVersion,
  importedOn,
}) {
  const flags = [];
  const connects = parseFile(connectsText, FILES.connects, Array.isArray, flags);
  const sidecar = parseFile(
    sidecarText,
    FILES.sidecar,
    value => value !== null && typeof value === 'object' && !Array.isArray(value),
    flags,
  );
  const connections = parseFile(
    connectionsText,
    FILES.connections,
    value => value !== null && typeof value === 'object' && !Array.isArray(value)
      && Array.isArray(value.connections),
    flags,
  );
  const counts = {
    ledger_entries: connects.value?.length ?? 0,
    requests_created: 0,
    requests_already_recorded: 0,
    sidecar_entries: sidecar.value ? Object.keys(sidecar.value).length : 0,
    sidecar_by_state: {},
    export_connections: connections.value?.connections.length ?? 0,
    acceptances_linked_to_person: 0,
    acceptances_unlinked: 0,
    files_missing: [connects, sidecar, connections].filter(file => file.missing).length,
  };
  const events = [];
  const existingRequestKeys = new Set(eventRows(store)
    .filter(event => event.type === 'connection_request_sent' && event.dedupe_key)
    .map(event => event.dedupe_key));
  const requestKeys = new Set(existingRequestKeys);

  for (let index = 0; index < (connects.value ?? []).length; index++) {
    const entry = connects.value[index];
    const hasId = entry?.id !== undefined && entry?.id !== null && entry?.id !== '';
    let personId = null;
    if (entry?.source === 'ta' && hasId) {
      personId = findPersonByAlias(store, 'target_talent', entry.id);
      if (!personId) flags.push({ type: 'request_no_person', file: FILES.connects, index });
    } else if (!hasId) {
      flags.push({ type: 'request_without_id', file: FILES.connects, index });
    } else {
      flags.push({ type: 'request_no_person', file: FILES.connects, index });
    }
    const validDate = isCalendarDate(entry?.date);
    const occurredOn = validDate ? entry.date : importedOn;
    if (!validDate) flags.push({ type: 'invalid_date', file: FILES.connects, index });
    const importKey = `import:${FILES.connects}:index:${index}`;
    const requestKey = personId ? `li_request:${personId}:${occurredOn}` : importKey;
    const common = {
      occurred_on: occurredOn,
      source: 'import',
      evidence_ref: `${FILES.connects}#index${index}`,
      definitions_version: definitionsVersion,
      ...(personId ? { person_id: personId } : {}),
    };
    if (personId && requestKeys.has(requestKey)) {
      counts.requests_already_recorded++;
      events.push({
        ...common,
        type: 'legacy_record',
        dedupe_key: importKey,
        payload: { file: FILES.connects, index, entry, reason: 'request_already_recorded' },
      });
    } else {
      counts.requests_created++;
      if (personId) requestKeys.add(requestKey);
      events.push({
        ...common,
        type: 'connection_request_sent',
        channel: 'linkedin_request',
        dedupe_key: requestKey,
        payload: { file: FILES.connects, index, entry },
      });
    }
  }

  const sidecarPeople = [];
  if (sidecar.value) {
    const keys = topLevelObjectKeys(sidecarText);
    for (let position = 0; position < keys.length; position++) {
      const key = keys[position];
      const value = sidecar.value[key];
      const personId = findPersonByAlias(store, 'target_talent', key);
      if (!personId) flags.push({ type: 'state_no_person', file: FILES.sidecar, key });
      const validDate = isCalendarDate(value?.updated);
      counts.sidecar_by_state[value?.state ?? ''] = (counts.sidecar_by_state[value?.state ?? ''] ?? 0) + 1;
      sidecarPeople.push({ key, state: value?.state, person_id: personId });
      events.push({
        type: 'legacy_record',
        occurred_on: validDate ? value.updated : importedOn,
        source: 'import',
        evidence_ref: `${FILES.sidecar}#key${position}`,
        dedupe_key: `import:${FILES.sidecar}:position:${position}`,
        definitions_version: definitionsVersion,
        ...(personId ? { person_id: personId } : {}),
        payload: { file: FILES.sidecar, key, value, position, reason: 'state_snapshot' },
      });
    }
    events.push({
      type: 'legacy_record',
      occurred_on: importedOn,
      source: 'import',
      evidence_ref: FILES.sidecar,
      dedupe_key: `import:${FILES.sidecar}:file_order`,
      definitions_version: definitionsVersion,
      payload: { file: FILES.sidecar, keys, reason: 'file_order' },
    });
  }

  if (connections.value) {
    const document = connections.value;
    events.push({
      type: 'legacy_record',
      occurred_on: importedOn,
      source: 'import',
      evidence_ref: FILES.connections,
      dedupe_key: `import:${FILES.connections}:header`,
      definitions_version: definitionsVersion,
      payload: {
        file: FILES.connections,
        importedAt: document.importedAt,
        source: document.source,
        count: document.count,
        key_order: topLevelObjectKeys(connectionsText),
        reason: 'export_header',
      },
    });
    const seenSlugs = new Set();
    for (let index = 0; index < document.connections.length; index++) {
      const entry = document.connections[index];
      let slug = null;
      let personId = null;
      try {
        slug = linkedinIdentifier(entry?.url);
        if (seenSlugs.has(slug)) {
          flags.push({ type: 'duplicate_connection', file: FILES.connections, index });
        } else {
          seenSlugs.add(slug);
        }
        personId = findPerson(store, { linkedin: entry.url });
      } catch {
        flags.push({ type: 'unparseable_url', file: FILES.connections, index });
      }
      const connectedOn = parseConnectedDate(entry?.on);
      if (!connectedOn) {
        flags.push({ type: 'invalid_connected_date', file: FILES.connections, index });
      }
      if (personId) counts.acceptances_linked_to_person++;
      else counts.acceptances_unlinked++;
      const event = {
        type: 'connection_accepted',
        channel: 'linkedin_request',
        occurred_on: connectedOn ?? importedOn,
        source: 'import',
        evidence_ref: `${FILES.connections}#index${index}`,
        dedupe_key: `import:${FILES.connections}:index:${index}`,
        definitions_version: definitionsVersion,
        ...(personId ? { person_id: personId } : {}),
        payload: { file: FILES.connections, index, entry },
      };
      events.push(event);
    }
  }

  if (events.length) appendEvents(store, events);

  const allEvents = eventRows(store);
  const acceptedPeople = new Set(allEvents
    .filter(event => event.type === 'connection_accepted' && event.person_id)
    .map(event => event.person_id));
  const requestedPeople = new Set(allEvents
    .filter(event => event.type === 'connection_request_sent' && event.person_id)
    .map(event => event.person_id));
  for (const snapshot of sidecarPeople) {
    if (!snapshot.person_id) continue;
    if (snapshot.state === 'Connected' && !acceptedPeople.has(snapshot.person_id)) {
      flags.push({ type: 'connected_state_without_export', file: FILES.sidecar, key: snapshot.key });
    }
    if (snapshot.state === 'Invite Pending' && acceptedPeople.has(snapshot.person_id)) {
      flags.push({ type: 'pending_state_but_connected', file: FILES.sidecar, key: snapshot.key });
    }
    if (snapshot.state === 'Invite Pending' && !requestedPeople.has(snapshot.person_id)) {
      flags.push({ type: 'pending_state_without_request', file: FILES.sidecar, key: snapshot.key });
    }
  }

  const requestsByPerson = new Map();
  const acceptancesByPerson = new Map();
  for (const event of allEvents) {
    if (!event.person_id) continue;
    const target = event.type === 'connection_request_sent'
      ? requestsByPerson
      : event.type === 'connection_accepted' ? acceptancesByPerson : null;
    if (!target) continue;
    if (!target.has(event.person_id)) target.set(event.person_id, []);
    target.get(event.person_id).push(event.occurred_on);
  }
  const acceptanceDelays = [];
  for (const [personId, requestDates] of requestsByPerson) {
    const firstRequest = [...requestDates].sort()[0];
    const acceptance = [...(acceptancesByPerson.get(personId) ?? [])]
      .filter(date => date >= firstRequest).sort()[0];
    if (acceptance) acceptanceDelays.push(dayDifference(firstRequest, acceptance));
  }

  return {
    counts,
    accepted_after_request: {
      people: acceptanceDelays.length,
      median_days: median(acceptanceDelays),
    },
    flags,
  };
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

function bytesIdentical(text, rebuilt, { compactOnly = false } = {}) {
  if (text === null) return true;
  const compact = JSON.stringify(rebuilt);
  const variants = compactOnly
    ? [compact, `${compact}\n`]
    : [compact, `${compact}\n`, JSON.stringify(rebuilt, null, 2), `${JSON.stringify(rebuilt, null, 2)}\n`];
  return variants.includes(text);
}

function fileResult(original, rebuilt, originalEntries, rebuiltEntries, options = {}) {
  if (original.missing) {
    return { match: true, bytes_identical: true, original_entries: 0, rebuilt_entries: 0 };
  }
  const orderMatches = options.orderMatches ?? true;
  const match = original.valid && orderMatches && isDeepStrictEqual(original.value, rebuilt);
  return {
    match,
    bytes_identical: original.valid && bytesIdentical(options.text, rebuilt, options),
    original_entries: original.valid ? originalEntries : 0,
    rebuilt_entries: rebuiltEntries,
  };
}

export function compareLinkedIn({ connectsText = null, sidecarText = null, connectionsText = null }, store) {
  const rows = eventRows(store);
  const connectsOriginal = parsedOriginal(connectsText, Array.isArray);
  const connectsEntries = rows
    .filter(event => event.payload.file === FILES.connects && Number.isInteger(event.payload.index))
    .sort((left, right) => left.payload.index - right.payload.index)
    .map(event => event.payload.entry);
  const connects = fileResult(
    connectsOriginal,
    connectsEntries,
    connectsOriginal.value?.length ?? 0,
    connectsEntries.length,
    { text: connectsText },
  );

  const sidecarOriginal = parsedOriginal(
    sidecarText,
    value => value !== null && typeof value === 'object' && !Array.isArray(value),
  );
  const sidecarHeader = rows.find(event => event.payload.file === FILES.sidecar
    && event.payload.reason === 'file_order');
  const sidecarRows = rows
    .filter(event => event.payload.file === FILES.sidecar
      && event.payload.reason === 'state_snapshot')
    .sort((left, right) => left.payload.position - right.payload.position);
  const recordedKeys = sidecarHeader?.payload.keys ?? sidecarRows.map(event => event.payload.key);
  const sidecarRebuilt = {};
  const sidecarByKey = new Map(sidecarRows.map(event => [event.payload.key, event.payload.value]));
  for (const key of recordedKeys) {
    if (sidecarByKey.has(key)) sidecarRebuilt[key] = sidecarByKey.get(key);
  }
  const sidecarResult = fileResult(
    sidecarOriginal,
    sidecarRebuilt,
    sidecarOriginal.value ? Object.keys(sidecarOriginal.value).length : 0,
    Object.keys(sidecarRebuilt).length,
    {
      text: sidecarText,
      orderMatches: sidecarOriginal.valid && sidecarOriginal.value !== null
        && isDeepStrictEqual(
          topLevelObjectKeys(sidecarText),
          sidecarRows.map(event => event.payload.key),
        ),
    },
  );

  const connectionsOriginal = parsedOriginal(
    connectionsText,
    value => value !== null && typeof value === 'object' && !Array.isArray(value)
      && Array.isArray(value.connections),
  );
  const exportHeader = rows.find(event => event.payload.file === FILES.connections
    && event.payload.reason === 'export_header');
  const connectionEntries = rows
    .filter(event => event.payload.file === FILES.connections && Number.isInteger(event.payload.index))
    .sort((left, right) => left.payload.index - right.payload.index)
    .map(event => event.payload.entry);
  const exportValues = {
    importedAt: exportHeader?.payload.importedAt,
    source: exportHeader?.payload.source,
    count: exportHeader?.payload.count,
    connections: connectionEntries,
  };
  const connectionsRebuilt = {};
  for (const key of exportHeader?.payload.key_order ?? []) {
    if (Object.hasOwn(exportValues, key)) connectionsRebuilt[key] = exportValues[key];
  }
  const connectionsResult = fileResult(
    connectionsOriginal,
    connectionsRebuilt,
    connectionsOriginal.value?.connections?.length ?? 0,
    connectionEntries.length,
    { text: connectionsText, compactOnly: true },
  );

  return {
    match: connects.match && sidecarResult.match && connectionsResult.match,
    files: {
      [FILES.connects]: connects,
      [FILES.sidecar]: sidecarResult,
      [FILES.connections]: connectionsResult,
    },
  };
}
