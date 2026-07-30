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
import { join, resolve, sep } from 'path';
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

// Cut the path at the first WHOLE `apply` / `application` segment, so the same
// posting isn't treated as new just because the URL variant changed
// (Ashby/Greenhouse expose /application, Lever exposes /apply).
//
// Segment-wise rather than by regex, deliberately. The regex this replaced,
// /\/(?:application|apply)(\/.*)?$/, is a polynomial ReDoS: the optional
// greedy tail has to be re-scanned to end-of-string from every candidate start
// position, so a URL with many repeated `/apply/` segments costs O(n^2).
// Posting URLs come from scanned job boards, i.e. from outside, so that input
// is not under our control. CodeQL flagged it as js/polynomial-redos.
//
// Splitting on '/' is linear and expresses the intent more directly anyway: a
// company slug like jobs.lever.co/applyacme/{uuid} is untouched because
// "applyacme" is not the segment "apply".
function stripApplySegment(path) {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i].toLowerCase();
    if (seg === 'apply' || seg === 'application') return parts.slice(0, i).join('/');
  }
  return path;
}

// Trailing slashes, stripped by index rather than by /\/+$/. That regex is the
// same ReDoS shape as the one above: on a long run of slashes not at the end,
// the engine re-consumes the whole run from every start position. It replaced a
// single-slash /\/$/ here and reintroduced the exact bug the segment rewrite was
// removing, which is why this is a loop and not a cleverer pattern.
function stripTrailingSlashes(s) {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47) end--; // 47 = '/'
  return end === s.length ? s : s.slice(0, end);
}

// A Greenhouse job id is globally unique across every Greenhouse board, and the
// SAME id surfaces in two URL shapes that share no host or path:
//
//   branded career page : https://jobs.exampleco.com/listing/5550001?gh_jid=5550001
//   raw greenhouse board: https://job-boards.greenhouse.io/exampleco/jobs/5550001
//
// Host+path canonicalization alone treats those as two different postings, so
// the same requisition got evaluated twice under two separate report ids. Worse,
// the "a differing canonical URL vetoes a same-title match" rule then actively
// confirmed the split. Collapsing both
// forms to `gh:{id}` fixes it at the identity layer, where every dedup path
// already reads. The id is trusted from two signals:
//   - a `gh_jid=N` query param, which branded pages carry on ANY host
//   - a `greenhouse.io/.../jobs/N` path, the raw board form
// Restricting the path form to greenhouse.io hosts keeps a random site's
// /jobs/12345 from being mistaken for a Greenhouse id.
function greenhouseId(url) {
  const q = url.match(/[?&]gh_jid=(\d+)/i);
  if (q) return q[1];
  // A greenhouse.io host with /jobs/{digits} in the path. Done as a host test
  // plus a separate /jobs/{id} match rather than one
  // `greenhouse\.io\/[^?#]*\/jobs\/` regex: the greedy `[^?#]*` before /jobs/
  // backtracks polynomially on a URL with many path segments (ReDoS), and
  // posting URLs come from scanned boards, i.e. uncontrolled input. Both halves
  // here are linear.
  if (/greenhouse\.io\//i.test(url)) {
    const p = url.match(/\/jobs\/(\d+)/);
    if (p) return p[1];
  }
  return null;
}

