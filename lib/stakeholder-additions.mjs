/**
 * stakeholder-additions.mjs: the validation gate for discovered people.
 *
 * WHY THIS EXISTS: a discovery source can produce a plausible name and title
 * without having found a real person. That failure has already happened in this
 * repo with invented companies and roles. A model asked for an executive can
 * produce the same convincing fiction because a name plus a title is the
 * cheapest possible answer.
 *
 * The source only proposes structured candidates. This module validates and
 * merges those proposals, and only its caller can write by injecting appendRows.
 * The module has no file or network access. A candidate that fails validation is
 * DROPPED, never recorded as unconfirmed, because an unconfirmed contact-book
 * row is indistinguishable from a real row a week later.
 *
 * Corroboration is the load-bearing check. A valid LinkedIn profile, an address
 * at a caller-confirmed company domain, or Hunter's public-source count must
 * support every accepted identity. Classification and clean table cells matter,
 * but neither one proves that the person exists.
 */

import { classifyTitle, setInfluenceTier } from './influence-tier.mjs';

export const START_MARKER = '<<<STAKEHOLDER_ADDITIONS>>>';
export const END_MARKER = '<<<END_STAKEHOLDER_ADDITIONS>>>';

const SOURCES = new Set(['hunter', 'agent', 'manual']);
const PLACEHOLDERS = new Set([
  'first', 'last', 'name', 'firstname', 'lastname', 'unknown', 'n/a', 'na',
  'none', 'tbd', 'example', 'test',
]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;
const LINKEDIN_PROFILE_RE = /^https:\/\/(?:www\.)?linkedin\.com\/in\/[A-Z0-9_%~.-]+\/?(?:[?#][^\s]*)?$/i;
const PROVENANCE_RE = /\[src:(hunter|agent|manual):(\d{4}-\d{2}-\d{2})\]/i;

export function sanitizePersonField(value, maxLength) {
  // Fall back to a generous cap rather than zero when the length is missing or
  // nonsensical. A zero default silently empties the field, and an empty field
  // here reads downstream as "the source did not provide this", which is a
  // different and much worse claim than "the caller forgot an argument".
  const cap = Number.isInteger(maxLength) && maxLength > 0 ? maxLength : 500;
  return String(value ?? '')
    .replace(/[|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, cap)
    .trim();
}

// Extract the proposed array without letting one malformed entry discard its
// valid neighbours. Trust decisions stay in validateStakeholder so parsing can
// be used before the caller has supplied company-domain and track context.
export function parseStakeholderAdditions(text) {
  const errors = [];
  const sourceText = String(text || '');
  const startIdx = sourceText.indexOf(START_MARKER);
  const endIdx = sourceText.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { people: [], errors: ['no STAKEHOLDER_ADDITIONS block found in the agent output'] };
  }

  let jsonText = sourceText.slice(startIdx + START_MARKER.length, endIdx).trim();
  const fenced = jsonText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenced) jsonText = fenced[1].trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return {
      people: [],
      errors: [`STAKEHOLDER_ADDITIONS block is not valid JSON: ${error.message}`],
    };
  }
  if (!Array.isArray(parsed)) {
    return { people: [], errors: ['STAKEHOLDER_ADDITIONS block is not a JSON array'] };
  }

  const people = [];
  for (const [index, entry] of parsed.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`entry ${index}: not an object`);
      continue;
    }
    people.push(entry);
  }
  return { people, errors };
}

