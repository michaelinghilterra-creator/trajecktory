import { randomUUID } from 'node:crypto';
import { canonicalUrl, sameRole } from './identity.mjs';
import { linkedinKey } from '../dashboard-web/server/lib/contact-identity.mjs';
import { insertEvents, withTransaction } from './event-store.mjs';

export class IdentityConflictError extends Error {
  constructor(conflicts) {
    super('Identity conflict');
    this.name = 'IdentityConflictError';
    this.conflicts = conflicts;
  }
}

const LEGAL_SUFFIXES = [
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation',
  'co', 'company', 'gmbh', 'plc', 'ag', 'sa', 'bv', 'pbc', 'lp', 'llp',
];
const dottedSuffix = word => [...word].map(character => `${character}\\.?`).join('');
const LEGAL_SUFFIX_PATTERN = new RegExp(
  `(?:\\s+|,\\s*)(?:${LEGAL_SUFFIXES.map(dottedSuffix).join('|')})\\s*$`,
  'i',
);

export function companyKey(name) {
  let value = String(name ?? '').trim();
  while (value) {
    const stripped = value.replace(LEGAL_SUFFIX_PATTERN, '').trim();
    if (stripped === value || !normalizeCompanyKey(stripped)) break;
    value = stripped;
  }
  const key = normalizeCompanyKey(value);
  if (!key) throw new Error('company name must produce a non-empty key');
  return key;
}

// Only Latin accents fold (Café equals Cafe). Other scripts keep their marks:
// Japanese voicing marks and Indic vowel signs change which name it is.
function normalizeCompanyKey(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]/gu, '');
}

export function emailKey(email) {
  const value = String(email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    throw new Error('invalid email');
  }
  return value;
}

export function linkedinIdentifier(url) {
  const value = linkedinKey(url);
  if (!value) throw new Error('invalid LinkedIn profile URL');
  return value;
}