// Strip tracking query params (utm_*, gh_src, etc. — anything not in
// ID_QUERY_KEYS) and the trailing apply segment. Query filtering happens on the
// query string alone and path stripping on the base path alone, so the two
// never interfere regardless of which the URL has.
//
// Key comparison is case-insensitive: ADP and Workday vary the casing of the
// same param (jobId vs jobid) across links to the identical posting.
export function canonicalUrl(url) {
  if (typeof url !== 'string' || !url) return '';

  // A resolvable Greenhouse id is a stronger identity than host+path: it unifies
  // the branded and raw-board forms of one requisition that would otherwise never
  // compare equal. Checked before anything else so both forms return one key.
  const ghid = greenhouseId(url);
  if (ghid) return `gh:${ghid}`;

  const qIndex = url.indexOf('?');
  const rawBase = qIndex === -1 ? url : url.slice(0, qIndex);
  const query = qIndex === -1 ? '' : url.slice(qIndex + 1);

  const base = stripTrailingSlashes(stripApplySegment(rawBase));
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
  // Containment: the matched `rel` only had to contain "reports/" and end in
  // ".md", which still permits ../ escaping segments. Reject anything that
  // resolves outside rootDir/reports so a poisoned tracker cell cannot turn this
  // into an arbitrary-file read (security: CWE-22).
  const reportsRoot = resolve(rootDir, 'reports');
  const resolved = resolve(full);
  if (resolved !== reportsRoot && !resolved.startsWith(reportsRoot + sep)) return null;
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

    // When one posting has several rows, report the HIGHEST row number: the most
    // recent evaluation, whose status is the decision that still stands.
    //
    // Chosen explicitly rather than left to file order. This was "first writer
    // wins", commented as reporting the lowest number, which was wrong on two
    // counts: the tracker is not stored in ascending order, so first-writer-wins
    // returned whatever happened to appear first, and merge-tracker inserts new
    // rows at the TOP, so the answer could change as rows were added without
    // anything about the posting changing. A suppression message that names a
    // different row on Tuesday than it did on Monday is not one a user can trust.
    const prior = byUrl.get(key);
    if (!prior || row.num > prior.num) {
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

// ── Active-engagement repost guard (Option A dedup) ───────────────────────────
// A reposted requisition gets a NEW url, so canonical-url dedup treats it as a
// brand-new posting, which re-evaluates a role you have already applied to. findDecided
// deliberately WON'T collapse two differing trustworthy urls, because a company
// can post two genuinely distinct reqs with the same title. But re-evaluating a
// role you are ALREADY engaged on — applied, interviewing — is never a new
// opportunity; it just burns a full eval to reach a conclusion the tracker holds.
// So this guard is deliberately NARROW: it fires only for active-engagement
// statuses, where a same-company same-role repost is overwhelmingly the SAME
// requisition. It SUPPRESSES (never deletes), and every hit must be logged.
export const ACTIVE_ENGAGEMENT_STATUSES = new Set([
  'Applied', 'Responded', 'Phone Screen',
  '1st Interview', '2nd Interview', '3rd Interview', '4th Interview',
  'Offer',
]);

// Index company → active tracker rows. UNLIKE buildDecidedIndex this keys by
// company+role even for rows that HAVE a url, because the whole point is to catch
// the same role reposted at a DIFFERENT url.
export function buildActiveRoleIndex({ appsPath, rootDir, statuses = ACTIVE_ENGAGEMENT_STATUSES }) {
  const byCompany = new Map();
  let text = '';
  try { text = readFileSync(appsPath, 'utf-8'); } catch { return { byCompany }; }
  for (const line of text.split(/\r?\n/)) {
    const row = parseTrackerLine(line);
    if (!row || !row.num || !statuses.has(row.status)) continue;
    const co = normalizeCompany(row.company);
    const raw = urlForRow(row, rootDir);
    const canonical = raw ? canonicalUrl(raw) : null;
    if (!byCompany.has(co)) byCompany.set(co, []);
    byCompany.get(co).push({ num: row.num, status: row.status, company: row.company, role: row.role, canonical });
  }
  return { byCompany };
}

// Is this pending posting a repost of a role you are ALREADY engaged on? Returns
// the active tracker row, or null. Requires same company, same role (sameRole),
// and a DIFFERENT canonical url — an identical url is already caught by
// findDecided; a differing one is the repost signal.
export function findActiveRepost(activeIndex, url, hint) {
  if (!activeIndex || !hint || !hint.company || !hint.role) return null;
  const co = normalizeCompany(hint.company);
  const candidates = activeIndex.byCompany.get(co) || [];
  const key = url ? canonicalUrl(url) : null;
  for (const c of candidates) {
    if (!sameRole(c.role, hint.role)) continue;
    if (key && c.canonical && key === c.canonical) continue; // same posting → findDecided's job
    return c;
  }
  return null;
}
