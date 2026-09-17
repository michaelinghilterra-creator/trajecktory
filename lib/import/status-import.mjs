import { ALL_STATUSES } from '../../dashboard-web/server/lib/statuses.mjs';
import { appendEvents } from '../event-store.mjs';
import { companyKey } from '../identity-store.mjs';

const SAME_DAY_REVERT_STATUSES = new Set([
  'Evaluated',
  'SKIP',
  'Not a Fit',
  'Discarded',
  'Closed',
]);

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

function parsedLines(text) {
  return String(text ?? '').split('\n').map((raw, lineIndex) => {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '') return { kind: 'blank', lineIndex, line };
    if (line.startsWith('app#')) return { kind: 'header', lineIndex, line };
    return { kind: 'row', lineIndex, line, cells: line.split('\t') };
  });
}

function trackerRows(store, trackerFile) {
  const prefix = `${trackerFile}#line`;
  const rows = store.db.prepare(`
    SELECT payload
    FROM events
    WHERE type = 'posting_evaluated'
      AND substr(evidence_ref, 1, ?) = ?
    ORDER BY id
  `).all(prefix.length, prefix);
  const byApp = new Map();
  for (const row of rows) {
    const payload = JSON.parse(row.payload);
    const app = String(payload.num ?? '');
    if (!byApp.has(app)) byApp.set(app, payload);
  }
  return byApp;
}

function importedApplicationIds(store) {
  const ids = new Set(
    store.db.prepare('SELECT id FROM applications ORDER BY id').all().map(row => String(row.id)),
  );
  const events = store.db.prepare(`
    SELECT application_id
    FROM events
    WHERE type = 'application_submitted'
      AND evidence_ref LIKE 'apply-evidence:%'
    ORDER BY id
  `).all();
  for (const event of events) {
    if (event.application_id !== null) ids.add(String(event.application_id));
  }
  return ids;
}

function keysDiffer(left, right) {
  if (!String(left ?? '').trim() || !String(right ?? '').trim()) return false;
  try {
    return companyKey(left) !== companyKey(right);
  } catch {
    return false;
  }
}

