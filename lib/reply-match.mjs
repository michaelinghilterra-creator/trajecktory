/**
 * D-7: a reply attaches to exactly one application, or goes to the unmatched
 * list. Pure functions; nothing here reads or writes a file.
 *
 * Company alone is enough only when the employer has one application. With
 * several, the reply must name a role or continue a known thread; an apply
 * date window only breaks a tie between role matches. Anything else is
 * unmatched, with ranked suggestions, never a guess.
 */

import { normalizeCompany, sameRole } from './identity.mjs';

const MAX_ROLE_WORDS = 10;
const BODY_CHARS = 2000;

function isRealDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function roleNamedIn(role, text) {
  const words = String(text || '').match(/[A-Za-z0-9+#.]+/g) || [];
  for (let start = 0; start < words.length; start++) {
    const last = Math.min(words.length, start + MAX_ROLE_WORDS);
    for (let end = start + 1; end <= last; end++) {
      if (sameRole(role, words.slice(start, end).join(' '))) return true;
    }
  }
  return false;
}

function validateMessage(message) {
  if (typeof message?.message_id !== 'string' || message.message_id.trim() === '') {
    throw new TypeError('message_id must be a non-empty string');
  }
  if (!isRealDate(message.message_date)) {
    throw new TypeError('message_date must be a valid YYYY-MM-DD calendar date');
  }
}

function dateFlags(app, messageDate) {
  if (!isRealDate(app.apply_date)) return ['no_apply_date'];
  return app.apply_date > messageDate ? ['before_apply_date'] : [];
}

function rankSuggestions(candidates, messageDate, namesRole) {
  return [...candidates]
    .sort((a, b) => {
      const roleDiff = Number(namesRole(b)) - Number(namesRole(a));
      if (roleDiff !== 0) return roleDiff;
      const eligibleDiff = Number(isEligible(b, messageDate)) - Number(isEligible(a, messageDate));
      if (eligibleDiff !== 0) return eligibleDiff;
      const ad = isRealDate(a.apply_date) ? a.apply_date : '';
      const bd = isRealDate(b.apply_date) ? b.apply_date : '';
      if (ad !== bd) return ad < bd ? 1 : -1;
      return String(a.id) < String(b.id) ? -1 : 1;
    })
    .map((app) => app.id);
}

function isEligible(app, messageDate) {
  return isRealDate(app.apply_date) && app.apply_date <= messageDate;
}

/**
 * message: { message_id, message_date, company, subject, body, thread_id }
 * applications: [{ id, company, role, apply_date, thread_ids }]
 * attached: Map of message_id to the application id it is already attached to.
 *
 * Returns one of
 *   { status: 'matched', application_id, method, flags }
 *   { status: 'duplicate', application_id }
 *   { status: 'unmatched', reason, suggestions }
 * method is 'thread', 'sole_application', 'role' or 'role_and_window'.
 * flags may hold 'before_apply_date' or 'no_apply_date'.
 */
export function matchReply(message, applications, { attached = new Map() } = {}) {
  validateMessage(message);

  if (attached.has(message.message_id)) {
    return { status: 'duplicate', application_id: attached.get(message.message_id) };
  }

  const companyKey = normalizeCompany(message.company);
  const sameEmployer = companyKey === ''
    ? []
    : applications.filter((app) => normalizeCompany(app.company) === companyKey);
  if (sameEmployer.length === 0) {
    return { status: 'unmatched', reason: 'no_company_match', suggestions: [] };
  }

  const text = `${message.subject || ''}\n${String(message.body || '').slice(0, BODY_CHARS)}`;
  const namesRole = (app) => roleNamedIn(app.role, text);
  const suggest = () => rankSuggestions(sameEmployer, message.message_date, namesRole);

  if (message.thread_id) {
    const onThread = sameEmployer.filter((app) => Array.isArray(app.thread_ids) && app.thread_ids.includes(message.thread_id));
    if (onThread.length === 1) {
      return { status: 'matched', application_id: onThread[0].id, method: 'thread', flags: dateFlags(onThread[0], message.message_date) };
    }
    if (onThread.length > 1) {
      return { status: 'unmatched', reason: 'ambiguous_thread', suggestions: rankSuggestions(onThread, message.message_date, namesRole) };
    }
  }

  if (sameEmployer.length === 1) {
    return { status: 'matched', application_id: sameEmployer[0].id, method: 'sole_application', flags: dateFlags(sameEmployer[0], message.message_date) };
  }

  const roleHits = sameEmployer.filter(namesRole);
  if (roleHits.length === 1) {
    return { status: 'matched', application_id: roleHits[0].id, method: 'role', flags: dateFlags(roleHits[0], message.message_date) };
  }
  if (roleHits.length > 1) {
    const inWindow = roleHits.filter((app) => isEligible(app, message.message_date));
    if (inWindow.length === 1) {
      return { status: 'matched', application_id: inWindow[0].id, method: 'role_and_window', flags: [] };
    }
    return { status: 'unmatched', reason: 'ambiguous_role', suggestions: suggest() };
  }
  return { status: 'unmatched', reason: 'no_role_signal', suggestions: suggest() };
}

/**
 * Match a batch. A message id attaches once: a repeat of an id seen earlier in
 * the batch, or already in `attached`, is reported as a duplicate. `attached`
 * is not modified.
 */
export function matchReplies(messages, applications, { attached = new Map() } = {}) {
  const seen = new Map(attached);
  const matched = [];
  const unmatched = [];
  const duplicates = [];
  for (const message of messages) {
    const result = matchReply(message, applications, { attached: seen });
    if (result.status === 'matched') {
      seen.set(message.message_id, result.application_id);
      matched.push({ message_id: message.message_id, ...result });
    } else if (result.status === 'duplicate') {
      duplicates.push({ message_id: message.message_id, ...result });
    } else {
      unmatched.push({ message_id: message.message_id, ...result });
    }
  }
  return { matched, unmatched, duplicates };
}
