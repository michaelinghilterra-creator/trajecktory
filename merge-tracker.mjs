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
 * Validates status against states.yml (rejects non-canonical, logs warning)
 *
 * Run: node career-ops/merge-tracker.mjs [--dry-run] [--verify]
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, renameSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { parseScore, shouldAutoDiscard, recommendsAgainst } from './lib/discard.mjs';
import { parseTrackerLine } from './lib/tracker.mjs';
import { normalizeUrl } from './lib/scan-core.mjs';

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

// Canonical states and aliases
const CANONICAL_STATES = ['Evaluated', 'Applied', 'Responded', 'Interview', 'Offer', 'Rejected', 'Discarded', 'SKIP', 'Closed', 'Not a Fit'];

function validateStatus(status) {
  const clean = status.replace(/\*\*/g, '').replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  const lower = clean.toLowerCase();

  for (const valid of CANONICAL_STATES) {
    if (valid.toLowerCase() === lower) return valid;
  }

  // Aliases
  const aliases = {
    // Spanish → English
    'evaluada': 'Evaluated', 'condicional': 'Evaluated', 'hold': 'Evaluated', 'evaluar': 'Evaluated', 'verificar': 'Evaluated',
    'aplicado': 'Applied', 'enviada': 'Applied', 'aplicada': 'Applied', 'applied': 'Applied', 'sent': 'Applied',
    'respondido': 'Responded',
    'entrevista': 'Interview',
    'oferta': 'Offer',
    'rechazado': 'Rejected', 'rechazada': 'Rejected',
    'descartado': 'Discarded', 'descartada': 'Discarded', 'cerrada': 'Discarded', 'cancelada': 'Discarded',
    'no aplicar': 'SKIP', 'no_aplicar': 'SKIP', 'skip': 'SKIP', 'monitor': 'SKIP',
    'geo blocker': 'SKIP',
  };

  if (aliases[lower]) return aliases[lower];

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

function roleTokens(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !ROLE_STOPWORDS.has(w));
}

function roleFuzzyMatch(a, b) {
  const wordsA = roleTokens(a);
  const wordsB = roleTokens(b);
  if (wordsA.length === 0 || wordsB.length === 0) return false;

  const setB = new Set(wordsB);
  const overlap = wordsA.filter(w => setB.has(w)).length;
  if (overlap === 0) return false;

  // Jaccard-style ratio on content tokens. Two roles are "the same" only
  // when the overlap dominates the smaller side — not when they just share
  // a location + "engineer".
  const minLen = Math.min(wordsA.length, wordsB.length);
  const ratio = overlap / minLen;

  return overlap >= 2 && ratio >= 0.6;
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
    const col4LooksLikeStatus = /^(evaluated|applied|responded|interview|offer|rejected|discarded|skip|evaluada|aplicado|respondido|entrevista|oferta|rechazado|descartado|no aplicar|cerrada|duplicado|repost|condicional|hold|monitor)/i.test(col4);
    const col5LooksLikeStatus = /^(evaluated|applied|responded|interview|offer|rejected|discarded|skip|evaluada|aplicado|respondido|entrevista|oferta|rechazado|descartado|no aplicar|cerrada|duplicado|repost|condicional|hold|monitor)/i.test(col5);

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
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|--------|-------|\n');
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

let added = 0;
let updated = 0;
let skipped = 0;
const newLines = [];
const processedReports = [];

for (const file of tsvFiles) {
  const content = readFileSync(join(ADDITIONS_DIR, file), 'utf-8').trim();
  const addition = parseTsvContent(content, file);
  if (!addition) { skipped++; continue; }
  processedReports.push(addition.report);

  // Check for duplicate by:
  // 1. Exact report number match (same company required — number collision ≠ same role)
  // 2. Exact entry number match (same company required — guards against ID reuse across companies)
  // 3. Company + role fuzzy match
  const reportNum = extractReportNum(addition.report);
  const normAdditionCompany = normalizeCompany(addition.company);
  let duplicate = null;

  if (reportNum) {
    // Report number match — only treat as duplicate if company also matches
    duplicate = existingApps.find(app => {
      const existingReportNum = extractReportNum(app.report);
      return existingReportNum === reportNum && normalizeCompany(app.company) === normAdditionCompany;
    });
  }

  if (!duplicate) {
    // Entry number match — only treat as duplicate if company also matches.
    // If numbers collide but companies differ, it is a collision, not a re-eval;
    // the new entry will receive the next available ID instead.
    duplicate = existingApps.find(app =>
      app.num === addition.num && normalizeCompany(app.company) === normAdditionCompany
    );
    if (!duplicate && existingApps.find(app => app.num === addition.num)) {
      console.warn(`⚠️  ID #${addition.num} already used by a different company — will assign next available ID to ${addition.company}`);
    }
  }

  if (!duplicate) {
    // Company + role fuzzy match
    duplicate = existingApps.find(app => {
      if (normalizeCompany(app.company) !== normAdditionCompany) return false;
      return roleFuzzyMatch(addition.role, app.role);
    });
  }

  if (duplicate) {
    const newScore = parseScore(addition.score);
    const oldScore = parseScore(duplicate.score);

    if (newScore > oldScore) {
      console.log(`🔄 Update: #${duplicate.num} ${addition.company} — ${addition.role} (${oldScore}→${newScore})`);
      const lineIdx = appLines.indexOf(duplicate.raw);
      if (lineIdx >= 0) {
        // Determine status for the updated entry:
        //   - Preserve user-set terminal states (Applied/Responded/Interview/Offer/Rejected)
        //     — the user took action on this, don't undo it
        //   - If old status was Discarded/SKIP from auto-discard AND the new score
        //     would NOT trigger auto-discard, reset to Evaluated (the re-eval
        //     showed it's worth a fresh look)
        //   - Otherwise keep the existing status
        const userTerminal = ['Applied', 'Responded', 'Interview', 'Offer', 'Rejected'].includes(duplicate.status);
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
        const updatedLine = `| ${duplicate.num} | ${addition.date} | ${addition.company} | ${addition.role} | ${addition.score} | ${resolvedStatus} | ${duplicate.pdf} | ${resumeVal} | ${addition.report} | Re-eval ${addition.date} (${oldScore}→${newScore}). ${addition.notes} |`;
        appLines[lineIdx] = updatedLine;
        updated++;
      }
    } else {
      console.log(`⏭️  Skip: ${addition.company} — ${addition.role} (existing #${duplicate.num} ${oldScore} >= new ${newScore})`);
      skipped++;
    }
  } else {
    // New entry — use the number from the TSV
    const entryNum = addition.num > maxNum ? addition.num : ++maxNum;
    if (addition.num > maxNum) maxNum = addition.num;

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

    const newLine = `| ${entryNum} | ${addition.date} | ${addition.company} | ${addition.role} | ${addition.score} | ${finalStatus} | ${addition.pdf} | — | ${addition.report} | ${finalNotes} |`;
    newLines.push(newLine);
    added++;
    const tag = finalStatus === 'Discarded' ? '🗑️ ' : '➕ ';
    console.log(`${tag}Add #${entryNum}: ${addition.company} — ${addition.role} (${addition.score}, ${finalStatus})`);
  }
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
