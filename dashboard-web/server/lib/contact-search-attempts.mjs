import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.mjs';
import { normCompany } from './tt-reconcile-core.mjs';

export const ATTEMPTS_PATH = path.join(DATA_DIR, 'contact-search-attempts.json');

/**
 * Read attempts map from disk. Returns {} if file missing or corrupt.
 */
export function readAttempts() {
  try {
    return JSON.parse(fs.readFileSync(ATTEMPTS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Atomic write: temp file + rename, matching the sidecar pattern in sidecars.mjs.
 */
export function writeAttempts(attempts) {
  const tempPath = `${ATTEMPTS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(attempts, null, 2) + '\n');
  fs.renameSync(tempPath, ATTEMPTS_PATH);
}

export const SEARCH_TYPES = Object.freeze(['talent', 'principal']);
export const SEARCH_CAP = 2;

// Maps a caller-supplied search type onto one of the two known literals, or
// null. Entry fields are only ever written under the returned literal, so a
// crafted type such as "__proto__" can never become a property name.
function knownType(type) {
  if (type === 'talent') return 'talent';
  if (type === 'principal') return 'principal';
  return null;
}

// The entry for a company, created on demand. Returns null for a blank name or
// a prototype-polluting key, so callers never touch Object.prototype.
//
// Written so that the guarantee does not depend on the name normalizer: the three
// dangerous names are refused by direct comparison, an existing entry is read as
// the map's OWN property (never through the prototype chain), and a new entry is
// returned as the fresh object itself rather than read back out of the map.
function entryFor(company, attempts, create) {
  const key = normCompany(company);
  if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') return null;
  const own = Object.getOwnPropertyDescriptor(attempts, key);
  if (own) {
    const existing = own.value;
    return existing && typeof existing === 'object' ? existing : null;
  }
  if (!create) return null;
  const fresh = {};
  Object.defineProperty(attempts, key, { value: fresh, enumerable: true, writable: true, configurable: true });
  return fresh;
}

/**
 * Record one EMPTY search for a company+type: a search that ran to the end and
 * returned nobody usable. This is the only thing that counts toward the cap.
 * A search that errored or timed out goes to recordSearchError instead.
 *
 * New-cycle-aware: if appDate is newer than the stored lastSearched, resets the
 * type's count to 1 instead of incrementing (a new application re-opens the
 * company).
 *
 * `confirmed` counts the tries recorded under this rule. Older files counted
 * errors and timeouts as tries with nothing to tell them apart, so a count
 * above its confirmed number holds tries that may never have been real.
 *
 * Mutates the in-memory map. Caller flushes once via writeAttempts().
 */
export function recordAttempt(company, rawType, appDate, attempts) {
  const type = knownType(rawType);
  if (!type) return;
  const entry = entryFor(company, attempts, true);
  if (!entry) return;
  const today = localDate();
  if (!entry.confirmed || typeof entry.confirmed !== 'object') entry.confirmed = {};

  // A newer application resets the count for this type.
  if (appDate && entry.lastSearched && appDate > entry.lastSearched) {
    entry[type] = 1;
    entry.confirmed[type] = 1;
  } else {
    entry[type] = (entry[type] || 0) + 1;
    entry.confirmed[type] = (entry.confirmed[type] || 0) + 1;
  }
  entry.lastSearched = today;
}

/**
 * Record a search that did not finish: an error, a timeout, or an answer that
 * could not be read. Kept for visibility only. It never moves the try count or
 * lastSearched, so a run of failures can never park a company.
 */
export function recordSearchError(company, rawType, message, attempts) {
  const type = knownType(rawType);
  if (!type) return;
  const entry = entryFor(company, attempts, true);
  if (!entry) return;
  if (!entry.errors || typeof entry.errors !== 'object') entry.errors = {};
  entry.errors[type] = (entry.errors[type] || 0) + 1;
  entry.lastError = { type, date: localDate(), message: String(message || '').slice(0, 200) };
}

/**
 * Returns true when the company has reached the cap for this search type
 * AND there is no newer application that would re-open it.
 */
export function isAtCap(company, type, appDate, attempts, cap = SEARCH_CAP) {
  const entry = entryFor(company, attempts, false);
  if (!entry) return false;
  const count = entry[type] || 0;
  if (count < cap) return false;
  // A newer app date re-opens the company for searching.
  if (appDate && entry.lastSearched && appDate > entry.lastSearched) return false;
  return true;
}

/**
 * Give a company another try. Clears the try count for one search type, or for
 * both when type is omitted. With unconfirmedOnly, keeps the tries recorded as
 * real empty searches and drops only the older ones that cannot be verified.
 * Returns the number of tries removed. Mutates the in-memory map.
 */
export function resetAttempts(company, type, attempts, options = {}) {
  return resetEntry(entryFor(company, attempts, false), type, options);
}

// The same reset on an entry already in hand. The reset script walks the stored
// keys directly, so it must not send them back through the name normalizer.
export function resetEntry(entry, type, { unconfirmedOnly = false } = {}) {
  if (!entry || typeof entry !== 'object') return 0;
  let removed = 0;
  const wanted = type ? [knownType(type)].filter(Boolean) : SEARCH_TYPES;
  for (const t of wanted) {
    const count = entry[t] || 0;
    const confirmed = Math.min(count, entry.confirmed?.[t] || 0);
    const keep = unconfirmedOnly ? confirmed : 0;
    if (count === keep) continue;
    removed += count - keep;
    entry[t] = keep;
    if (entry.confirmed && typeof entry.confirmed === 'object') entry.confirmed[t] = keep;
  }
  return removed;
}

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
