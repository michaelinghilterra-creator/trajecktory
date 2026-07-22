#!/usr/bin/env node
/**
 * merge-tracker.mjs — Merge batch tracker additions into applications.md
 *
 * Handles multiple TSV formats:
 * - 9-col: num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes
 * - 8-col: num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport (no notes)
 * - Pipe-delimited (markdown table row): | col | col | ... |
 *
 * Dedup: company normalized + role fuzzy match + report number match
 * If duplicate with higher score → update in-place, update report link
 * Validates status against templates/states.yml: canonical labels + aliases are
 * loaded from that file at startup (not hardcoded), so they never drift from the
 * dashboard reader / pipeline writer. Unknown values warn and default to Evaluated.
 *
 * Run: node career-ops/merge-tracker.mjs [--dry-run] [--verify]
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import yaml from 'js-yaml';
import { parseScore, shouldAutoDiscard, recommendsAgainst } from './lib/discard.mjs';
import { parseTrackerLine, formatTrackerLine, TRACKER_HEADER, TRACKER_SEPARATOR } from './lib/tracker.mjs';
import { normalizeUrl } from './lib/scan-core.mjs';
// next-jd.mjs (persistent JD counter) can be one update cycle behind on installs
// updating from a pre-counter version. Load it defensively so a missing file
// degrades to max+1 numbering instead of crashing merge-tracker at module load.
let issueJd = null;
try { ({ issueJd } = await import('./next-jd.mjs')); } catch { issueJd = null; }

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
// Support both layouts: data/applications.md (boilerplate, default) and the
// original root applications.md. On a fresh install NEITHER exists yet — default
// to the canonical data/applications.md so a created tracker lands where the
// dashboard actually reads it (root would be invisible to the UI).
const DATA_APPS = join(CAREER_OPS, 'data/applications.md');
const ROOT_APPS = join(CAREER_OPS, 'applications.md');
const APPS_FILE = existsSync(DATA_APPS) ? DATA_APPS : (existsSync(ROOT_APPS) ? ROOT_APPS : DATA_APPS);
const ADDITIONS_DIR = join(CAREER_OPS, 'batch/tracker-additions');
const MERGED_DIR = join(ADDITIONS_DIR, 'merged');
const PIPELINE_FILE = join(CAREER_OPS, 'data/pipeline.md');
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');

// Ensure required directories exist (fresh setup)
mkdirSync(join(CAREER_OPS, 'data'), { recursive: true });
mkdirSync(ADDITIONS_DIR, { recursive: true });

// ── Canonical states + aliases (loaded from templates/states.yml) ─────────────
// templates/states.yml is the documented source of truth shared with the
// dashboard reader and the pipeline writer. CANONICAL_STATES and the alias map
// are derived from it at startup so they can never drift again. When "Closed"
// and "Not a Fit" were added to states.yml, the old hardcoded arrays here did
// not know about them and silently rewrote both to "Evaluated" until they were
// hand-patched (2026-06-23). Reading the file removes that whole class of bug.
const STATES_FILE = join(CAREER_OPS, 'templates/states.yml');
const statesDoc = yaml.load(readFileSync(STATES_FILE, 'utf-8'));
const CANONICAL_STATES = statesDoc.states.map(s => s.label);

// Code-only aliases that are intentionally NOT in states.yml: loose free-text
// the writer occasionally emits, not canonical-state synonyms the dashboard
// needs to know about. Seeded first so anything in states.yml wins on conflict.
const STATUS_ALIASES = {
  condicional: 'Evaluated', hold: 'Evaluated', evaluar: 'Evaluated', verificar: 'Evaluated',
  'geo blocker': 'SKIP',
};
for (const state of statesDoc.states) {
  for (const alias of state.aliases || []) {
    STATUS_ALIASES[String(alias).toLowerCase()] = state.label;
  }
}

// Vocabulary used only to disambiguate swapped score/status columns in
// parseTsvContent. Derived from the same states.yml set as validateStatus so the
// two never disagree about what counts as a status. DUPLICADO/Repost are not
// states.yml entries, but validateStatus maps them to Discarded, so the
// heuristic must still recognize them as status-like.
const KNOWN_STATUS_TOKENS = new Set([
  ...CANONICAL_STATES.map(s => s.toLowerCase()),
  ...Object.keys(STATUS_ALIASES),
  'duplicado', 'repost',
]);
function looksLikeStatus(cell) {
  const lower = cell.trim().toLowerCase();
  for (const token of KNOWN_STATUS_TOKENS) {
    if (lower.startsWith(token)) return true;
  }
  return false;
}

/**
 * Canonicalize a raw status string against templates/states.yml.
 * Strips markdown bold and any trailing date, matches canonical labels
 * (case-insensitive), then the alias map. Genuinely unknown values warn and
 * default to "Evaluated" (warn-and-default, never a hard failure).
 */
