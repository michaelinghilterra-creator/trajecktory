#!/usr/bin/env node
/**
 * dedup-tracker.mjs — Consolidate duplicate entries in applications.md
 *
 * Clusters by normalized company + EXACT canonical URL. Keeps the entry with the
 * highest score, promotes the most advanced status found in the cluster.
 *
 * Run: node dedup-tracker.mjs            (report only — default)
 *      node dedup-tracker.mjs --apply    (actually rewrite applications.md)
 *
 * WHY THIS SCRIPT NO LONGER GUESSES:
 * It used to cluster on a loose word-overlap of the role title (>=2 shared words
 * and a >=0.6 ratio) with "manager" and "director" treated as STOPWORDS, i.e.
 * seniority was ignored entirely. That is not a dedup rule, it is a collision
 * generator: two postings at one employer whose titles share a two-word function
 * name and differ only by a trailing segment qualifier clear that threshold, so
 * they were declared the same job. Distinct postings were deleted from the
 * tracker, and because a shorter table is still a valid table, nothing failed.
 *
 * Deleting a row is irreversible (data/applications.md is gitignored, so there is
 * no git history behind it). No title heuristic is a safe basis for that, however
 * strict — three requisitions at one employer can carry byte-identical titles and
 * be three genuinely different openings. Only the URL settles it, so only the URL
 * clusters here.
 *
 * `sameRole` is used in exactly one direction: a role MISMATCH inside a URL
 * cluster BLOCKS the deletion. A shared URL with clearly different roles means a
 * report recorded the wrong link, not that one job was evaluated twice, and
 * deleting either would destroy a real evaluation to tidy up a typo. It is never
 * used to justify a deletion, only to refuse one.
 *
 * The flags were also inverted: destruction used to be the default and --dry-run
 * was the opt-out. Now writing requires --apply.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseTrackerLine, formatTrackerLine } from './lib/tracker.mjs';
import { canonicalUrl, normalizeCompany, sameRole, urlForRow } from './lib/identity.mjs';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
// Support both layouts: data/applications.md (boilerplate) and applications.md (original)
const APPS_FILE = existsSync(join(CAREER_OPS, 'data/applications.md'))
  ? join(CAREER_OPS, 'data/applications.md')
  : join(CAREER_OPS, 'applications.md');
// Report-only unless the caller explicitly opts into writing. --dry-run is kept
// as a no-op alias so existing muscle memory still lands somewhere safe.
const APPLY = process.argv.includes('--apply');

// Ensure required directories exist (fresh setup)
mkdirSync(join(CAREER_OPS, 'data'), { recursive: true });

// Status advancement order (higher = more advanced in pipeline)
// Aplicado > Rechazado because active application > terminal state
const STATUS_RANK = {
  // English canonicals (states.yml labels). Interview rounds rank in order so
  // dedup keeps the most-advanced round when merging duplicates.
  'skip': 0,
  'discarded': 0,
  'rejected': 1,
  'evaluated': 2,
  'applied': 3,
  'responded': 4,
  'phone screen': 5,
  '1st interview': 6,
  '2nd interview': 7,
  '3rd interview': 8,
  '4th interview': 9,
  'offer': 10,
  // Defensive: legacy generic interview folds into the 1st round.
  'interview': 6,
  // Spanish aliases — kept for backwards compat with existing tracker data
  'no_aplicar': 0,
  'no aplicar': 0,
  'descartado': 0,
  'descartada': 0,
  'rechazado': 1,  // Terminal — below active states
  'rechazada': 1,
  'evaluada': 2,
  'aplicado': 3,
  'respondido': 4,
  'entrevista': 6,
  'oferta': 10,
};

// normalizeCompany comes from lib/identity.mjs. The private copy that used to
// live here kept spaces where the shared one strips them, so an employer written
// with and without a space in its name ("Example Co" vs "ExampleCo") was one
// company everywhere in the system EXCEPT in the one script that deletes rows.
// It also threw on a null company cell, where the shared one returns ''. Neither
// difference was deliberate; that is what a second definition does over time.

function parseScore(s) {
  const m = s.replace(/\*\*/g, '').match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

// Canonical parser in lib/tracker.mjs (kept as a thin alias so call sites and
// the .raw-preserving rewrite logic are unchanged).
const parseAppLine = parseTrackerLine;

// Read
if (!existsSync(APPS_FILE)) {
  console.log('No applications.md found. Nothing to dedup.');
  process.exit(0);
}
const content = readFileSync(APPS_FILE, 'utf-8');
const lines = content.split('\n');

// Parse all entries
const entries = [];
const entryLineMap = new Map(); // num → line index

for (let i = 0; i < lines.length; i++) {
  if (!lines[i].startsWith('|')) continue;
  const app = parseAppLine(lines[i]);
  if (app && app.num > 0) {
    entries.push(app);
    entryLineMap.set(app.num, i);
  }
}

console.log(`📊 ${entries.length} entries loaded`);