function contextEvent(type, fields, payload, ctx) {
  return {
    type,
    ...fields,
    payload,
    occurred_on: ctx.occurred_on,
    source: ctx.source,
    definitions_version: ctx.definitions_version,
    ...(ctx.evidence_ref === undefined ? {} : { evidence_ref: ctx.evidence_ref }),
  };
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeAlias(alias) {
  const source = String(alias?.source ?? '').trim();
  const legacyId = String(alias?.legacyId ?? alias?.legacy_id ?? alias?.id ?? '').trim();
  if (!source || !legacyId) throw new Error('alias source and legacy id are required');
  return { source, legacyId };
}

function resolveId(store, id, { entity, table, mergeTable, fromColumn, intoColumn }) {
  const value = String(id ?? '');
  if (!store.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(value)) {
    throw new Error(`${entity} not found: ${value}`);
  }

  const activeMerge = store.db.prepare(`
    SELECT merges.${intoColumn} AS into_id
    FROM ${mergeTable} AS merges
    LEFT JOIN ${entity}_unmerges AS unmerges ON unmerges.merge_id = merges.id
    WHERE merges.${fromColumn} = ? AND unmerges.merge_id IS NULL
    ORDER BY merges.id
    LIMIT 2
  `);
  let current = value;
  let steps = 0;
  while (true) {
    const rows = activeMerge.all(current);
    if (rows.length > 1) throw new Error(`${entity} has more than one active merge: ${current}`);
    if (!rows.length) return current;
    steps++;
    if (steps > 100) throw new Error(`${entity} merge chain exceeds 100 steps`);
    current = rows[0].into_id;
  }
}

export function resolvePersonId(store, id) {
  return resolveId(store, id, {
    entity: 'person',
    table: 'people',
    mergeTable: 'person_merges',
    fromColumn: 'from_person_id',
    intoColumn: 'into_person_id',
  });
}

export function resolveCompanyId(store, id) {
  return resolveId(store, id, {
    entity: 'company',
    table: 'companies',
    mergeTable: 'company_merges',
    fromColumn: 'from_company_id',
    intoColumn: 'into_company_id',
  });
}

function members(store, rootId, {
  resolve,
  mergeTable,
  unmergeTable,
  fromColumn,
  intoColumn,
}) {
  const root = resolve(store, rootId);
  return store.db.prepare(`
    WITH RECURSIVE identity_members(id) AS (
      VALUES (?)
      UNION
      SELECT merges.${fromColumn}
      FROM ${mergeTable} AS merges
      JOIN identity_members ON merges.${intoColumn} = identity_members.id
      LEFT JOIN ${unmergeTable} AS unmerges ON unmerges.merge_id = merges.id
      WHERE unmerges.merge_id IS NULL
    )
    SELECT id FROM identity_members ORDER BY id
  `).all(root).map(row => row.id);
}

export function personMembers(store, rootId) {
  return members(store, rootId, {
    resolve: resolvePersonId,
    mergeTable: 'person_merges',
    unmergeTable: 'person_unmerges',
    fromColumn: 'from_person_id',
    intoColumn: 'into_person_id',
  });
}

export function companyMembers(store, rootId) {
  return members(store, rootId, {
    resolve: resolveCompanyId,
    mergeTable: 'company_merges',
    unmergeTable: 'company_unmerges',
    fromColumn: 'from_company_id',
    intoColumn: 'into_company_id',
  });
}

function mergeIdentities(store, { fromId, intoId }, ctx, options) {
  return withTransaction(store, () => {
    const fromRoot = options.resolve(store, fromId);
    const intoRoot = options.resolve(store, intoId);
    if (fromRoot === intoRoot) return null;

    const [eventId] = insertEvents(store, [contextEvent(
      options.eventType,
      { [options.eventIdField]: intoRoot },
      {
        from_id: fromRoot,
        into_id: intoRoot,
        requested_from_id: fromId,
        requested_into_id: intoId,
      },
      ctx,
    )]);
    const result = store.db.prepare(`
      INSERT INTO ${options.mergeTable} (${options.fromColumn}, ${options.intoColumn}, event_id)
      VALUES (?, ?, ?)
    `).run(fromRoot, intoRoot, eventId);
    return Number(result.lastInsertRowid);
  });
}

export function mergePeople(store, ids, ctx) {
  return mergeIdentities(store, ids, ctx, {
    resolve: resolvePersonId,
    eventType: 'people_merged',
    eventIdField: 'person_id',
    mergeTable: 'person_merges',
    fromColumn: 'from_person_id',
    intoColumn: 'into_person_id',
  });
}

export function mergeCompanies(store, ids, ctx) {
  return mergeIdentities(store, ids, ctx, {
    resolve: resolveCompanyId,
    eventType: 'companies_merged',
    eventIdField: 'company_id',
    mergeTable: 'company_merges',
    fromColumn: 'from_company_id',
    intoColumn: 'into_company_id',
  });
}

function unmergeIdentities(store, { mergeId }, ctx, options) {
  return withTransaction(store, () => {
    const merge = store.db.prepare(`
      SELECT merges.id, merges.${options.fromColumn} AS from_id,
             merges.${options.intoColumn} AS into_id, merges.event_id,
             unmerges.merge_id AS undone_id
      FROM ${options.mergeTable} AS merges
      LEFT JOIN ${options.unmergeTable} AS unmerges ON unmerges.merge_id = merges.id
      WHERE merges.id = ?
    `).get(mergeId);
    if (!merge) throw new Error(`${options.entity} merge not found: ${mergeId}`);
    if (merge.undone_id !== null) throw new Error(`${options.entity} merge already undone: ${mergeId}`);

    const [eventId] = insertEvents(store, [contextEvent(
      options.eventType,
      {
        [options.eventIdField]: options.resolve(store, merge.into_id),
        corrects_event_id: merge.event_id,
      },
      { merge_id: merge.id, from_id: merge.from_id, into_id: merge.into_id },
      ctx,
    )]);
    store.db.prepare(`
      INSERT INTO ${options.unmergeTable} (merge_id, event_id) VALUES (?, ?)
    `).run(merge.id, eventId);
    return true;
  });
}

export function unmergePeople(store, ids, ctx) {
  return unmergeIdentities(store, ids, ctx, {
    entity: 'person',
    resolve: resolvePersonId,
    eventType: 'people_unmerged',
    eventIdField: 'person_id',
    mergeTable: 'person_merges',
    unmergeTable: 'person_unmerges',
    fromColumn: 'from_person_id',
    intoColumn: 'into_person_id',
  });
}

export function unmergeCompanies(store, ids, ctx) {
  return unmergeIdentities(store, ids, ctx, {
    entity: 'company',
    resolve: resolveCompanyId,
    eventType: 'companies_unmerged',
    eventIdField: 'company_id',
    mergeTable: 'company_merges',
    unmergeTable: 'company_unmerges',
    fromColumn: 'from_company_id',
    intoColumn: 'into_company_id',
  });
}

function orderedPair(aId, bId) {
  const a = String(aId ?? '');
  const b = String(bId ?? '');
  if (a === b) throw new Error('ids must be different');
  return a < b ? [a, b] : [b, a];
}

function keepSeparate(store, { aId, bId }, ctx, options) {
  return withTransaction(store, () => {
    const requestedAId = String(aId ?? '');
    const requestedBId = String(bId ?? '');
    const aRoot = options.resolve(store, requestedAId);
    const bRoot = options.resolve(store, requestedBId);
    if (aRoot === bRoot) throw new Error(`already the same ${options.entity}`);
    if (separationExists(store, aRoot, bRoot, options)) return false;
    const [a, b] = orderedPair(aRoot, bRoot);

    const [eventId] = insertEvents(store, [contextEvent(
      options.eventType,
      {},
      {
        a_id: a,
        b_id: b,
        requested_a_id: requestedAId,
        requested_b_id: requestedBId,
      },
      ctx,
    )]);
    store.db.prepare(`
      INSERT INTO ${options.table} (a_id, b_id, event_id) VALUES (?, ?, ?)
    `).run(a, b, eventId);
    return true;
  });
}

export function keepPeopleSeparate(store, ids, ctx) {
  return keepSeparate(store, ids, ctx, {
    entity: 'person',
    resolve: resolvePersonId,
    members: personMembers,
    table: 'people_separate',
    eventType: 'people_kept_separate',
  });
}

export function keepCompaniesSeparate(store, ids, ctx) {
  return keepSeparate(store, ids, ctx, {
    entity: 'company',
    resolve: resolveCompanyId,
    members: companyMembers,
    table: 'companies_separate',
    eventType: 'companies_kept_separate',
  });
}

function separationExists(store, aRoot, bRoot, options) {
  const aMembers = new Set(options.members(store, aRoot));
  const bMembers = new Set(options.members(store, bRoot));
  return store.db.prepare(`SELECT a_id, b_id FROM ${options.table}`).all().some(row => (
    (aMembers.has(row.a_id) && bMembers.has(row.b_id))
    || (aMembers.has(row.b_id) && bMembers.has(row.a_id))
  ));
}

export function wereKeptSeparate(store, entity, aId, bId) {
  const options = entity === 'person'
    ? {
        entity,
        resolve: resolvePersonId,
        members: personMembers,
        table: 'people_separate',
      }
    : entity === 'company'
      ? {
          entity,
          resolve: resolveCompanyId,
          members: companyMembers,
          table: 'companies_separate',
        }
      : null;
  if (!options) throw new Error('entity must be person or company');
  const aRoot = options.resolve(store, aId);
  const bRoot = options.resolve(store, bId);
  if (aRoot === bRoot) return false;
  return separationExists(store, aRoot, bRoot, options);
}

export function findPerson(store, { email, linkedin } = {}) {
  const matches = [];
  if (email !== undefined && email !== null && String(email).trim()) {
    const value = emailKey(email);
    const row = store.db.prepare(
      "SELECT person_id FROM person_identifiers WHERE kind = 'email' AND value = ?",
    ).get(value);
    if (row) matches.push({ kind: 'email', value, existingId: row.person_id });
  }
  if (linkedin !== undefined && linkedin !== null && String(linkedin).trim()) {
    const value = linkedinIdentifier(linkedin);
    const row = store.db.prepare(
      "SELECT person_id FROM person_identifiers WHERE kind = 'linkedin' AND value = ?",
    ).get(value);
    if (row) matches.push({ kind: 'linkedin', value, existingId: row.person_id });
  }
  const resolvedMatches = matches.map(match => ({
    ...match,
    existingId: resolvePersonId(store, match.existingId),
  }));
  const ids = unique(resolvedMatches.map(match => match.existingId));
  if (ids.length > 1) throw new IdentityConflictError(resolvedMatches);
  return ids[0] ?? null;
}

export function findPersonByAlias(store, source, legacyId) {
  const row = store.db.prepare(
    'SELECT person_id FROM person_aliases WHERE source = ? AND legacy_id = ?',
  ).get(String(source ?? '').trim(), String(legacyId ?? '').trim());
  return row ? resolvePersonId(store, row.person_id) : null;
}

export function addPerson(store, { name, emails = [], linkedinUrls = [], aliases = [] }, ctx) {
  const displayName = String(name ?? '').trim();
  if (!displayName) throw new Error('name is required');
  const normalizedEmails = unique(emails.map(emailKey));
  const normalizedLinkedin = unique(linkedinUrls.map(linkedinIdentifier));
  const normalizedAliases = [
    ...new Map(aliases.map(normalizeAlias).map(alias => [`${alias.source}\0${alias.legacyId}`, alias])).values(),
  ];

  return withTransaction(store, () => {
    const conflicts = [];
    const identifierLookup = store.db.prepare(
      'SELECT person_id FROM person_identifiers WHERE kind = ? AND value = ?',
    );
    for (const value of normalizedEmails) {
      const row = identifierLookup.get('email', value);
      if (row) conflicts.push({ kind: 'email', value, existingId: resolvePersonId(store, row.person_id) });
    }
    for (const value of normalizedLinkedin) {
      const row = identifierLookup.get('linkedin', value);
      if (row) conflicts.push({ kind: 'linkedin', value, existingId: resolvePersonId(store, row.person_id) });
    }
    const aliasLookup = store.db.prepare(
      'SELECT person_id FROM person_aliases WHERE source = ? AND legacy_id = ?',
    );
    for (const alias of normalizedAliases) {
      const row = aliasLookup.get(alias.source, alias.legacyId);
      if (row) conflicts.push({ kind: alias.source, value: alias.legacyId, existingId: resolvePersonId(store, row.person_id) });
    }
    if (conflicts.length) throw new IdentityConflictError(conflicts);

    const personId = `per_${randomUUID()}`;
    const payloadAliases = normalizedAliases.map(({ source, legacyId }) => ({ source, legacy_id: legacyId }));
    const [eventId] = insertEvents(store, [contextEvent(
      'person_added',
      { person_id: personId },
      { name: displayName, emails: normalizedEmails, linkedin: normalizedLinkedin, aliases: payloadAliases },
      ctx,
    )]);
    store.db.prepare(
      'INSERT INTO people (id, display_name, created_event_id) VALUES (?, ?, ?)',
    ).run(personId, displayName, eventId);
    const insertIdentifier = store.db.prepare(
      'INSERT INTO person_identifiers (kind, value, person_id, event_id) VALUES (?, ?, ?, ?)',
    );
    for (const value of normalizedEmails) insertIdentifier.run('email', value, personId, eventId);
    for (const value of normalizedLinkedin) insertIdentifier.run('linkedin', value, personId, eventId);
    const insertAlias = store.db.prepare(
      'INSERT INTO person_aliases (source, legacy_id, person_id, event_id) VALUES (?, ?, ?, ?)',
    );
    for (const alias of normalizedAliases) insertAlias.run(alias.source, alias.legacyId, personId, eventId);
    return personId;
  });
}

export function addIdentifier(store, personId, { kind, value }, ctx) {
  const normalizedKind = String(kind ?? '').trim();
  if (normalizedKind !== 'email' && normalizedKind !== 'linkedin') {
    throw new Error('identifier kind must be email or linkedin');
  }
  const normalizedValue = normalizedKind === 'email' ? emailKey(value) : linkedinIdentifier(value);

  return withTransaction(store, () => {
    const rootId = resolvePersonId(store, personId);
    const existing = store.db.prepare(
      'SELECT person_id FROM person_identifiers WHERE kind = ? AND value = ?',
    ).get(normalizedKind, normalizedValue);
    if (existing && resolvePersonId(store, existing.person_id) === rootId) return false;
    if (existing) {
      throw new IdentityConflictError([
        { kind: normalizedKind, value: normalizedValue, existingId: resolvePersonId(store, existing.person_id) },
      ]);
    }

    const type = normalizedKind === 'email' ? 'email_found' : 'person_updated';
    const payload = normalizedKind === 'email'
      ? { email: normalizedValue }
      : { linkedin: normalizedValue };
    const [eventId] = insertEvents(store, [contextEvent(
      type,
      { person_id: rootId },
      payload,
      ctx,
    )]);
    store.db.prepare(
      'INSERT INTO person_identifiers (kind, value, person_id, event_id) VALUES (?, ?, ?, ?)',
    ).run(normalizedKind, normalizedValue, rootId, eventId);
    return true;
  });
}

export function findCompany(store, name) {
  const row = store.db.prepare('SELECT company_id FROM company_keys WHERE key = ?').get(companyKey(name));
  return row ? resolveCompanyId(store, row.company_id) : null;
}

export function resolveCompany(store, name, ctx) {
  const trimmedName = String(name ?? '').trim();
  const key = companyKey(trimmedName);
  return withTransaction(store, () => {
    const existing = store.db.prepare('SELECT company_id FROM company_keys WHERE key = ?').get(key);
    if (existing) return { id: resolveCompanyId(store, existing.company_id), created: false };

    const companyId = `co_${randomUUID()}`;
    const [eventId] = insertEvents(store, [contextEvent(
      'company_added',
      { company_id: companyId },
      { name: trimmedName, key },
      ctx,
    )]);
    store.db.prepare(
      'INSERT INTO companies (id, name, created_event_id) VALUES (?, ?, ?)',
    ).run(companyId, trimmedName, eventId);
    store.db.prepare(
      'INSERT INTO company_keys (key, company_id, event_id) VALUES (?, ?, ?)',
    ).run(key, companyId, eventId);
    return { id: companyId, created: true };
  });
}

export function resolvePosting(store, { companyId, title, url }, ctx) {
  const trimmedTitle = String(title ?? '').trim();
  if (!trimmedTitle) throw new Error('title is required');
  const canonical = canonicalUrl(url ?? '');

  return withTransaction(store, () => {
    const rootCompanyId = resolveCompanyId(store, companyId);
    if (canonical) {
      const existing = store.db.prepare(
        'SELECT id, company_id FROM postings WHERE canonical_url = ?',
      ).get(canonical);
      if (existing && resolveCompanyId(store, existing.company_id) === rootCompanyId) {
        return { id: existing.id, created: false };
      }
      if (existing) {
        throw new IdentityConflictError([
          { kind: 'canonical_url', value: canonical, existingId: existing.id },
        ]);
      }
    } else {
      const memberIds = companyMembers(store, rootCompanyId);
      const placeholders = memberIds.map(() => '?').join(', ');
      const candidates = store.db.prepare(`
        SELECT id, title FROM postings
        WHERE company_id IN (${placeholders}) AND canonical_url IS NULL
        ORDER BY created_event_id, id
      `).all(...memberIds);
      const existing = candidates.find(candidate => sameRole(candidate.title, trimmedTitle));
      if (existing) return { id: existing.id, created: false };
    }

    const postingId = `pst_${randomUUID()}`;
    const [eventId] = insertEvents(store, [contextEvent(
      'posting_added',
      { posting_id: postingId, company_id: rootCompanyId },
      { title: trimmedTitle, canonical_url: canonical || null },
      ctx,
    )]);
    store.db.prepare(`
      INSERT INTO postings (id, company_id, title, canonical_url, created_event_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(postingId, rootCompanyId, trimmedTitle, canonical || null, eventId);
    return { id: postingId, created: true };
  });
}

export function addApplication(store, { id, postingId }, ctx) {
  const applicationId = typeof id === 'number' && Number.isInteger(id) ? String(id) : String(id ?? '');
  if (!/^\d+$/.test(applicationId)) throw new Error('application id must contain digits only');

  return withTransaction(store, () => {
    const posting = store.db.prepare('SELECT id FROM postings WHERE id = ?').get(postingId);
    if (!posting) throw new Error(`posting not found: ${postingId}`);
    const conflicts = [];
    const byPosting = store.db.prepare('SELECT id FROM applications WHERE posting_id = ?').get(postingId);
    if (byPosting) conflicts.push({ kind: 'posting', value: postingId, existingId: byPosting.id });
    const byId = store.db.prepare('SELECT id FROM applications WHERE id = ?').get(applicationId);
    if (byId) conflicts.push({ kind: 'application', value: applicationId, existingId: byId.id });
    if (conflicts.length) throw new IdentityConflictError(conflicts);

    const [eventId] = insertEvents(store, [contextEvent(
      'application_submitted',
      { application_id: applicationId, posting_id: postingId },
      {},
      ctx,
    )]);
    store.db.prepare(
      'INSERT INTO applications (id, posting_id, created_event_id) VALUES (?, ?, ?)',
    ).run(applicationId, postingId, eventId);
    return applicationId;
  });
}