function validateStatus(status) {
  const clean = status.replace(/\*\*/g, '').replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  const lower = clean.toLowerCase();

  for (const valid of CANONICAL_STATES) {
    if (valid.toLowerCase() === lower) return valid;
  }

  if (STATUS_ALIASES[lower]) return STATUS_ALIASES[lower];

  // DUPLICADO/Repost → Discarded
  if (/^(duplicado|dup|repost)/i.test(lower)) return 'Discarded';

  console.warn(`⚠️  Non-canonical status "${status}" → defaulting to "Evaluated"`);
  return 'Evaluated';
}

function normalizeCompany(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Tokens that almost every role shares — must NOT count as signal.
// Includes seniority, work-mode, contract, and common locations.
const ROLE_STOPWORDS = new Set([
  // seniority / level
  'junior', 'mid', 'middle', 'senior', 'staff', 'principal', 'lead', 'head',
  'chief', 'associate', 'intern', 'entry', 'level',
  // contract / mode
  'remote', 'hybrid', 'onsite', 'contract', 'contractor', 'freelance',
  'fulltime', 'parttime', 'permanent', 'temporary', 'intern', 'internship',
  // generic job words
  'role', 'position', 'opportunity', 'team', 'based',
  // very common locations (extend in portals.yml later if needed)
  'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'pune', 'chennai',
  'london', 'berlin', 'paris', 'madrid', 'barcelona', 'amsterdam', 'dublin',
  'york', 'francisco', 'seattle', 'boston', 'austin', 'chicago', 'toronto',
  'tokyo', 'singapore', 'sydney', 'melbourne', 'lisbon', 'warsaw',
  // regions / countries
  'europe', 'emea', 'apac', 'latam', 'americas', 'india', 'spain', 'germany',
  'france', 'italy', 'canada', 'brazil', 'mexico', 'japan',
  // prepositions leaking through length filter
  'with', 'from', 'into', 'over', 'this', 'that',
]);

// Level / seniority tokens, compared as a SEPARATE axis from the role's core
// noun phrase. Two roles with DIFFERENT explicit levels are never the same
// posting even when the rest of the title is identical (Director ≠ VP ≠ Senior
// Director). Abbreviations fold to a canonical form so "Sr" == "Senior" and
// "VP" == "vice president".
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

// Split a role title into a { levels, core } signature:
//   • levels — seniority/level tokens (canonicalized), compared on their own axis
//   • core   — the distinguishing content nouns (length > 3, minus stopwords and
//              level words). This is what actually names the function, e.g.
//              {sales, strategy} vs {sales, operations} vs {sales, operations,
//              planning} are three different cores.
// Multi-word "vice president" collapses to the single level token "vp".
function roleSignature(s) {
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

// Two role titles are the SAME posting only when:
//   1. their distinguishing core nouns are identical — so "Sales Strategy",
//      "Sales Operations", and "Sales Operations Planning" are all distinct
//      (the qualifier that separates them must match, not just the shared
//      "Sales"/"Operations"/"Director" family tokens); likewise "Revenue
//      Operations" ≠ "Revenue Enablement"; AND
//   2. their explicit levels are compatible — equal, or one side unspecified —
//      so Director ≠ VP ≠ Senior Director, while a bare "X" re-eval that omits
//      the level still matches "Director X".
// This is deliberately stricter than the old Jaccard-on-smaller-side ratio,
// which let a superset ("Sales Operations Planning") and two same-family roles
// ("Sales Strategy", "Sales Operations") all collapse onto one existing row.
// Because merge-tracker UPDATES rows in place, a false positive silently
// clobbers a distinct role's row; a genuine near-duplicate that slips through
// is consolidated later by dedup-tracker, which is the safe way to err.
function roleFuzzyMatch(a, b) {
  const sigA = roleSignature(a);
  const sigB = roleSignature(b);
  // Need at least some distinguishing signal on both sides.
  if (sigA.core.size === 0 && sigA.levels.size === 0) return false;
  if (sigB.core.size === 0 && sigB.levels.size === 0) return false;
  // Different explicit levels → different posting.
  if (sigA.levels.size > 0 && sigB.levels.size > 0 && !setsEqual(sigA.levels, sigB.levels)) return false;
  // Core nouns must match exactly (no superset/subset collapse).
  return setsEqual(sigA.core, sigB.core);
}

function extractReportNum(reportStr) {
  const m = reportStr.match(/\[(\d+)\]/);
  return m ? parseInt(m[1]) : null;
}

// parseScore now lives in lib/discard.mjs (imported above).

// Canonical parser in lib/tracker.mjs, keeping merge-tracker's extra guard that
// rejects a row numbered 0 (never a real entry).
function parseAppLine(line) {
  const row = parseTrackerLine(line);
  return row && row.num !== 0 ? row : null;
}

/**
 * Parse a TSV file content into a structured addition object.
 * Handles: 9-col TSV, 8-col TSV, pipe-delimited markdown.
 */
function parseTsvContent(content, filename) {
  content = content.trim();
  if (!content) return null;

  let parts;
  let addition;

  // Detect pipe-delimited (markdown table row)
  if (content.startsWith('|')) {
    parts = content.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length < 8) {
      console.warn(`⚠️  Skipping malformed pipe-delimited ${filename}: ${parts.length} fields`);
      return null;
    }
    // Format: num | date | company | role | score | status | pdf | report | notes
    addition = {
      num: parseInt(parts[0]),
      date: parts[1],
      company: parts[2],
      role: parts[3],
      score: parts[4],
      status: validateStatus(parts[5]),
      pdf: parts[6],
      report: parts[7],
      notes: parts[8] || '',
    };
  } else {
    // Tab-separated
    parts = content.split('\t');
    if (parts.length < 8) {
      console.warn(`⚠️  Skipping malformed TSV ${filename}: ${parts.length} fields`);
      return null;
    }

    // Detect column order: some TSVs have (status, score), others have (score, status)
    // Heuristic: if col4 looks like a score and col5 looks like a status, they're swapped
    const col4 = parts[4].trim();
    const col5 = parts[5].trim();
    const col4LooksLikeScore = /^\d+\.?\d*\/5$/.test(col4) || col4 === 'N/A' || col4 === 'DUP';
    const col5LooksLikeScore = /^\d+\.?\d*\/5$/.test(col5) || col5 === 'N/A' || col5 === 'DUP';
    const col4LooksLikeStatus = looksLikeStatus(col4);
    const col5LooksLikeStatus = looksLikeStatus(col5);

    let statusCol, scoreCol;
    if (col4LooksLikeStatus && !col4LooksLikeScore) {
      // Standard format: col4=status, col5=score
      statusCol = col4; scoreCol = col5;
    } else if (col4LooksLikeScore && col5LooksLikeStatus) {
      // Swapped format: col4=score, col5=status
      statusCol = col5; scoreCol = col4;
    } else if (col5LooksLikeScore && !col4LooksLikeScore) {
      // col5 is definitely score → col4 must be status
      statusCol = col4; scoreCol = col5;
    } else {
      // Default: standard format (status before score)
      statusCol = col4; scoreCol = col5;
    }

    addition = {
      num: parseInt(parts[0]),
      date: parts[1],
      company: parts[2],
      role: parts[3],
      status: validateStatus(statusCol),
      score: scoreCol,
      pdf: parts[6],
      report: parts[7],
      notes: parts[8] || '',
    };
  }

  if (isNaN(addition.num) || addition.num === 0) {
    console.warn(`⚠️  Skipping ${filename}: invalid entry number`);
    return null;
  }

  return addition;
}

// ---- Main ----

// Read applications.md — on a fresh install it does not exist yet, so CREATE it
// (header only) instead of bailing. The evaluated TSVs need somewhere to land,
// and "Evaluate Pipeline then Merge Tracker" on a brand-new install otherwise
// dropped every result on the floor ("No applications.md found. Nothing to merge").
if (!existsSync(APPS_FILE)) {
  mkdirSync(dirname(APPS_FILE), { recursive: true });
  writeFileSync(APPS_FILE,
    '# Applications Tracker\n\n' + TRACKER_HEADER + '\n' + TRACKER_SEPARATOR + '\n');
  console.log(`Created ${APPS_FILE} (fresh install).`);
}
const appContent = readFileSync(APPS_FILE, 'utf-8');
const appLines = appContent.split('\n');
const existingApps = [];
let maxNum = 0;

for (const line of appLines) {
  if (line.startsWith('|') && !line.includes('---') && !line.includes('Empresa')) {
    const app = parseAppLine(line);
    if (app) {
      existingApps.push(app);
      if (app.num > maxNum) maxNum = app.num;
    }
  }
}

console.log(`📊 Existing: ${existingApps.length} entries, max #${maxNum}`);

// Every JD number ever used by a row (plus the ones we add this run). New
// entries normally keep the canonical number that next-jd.mjs already stamped
// onto the report (so tracker id == report number, no drift). usedNums only
// guards against a number that somehow collides with a different company
// (e.g. a stale pre-counter batch) — those draw a fresh number instead.
const usedNums = new Set(existingApps.map(a => a.num));

// ── Mark evaluated rows done in pipeline.md ───────────────────────────────────
// Deterministic safety net for the batch-evaluate flow: nothing else flips an
// evaluated URL's pipeline.md row from "- [ ]" to "- [x]", so without this a
// re-run of Evaluate would re-score the same top-of-list roles. We match by the
// report's own URL (v1 JSON frontmatter, or the legacy **URL:** header). The
// Evaluate prompt also marks rows as it goes; this guarantees it even if it didn't.
function reportUrl(reportLink) {
  const m = reportLink && reportLink.match(/\(([^)]*reports\/[^)]+\.md)\)/);
  if (!m) return null;
  const full = join(CAREER_OPS, m[1]);
  if (!existsSync(full)) return null;
  try {
    const text = readFileSync(full, 'utf-8');
    const j = text.match(/"url"\s*:\s*"([^"]+)"/);          // v1 JSON frontmatter
    if (j) return j[1];
    const h = text.match(/\*\*URL:\*\*\s*(\S+)/);            // legacy header
    return h ? h[1] : null;
  } catch { return null; }
}

