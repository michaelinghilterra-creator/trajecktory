import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.mjs';
import { normCompany } from './tt-reconcile-core.mjs';

const ATTEMPTS_PATH = path.join(DATA_DIR, 'contact-search-attempts.json');

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

/**
 * Record one search attempt for a company+type. New-cycle-aware: if appDate is
 * newer than the stored lastSearched, resets the type's count to 1 instead of
 * incrementing (a new application re-opens the company).
 *
 * Mutates the in-memory map. Caller flushes once via writeAttempts().
 */
export function recordAttempt(company, type, appDate, attempts) {
  const key = normCompany(company);
  if (!key) return;
  if (!attempts[key]) attempts[key] = {};
  const entry = attempts[key];
  const today = localDate();

  // A newer application resets the count for this type.
  if (appDate && entry.lastSearched && appDate > entry.lastSearched) {
    entry[type] = 1;
  } else {
    entry[type] = (entry[type] || 0) + 1;
  }
  entry.lastSearched = today;
}

/**
 * Returns true when the company has reached the cap for this search type
 * AND there is no newer application that would re-open it.
 */
export function isAtCap(company, type, appDate, attempts, cap = 2) {
  const key = normCompany(company);
  if (!key) return false;
  const entry = attempts[key];
  if (!entry) return false;
  const count = entry[type] || 0;
  if (count < cap) return false;
  // A newer app date re-opens the company for searching.
  if (appDate && entry.lastSearched && appDate > entry.lastSearched) return false;
  return true;
}

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
