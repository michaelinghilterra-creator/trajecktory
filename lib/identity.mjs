// identity.mjs — the ONE place that decides whether two things are the same posting.
//
// WHY THIS EXISTS:
// "Have I seen this job before?" used to be answered by eight uncoordinated
// mechanisms keyed on four different URL identities and four different
// company+role identities, none of them sharing a function. A posting could
// dodge one check while tripping another, so already-decided roles resurfaced
// as new candidates and distinct requisitions were silently merged onto one
// row. Both failure modes are invisible: a wrong row is still a valid row.
//
// THE RULE: posting identity is the canonical URL. Company+role CANNOT
// distinguish two requisitions with the same title at the same employer — a
// common shape at scaling startups, and it ate real evaluations twice. So a
// differing canonical URL VETOES a role match; `sameRole` is only the fallback
// for when a URL cannot be resolved at all.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { parseTrackerLine } from './tracker.mjs';

// ── URL identity ──────────────────────────────────────────────────────────────

// Query keys that IDENTIFY a posting rather than track its referrer. Some
// companies front their board through a custom domain with one static path
// shared by every posting, where the id query param is the ONLY thing
// distinguishing one job from another — stripping it collapses every posting
// from that company onto the same key, which an audit found had made whole
// boards' worth of postings permanently invisible.
//
// Lever (hostedUrl) and Ashby (jobUrl) bake the id into the URL PATH, so they
// need no entry. ADP / Hirebridge / Workday-style hosts do not, which is why
// this list is wider than the original `gh_jid`-only set: two postings at
// DIFFERENT employers on a shared ADP host would otherwise canonicalize to the
// identical string. See `buildDecidedIndex`'s ambiguity guard for the
// belt-and-braces defense that catches whatever this list misses.
const ID_QUERY_KEYS = new Set([
  'gh_jid',
  'jobid', 'job_id', 'job',
  'reqid', 'req_id', 'req',
  'postingid', 'posting_id', 'posting',
  'vacancyid', 'vacancy_id', 'vacancy',
  'ccid', 'cid', 'pid', 'rid',
]);

// Strip tracking query params (utm_*, gh_src, etc. — anything not in
// ID_QUERY_KEYS) and a trailing /application or /apply so the same posting
// isn't treated as new just because the URL variant changed (Ashby/Greenhouse
// expose /application, Lever exposes /apply). Query filtering happens on the
// query string alone and path stripping on the base path alone, so the two
// never interfere regardless of which the URL has. The (?:application|apply)
// group only strips a WHOLE trailing segment, so a company slug like
// jobs.lever.co/applyacme/{uuid} is left intact ("apply" there is followed by
// "acme", not "/" or end-of-string).
//
// Key comparison is case-insensitive: ADP and Workday vary the casing of the
// same param (jobId vs jobid) across links to the identical posting.
export function canonicalUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  const qIndex = url.indexOf('?');
  const rawBase = qIndex === -1 ? url : url.slice(0, qIndex);
  const query = qIndex === -1 ? '' : url.slice(qIndex + 1);

  const base = rawBase.replace(/\/(?:application|apply)(\/.*)?$/, '').replace(/\/$/, '');
  if (!query) return base;

  // Kept params are rewritten with a lowercased key and sorted, so the SAME
  // posting linked as ?jobId=9 and ?jobid=9, or with its params in a different
  // order, produces one key. Matching case-insensitively while emitting the
  // original casing would defeat the whole point: both variants survive the
  // filter and then compare unequal.
  const kept = query.split('&')
    .map(pair => {
      const eq = pair.indexOf('=');
      const k = (eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
      return ID_QUERY_KEYS.has(k) ? `${k}${eq === -1 ? '' : '=' + pair.slice(eq + 1)}` : null;
    })
    .filter(Boolean)
    .sort();
  return kept.length ? `${base}?${kept.join('&')}` : base;
}

// ── Company identity ──────────────────────────────────────────────────────────