function markPipelineDone(reportLinks) {
  // unresolved = reports we could not turn into a URL (file missing, no url field,
  // unreadable). Those rows stay "- [ ]" and get re-evaluated next run, which is
  // the safe fallback — but we surface the count so it is never a SILENT skip.
  let unresolved = 0;
  if (!existsSync(PIPELINE_FILE)) return { flipped: 0, unresolved: reportLinks.length };
  const done = new Set();
  for (const link of reportLinks) {
    const u = reportUrl(link);
    if (u) done.add(normalizeUrl(u)); else unresolved++;
  }
  if (!done.size) return { flipped: 0, unresolved };
  let flipped = 0;
  const out = readFileSync(PIPELINE_FILE, 'utf-8').split('\n').map(line => {
    const m = line.match(/^(\s*-\s*)\[ \](\s+)(https?:\/\/[^\s|)]+)(.*)$/);
    if (m && done.has(normalizeUrl(m[3]))) { flipped++; return `${m[1]}[x]${m[2]}${m[3]}${m[4]}`; }
    return line;
  }).join('\n');
  if (flipped > 0) writeFileSync(PIPELINE_FILE, out, 'utf-8');
  return { flipped, unresolved };
}

// Read tracker additions
if (!existsSync(ADDITIONS_DIR)) {
  console.log('No tracker-additions directory found.');
  process.exit(0);
}