export function importStatusHistory(store, text, {
  definitionsVersion,
  importedOn,
  file = 'status-events.tsv',
  trackerFile = 'applications.md',
}) {
  const lines = parsedLines(text);
  const counts = {
    lines: lines.length,
    header_lines: 0,
    blank_lines: 0,
    events: 0,
    apps_with_history: 0,
    legacy_rows: 0,
  };
  const statusCounts = {};
  const canonicalStatuses = new Set(ALL_STATUSES);
  const flags = [];
  const trackerByApp = trackerRows(store, trackerFile);
  const applicationIds = importedApplicationIds(store);
  const appsWithHistory = new Set();
  const lastByApp = new Map();
  const lastLineByApp = new Map();
  const appliedDatesByApp = new Map();
  const appsWithAppliedEvent = new Set();

  for (const entry of lines) {
    if (entry.kind === 'blank') {
      counts.blank_lines++;
      continue;
    }
    if (entry.kind === 'header') {
      counts.header_lines++;
      continue;
    }

    const { cells, lineIndex } = entry;
    const appCell = cells[0] ?? '';
    const app = /^\d+$/.test(appCell.trim()) ? appCell.trim() : null;
    const date = (cells[1] ?? '').trim();
    const status = (cells[2] ?? '').trim();
    const logged = (cells[4] ?? '').trim();
    const validDate = isCalendarDate(date);
    const validLogged = isCalendarDate(logged);
    const flag = type => flags.push({ type, line_index: lineIndex, ...(app ? { app } : {}) });

    if (!app) flag('invalid_app_id');
    if (!validDate) flag('invalid_date');
    if (cells.length >= 5 && logged && !validLogged) flag('invalid_logged');
    if (!canonicalStatuses.has(status)) flag('unknown_status');
    if (cells.length === 4) {
      flag('legacy_row');
      counts.legacy_rows++;
    }
    if (cells.length < 4 || cells.length > 5) flag('odd_cell_count');
    if (validDate && validLogged && date > logged) flag('date_after_logged');

    const statusBucket = canonicalStatuses.has(status) ? status : 'other';
    statusCounts[statusBucket] = (statusCounts[statusBucket] ?? 0) + 1;

    if (app) {
      appsWithHistory.add(app);
      lastLineByApp.set(app, lineIndex);
      const tracker = trackerByApp.get(app);
      if (!tracker) flag('no_tracker_row');
      else if (keysDiffer(cells[3] ?? '', tracker.company)) flag('company_mismatch');

      const previous = lastByApp.get(app);
      if (previous && previous.date === date && previous.status === status) {
        flag('duplicate_consecutive');
      }
      const appliedDates = appliedDatesByApp.get(app) ?? new Set();
      if (SAME_DAY_REVERT_STATUSES.has(status) && appliedDates.has(date)) {
        flag('same_day_revert');
      }
      if (status === 'Applied') {
        appliedDates.add(date);
        appliedDatesByApp.set(app, appliedDates);
        appsWithAppliedEvent.add(app);
      }
      lastByApp.set(app, { date, status });
    }

    appendEvents(store, [{
      type: 'status_changed',
      occurred_on: validDate ? date : importedOn,
      source: 'import',
      definitions_version: definitionsVersion,
      evidence_ref: `${file}#line${lineIndex}`,
      dedupe_key: `import:${file}:line:${lineIndex}`,
      ...(app ? { application_id: app } : {}),
      payload: {
        line_index: lineIndex,
        cells,
        cell_count: cells.length,
      },
    }]);
    counts.events++;
  }

  counts.apps_with_history = appsWithHistory.size;
  for (const [app, last] of lastByApp) {
    const tracker = trackerByApp.get(app);
    if (tracker && last.status !== tracker.status) {
      flags.push({
        type: 'history_differs_from_tracker',
        line_index: lastLineByApp.get(app),
        app,
      });
    }
  }
  for (const app of applicationIds) {
    if (!appsWithAppliedEvent.has(app)) {
      flags.push({
        type: 'applied_application_without_applied_event',
        line_index: lastLineByApp.get(app) ?? null,
        app,
      });
    }
  }

  return { counts, status_counts: statusCounts, flags };
}

export function rebuildStatusRows(store, file = 'status-events.tsv') {
  const prefix = `${file}#line`;
  return store.db.prepare(`
    SELECT payload
    FROM events
    WHERE type = 'status_changed'
      AND substr(evidence_ref, 1, ?) = ?
    ORDER BY id
  `).all(prefix.length, prefix)
    .map(event => JSON.parse(event.payload))
    .sort((left, right) => left.line_index - right.line_index)
    .map(payload => payload.cells);
}

export function compareStatusHistory(text, store, file = 'status-events.tsv') {
  const originalEntries = parsedLines(text).filter(entry => entry.kind === 'row');
  const rebuiltRows = rebuildStatusRows(store, file);
  const positions = Math.max(originalEntries.length, rebuiltRows.length);
  let mismatchPositions = 0;
  for (let position = 0; position < positions; position++) {
    const original = originalEntries[position]?.cells;
    const rebuilt = rebuiltRows[position];
    if (!original || !rebuilt || original.length !== rebuilt.length
      || original.some((cell, index) => cell !== rebuilt[index])) {
      mismatchPositions++;
    }
  }

  let renderedIdentical = 0;
  let renderedDifferent = 0;
  for (let position = 0; position < rebuiltRows.length; position++) {
    if (rebuiltRows[position].join('\t') === originalEntries[position]?.line) renderedIdentical++;
    else renderedDifferent++;
  }

  return {
    match: mismatchPositions === 0,
    original_rows: originalEntries.length,
    rebuilt_rows: rebuiltRows.length,
    mismatch_positions_count: mismatchPositions,
    rendered_identical: renderedIdentical,
    rendered_different: renderedDifferent,
  };
}