export function normalizeCompany(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Is this the same employer under two spellings? The tracker's company cell is
// free text written by a human or an agent, so one posting routinely lands both
// with and without a legal suffix, or with a product word appended (think
// "Example" vs "Example Inc." vs "Example Labs"). A prefix match either
// direction folds those together.
//
// This is deliberately used ONLY to decide whether a shared URL is suspicious.
// It is never used to decide that two POSTINGS are the same — that is always
// the URL's job. Two unrelated employers really can share a name prefix across
// different ATS boards; when that happens they are distinguished by their URLs,
// not by this function.
function sameCompanyish(a, b) {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

// Does this canonical URL name ONE specific posting, as opposed to a board or
// a landing page? A UUID, a long numeric id, or a surviving id query param all
// mean the URL is precise enough that two rows sharing it are the same job,
// whatever their company cells say.
//
// This is what makes the ambiguity guard below fire only when it should: a URL
// that has been stripped down to a shared host path (the real collision risk)
// carries none of these markers.
function looksPostingSpecific(canonical) {
  if (!canonical) return false;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(canonical)) return true; // uuid
  if (/\d{6,}/.test(canonical)) return true;                                                        // long numeric id
  if (canonical.includes('?')) return true;                                                         // a kept ID_QUERY_KEY
  return false;
}

// ── Role identity (FALLBACK ONLY — never a basis for deleting a row) ──────────

// Tokens that almost every role shares — must NOT count as signal.
const ROLE_STOPWORDS = new Set([
  // seniority / level
  'junior', 'mid', 'middle', 'senior', 'staff', 'principal', 'lead', 'head',
  'chief', 'associate', 'intern', 'entry', 'level',
  // contract / mode
  'remote', 'hybrid', 'onsite', 'contract', 'contractor', 'freelance',
  'fulltime', 'parttime', 'permanent', 'temporary', 'internship',
  // generic job words
  'role', 'position', 'opportunity', 'team', 'based',
  // very common locations
  'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'pune', 'chennai',
  'london', 'berlin', 'paris', 'madrid', 'barcelona', 'amsterdam', 'dublin',
  'york', 'francisco', 'seattle', 'boston', 'austin', 'chicago', 'toronto',
  'tokyo', 'singapore', 'sydney', 'melbourne', 'lisbon', 'warsaw',
  // regions / countries
  'europe', 'emea', 'apac', 'latam', 'americas', 'india', 'spain', 'germany',
  'france', 'italy', 'canada', 'brazil', 'mexico', 'japan',
  // prepositions leaking through the length filter
  'with', 'from', 'into', 'over', 'this', 'that',
]);

// Level tokens, compared as a SEPARATE axis from the role's core noun phrase.
// Two roles with DIFFERENT explicit levels are never the same posting even when
// the rest of the title is identical (Director != VP != Senior Director).
// Abbreviations fold so "Sr" == "Senior" and "VP" == "vice president".
const LEVEL_CANON = new Map([
  ['intern', 'intern'], ['internship', 'intern'],
  ['jr', 'junior'], ['junior', 'junior'],
  ['associate', 'associate'],
  ['mid', 'mid'], ['middle', 'mid'],
  ['sr', 'senior'], ['snr', 'senior'], ['senior', 'senior'],
  ['staff', 'staff'],
  ['principal', 'principal'],
  ['lead', 'lead'],
  ['mgr', 'manager'], ['manager', 'manager'],
  ['dir', 'director'], ['director', 'director'],
  ['vp', 'vp'], ['svp', 'svp'], ['evp', 'evp'], ['avp', 'avp'],
  ['head', 'head'],
  ['chief', 'chief'],
  ['president', 'president'],
]);

// Split a role title into { levels, core }. `core` is the distinguishing
// content nouns, so {sales, strategy} vs {sales, operations} vs {sales,
// operations, planning} are three different roles. "vice president" collapses
// to the single level token "vp".
export function roleSignature(s) {
  const raw = String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const levels = new Set();
  const core = new Set();
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    if (w === 'vice' && raw[i + 1] === 'president') { levels.add('vp'); i++; continue; }
    if (LEVEL_CANON.has(w)) { levels.add(LEVEL_CANON.get(w)); continue; }
    if (ROLE_STOPWORDS.has(w)) continue;
    if (w.length > 3) core.add(w);
  }
  return { levels, core };
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

// Two role titles MAY be the same posting when their core nouns are identical
// AND their explicit levels are compatible (equal, or one side unspecified).
//
// This can only ever be a hint. Three requisitions at one employer can carry
// byte-identical titles and be three genuinely different openings, and no
// amount of string cleverness separates those — only the URL does. Callers
// must let a differing canonical URL override a true return here, and must
// never DELETE a row on this signal alone.
export function sameRole(a, b) {
  const sigA = roleSignature(a);
  const sigB = roleSignature(b);
  if (sigA.core.size === 0 && sigA.levels.size === 0) return false;
  if (sigB.core.size === 0 && sigB.levels.size === 0) return false;
  if (sigA.levels.size > 0 && sigB.levels.size > 0 && !setsEqual(sigA.levels, sigB.levels)) return false;
  return setsEqual(sigA.core, sigB.core);
}

// ── Resolving a tracker row back to the URL it evaluated ─────────────────────

// A report link ("[000](reports/000-example-co-2020-01-01.md)") or a bare path →
// the posting URL recorded inside that report. Reports carry the URL in v1 JSON
// frontmatter; older ones use a legacy **URL:** header. Returns null rather
// than throwing for a missing file, an unreadable one, or a report with no url.
export function urlFromReport(reportLinkOrPath, rootDir) {
  if (!reportLinkOrPath) return null;
  const m = String(reportLinkOrPath).match(/\(([^)]*reports\/[^)]+\.md)\)/);
  const rel = m ? m[1] : (/reports\/.+\.md$/.test(reportLinkOrPath) ? reportLinkOrPath : null);
  if (!rel) return null;
  const full = join(rootDir, rel);
  if (!existsSync(full)) return null;
  try {
    const text = readFileSync(full, 'utf-8');
    const j = text.match(/"url"\s*:\s*"([^"]+)"/);   // v1 JSON frontmatter
    if (j) return j[1];
    const h = text.match(/\*\*URL:\*\*\s*(\S+)/);     // legacy header
    return h ? h[1] : null;
  } catch { return null; }
}

