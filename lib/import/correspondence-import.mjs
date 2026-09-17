import { parseCorrespondence } from '../../dashboard-web/server/lib/correspondence-format.mjs';
import { parseTargetTalentText } from '../../dashboard-web/server/lib/target-talent.mjs';
import { appendEvents } from '../event-store.mjs';
import { findPersonByAlias, resolvePersonId } from '../identity-store.mjs';

const DIRECTORIES = Object.freeze({
  target_talent: 'target-talent-correspondence',
  referral: 'referral-correspondence',
});

const REQUEST_PATTERN = /connection request|connect(ion)? (request|invite)|linkedin invite|invite sent/i;

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

function numericFileSort(left, right) {
  const leftId = Number.parseInt(left, 10);
  const rightId = Number.parseInt(right, 10);
  if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
    return leftId - rightId;
  }
  return left.localeCompare(right);
}

function splitSegments(text) {
  const source = String(text ?? '');
  const starts = [...source.matchAll(/^## /gm)].map(match => match.index);
  if (!starts.length) return [source];
  const segments = [source.slice(0, starts[0])];
  for (let index = 0; index < starts.length; index++) {
    segments.push(source.slice(starts[index], starts[index + 1]));
  }
  return segments;
}

function splitRowCells(raw) {
  return String(raw ?? '').split(/(?<!\\)\|/).map(cell => cell.trim());
}

function parseCopy(event) {
  const payload = event.payload;
  const cells = splitRowCells(payload.raw);
  if (cells.length < 10) return null;
  const notes = cells[8];
  const match = notes.match(
    /^Cross-logged from Talent Acquisition\s*·\s*(.*?)\s*·\s*Subject:\s*(.*?)\s*$/i,
  );
  if (!match) return null;
  return {
    line_index: payload.line_index,
    application_id: cells[2],
    date: cells[3],
    contact: cells[7].trim(),
    company: match[1].trim(),
    subject: match[2].trim(),
  };
}

function targetTalentAliasRows(store) {
  const rowsById = new Map();
  const events = store.db.prepare(`
    SELECT person_id, payload
    FROM events
    WHERE type IN ('person_added', 'person_updated')
      AND json_extract(payload, '$.file') = 'target-talent.md'
      AND json_type(payload, '$.raw') IS NOT NULL
    ORDER BY id
  `).all();
  for (const event of events) {
    const payload = JSON.parse(event.payload);
    const parsed = parseTargetTalentText(payload.raw, {});
    for (const row of parsed) {
      const id = String(row.id);
      if (!rowsById.has(id)) rowsById.set(id, []);
      rowsById.get(id).push({
        name: [row.first, row.last].filter(Boolean).join(' ').trim(),
        company: String(row.company ?? '').trim(),
        person_id: event.person_id ? resolvePersonId(store, event.person_id) : null,
      });
    }
  }
  return rowsById;
}

function copyLinks(store, entries, followupsFile, flags) {
  const aliasRows = targetTalentAliasRows(store);
  const copies = store.db.prepare(`
    SELECT payload
    FROM events
    WHERE type = 'legacy_record'
      AND json_extract(payload, '$.file') = ?
      AND json_extract(payload, '$.reason') = 'cross_log_copy'
    ORDER BY id
  `).all(followupsFile)
    .map(event => parseCopy({ payload: JSON.parse(event.payload) }))
    .filter(Boolean);
  const applicationIdsByEntry = new Map();
  let copiesLinked = 0;
  let copiesWithoutSource = 0;

  for (const copy of copies) {
    const matches = entries.filter(entry => {
      if (entry.source !== 'target_talent' || entry.message?.direction !== 'Sent') return false;
      if (entry.date !== copy.date || entry.message.subject.trim() !== copy.subject) return false;
      const rows = aliasRows.get(entry.id) ?? [];
      return rows.some(row => row.person_id === entry.person_id
        && row.name.trim() === copy.contact
        && row.company.trim() === copy.company);
    });
    if (matches.length === 0) {
      flags.push({ type: 'copy_without_source', line_index: copy.line_index });
      copiesWithoutSource++;
      continue;
    }
    if (matches.length > 1) {
      flags.push({ type: 'copy_matches_several_entries', line_index: copy.line_index });
      continue;
    }
    const entry = matches[0];
    if (!applicationIdsByEntry.has(entry)) applicationIdsByEntry.set(entry, new Set());
    applicationIdsByEntry.get(entry).add(copy.application_id);
    copiesLinked++;
  }

  return { applicationIdsByEntry, copiesLinked, copiesWithoutSource };
}

function applicationSort(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}

function parsedFiles(store, source, files, flags) {
  const dir = DIRECTORIES[source];
  const parsed = [];
  for (const file of Object.keys(files ?? {}).sort(numericFileSort)) {
    const id = file.replace(/\.md$/i, '');
    const personId = findPersonByAlias(store, source, id);
    if (!personId) flags.push({ type: 'no_person', dir, file, segment_index: 0 });
    const segments = splitSegments(files[file]);
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      const raw = segments[segmentIndex];
      const messages = segmentIndex === 0 ? [] : parseCorrespondence(raw);
      const message = messages.length === 1 ? messages[0] : null;
      const date = message?.timestamp.slice(0, 10) ?? null;
      parsed.push({
        source,
        dir,
        file,
        id,
        person_id: personId,
        segment_index: segmentIndex,
        raw,
        message,
        date,
      });
      if (segmentIndex > 0 && !message) {
        flags.push({ type: 'unparsed_heading', dir, file, segment_index: segmentIndex });
      }
    }
  }
  return parsed;
}

export function importCorrespondence(store, {
  targetTalentFiles = {},
  referralFiles = {},
  definitionsVersion,
  importedOn,
  followupsFile = 'follow-ups.md',
}) {
  const flags = [];
  const segments = [
    ...parsedFiles(store, 'target_talent', targetTalentFiles, flags),
    ...parsedFiles(store, 'referral', referralFiles, flags),
  ];
  const entries = segments.filter(segment => segment.message);
  const links = copyLinks(store, entries, followupsFile, flags);
  const counts = {
    target_talent_files: Object.keys(targetTalentFiles ?? {}).length,
    referral_files: Object.keys(referralFiles ?? {}).length,
    segments: segments.length,
    entries: entries.length,
    messages_sent: 0,
    connection_requests: 0,
    messages_received: 0,
    drafts: 0,
    legacy_records: 0,
    copies_linked: links.copiesLinked,
    copies_without_source: links.copiesWithoutSource,
  };
  const byChannel = {
    messages_sent: { email: 0, linkedin_message: 0 },
    connection_requests: { linkedin_request: 0 },
    messages_received: { email: 0, linkedin_message: 0 },
  };
  const events = [];
  const pendingRequestKeys = new Set();
  const eventByDedupeKey = store.db.prepare('SELECT id FROM events WHERE dedupe_key = ?');

  for (const segment of segments) {
    const { message } = segment;
    const validDate = message ? isCalendarDate(segment.date) : false;
    if (message && !validDate) {
      flags.push({
        type: 'invalid_date',
        dir: segment.dir,
        file: segment.file,
        segment_index: segment.segment_index,
      });
    }
    if (message && !message.timestamp.includes(' ')) {
      flags.push({
        type: 'no_time',
        dir: segment.dir,
        file: segment.file,
        segment_index: segment.segment_index,
      });
    }

    const payload = {
      dir: segment.dir,
      file: segment.file,
      segment_index: segment.segment_index,
      raw: segment.raw,
      direction: message?.direction ?? null,
      subject_present: Boolean(message?.subject),
    };
    const common = {
      occurred_on: validDate ? segment.date : importedOn,
      source: 'import',
      evidence_ref: `${segment.dir}/${segment.file}#segment${segment.segment_index}`,
      definitions_version: definitionsVersion,
      ...(segment.person_id ? { person_id: segment.person_id } : {}),
    };
    const importDedupeKey = `import:${segment.dir}/${segment.file}:segment:${segment.segment_index}`;
    let event;

    if (!message) {
      counts.legacy_records++;
      event = {
        ...common,
        type: 'legacy_record',
        dedupe_key: importDedupeKey,
        payload: { ...payload, reason: segment.segment_index === 0 ? 'preamble' : 'unparsed' },
      };
    } else if (message.direction === 'Draft') {
      counts.drafts++;
      counts.legacy_records++;
      event = {
        ...common,
        type: 'legacy_record',
        dedupe_key: importDedupeKey,
        payload: { ...payload, reason: 'draft' },
      };
    } else if (message.direction === 'Received') {
      const channel = message.channel === 'LinkedIn' ? 'linkedin_message' : 'email';
      counts.messages_received++;
      byChannel.messages_received[channel]++;
      event = {
        ...common,
        type: 'message_received',
        channel,
        dedupe_key: importDedupeKey,
        payload: { ...payload, reply_type: 'unclassified' },
      };
    } else {
      const firstBody = message.body.slice(0, 200);
      const isRequest = !/^\s*RE:/i.test(message.subject)
        && (REQUEST_PATTERN.test(message.subject) || REQUEST_PATTERN.test(firstBody));
      if (isRequest) {
        if (message.channel === 'Email') {
          flags.push({
            type: 'request_logged_on_email_channel',
            dir: segment.dir,
            file: segment.file,
            segment_index: segment.segment_index,
          });
        }
        // Key on the date the event is actually recorded under, so two requests
        // with invalid dates that both fall back to importedOn still dedupe.
        const requestKey = segment.person_id
          ? `li_request:${segment.person_id}:${validDate ? segment.date : importedOn}`
          : null;
        const duplicate = requestKey
          && (pendingRequestKeys.has(requestKey) || eventByDedupeKey.get(requestKey));
        if (duplicate) {
          counts.legacy_records++;
          flags.push({
            type: 'duplicate_request_same_day',
            dir: segment.dir,
            file: segment.file,
            segment_index: segment.segment_index,
          });
          event = {
            ...common,
            type: 'legacy_record',
            dedupe_key: importDedupeKey,
            payload: { ...payload, reason: 'duplicate_request_same_day' },
          };
        } else {
          if (requestKey) pendingRequestKeys.add(requestKey);
          counts.connection_requests++;
          byChannel.connection_requests.linkedin_request++;
          event = {
            ...common,
            type: 'connection_request_sent',
            channel: 'linkedin_request',
            dedupe_key: requestKey ?? importDedupeKey,
            payload,
          };
        }
      } else {
        const channel = message.channel === 'LinkedIn' ? 'linkedin_message' : 'email';
        counts.messages_sent++;
        byChannel.messages_sent[channel]++;
        event = {
          ...common,
          type: 'message_sent',
          channel,
          dedupe_key: importDedupeKey,
          payload,
        };
      }
    }

    const applicationIds = [...(links.applicationIdsByEntry.get(segment) ?? [])]
      .sort(applicationSort);
    if (applicationIds.length) {
      event.payload.application_ids = applicationIds;
      if (applicationIds.length === 1) event.application_id = applicationIds[0];
    }
    events.push(event);
  }

  if (events.length) appendEvents(store, events);
  return { counts, by_channel: byChannel, flags };
}

export function rebuildCorrespondenceFiles(store, dir) {
  const rows = store.db.prepare(`
    SELECT payload
    FROM events
    WHERE json_extract(payload, '$.dir') = ?
      AND json_type(payload, '$.file') IS NOT NULL
      AND json_type(payload, '$.segment_index') IS NOT NULL
      AND json_type(payload, '$.raw') IS NOT NULL
    ORDER BY id
  `).all(dir);
  const byFile = new Map();
  for (const row of rows) {
    const payload = JSON.parse(row.payload);
    if (!byFile.has(payload.file)) byFile.set(payload.file, []);
    byFile.get(payload.file).push(payload);
  }
  return Object.fromEntries([...byFile.entries()]
    .sort(([left], [right]) => numericFileSort(left, right))
    .map(([file, segments]) => [
      file,
      segments.sort((left, right) => left.segment_index - right.segment_index)
        .map(segment => segment.raw).join(''),
    ]));
}

function compareDirectory(original, rebuilt) {
  const originalFiles = Object.keys(original ?? {}).sort(numericFileSort);
  const rebuiltFiles = Object.keys(rebuilt).sort(numericFileSort);
  const allFiles = [...new Set([...originalFiles, ...rebuiltFiles])].sort(numericFileSort);
  const mismatchedFilesCount = allFiles.filter(file => original?.[file] !== rebuilt[file]).length;
  return {
    match: mismatchedFilesCount === 0,
    files: originalFiles.length,
    rebuilt_files: rebuiltFiles.length,
    mismatched_files_count: mismatchedFilesCount,
  };
}

export function compareCorrespondence({ targetTalentFiles = {}, referralFiles = {} }, store) {
  const targetTalent = compareDirectory(
    targetTalentFiles,
    rebuildCorrespondenceFiles(store, DIRECTORIES.target_talent),
  );
  const referral = compareDirectory(
    referralFiles,
    rebuildCorrespondenceFiles(store, DIRECTORIES.referral),
  );
  return {
    match: targetTalent.match && referral.match,
    files: targetTalent.files + referral.files,
    rebuilt_files: targetTalent.rebuilt_files + referral.rebuilt_files,
    mismatched_files_count: targetTalent.mismatched_files_count + referral.mismatched_files_count,
    target_talent: targetTalent,
    referral,
  };
}
