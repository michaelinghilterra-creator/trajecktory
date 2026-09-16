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
  const ids = unique(matches.map(match => match.existingId));
  if (ids.length > 1) throw new IdentityConflictError(matches);
  return ids[0] ?? null;
}

export function findPersonByAlias(store, source, legacyId) {
  const row = store.db.prepare(
    'SELECT person_id FROM person_aliases WHERE source = ? AND legacy_id = ?',
  ).get(String(source ?? '').trim(), String(legacyId ?? '').trim());
  return row?.person_id ?? null;
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
      if (row) conflicts.push({ kind: 'email', value, existingId: row.person_id });
    }
    for (const value of normalizedLinkedin) {
      const row = identifierLookup.get('linkedin', value);
      if (row) conflicts.push({ kind: 'linkedin', value, existingId: row.person_id });
    }
    const aliasLookup = store.db.prepare(
      'SELECT person_id FROM person_aliases WHERE source = ? AND legacy_id = ?',
    );
    for (const alias of normalizedAliases) {
      const row = aliasLookup.get(alias.source, alias.legacyId);
      if (row) conflicts.push({ kind: alias.source, value: alias.legacyId, existingId: row.person_id });
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
    const person = store.db.prepare('SELECT id FROM people WHERE id = ?').get(personId);
    if (!person) throw new Error(`person not found: ${personId}`);
    const existing = store.db.prepare(
      'SELECT person_id FROM person_identifiers WHERE kind = ? AND value = ?',
    ).get(normalizedKind, normalizedValue);
    if (existing?.person_id === personId) return false;
    if (existing) {
      throw new IdentityConflictError([
        { kind: normalizedKind, value: normalizedValue, existingId: existing.person_id },
      ]);
    }

    const type = normalizedKind === 'email' ? 'email_found' : 'person_updated';
    const payload = normalizedKind === 'email'
      ? { email: normalizedValue }
      : { linkedin: normalizedValue };
    const [eventId] = insertEvents(store, [contextEvent(
      type,
      { person_id: personId },
      payload,
      ctx,
    )]);
    store.db.prepare(
      'INSERT INTO person_identifiers (kind, value, person_id, event_id) VALUES (?, ?, ?, ?)',
    ).run(normalizedKind, normalizedValue, personId, eventId);
    return true;
  });
}

export function findCompany(store, name) {
  const row = store.db.prepare('SELECT company_id FROM company_keys WHERE key = ?').get(companyKey(name));
  return row?.company_id ?? null;
}

export function resolveCompany(store, name, ctx) {
  const trimmedName = String(name ?? '').trim();
  const key = companyKey(trimmedName);
  return withTransaction(store, () => {
    const existing = store.db.prepare('SELECT company_id FROM company_keys WHERE key = ?').get(key);
    if (existing) return { id: existing.company_id, created: false };

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
    const company = store.db.prepare('SELECT id FROM companies WHERE id = ?').get(companyId);
    if (!company) throw new Error(`company not found: ${companyId}`);
    if (canonical) {
      const existing = store.db.prepare(
        'SELECT id, company_id FROM postings WHERE canonical_url = ?',
      ).get(canonical);
      if (existing?.company_id === companyId) return { id: existing.id, created: false };
      if (existing) {
        throw new IdentityConflictError([
          { kind: 'canonical_url', value: canonical, existingId: existing.id },
        ]);
      }
    } else {
      const candidates = store.db.prepare(`
        SELECT id, title FROM postings
        WHERE company_id = ? AND canonical_url IS NULL
        ORDER BY created_event_id, id
      `).all(companyId);
      const existing = candidates.find(candidate => sameRole(candidate.title, trimmedTitle));
      if (existing) return { id: existing.id, created: false };
    }

    const postingId = `pst_${randomUUID()}`;
    const [eventId] = insertEvents(store, [contextEvent(
      'posting_added',
      { posting_id: postingId, company_id: companyId },
      { title: trimmedTitle, canonical_url: canonical || null },
      ctx,
    )]);
    store.db.prepare(`
      INSERT INTO postings (id, company_id, title, canonical_url, created_event_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(postingId, companyId, trimmedTitle, canonical || null, eventId);
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
