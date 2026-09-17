import { appendEvents } from '../event-store.mjs';
import {
  IdentityConflictError,
  companyKey,
  resolveCompany,
  resolveCompanyId,
  resolvePosting,
} from '../identity-store.mjs';
import { sameRole } from '../identity.mjs';
import { recordFileLayout } from '../legacy-files.mjs';
import {
  TRACKER_COLUMNS,
  formatTrackerLine,
  hasStrayPipe,
  parseTrackerLine,
} from '../tracker.mjs';

const ROW_FIELDS = Object.freeze([
  'num',
  'date',
  'company',
  'role',
  'score',
  'status',
  'pdf',
  'resume',
  'report',
  'notes',
  'url',
  'urlCell',
  'cellCount',
  'reportPath',
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

function reportPath(report) {
  const match = String(report ?? '').match(/\[.*?\]\((.*?)\)/);
  return match ? match[1] : (report || null);
}

function rowShape(row) {
  return {
    num: row.num,
    date: row.date,
    company: row.company,
    role: row.role,
    score: row.score,
    status: row.status,
    pdf: row.pdf,
    resume: row.resume,
    report: row.report,
    notes: row.notes,
    url: row.url,
    urlCell: row.urlCell,
    cellCount: row.cellCount,
    reportPath: row.reportPath,
  };
}

function payloadFor(row, lineIndex) {
  return {
    line_index: lineIndex,
    raw: row.raw,
    num: row.num,
    date: row.date,
    company: row.company,
    role: row.role,
    score: row.score,
    status: row.status,
    pdf: row.pdf,
    resume: row.resume,
    report: row.report,
    notes: row.notes,
    url: row.url,
    url_cell: row.urlCell,
    cell_count: row.cellCount,
  };
}

function existingPostingId(error) {
  return error.conflicts?.find(conflict => conflict.kind === 'canonical_url')?.existingId
    ?? error.conflicts?.[0]?.existingId;
}

function mergeCandidates(store, importedCompanyIds) {
  const companies = store.db.prepare(`
    SELECT company_id, key
    FROM company_keys
    ORDER BY key, company_id
  `).all().filter(company => importedCompanyIds.has(company.company_id));
  const candidates = [];
  for (let left = 0; left < companies.length; left++) {
    for (let right = left + 1; right < companies.length; right++) {
      const first = companies[left];
      const second = companies[right];
      if (first.company_id === second.company_id) continue;
      let shorter = first;
      let longer = second;
      if (shorter.key.length > longer.key.length) [shorter, longer] = [longer, shorter];
      if (shorter.key.length < 4 || shorter.key === longer.key || !longer.key.startsWith(shorter.key)) continue;
      candidates.push({
        a_company_id: shorter.company_id,
        b_company_id: longer.company_id,
        a_key: shorter.key,
        b_key: longer.key,
      });
    }
  }
  return candidates;
}

function sameRolePostings(store, importedRows) {
  const rowsByCompany = new Map();
  for (const row of importedRows) {
    const companyId = resolveCompanyId(store, row.company_id);
    if (!rowsByCompany.has(companyId)) rowsByCompany.set(companyId, []);
    rowsByCompany.get(companyId).push(row);
  }

  const groups = [];
  for (const [companyId, rows] of rowsByCompany) {
    const visited = new Set();
    for (let start = 0; start < rows.length; start++) {
      if (visited.has(start)) continue;
      const indexes = [];
      const pending = [start];
      visited.add(start);
      while (pending.length) {
        const current = pending.pop();
        indexes.push(current);
        for (let candidate = 0; candidate < rows.length; candidate++) {
          if (visited.has(candidate) || !sameRole(rows[current].role, rows[candidate].role)) continue;
          visited.add(candidate);
          pending.push(candidate);
        }
      }

      if (indexes.length < 2) continue;
      indexes.sort((a, b) => a - b);
      const members = indexes.map(index => rows[index]);
      const postingIds = [...new Set(members.map(row => row.posting_id).filter(Boolean))];
      const allSamePosting = members.every(row => (
        row.posting_id && row.posting_id === members[0].posting_id
      ));
      if (allSamePosting) continue;
      const everyRowHasPosting = members.every(row => row.posting_id);
      const missingUrl = members.some(row => !row.has_url);
      groups.push({
        company_id: companyId,
        nums: members.map(row => row.num),
        posting_ids: postingIds,
        reason: missingUrl
          ? 'missing_url'
          : (everyRowHasPosting && postingIds.length > 1 ? 'different_urls' : 'mixed'),
      });
    }
  }
  return groups;
}

function firstCompanyWord(name) {
  return String(name ?? '').trim().split(/\s+/, 1)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
}

function companyWordCandidates(firstNames, mergeCandidateList) {
  const existingPairs = new Set(mergeCandidateList.map(candidate => (
    [candidate.a_company_id, candidate.b_company_id].sort().join('\0')
  )));
  const companies = [...firstNames].map(([companyId, name]) => ({
    companyId,
    firstWord: firstCompanyWord(name),
  }));
  const candidates = [];
  for (let left = 0; left < companies.length; left++) {
    for (let right = left + 1; right < companies.length; right++) {
      const first = companies[left];
      const second = companies[right];
      if (first.companyId === second.companyId
        || first.firstWord.length < 5
        || first.firstWord !== second.firstWord) continue;
      const pairKey = [first.companyId, second.companyId].sort().join('\0');
      if (existingPairs.has(pairKey)) continue;
      candidates.push({
        a_company_id: first.companyId,
        b_company_id: second.companyId,
        shared_word_length: first.firstWord.length,
      });
    }
  }
  return candidates;
}

export function importTracker(store, text, {
  definitionsVersion,
  importedOn,
  file = 'applications.md',
  exists = true,
}) {
  const lines = String(text ?? '').split('\n');
  const counts = {
    lines: lines.length,
    rows: 0,
    non_row_lines: 0,
    companies_created: 0,
    companies_reused: 0,
    postings_created: 0,
    postings_reused: 0,
    evaluations: 0,
  };
  const flags = [];
  const seenNums = new Set();
  const postingNums = new Map();
  const spellings = new Map();
  const importedCompanyIds = new Set();
  const importedRows = [];
  const firstCompanyNames = new Map();
  const rowLineIndexes = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].replace(/\r$/, '');
    const row = parseTrackerLine(line);
    if (!row) {
      counts.non_row_lines++;
      continue;
    }
    counts.rows++;
    rowLineIndexes.push(lineIndex);

    const flag = (type, extra = {}) => flags.push({ type, line_index: lineIndex, num: row.num, ...extra });
    if (seenNums.has(row.num)) flag('duplicate_num');
    seenNums.add(row.num);
    if (!row.role) flag('no_role');
    const localUrl = !row.url && /^local:/i.test(row.urlCell) ? row.urlCell : null;
    if (!row.url && !localUrl) flag('no_url');
    if (hasStrayPipe(row)) flag('stray_cell');

    const validDate = isCalendarDate(row.date);
    const occurredOn = validDate ? row.date : importedOn;
    if (!validDate) flag('invalid_date');
    const evidenceRef = `${file}#line${lineIndex}`;
    const ctx = {
      occurred_on: occurredOn,
      source: 'import',
      definitions_version: definitionsVersion,
      evidence_ref: evidenceRef,
    };

    let companyId;
    try {
      companyKey(row.company);
      const company = resolveCompany(store, row.company, ctx);
      companyId = company.id;
      importedCompanyIds.add(companyId);
      if (!firstCompanyNames.has(companyId)) firstCompanyNames.set(companyId, row.company);
      counts[company.created ? 'companies_created' : 'companies_reused']++;
      if (!spellings.has(companyId)) spellings.set(companyId, new Set());
      spellings.get(companyId).add(row.company);
    } catch (error) {
      if (String(error?.message).includes('company name must produce a non-empty key')) flag('no_company');
      else throw error;
    }

    let postingId;
    if (companyId && row.role) {
      try {
        const posting = resolvePosting(store, {
          companyId,
          title: row.role,
          url: row.url ?? localUrl,
        }, ctx);
        postingId = posting.id;
        counts[posting.created ? 'postings_created' : 'postings_reused']++;
      } catch (error) {
        if (error instanceof IdentityConflictError) {
          flag('url_owned_by_other_company', { existing_posting_id: existingPostingId(error) });
        } else {
          throw error;
        }
      }
    }

    if (postingId) {
      if (!postingNums.has(postingId)) postingNums.set(postingId, []);
      postingNums.get(postingId).push(row.num);
    }

    if (companyId && row.role) {
      importedRows.push({
        num: row.num,
        company_id: companyId,
        role: row.role,
        posting_id: postingId,
        has_url: Boolean(row.url ?? localUrl),
      });
    }

    appendEvents(store, [{
      type: 'posting_evaluated',
      occurred_on: occurredOn,
      source: 'import',
      definitions_version: definitionsVersion,
      evidence_ref: evidenceRef,
      dedupe_key: `import:${file}:line:${lineIndex}`,
      ...(companyId ? { company_id: companyId } : {}),
      ...(postingId ? { posting_id: postingId } : {}),
      payload: payloadFor(row, lineIndex),
    }]);
    counts.evaluations++;
  }

  if (file === 'applications.md') {
    recordFileLayout(store, {
      file,
      text,
      exists,
      rowLineIndexes,
      definitionsVersion,
      importedOn,
    });
  }

  const mergeCandidateList = mergeCandidates(store, importedCompanyIds);
  return {
    counts,
    flags,
    shared_postings: [...postingNums]
      .filter(([, nums]) => nums.length > 1)
      .map(([posting_id, nums]) => ({ posting_id, nums })),
    company_spellings: [...spellings]
      .filter(([, names]) => names.size > 1)
      .map(([company_id, names]) => ({ company_id, spellings: [...names] })),
    merge_candidates: mergeCandidateList,
    same_role_postings: sameRolePostings(store, importedRows),
    company_word_candidates: companyWordCandidates(firstCompanyNames, mergeCandidateList),
  };
}

