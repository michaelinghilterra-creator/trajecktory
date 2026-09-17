import { appendEvents } from '../event-store.mjs';

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

function splitRowCells(raw) {
  return raw.split(/(?<!\\)\|/).map(cell => cell.trim());
}

function parseRows(text) {
  const lines = String(text ?? '').split('\n').map(line => line.replace(/\r$/, ''));
  const rows = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex];
    if (!raw.startsWith('|')) continue;
    const cells = splitRowCells(raw);
    if (cells.length < 10) continue;
    const n = parseInt(cells[1], 10);
    if (Number.isNaN(n)) continue;
    rows.push({ raw, cells, n, lineIndex });
  }
  return { lines, rows };
}

function trackerNumbers(store, trackerFile) {
  const prefix = `${trackerFile}#line`;
  const numbers = new Set();
  const events = store.db.prepare(`
    SELECT payload
    FROM events
    WHERE type = 'posting_evaluated'
      AND substr(evidence_ref, 1, ?) = ?
  `).all(prefix.length, prefix);
  for (const event of events) {
    const num = JSON.parse(event.payload).num;
    if (num !== undefined && num !== null) numbers.add(String(num));
  }
  return numbers;
}

function classification(row, earlierRows) {
  const notes = row.cells[8];
  if (/^Cross-logged from/i.test(notes)) return 'cross_log_copy';
  if (/^back-?fill/i.test(notes)) return 'backfill';
  const contact = row.cells[7];
  if (/^(?:SKIP|SKP)$/i.test(contact) || /^(?:SKIP|SKP)$/i.test(notes)) {
    return 'skip_placeholder';
  }
  const content = row.cells.slice(2, 9).join('\0');
  if (earlierRows.has(content)) return 'duplicate_row';
  const channel = row.cells[6].toLowerCase();
  if (channel !== 'email' && channel !== 'linkedin') return 'unknown_channel';
  return 'direct';
}

function addFlag(flags, type, row) {
  flags.push({ type, line_index: row.lineIndex, n: row.n });
}

export function importFollowups(store, text, {
  definitionsVersion,
  importedOn,
  file = 'follow-ups.md',
  trackerFile = 'applications.md',
}) {
  const parsed = parseRows(text);
  const counts = {
    lines: parsed.lines.length,
    non_row_lines: parsed.lines.length - parsed.rows.length,
    rows: parsed.rows.length,
    direct: 0,
    cross_log_copy: 0,
    backfill: 0,
    skip_placeholder: 0,
    duplicate_row: 0,
    unknown_channel: 0,
  };
  const directByChannel = { email: 0, linkedin_message: 0 };
  const flags = [];
  const events = [];
  const earlierRows = new Set();
  const earlierNumbers = new Set();
  const knownTrackerNumbers = trackerNumbers(store, trackerFile);

  for (const row of parsed.rows) {
    const reason = classification(row, earlierRows);
    counts[reason]++;

    const appNum = row.cells[2];
    const validAppNum = /^\d+$/.test(appNum);
    const date = row.cells[3];
    const validDate = isCalendarDate(date);
    const channel = row.cells[6].toLowerCase();
    const notes = row.cells[8];

    if (!validDate) addFlag(flags, 'invalid_date', row);
    if (!validAppNum) addFlag(flags, 'invalid_app_num', row);
    else if (!knownTrackerNumbers.has(appNum)) addFlag(flags, 'no_tracker_row', row);
    if (reason === 'direct') addFlag(flags, 'no_person_link', row);
    if (channel === 'email'
      && /connection request|connect(ion)? (request|invite)|linkedin invite|invite sent/i.test(notes)) {
      addFlag(flags, 'linkedin_request_in_email_channel', row);
    }
    if (row.cells.length > 10) addFlag(flags, 'extra_cells', row);
    if (earlierNumbers.has(row.n)) addFlag(flags, 'duplicate_n', row);

    const common = {
      occurred_on: validDate ? date : importedOn,
      source: 'import',
      definitions_version: definitionsVersion,
      evidence_ref: `${file}#line${row.lineIndex}`,
      dedupe_key: `import:${file}:line:${row.lineIndex}`,
      ...(validAppNum ? { application_id: appNum } : {}),
    };
    if (reason === 'direct') {
      const eventChannel = channel === 'email' ? 'email' : 'linkedin_message';
      directByChannel[eventChannel]++;
      events.push({
        ...common,
        type: 'message_sent',
        channel: eventChannel,
        payload: { file, line_index: row.lineIndex, raw: row.raw },
      });
    } else {
      events.push({
        ...common,
        type: 'legacy_record',
        payload: { file, line_index: row.lineIndex, raw: row.raw, reason },
      });
    }

    earlierRows.add(row.cells.slice(2, 9).join('\0'));
    earlierNumbers.add(row.n);
  }

  if (events.length) appendEvents(store, events);
  return { counts, direct_by_channel: directByChannel, flags };
}

export function rebuildFollowupRows(store, file = 'follow-ups.md') {
  return store.db.prepare(`
    SELECT payload
    FROM events
    WHERE json_extract(payload, '$.file') = ?
      AND json_type(payload, '$.line_index') IS NOT NULL
      AND json_type(payload, '$.raw') IS NOT NULL
  `).all(file)
    .map(event => JSON.parse(event.payload))
    .sort((left, right) => left.line_index - right.line_index)
    .map(payload => payload.raw);
}

export function compareFollowups(text, store, file = 'follow-ups.md') {
  const original = parseRows(text).rows.map(row => row.raw);
  const rebuilt = rebuildFollowupRows(store, file);
  const length = Math.max(original.length, rebuilt.length);
  let mismatchPositionsCount = 0;
  for (let index = 0; index < length; index++) {
    if (original[index] !== rebuilt[index]) mismatchPositionsCount++;
  }
  return {
    match: mismatchPositionsCount === 0,
    original_rows: original.length,
    rebuilt_rows: rebuilt.length,
    mismatch_positions_count: mismatchPositionsCount,
  };
}