const tsvFiles = readdirSync(ADDITIONS_DIR).filter(f => f.endsWith('.tsv'));
if (tsvFiles.length === 0) {
  console.log('✅ No pending additions to merge.');
  process.exit(0);
}

// Sort files numerically for deterministic processing
tsvFiles.sort((a, b) => {
  const numA = parseInt(a.replace(/\D/g, '')) || 0;
  const numB = parseInt(b.replace(/\D/g, '')) || 0;
  return numA - numB;
});

console.log(`📥 Found ${tsvFiles.length} pending additions`);

// ── Source enforcement (deterministic — does not trust the eval agent's label) ─
// Every URL in pipeline.md was put there by a scanner (scan.mjs / discover.mjs /
// the dashboard Agent Scan). A user-pasted JD never enters pipeline.md — it
// deep-evals directly. So membership in pipeline.md is the authoritative source
// signal, and we enforce it in BOTH directions here (see modes/auto-pipeline.md):
//   • URL IN pipeline.md      → SCANNED: strip any [self-sourced] tag the agent
//     added by mistake, so it classifies as API/Agent Scan.
//   • URL NOT in pipeline.md  → user paste = SELF-SOURCED: ADD the [self-sourced]
//     tag if the agent forgot it, so the dashboard Source column and the
//     auto-discard exemption are correct regardless of the agent's labeling.
//     (Notes already tagged [referral:...] are left as-is — a referral is also
//     user-initiated and tracked distinctly.)
// If the report URL can't be resolved we do nothing — safe: the row keeps
// whatever the agent wrote rather than a guess. Only enforcing one direction
// (strip) used to leave untagged self-sourced pastes to be misclassified as
// API/Agent Scan by the dashboard's URL-host fallback.
const scannedUrls = new Set();
if (existsSync(PIPELINE_FILE)) {
  for (const line of readFileSync(PIPELINE_FILE, 'utf-8').split('\n')) {
    for (const u of (line.match(/https?:\/\/[^\s|)]+/g) || [])) scannedUrls.add(normalizeUrl(u));
  }
}
// Remove a [self-sourced] tag AND whatever delimiter the agent used to attach
// it. Agents write the tag as a trailing fragment ("…remote | [self-sourced]",
// "…remote — [self-sourced]"), so lifting out only the tag leaves the delimiter
// dangling. That is cosmetic for a dash and corrupting for a pipe: the orphaned
// '|' becomes an extra table cell when the row is written. Handles the tag at
// either end, since "[self-sourced] | note" strands a leading delimiter too.
const SOURCE_TAG_SEPARATOR = '[|;,·—–-]';
function stripSourceTag(notes) {
  return String(notes)
    .replace(new RegExp(`\\s*${SOURCE_TAG_SEPARATOR}?\\s*\\[self-sourced\\]\\s*`, 'i'), ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(new RegExp(`^\\s*${SOURCE_TAG_SEPARATOR}\\s*`), '')
    .replace(new RegExp(`\\s*${SOURCE_TAG_SEPARATOR}\\s*$`), '')
    .trim();
}
function enforceSource(reportLink, notes, label) {
  const u = reportUrl(reportLink);
  if (!u) return notes;                                 // unknown origin — don't guess
  if (scannedUrls.has(normalizeUrl(u))) {
    // Scanned: strip a stray [self-sourced] tag.
    if (!notes) return notes;
    const cleaned = stripSourceTag(notes);
    if (cleaned !== notes) console.log(`   ↳ source: stripped [self-sourced] from scanned URL (${label || ''})`);
    return cleaned;
  }
  // Not in pipeline.md → self-sourced. Tag it unless already source-tagged.
  if (/\[self-sourced\]|\[referral:/i.test(notes || '')) return notes;
  const tagged = notes ? `[self-sourced] ${notes}` : '[self-sourced]';
  console.log(`   ↳ source: tagged [self-sourced] (not in pipeline.md) (${label || ''})`);
  return tagged;
}

let added = 0;
let updated = 0;
let skipped = 0;
const newLines = [];
const processedReports = [];

// Resolve which existing row (if any) an addition is a re-eval of. Three tiers,
// each requiring the company to match:
//   1. Exact report number match (number collision across companies ≠ same role)
//   2. Exact entry number match (guards against ID reuse across companies)
//   3. Company + role fuzzy match (tightened — see roleFuzzyMatch)
function findExistingMatch(addition) {
  const reportNum = addition._reportNum;
  const normAdditionCompany = addition._normCompany;

  if (reportNum) {
    const byReport = existingApps.find(app =>
      extractReportNum(app.report) === reportNum && normalizeCompany(app.company) === normAdditionCompany);
    if (byReport) return byReport;
  }

  const byNum = existingApps.find(app =>
    app.num === addition.num && normalizeCompany(app.company) === normAdditionCompany);
  if (byNum) return byNum;
  if (existingApps.find(app => app.num === addition.num)) {
    console.warn(`⚠️  ID #${addition.num} already used by a different company — will assign next available ID to ${addition.company}`);
  }

  return existingApps.find(app =>
    normalizeCompany(app.company) === normAdditionCompany && roleFuzzyMatch(addition.role, app.role)) || null;
}

// Do two additions in THIS batch describe the same posting? Same tiers as the
// existing-row match, so regional re-scans / reposts that got different JD
// numbers still collapse via the (tightened) role fuzzy match.
function additionsMatch(a, b) {
  if (a._normCompany !== b._normCompany) return false;
  if (a._reportNum && b._reportNum && a._reportNum === b._reportNum) return true;
  if (a.num === b.num) return true;
  return roleFuzzyMatch(a.role, b.role);
}

// ── Pass 1: parse every addition and resolve its target ───────────────────────
// existingApps is a start-of-run snapshot, so without cross-addition dedup two
// new same-company+role postings both became separate rows and two additions
// that matched the SAME existing row both wrote it (the second clobbering the
// first — one top-4 eval was silently lost on 2026-07-15). We fix both here:
//   • at most ONE addition updates any given existing row (highest score wins)
//   • new additions dedupe against each OTHER (highest score wins)
const parsed = [];
for (const file of tsvFiles) {
  const content = readFileSync(join(ADDITIONS_DIR, file), 'utf-8').trim();
  const addition = parseTsvContent(content, file);
  if (!addition) { skipped++; continue; }
  // Enforce source from pipeline.md before any status/dedup logic reads the notes.
  addition.notes = enforceSource(addition.report, addition.notes, addition.company);
  addition._file = file;
  addition._reportNum = extractReportNum(addition.report);
  addition._normCompany = normalizeCompany(addition.company);
  processedReports.push(addition.report);
  parsed.push(addition);
}

// ── Pass 2: bucket additions into updates-of-existing vs new, deduping both ────
const updatesByExisting = new Map(); // existing.raw → { addition, existing }
const pendingNew = [];               // additions that will become new rows
function consolidate(drop, keep, scope) {
  console.log(`🧹 Consolidated (${scope}): dropped #${drop.num} ${drop.company} — ${drop.role} (${drop.score}) in favor of #${keep.num} ${keep.role} (${keep.score})`);
  skipped++;
}

for (const addition of parsed) {
  const existing = findExistingMatch(addition);
  if (existing) {
    const key = existing.raw;
    const prev = updatesByExisting.get(key);
    if (!prev) {
      updatesByExisting.set(key, { addition, existing });
    } else if (parseScore(addition.score) > parseScore(prev.addition.score)) {
      consolidate(prev.addition, addition, `existing #${existing.num}`);
      updatesByExisting.set(key, { addition, existing });
    } else {
      consolidate(addition, prev.addition, `existing #${existing.num}`);
    }
  } else {
    const rivalIdx = pendingNew.findIndex(p => additionsMatch(p, addition));
    if (rivalIdx === -1) {
      pendingNew.push(addition);
    } else if (parseScore(addition.score) > parseScore(pendingNew[rivalIdx].score)) {
      consolidate(pendingNew[rivalIdx], addition, 'intra-batch');
      pendingNew[rivalIdx] = addition; // keep position, swap in the higher score
    } else {
      consolidate(addition, pendingNew[rivalIdx], 'intra-batch');
    }
  }
}

// ── Apply updates (one per existing row, higher-score-wins vs the existing) ────
for (const { addition, existing: duplicate } of updatesByExisting.values()) {
  const newScore = parseScore(addition.score);
  const oldScore = parseScore(duplicate.score);

  if (newScore > oldScore) {
    console.log(`🔄 Update: #${duplicate.num} ${addition.company} — ${addition.role} (${oldScore}→${newScore})`);
    const lineIdx = appLines.indexOf(duplicate.raw);
    if (lineIdx >= 0) {
      // Determine status for the updated entry:
      //   - Preserve user-set terminal states (Applied/Responded/interview rounds/Offer/Rejected)
      //     — the user took action on this, don't undo it
      //   - If old status was Discarded/SKIP from auto-discard AND the new score
      //     would NOT trigger auto-discard, reset to Evaluated (the re-eval
      //     showed it's worth a fresh look)
      //   - Otherwise keep the existing status
      const userTerminal = ['Applied', 'Responded', 'Phone Screen', '1st Interview', '2nd Interview', '3rd Interview', '4th Interview', 'Offer', 'Rejected'].includes(duplicate.status);
      const autoDiscarded = /auto-discarded:/i.test(duplicate.notes || '');
      const newNotesLower = (addition.notes || '').toLowerCase();
      const newRecAgainst = /\b(do not apply|do not pursue|recommend against|hard\s*(?:no|blocker|disqualifier)|location\s+(?:blocker|hard.?no|mismatch|disqualifier)|international\s+relocation|not recommended|not applicable)\b/.test(newNotesLower);
      const isSelfSourced = /\[self-sourced\]|\[referral:|\[cowork\]/i.test(addition.notes || '');
      const wouldAutoDiscard = !isSelfSourced && (newScore <= 2.5 || newRecAgainst);
      let resolvedStatus = duplicate.status;
      if (!userTerminal && autoDiscarded && !wouldAutoDiscard) {
        resolvedStatus = 'Evaluated';
        console.log(`   ↳ Reset status: ${duplicate.status} → Evaluated (re-eval cleared the auto-discard condition)`);
      }
      const resumeVal = duplicate.resume || '—';
      const updatedLine = formatTrackerLine({
        num: duplicate.num,
        date: addition.date,
        company: addition.company,
        role: addition.role,
        score: addition.score,
        status: resolvedStatus,
        pdf: duplicate.pdf,
        resume: resumeVal,
        report: addition.report,
        notes: `Re-eval ${addition.date} (${oldScore}→${newScore}). ${addition.notes}`,
      });
      appLines[lineIdx] = updatedLine;
      updated++;
    }
  } else {
    console.log(`⏭️  Skip: ${addition.company} — ${addition.role} (existing #${duplicate.num} ${oldScore} >= new ${newScore})`);
    skipped++;
  }
}

// ── Apply new rows (deduped winners) ──────────────────────────────────────────
for (const addition of pendingNew) {
  // New entry. With the persistent counter (next-jd.mjs) the report number IS
  // the canonical, never-reused JD#, so the tracker id should match it exactly
  // (this is what kills the old id<->report drift). Only if that number is
  // already taken by a DIFFERENT company — a leftover from the pre-counter
  // "max existing + 1" era — do we draw a fresh, monotonic number.
  let entryNum = addition.num;
  if (usedNums.has(entryNum)) {
    entryNum = issueJd ? issueJd() : ++maxNum;
    console.warn(`⚠️  #${addition.num} already in use — assigned fresh JD #${entryNum} to ${addition.company}`);
  }
  usedNums.add(entryNum);
  if (entryNum > maxNum) maxNum = entryNum;

  // Auto-discard entries that aren't worth pursuing:
  //   (a) numerical score <= 2.5  OR
  //   (b) notes contain "do not apply" / "recommend against" / "hard no" /
  //       "not recommended" — catches cases where the agent gave a 3+
  //       score on individual dimensions but flagged the role as a
  //       structural mismatch in the verdict.
  //
  // EXEMPT from auto-discard:
  //   - Entries tagged [self-sourced] in notes — user explicitly chose this
  //     JD, they want to see the evaluation regardless of score.
  //   - Entries tagged [referral:...] in notes — referrals always get the
  //     full evaluation; user can decide what to do with the relationship.
  //   The source-tag convention is documented in modes/auto-pipeline.md.
  const numScore = parseScore(addition.score);
  let finalStatus = addition.status;
  let finalNotes = addition.notes;
  if (shouldAutoDiscard({ status: finalStatus, score: addition.score, notes: finalNotes })) {
    finalStatus = 'Discarded';
    const reason = recommendsAgainst(finalNotes)
      ? `auto-discarded: agent recommends against`
      : `auto-discarded: score ${numScore} <= 2.5`;
    finalNotes = finalNotes ? `${reason}. ${finalNotes}` : reason;
  }

  const newLine = formatTrackerLine({
    num: entryNum,
    date: addition.date,
    company: addition.company,
    role: addition.role,
    score: addition.score,
    status: finalStatus,
    pdf: addition.pdf,
    resume: '—',
    report: addition.report,
    notes: finalNotes,
  });
  newLines.push(newLine);
  added++;
  const tag = finalStatus === 'Discarded' ? '🗑️ ' : '➕ ';
  console.log(`${tag}Add #${entryNum}: ${addition.company} — ${addition.role} (${addition.score}, ${finalStatus})`);
}

// Insert new lines after the header (line index of first data row)
if (newLines.length > 0) {
  // Find header separator (|---|...) and insert after it
  let insertIdx = -1;
  for (let i = 0; i < appLines.length; i++) {
    if (appLines[i].includes('---') && appLines[i].startsWith('|')) {
      insertIdx = i + 1;
      break;
    }
  }
  if (insertIdx >= 0) {
    appLines.splice(insertIdx, 0, ...newLines);
  }
}

// Write back
if (!DRY_RUN) {
  writeFileSync(APPS_FILE, appLines.join('\n'));

  // Flip evaluated URLs' pipeline.md rows to done so re-running Evaluate advances
  // to the next batch instead of re-scoring these.
  const { flipped, unresolved } = markPipelineDone(processedReports);
  if (flipped > 0) console.log(`✓ Marked ${flipped} pipeline.md row${flipped === 1 ? '' : 's'} done (evaluated this batch)`);
  if (unresolved > 0) console.log(`⚠️  ${unresolved} evaluated report${unresolved === 1 ? '' : 's'} had no resolvable URL — those pipeline rows stay pending and will be re-evaluated next run.`);

  // Move processed files to merged/
  if (!existsSync(MERGED_DIR)) mkdirSync(MERGED_DIR, { recursive: true });
  for (const file of tsvFiles) {
    renameSync(join(ADDITIONS_DIR, file), join(MERGED_DIR, file));
  }
  console.log(`\n✅ Moved ${tsvFiles.length} TSVs to merged/`);
}

console.log(`\n📊 Summary: +${added} added, 🔄${updated} updated, ⏭️${skipped} skipped`);
if (DRY_RUN) console.log('(dry-run — no changes written)');

// Optional verify
if (VERIFY && !DRY_RUN) {
  console.log('\n--- Running verification ---');
  try {
    execFileSync('node', [join(CAREER_OPS, 'verify-pipeline.mjs')], { stdio: 'inherit' });
  } catch (e) {
    process.exit(1);
  }
}