export function rebuildTrackerRows(store, file = 'applications.md') {
  const prefix = `${file}#line`;
  return store.db.prepare(`
    SELECT payload
    FROM events
    WHERE type = 'posting_evaluated'
      AND substr(evidence_ref, 1, ?) = ?
  `).all(prefix.length, prefix)
    .map(event => JSON.parse(event.payload))
    .sort((a, b) => a.line_index - b.line_index)
    .map(payload => ({
      num: payload.num,
      date: payload.date,
      company: payload.company,
      role: payload.role,
      score: payload.score,
      status: payload.status,
      pdf: payload.pdf,
      resume: payload.resume,
      report: payload.report,
      notes: payload.notes,
      url: payload.url,
      urlCell: payload.url_cell,
      cellCount: payload.cell_count,
      reportPath: reportPath(payload.report),
    }));
}

export function compareTracker(text, store, file = 'applications.md') {
  const originalEntries = String(text ?? '').split('\n')
    .map(line => line.replace(/\r$/, ''))
    .map(line => ({ line, row: parseTrackerLine(line) }))
    .filter(entry => entry.row);
  const originalRows = originalEntries.map(entry => rowShape(entry.row));
  const rebuiltRows = rebuildTrackerRows(store, file);
  const mismatches = [];
  if (originalRows.length !== rebuiltRows.length) {
    mismatches.push({ position: null, field: 'count' });
  }
  const compared = Math.min(originalRows.length, rebuiltRows.length);
  for (let position = 0; position < compared && mismatches.length < 20; position++) {
    for (const field of ROW_FIELDS) {
      if (!Object.is(originalRows[position][field], rebuiltRows[position][field])) {
        mismatches.push({ position, field });
        if (mismatches.length === 20) break;
      }
    }
  }
  let renderedIdentical = 0;
  let renderedDifferent = 0;
  const renderedDifferentPositions = [];
  for (let position = 0; position < rebuiltRows.length; position++) {
    const fields = Object.fromEntries(
      TRACKER_COLUMNS.map(column => [column, rebuiltRows[position][column]]),
    );
    const rendered = formatTrackerLine(fields);
    if (rendered === originalEntries[position]?.line) {
      renderedIdentical++;
    } else {
      renderedDifferent++;
      if (renderedDifferentPositions.length < 20) renderedDifferentPositions.push(position);
    }
  }
  return {
    match: mismatches.length === 0,
    original_rows: originalRows,
    rebuilt_rows: rebuiltRows,
    mismatches,
    rendered_identical: renderedIdentical,
    rendered_different: renderedDifferent,
    rendered_different_positions: renderedDifferentPositions,
  };
}