// Cluster on company + EXACT canonical URL. A row whose URL cannot be resolved
// (no report, report missing, report has no url field) is never clustered — an
// unknown identity must not be grounds for deleting a row.
const groups = new Map();
let unresolved = 0;
for (const entry of entries) {
  const raw = urlForRow(entry, CAREER_OPS);
  if (!raw) { unresolved++; continue; }
  const key = `${normalizeCompany(entry.company)} ${canonicalUrl(raw)}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(entry);
}
if (unresolved) console.log(`   ${unresolved} rows have no resolvable URL — never clustered`);

// Find duplicates
let removed = 0;
const linesToRemove = new Set();

let conflicted = 0;
for (const [, cluster] of groups) {
  {
    if (cluster.length < 2) continue;

    // A shared URL normally means one posting evaluated twice. When the ROLES in
    // a cluster clearly disagree, that reading is wrong: one of the reports
    // recorded the wrong link, so these are two real evaluations wearing one URL.
    // Deleting either would destroy a distinct evaluation to tidy up a typo.
    //
    // Note the direction. The doctrine forbids a role match from JUSTIFYING a
    // deletion; this is the opposite, a role MISMATCH vetoing one. Blocking is
    // always the safe direction: the cost of a wrong block is a duplicate row
    // that stays visible, and the cost of a wrong delete is an evaluation gone.
    const rolesAgree = cluster.every((e) => sameRole(e.role, cluster[0].role));
    if (!rolesAgree) {
      conflicted++;
      console.log(`⚠️  Conflict: ${cluster.map((e) => `#${e.num} "${e.role}"`).join(' vs ')}`);
      console.log(`     same URL, different roles — one of these reports has the wrong link.`);
      console.log(`     Neither is touched. Fix the wrong report's URL, then re-run.`);
      continue;
    }

    // Keep the one with highest score
    cluster.sort((a, b) => parseScore(b.score) - parseScore(a.score));
    const keeper = cluster[0];

    // Check if any removed entry has more advanced status
    let bestStatusRank = STATUS_RANK[keeper.status.toLowerCase()] || 0;
    let bestStatus = keeper.status;
    for (let k = 1; k < cluster.length; k++) {
      const rank = STATUS_RANK[cluster[k].status.toLowerCase()] || 0;
      if (rank > bestStatusRank) {
        bestStatusRank = rank;
        bestStatus = cluster[k].status;
      }
    }

    // Update keeper's status if a removed entry had a more advanced one
    if (bestStatus !== keeper.status) {
      const lineIdx = entryLineMap.get(keeper.num);
      if (lineIdx !== undefined) {
        const row = parseTrackerLine(lines[lineIdx]);
        if (row) lines[lineIdx] = formatTrackerLine({ ...row, status: bestStatus });
        console.log(`  📝 #${keeper.num}: status promoted to "${bestStatus}" (from #${cluster.find(e => e.status === bestStatus)?.num})`);
      }
    }

    // Remove duplicates
    for (let k = 1; k < cluster.length; k++) {
      const dup = cluster[k];
      const lineIdx = entryLineMap.get(dup.num);
      if (lineIdx !== undefined) {
        linesToRemove.add(lineIdx);
        removed++;
        console.log(`🗑️  Remove #${dup.num} (${dup.company} — ${dup.role}, ${dup.score}) → kept #${keeper.num} (${keeper.score})`);
      }
    }
  }
}

// Remove lines (in reverse order to preserve indices)
const sortedRemoveIndices = [...linesToRemove].sort((a, b) => b - a);
for (const idx of sortedRemoveIndices) {
  lines.splice(idx, 1);
}

console.log(`\n📊 ${removed} duplicate${removed === 1 ? '' : 's'} ${APPLY ? 'removed' : 'found'}`);
if (conflicted) {
  console.log(`⚠️  ${conflicted} cluster${conflicted === 1 ? '' : 's'} left alone: same URL, conflicting roles.`);
  console.log(`   Those are two real evaluations sharing one link, not duplicates.`);
}

if (removed === 0 && conflicted === 0) {
  console.log('✅ No duplicates found');
} else if (removed === 0) {
  // Deliberately NOT the green all-clear. Nothing needed consolidating, but a
  // conflicting cluster is an open question about the user's data, and printing
  // a tick under it would bury the only line worth acting on.
  console.log('Nothing to consolidate. Review the conflict above.');
} else if (!APPLY) {
  console.log('\nReport only — nothing was written. Re-run with --apply to consolidate.');
} else {
  // Timestamped, never the plain .bak: this script used to overwrite that file
  // every run, so the one backup a user needed was routinely destroyed by the
  // next invocation. data/applications.md is gitignored — backups are the ONLY
  // rollback there is.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const backup = `${APPS_FILE}.bak-${stamp}-dedup`;
  copyFileSync(APPS_FILE, backup);
  writeFileSync(APPS_FILE, lines.join('\n'));
  console.log(`✅ Written to applications.md (backup: ${backup.split(/[\\/]/).pop()})`);
}
