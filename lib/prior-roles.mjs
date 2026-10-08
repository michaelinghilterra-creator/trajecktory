// Flag only. Never a basis for deleting or suppressing a row. Posting identity is
// the canonical URL, but differing canonical URLs do not veto here because this
// module surfaces reposts that carry new URLs.

import { canonicalUrl, normalizeCompany, sameRole } from './identity.mjs';

const STOPWORDS = new Set(['of', 'the', 'and', 'for', 'a', 'an', 'to']);
const LEVELS = new Set(['director', 'vp', 'head', 'principal', 'staff', 'senior', 'junior', 'lead', 'chief', 'associate']);
const CANON = new Map([
  ['sr', 'senior'],
  ['jr', 'junior'],
  ['mgr', 'manager'],
]);

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function isSubset(small, large) {
  for (const x of small) if (!large.has(x)) return false;
  return true;
}

function rowNum(row) {
  const n = Number(row?.num ?? row?.id);
  return Number.isFinite(n) ? n : null;
}

function scoreValue(row) {
  if (row?.score == null || row?.score === '') return null;
  const n = Number(row?.score);
  return Number.isFinite(n) ? n : null;
}

export function looseRoleKey(title) {
  const head = String(title || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/ (?:-|\u2013) /)[0]
    .replace(/&/g, ' and ');
  const tokens = head
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(t => CANON.get(t) || t)
    .filter(t => !STOPWORDS.has(t));

  const core = new Set();
  const levels = new Set();
  for (const t of tokens) {
    if (LEVELS.has(t)) levels.add(t);
    else core.add(t);
  }
  return { core, levels };
}

// The part of a title after a spaced dash or inside parentheses names a team,
// region or product ("- Ads", "(LCSP)", "- Japan"). When BOTH titles carry one
// and they differ, the postings are different jobs that share a function name.
// One side having no qualifier is not a conflict (a repost often drops it).
export function qualifierKey(title) {
  const t = String(title || '').toLowerCase();
  const parens = [...t.matchAll(/\(([^)]*)\)/g)].map(m => m[1]);
  const tail = t.replace(/\([^)]*\)/g, ' ').split(/ (?:-|–) /).slice(1);
  return [...parens, ...tail].join(' ').split(/[^a-z0-9]+/).filter(t2 => t2 && !STOPWORDS.has(t2)).sort().join(' ');
}

function qualifiersConflict(a, b) {
  const qa = qualifierKey(a);
  const qb = qualifierKey(b);
  return qa !== '' && qb !== '' && qa !== qb;
}

function looseMatch(a, b) {
  const ka = looseRoleKey(a);
  const kb = looseRoleKey(b);
  if (ka.core.size === 0 || kb.core.size === 0) return false;
  if (ka.levels.size > 0 && kb.levels.size > 0 && !setsEqual(ka.levels, kb.levels)) return false;
  if (setsEqual(ka.core, kb.core)) return true;
  const small = ka.core.size <= kb.core.size ? ka.core : kb.core;
  const large = small === ka.core ? kb.core : ka.core;
  return small.size >= 3 && isSubset(small, large);
}

function deltaFor(a, b) {
  const na = rowNum(a);
  const nb = rowNum(b);
  const sa = scoreValue(a);
  const sb = scoreValue(b);
  if (na == null || nb == null || sa == null || sb == null) return null;
  const newer = na >= nb ? sa : sb;
  const older = na >= nb ? sb : sa;
  return Math.round((newer - older) * 10) / 10;
}

export function findRelatedRoles(rows, row) {
  const currentNum = rowNum(row);
  const currentCompany = normalizeCompany(row?.company);
  const currentUrl = canonicalUrl(row?.url || '');
  const out = [];
  for (const other of Array.isArray(rows) ? rows : []) {
    const otherNum = rowNum(other);
    if (currentNum == null || otherNum == null || otherNum === currentNum) continue;
    if (normalizeCompany(other?.company) !== currentCompany) continue;
    const otherUrl = canonicalUrl(other?.url || '');
    if (currentUrl && otherUrl && currentUrl === otherUrl) continue;
    if (!sameRole(row?.role, other?.role) && !looseMatch(row?.role, other?.role)) continue;
    if (qualifiersConflict(row?.role, other?.role)) continue;
    out.push({
      num: otherNum,
      status: other?.status || '',
      date: other?.date || '',
      role: other?.role || '',
      score: scoreValue(other),
      direction: otherNum < currentNum ? 'earlier' : 'later',
      scoreDelta: deltaFor(row, other),
    });
  }
  return out.sort((a, b) => a.num - b.num);
}
