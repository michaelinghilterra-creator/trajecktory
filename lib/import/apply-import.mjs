import { appendEvents, insertEvents, withTransaction } from '../event-store.mjs';

const CORPORATE_WORDS = new Set([
  'inc',
  'llc',
  'corp',
  'corporation',
  'limited',
  'ltd',
  'gmbh',
  'ag',
  'sa',
  'holdings',
  'group',
  'technologies',
  'software',
  'solutions',
  'systems',
  'co',
  'company',
]);

const APPLIED_STATUSES = new Set([
  'applied',
  'phone screen',
  '1st interview',
  '2nd interview',
  '3rd interview',
  'offer',
  'rejected',
  'no response',
]);

const VOID_STATUSES = new Set([
  'evaluated',
  'skip',
  'not a fit',
  'discarded',
  'closed',
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

function usDate(value) {
  const match = String(value).match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  const date = `${match[3]}-${match[1]}-${match[2]}`;
  return isCalendarDate(date) ? date : null;
}

function daysApart(left, right) {
  if (!isCalendarDate(left) || !isCalendarDate(right)) return Infinity;
  return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86400000;
}

function statusKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function evidenceCompanyKey(value) {
  return String(value ?? '')
    .split(/[\s,-]+/)
    .filter(Boolean)
    .filter(token => !CORPORATE_WORDS.has(token.toLowerCase().replace(/[^a-z0-9]/g, '')))
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function kebabName(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function legacyCompanyKey(slug, ownerName, trackerCompanyKeys) {
  const ownerSlug = kebabName(ownerName);
  const lowerSlug = slug.toLowerCase();
  if (ownerSlug && lowerSlug.startsWith(`${ownerSlug}-`)) {
    return evidenceCompanyKey(slug.slice(ownerSlug.length + 1));
  }

  const knownKeys = trackerCompanyKeys instanceof Set
    ? trackerCompanyKeys
    : new Set(trackerCompanyKeys ?? []);
  const tokens = slug.split('-').filter(Boolean);
  for (let index = 0; index < tokens.length; index++) {
    const key = evidenceCompanyKey(tokens.slice(index).join('-'));
    if (knownKeys.has(key)) return key;
  }
  return evidenceCompanyKey(slug);
}

export function parseEvidenceFilename(name, ownerName, trackerCompanyKeys = []) {
  const value = String(name ?? '');
  if (/^cv-/i.test(value)) return { kind: 'cv', companyKey: null, date: null };

  const legacy = value.match(/^cover-letter-(.+)-(\d{4}-\d{2}-\d{2})\.(?:html|pdf)$/i);
  if (legacy && isCalendarDate(legacy[2])) {
    return {
      kind: 'cover_legacy',
      companyKey: legacyCompanyKey(legacy[1], ownerName, trackerCompanyKeys),
      date: legacy[2],
    };
  }

  const resume = value.match(/^.+_Resume_(.+)_(\d{2}-\d{2}-\d{4})(?:_.+)?\.docx$/i);
  if (resume) {
    const date = usDate(resume[2]);
    if (date) return { kind: 'resume', companyKey: evidenceCompanyKey(resume[1]), date };
  }

  const cover = value.match(/^.+_Cover_(.+)_(\d{2}-\d{2}-\d{4})\.(?:html|docx)$/i);
  if (cover) {
    const date = usDate(cover[2]);
    if (date) return { kind: 'cover', companyKey: evidenceCompanyKey(cover[1]), date };
  }

  return { kind: 'unrecognized', companyKey: null, date: null };
}

function loadTrackerRows(store, trackerFile, flags) {
  const prefix = `${trackerFile}#line`;
  const events = store.db.prepare(`
    SELECT id, posting_id, payload
    FROM events
    WHERE type = 'posting_evaluated'
      AND substr(evidence_ref, 1, ?) = ?
    ORDER BY id
  `).all(prefix.length, prefix);
  const rows = [];
  const seen = new Set();
  const duplicateFlags = new Set();
  for (const event of events) {
    const payload = JSON.parse(event.payload);
    const num = payload.num;
    const numKey = String(num);
    if (seen.has(numKey)) {
      if (!duplicateFlags.has(numKey)) {
        flags.push({ type: 'duplicate_num', num });
        duplicateFlags.add(numKey);
      }
      continue;
    }
    seen.add(numKey);
    rows.push({
      num,
      company: payload.company,
      status: payload.status,
      date: payload.date,
      posting_id: event.posting_id ?? undefined,
    });
  }
  return rows;
}

function linkFile(parsed, rows, applyDates) {
  const candidates = rows.filter(row => evidenceCompanyKey(row.company) === parsed.companyKey);
  if (candidates.length === 0) return { type: 'none' };

  const byApplyDate = candidates.filter(row => {
    const value = applyDates[String(row.num)];
    return isCalendarDate(value) && daysApart(value, parsed.date) <= 2;
  });
  if (byApplyDate.length === 1) return { type: 'linked', row: byApplyDate[0], rule: 'a' };

  const byStatus = candidates.filter(row => APPLIED_STATUSES.has(statusKey(row.status))
    && isCalendarDate(row.date)
    && row.date <= parsed.date);
  if (byStatus.length === 1) return { type: 'linked', row: byStatus[0], rule: 'b' };
  if (candidates.length === 1) return { type: 'linked', row: candidates[0], rule: 'c' };
  return { type: 'ambiguous', nums: candidates.map(row => row.num) };
}

function applicationEvent(num, occurredOn, definitionsVersion, postingId, payload) {
  return {
    type: 'application_submitted',
    occurred_on: occurredOn,
    source: 'import',
    definitions_version: definitionsVersion,
    evidence_ref: `apply-evidence:${num}`,
    dedupe_key: `import:apply-evidence:${num}`,
    application_id: String(num),
    ...(postingId ? { posting_id: postingId } : {}),
    payload,
  };
}

function appendUnlinked(store, row, occurredOn, definitionsVersion, payload, reason) {
  appendEvents(store, [applicationEvent(
    row.num,
    occurredOn,
    definitionsVersion,
    null,
    { ...payload, unlinked: true, reason },
  )]);
}

function addLinkedApplication(store, row, occurredOn, definitionsVersion, payload) {
  const applicationId = String(row.num ?? '');
  if (!/^\d+$/.test(applicationId)) throw new Error('application id must contain digits only');
  return withTransaction(store, () => {
    const posting = store.db.prepare('SELECT id FROM postings WHERE id = ?').get(row.posting_id);
    if (!posting) {
      const error = new Error(`posting not found: ${row.posting_id}`);
      error.kind = 'posting_missing';
      throw error;
    }
    const byPosting = store.db.prepare('SELECT id FROM applications WHERE posting_id = ?').get(row.posting_id);
    if (byPosting) {
      const error = new Error('posting already has an application');
      error.kind = 'posting';
      error.existingId = byPosting.id;
      throw error;
    }
    const byId = store.db.prepare('SELECT id FROM applications WHERE id = ?').get(applicationId);
    if (byId) {
      const error = new Error('application id is already taken');
      error.kind = 'application';
      error.existingId = byId.id;
      throw error;
    }
    const [eventId] = insertEvents(store, [applicationEvent(
      row.num,
      occurredOn,
      definitionsVersion,
      row.posting_id,
      payload,
    )]);
    store.db.prepare(
      'INSERT INTO applications (id, posting_id, created_event_id) VALUES (?, ?, ?)',
    ).run(applicationId, row.posting_id, eventId);
  });
}

export function importApplyEvidence(store, {
  applyDates,
  outputFiles,
  trackerFile = 'applications.md',
  definitionsVersion,
  importedOn,
  ownerName,
}) {
  const dates = applyDates && typeof applyDates === 'object' && !Array.isArray(applyDates)
    ? applyDates
    : {};
  const files = Array.isArray(outputFiles) ? outputFiles : [];
  const counts = {
    output_files: files.length,
    resume_files: 0,
    cover_files: 0,
    cover_legacy_files: 0,
    ignored_cv_files: 0,
    unrecognized_files: 0,
    files_linked: 0,
    apply_dates_entries: Object.keys(dates).length,
    applications_linked: 0,
    applications_unlinked: 0,
    applications_total: 0,
  };
  const link_rules = { a: 0, b: 0, c: 0 };
  const evidence_used = { resume: 0, cover: 0, confirmation: 0 };
  const flags = [];
  const rows = loadTrackerRows(store, trackerFile, flags);
  const trackerCompanyKeys = new Set(rows.map(row => evidenceCompanyKey(row.company)));
  const rowByNum = new Map(rows.map(row => [String(row.num), row]));
  const linked = new Map(rows.map(row => [String(row.num), []]));

  for (const name of files) {
    const parsed = parseEvidenceFilename(name, ownerName, trackerCompanyKeys);
    if (parsed.kind === 'cv') {
      counts.ignored_cv_files++;
      continue;
    }
    if (parsed.kind === 'unrecognized') {
      counts.unrecognized_files++;
      continue;
    }
    if (parsed.kind === 'resume') counts.resume_files++;
    if (parsed.kind === 'cover') counts.cover_files++;
    if (parsed.kind === 'cover_legacy') counts.cover_legacy_files++;

    const result = linkFile(parsed, rows, dates);
    if (result.type === 'none') {
      flags.push({ type: 'evidence_without_row', num: null, kind: parsed.kind, date: parsed.date });
      continue;
    }
    if (result.type === 'ambiguous') {
      flags.push({ type: 'ambiguous_evidence', num: null, kind: parsed.kind, date: parsed.date, nums: result.nums });
      continue;
    }
    linked.get(String(result.row.num)).push(parsed);
    counts.files_linked++;
    link_rules[result.rule]++;
  }

  for (const row of rows) {
    const rowFiles = linked.get(String(row.num));
    const resumeDates = rowFiles.filter(file => file.kind === 'resume').map(file => file.date).sort();
    const coverDates = rowFiles.filter(file => file.kind === 'cover' || file.kind === 'cover_legacy')
      .map(file => file.date)
      .sort();
    const hasApplyDate = Object.hasOwn(dates, String(row.num));
    const applyDate = hasApplyDate ? dates[String(row.num)] : null;
    const validApplyDate = hasApplyDate && isCalendarDate(applyDate);
    if (hasApplyDate && !validApplyDate) {
      flags.push({ type: 'invalid_apply_date', num: row.num });
    }
    const hasEvidence = resumeDates.length > 0 || coverDates.length > 0 || hasApplyDate;

    if (APPLIED_STATUSES.has(statusKey(row.status)) && !hasEvidence) {
      flags.push({ type: 'applied_status_without_evidence', num: row.num });
    }
    if (!resumeDates.length && !coverDates.length && hasApplyDate
      && VOID_STATUSES.has(statusKey(row.status))) {
      flags.push({ type: 'possible_void', num: row.num });
    }
    if (resumeDates.length && validApplyDate) {
      const days = daysApart(resumeDates[0], applyDate);
      if (days > 2) flags.push({ type: 'date_disagreement', num: row.num, days });
    }
    if (!hasEvidence) continue;

    const occurredOn = resumeDates[0] ?? coverDates[0] ?? (validApplyDate ? applyDate : importedOn);
    const evidence = resumeDates.length ? 'resume' : coverDates.length ? 'cover' : 'confirmation';
    const payload = {
      evidence,
      resume_dates: resumeDates,
      cover_dates: coverDates,
      ...(hasApplyDate ? { apply_dates_value: applyDate } : {}),
    };
    evidence_used[evidence]++;
    counts.applications_total++;

    if (!row.posting_id) {
      flags.push({ type: 'no_posting', num: row.num });
      appendUnlinked(store, row, occurredOn, definitionsVersion, payload, 'no_posting');
      counts.applications_unlinked++;
      continue;
    }

    try {
      addLinkedApplication(store, row, occurredOn, definitionsVersion, payload);
      counts.applications_linked++;
    } catch (error) {
      if (error.kind === 'posting') {
        flags.push({
          type: 'posting_already_applied',
          num: row.num,
          other_application_id: error.existingId,
        });
      } else if (error.kind === 'application') {
        flags.push({
          type: 'application_id_taken',
          num: row.num,
        });
      }
      appendUnlinked(
        store,
        row,
        occurredOn,
        definitionsVersion,
        payload,
        error.kind === 'posting'
          ? 'posting_already_applied'
          : error.kind === 'application'
            ? 'application_id_taken'
            : 'identity_conflict',
      );
      counts.applications_unlinked++;
    }
  }

  for (const [num, applyDate] of Object.entries(dates)) {
    if (rowByNum.has(String(num))) continue;
    flags.push({ type: 'apply_date_without_row', num });
    const validApplyDate = isCalendarDate(applyDate);
    if (!validApplyDate) flags.push({ type: 'invalid_apply_date', num });
    const payload = {
      evidence: 'confirmation',
      resume_dates: [],
      cover_dates: [],
      apply_dates_value: applyDate,
      unlinked: true,
      reason: 'no_row',
    };
    appendEvents(store, [applicationEvent(
      num,
      validApplyDate ? applyDate : importedOn,
      definitionsVersion,
      null,
      payload,
    )]);
    counts.applications_total++;
    counts.applications_unlinked++;
    evidence_used.confirmation++;
  }

  return { counts, link_rules, evidence_used, flags };
}

export function rebuildApplyDates(store) {
  const rows = store.db.prepare(`
    SELECT application_id, payload
    FROM events
    WHERE type = 'application_submitted'
      AND (evidence_ref LIKE 'apply-evidence:%'
        OR dedupe_key LIKE 'import:apply-evidence:%')
    ORDER BY id
  `).all();
  const rebuilt = {};
  for (const row of rows) {
    const payload = JSON.parse(row.payload);
    if (Object.hasOwn(payload, 'apply_dates_value')) {
      rebuilt[row.application_id] = payload.apply_dates_value;
    }
  }
  return rebuilt;
}

export function compareApplyDates(applyDates, store) {
  const original = applyDates && typeof applyDates === 'object' && !Array.isArray(applyDates)
    ? applyDates
    : {};
  const rebuilt = rebuildApplyDates(store);
  const keys = new Set([...Object.keys(original), ...Object.keys(rebuilt)]);
  let mismatchKeys = 0;
  for (const key of keys) {
    if (!Object.hasOwn(original, key)
      || !Object.hasOwn(rebuilt, key)
      || !Object.is(original[key], rebuilt[key])) mismatchKeys++;
  }
  return {
    match: mismatchKeys === 0,
    original_entries: Object.keys(original).length,
    rebuilt_entries: Object.keys(rebuilt).length,
    mismatch_keys_count: mismatchKeys,
  };
}