// Resolve one parsed tracker row to its posting URL. Prefers the row's own url
// cell and falls back to the report. The fallback is PERMANENT, not migration
// scaffolding: rows predating the url column, hand-edited rows, and rows whose
// cell was blanked all still resolve.
export function urlForRow(row, rootDir) {
  if (row && row.url) return row.url;
  return urlFromReport(row && row.report, rootDir);
}

// ── The decided index ────────────────────────────────────────────────────────

// Build a lookup of "postings already evaluated and recorded in the tracker",
// keyed by canonical URL.
//
// AMBIGUITY GUARD: some hosts serve many employers off one path shape, so two
// genuinely different companies' postings could canonicalize to the same string
// if the identifying part were stripped. Rather than maintain a host allowlist
// forever, this detects the collision in the DATA: a canonical URL is ambiguous
// when it maps to rows from more than one employer AND the URL itself carries
// no posting-specific id.
//
// Both halves matter. Without the id test the guard misfires on every posting
// whose company was typed two ways (with and without a legal suffix), which are
// exactly the duplicates worth suppressing — measured against a real tracker,
// every flag was that case and none was a true cross-employer collision.
// Without the company test a genuinely stripped host path would silently
// suppress a real job.
//
// It fails toward doing nothing: a missed suppression costs tokens, a wrong one
// hides a job the user should have seen.
export function buildDecidedIndex({ appsPath, rootDir }) {
  const byUrl = new Map();
  const ambiguous = new Set();
  const companiesPerUrl = new Map();
  // Rows whose URL cannot be resolved at all (no report, missing file, no url
  // field). They are the ONLY reason the role matcher still exists: without a
  // URL there is nothing better to compare. On a real tracker this is a handful
  // of rows out of the whole file, so it is genuinely a fallback, never the main
  // path.
  const noUrlByCompany = new Map();

  let text = '';
  try { text = readFileSync(appsPath, 'utf-8'); } catch { return { byUrl, ambiguous, noUrlByCompany }; }

  for (const line of text.split(/\r?\n/)) {
    const row = parseTrackerLine(line);
    if (!row || !row.num) continue;
    const raw = urlForRow(row, rootDir);
    if (!raw) {
      const co = normalizeCompany(row.company);
      if (!noUrlByCompany.has(co)) noUrlByCompany.set(co, []);
      noUrlByCompany.get(co).push({ num: row.num, status: row.status, company: row.company, role: row.role });
      continue;
    }
    const key = canonicalUrl(raw);
    if (!key) continue;

    const co = normalizeCompany(row.company);
    if (!companiesPerUrl.has(key)) companiesPerUrl.set(key, new Set());
    const seen = companiesPerUrl.get(key);
    if (!looksPostingSpecific(key) && seen.size && ![...seen].some(c => sameCompanyish(c, co))) {
      ambiguous.add(key);
    }
    seen.add(co);

    // First writer wins so the LOWEST row number is reported as the original.
    if (!byUrl.has(key)) {
      byUrl.set(key, { num: row.num, status: row.status, company: row.company, role: row.role });
    }
  }
  return { byUrl, ambiguous, noUrlByCompany };
}

// Has this posting already been evaluated? Returns the existing tracker row, or
// null when unseen OR when the canonical key is ambiguous (see the guard above).
//
// URL is primary. `hint` ({company, role}) only engages the role fallback
// against tracker rows that have NO resolvable URL of their own — a differing
// URL always wins, so two same-titled requisitions never collapse here.
export function findDecided(index, url, hint) {
  if (!index) return null;

  if (url) {
    const key = canonicalUrl(url);
    if (key && index.ambiguous.has(key)) return null;
    if (key && index.byUrl.has(key)) return index.byUrl.get(key);
  }

  if (hint && hint.company && hint.role && index.noUrlByCompany) {
    const candidates = index.noUrlByCompany.get(normalizeCompany(hint.company)) || [];
    for (const c of candidates) if (sameRole(c.role, hint.role)) return c;
  }
  return null;
}