function emailDomain(email) {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

function normalizedDomain(domain) {
  return String(domain ?? '').trim().toLowerCase().replace(/\.$/, '');
}

export function stampProvenance(notes, { tier, source, date } = {}) {
  if (!DATE_RE.test(String(date ?? ''))) {
    throw new TypeError('Provenance date must use YYYY-MM-DD');
  }
  if (!SOURCES.has(source)) {
    throw new TypeError(`Invalid provenance source: ${String(source)}`);
  }
  const stamped = `${sanitizePersonField(notes, 500)} [src:${source}:${date}]`.trim();
  return setInfluenceTier(stamped, tier);
}

export function parseProvenance(notes) {
  const match = typeof notes === 'string' ? notes.match(PROVENANCE_RE) : null;
  return match
    ? { source: match[1].toLowerCase(), date: match[2] }
    : { source: null, date: null };
}

export function validateStakeholder(candidate, { track, today, knownDomain } = {}) {
  try {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return { ok: false, reasons: ['candidate is not an object'] };
    }

    const first = sanitizePersonField(candidate.first, 80);
    const last = sanitizePersonField(candidate.last, 80);
    const company = sanitizePersonField(candidate.company, 120);
    const title = sanitizePersonField(candidate.title, 160);
    const city = sanitizePersonField(candidate.city, 80);
    const state = sanitizePersonField(candidate.state, 40);
    const source = sanitizePersonField(candidate.source, 20).toLowerCase();
    const reasons = [];
    const warnings = [];

    if (!first) reasons.push('first name is missing');
    if (!last) reasons.push('last name is missing');
    if (first && PLACEHOLDERS.has(first.toLowerCase())) reasons.push('first name is a placeholder');
    if (last && PLACEHOLDERS.has(last.toLowerCase())) reasons.push('last name is a placeholder');
    if (!company) reasons.push('company is missing');
    if (!title) reasons.push('title is missing');

    let tier = null;
    if (title) {
      tier = classifyTitle(title, { track });
      if (tier === null) reasons.push('title cannot be classified');
    }

    let linkedin = sanitizePersonField(candidate.linkedin, 500);
    const linkedinPresent = linkedin !== '';
    const validLinkedin = linkedinPresent && LINKEDIN_PROFILE_RE.test(linkedin);
    if (linkedinPresent && !validLinkedin) {
      linkedin = '';
      warnings.push('linkedin was dropped because it is not a valid profile URL');
    }

    let email = sanitizePersonField(candidate.email, 254).toLowerCase();
    const emailPresent = email !== '';
    const validEmail = emailPresent && EMAIL_RE.test(email);
    const expectedDomain = knownDomain === undefined ? '' : normalizedDomain(knownDomain);
    const domainMatches = validEmail && expectedDomain !== '' && emailDomain(email) === expectedDomain;
    if (emailPresent && !validEmail) {
      email = '';
      warnings.push('email was dropped because it is not a valid address');
    } else if (validEmail && knownDomain !== undefined && !domainMatches) {
      email = '';
      warnings.push('email was dropped because its domain does not match the known company domain');
    }

    // A name plus a title and nothing else is exactly the shape of an invented
    // person, and it is also the cheapest thing for a model to produce.
    const hasSourceEvidence = typeof candidate.sourceCount === 'number'
      && Number.isFinite(candidate.sourceCount)
      && candidate.sourceCount >= 1;
    if (!validLinkedin && !domainMatches && !hasSourceEvidence) {
      reasons.push('no corroboration');
    }
    if (!SOURCES.has(source)) reasons.push('source is not hunter, agent, or manual');
    if (!DATE_RE.test(String(today ?? ''))) reasons.push('today must use YYYY-MM-DD');

    if (reasons.length) return { ok: false, reasons };

    const notes = stampProvenance(sanitizePersonField(candidate.notes, 500), {
      tier,
      source,
      date: today,
    });
    return {
      ok: true,
      person: {
        first,
        last,
        company,
        title,
        city,
        state,
        email,
        linkedin,
        tier,
        source,
        notes,
        warnings,
      },
    };
  } catch (error) {
    return { ok: false, reasons: [`validation failed: ${error.message}`] };
  }
}

function normalizeIdentityPart(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9]/g, '');
}

function identityKey(person) {
  const fullName = `${person?.first ?? ''} ${person?.last ?? ''}`;
  return `${normalizeIdentityPart(person?.company)}:${normalizeIdentityPart(fullName)}`;
}

function domainForCompany(knownDomains, company) {
  const key = normalizeIdentityPart(company);
  if (knownDomains instanceof Map) return knownDomains.get(key);
  if (!knownDomains || typeof knownDomains !== 'object') return undefined;
  return knownDomains[key];
}

export function mergeStakeholderAdditions(candidates, {
  appendRows,
  existingRows = [],
  track,
  today,
  knownDomains = {},
} = {}) {
  const result = {
    added: 0,
    people: [],
    rejected: [],
    duplicates: 0,
    warnings: [],
    errors: [],
  };
  const entries = Array.isArray(candidates) ? candidates : [];
  if (!Array.isArray(candidates) && candidates !== undefined) {
    result.errors.push('candidates must be an array');
  }

  const seen = new Set(
    (Array.isArray(existingRows) ? existingRows : []).map(identityKey),
  );
  for (const candidate of entries) {
    const knownDomain = domainForCompany(knownDomains, candidate?.company);
    const validation = validateStakeholder(candidate, { track, today, knownDomain });
    if (!validation.ok) {
      result.rejected.push({
        name: sanitizePersonField(`${candidate?.first ?? ''} ${candidate?.last ?? ''}`, 161),
        company: sanitizePersonField(candidate?.company, 120),
        reasons: validation.reasons,
      });
      continue;
    }

    const person = validation.person;
    const key = identityKey(person);
    if (seen.has(key)) {
      result.duplicates++;
      continue;
    }
    seen.add(key);
    result.people.push(person);
    if (person.warnings.length) {
      result.warnings.push({
        name: `${person.first} ${person.last}`,
        company: person.company,
        warnings: [...person.warnings],
      });
    }
  }

  if (result.people.length && typeof appendRows === 'function') {
    try {
      appendRows(result.people);
      result.added = result.people.length;
    } catch (error) {
      result.errors.push(`appendRows failed: ${error.message}`);
    }
  }
  return result;
}
