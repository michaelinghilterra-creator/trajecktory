#!/usr/bin/env node
// organize-interview-prep.mjs — file legacy FLAT interview-prep cheat sheets and
// intel reports into per-company subfolders (interview-prep/{Company}/...).
//
// This is the deterministic backstop for the folder-per-company convention that
// modes/interview-prep.md and modes/cheat-sheet.md tell the agent to follow when
// generating new prep. Run it once after upgrading, or any time flat files
// accumulate, to self-heal the layout.
//
// Behavior:
//   - Only FLAT top-level .md files are considered. Files already inside a
//     company subfolder and the shared story-bank.md are left alone, so the
//     script is idempotent (a second run finds nothing to do).
//   - The company display name comes from each file's H1 header (e.g.
//     "# Interview Prep - ACME Corp | ..."), which is the reliable source;
//     de-slugifying the filename would lose the company's own casing (the slug
//     "acme-corp" title-cases back to "Acme Corp", never "ACME Corp"). Names are
//     reconciled against existing subfolders by slug, so casing is preserved and
//     never duplicated as a case-variant.
//   - Trailing legal suffixes are stripped ("Example Co, Inc." -> "Example Co")
//     and Windows-forbidden path characters removed, matching the mode rule.
//   - Files that aren't recognizable interview-prep artifacts are left untouched.
//   - Never overwrites: if the destination already exists, the file is skipped.
//
// Usage:
//   node organize-interview-prep.mjs             # DRY RUN (default): print the plan
//   node organize-interview-prep.mjs --apply     # actually move the files
//   node organize-interview-prep.mjs --check      # QA gate: exit 1 if any flat artifact exists (never moves)
//   node organize-interview-prep.mjs --json      # machine-readable output
//   node organize-interview-prep.mjs --dir <p>   # override the interview-prep dir
//
// Exit code: 0 on success (including "nothing to do"); 1 if any file could not be
// resolved to a company folder, a move failed, or (in --check mode) any flat
// cheat sheet / intel report is present that belongs in a company folder.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { cleanCompany, slug } from './dashboard-web/server/lib/company-path.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');       // QA gate: report only, exit 1 on any flat artifact
const APPLY = argv.includes('--apply') && !CHECK; // --check always implies dry run
const JSON_OUT = argv.includes('--json');

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`organize-interview-prep.mjs — file flat cheat sheets into per-company folders

  node organize-interview-prep.mjs            dry run (default)
  node organize-interview-prep.mjs --apply    perform the moves
  node organize-interview-prep.mjs --check    QA gate: exit 1 if any flat artifact exists (never moves)
  node organize-interview-prep.mjs --json     machine-readable output
  node organize-interview-prep.mjs --dir <p>  override interview-prep directory`);
  process.exit(0);
}

function argValue(flag) {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

// ── Resolve the interview-prep directory ──────────────────────────────────────
// --dir wins; otherwise honor outputs.interview_prep_dir from config/profile.yml
// (so a user who redirected output is still organized); otherwise default.
function resolveDir() {
  const override = argValue('--dir');
  if (override) return path.resolve(override);
  const profile = path.join(__dirname, 'config', 'profile.yml');
  if (fs.existsSync(profile)) {
    for (const line of fs.readFileSync(profile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*interview_prep_dir:\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/);
      if (m) {
        const v = m[1].trim();
        if (v) return path.isAbsolute(v) ? v : path.join(__dirname, v);
      }
    }
  }
  return path.join(__dirname, 'interview-prep');
}

const DIR = resolveDir();

// ── Name helpers ──────────────────────────────────────────────────────────────
// cleanCompany + slug live in dashboard-web/server/lib/company-path.mjs (imported
// above) so this organizer and the dashboard's Interview tab agree on exactly one
// folder name for a company.

// Extract the company display name from an interview-prep H1. Returns null when
// the H1 doesn't look like an interview-prep artifact (so unrelated .md files at
// the top level are not swept up).
function companyFromHeader(md) {
  const line = md.split(/\r?\n/).find((l) => /^#\s+\S/.test(l));
  if (!line) return null;
  let t = line.replace(/^#\s+/, '').trim();
  let recognized = false;
  const prefix = /^(?:Interview\s+Prep|Interview\s+Intel(?:ligence)?|Interview\s+Cheat\s*Sheet)\s*[:\-–—]\s*/i;
  if (prefix.test(t)) { t = t.replace(prefix, ''); recognized = true; }
  // Company is the first segment before " | ", an en/em/hyphen dash, or " Round N".
  const seg = t.split(/\s+\|\s+|\s+[–—-]\s+|\s+Round\s+\d/i)[0];
  // A free-form "{Company} Round N — ..." card is also a recognized artifact.
  if (!recognized && /\sRound\s+\d/i.test(t)) recognized = true;
  if (!recognized) return null;
  return cleanCompany(seg);
}

function isCheatSheetName(base) {
  return /-round-\d/i.test(base) || /-cheat-sheet\.md$/i.test(base);
}

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// ── Plan ──────────────────────────────────────────────────────────────────────
if (!fs.existsSync(DIR)) {
  if (JSON_OUT) console.log(JSON.stringify({ dir: DIR, moves: [], skipped: [], unresolved: [] }, null, 2));
  else console.log(`No interview-prep directory at ${DIR} — nothing to organize.`);
  process.exit(0);
}

const entries = fs.readdirSync(DIR, { withFileTypes: true });
const existingFolders = entries.filter((e) => e.isDirectory()).map((e) => e.name);
// slug -> canonical folder name; seeded from existing folders, extended as we go
// so two flat files that clean to the same slug land in one folder within a run.
const chosenBySlug = new Map(existingFolders.map((f) => [slug(f), f]));
function canonicalFolder(name) {
  const s = slug(name);
  if (chosenBySlug.has(s)) return chosenBySlug.get(s);
  chosenBySlug.set(s, name);
  return name;
}

const flat = entries
  .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'story-bank.md')
  .map((e) => e.name)
  .sort();

const moves = [];      // { file, company, via }
const skipped = [];    // { file, reason }
const unresolved = []; // { file, reason }

for (const base of flat) {
  const md = safeRead(path.join(DIR, base));
  const headerCompany = md ? companyFromHeader(md) : null;
  const looksLikeSheet = isCheatSheetName(base);

  if (!headerCompany && !looksLikeSheet) {
    skipped.push({ file: base, reason: 'not a recognizable cheat sheet or intel report' });
    continue;
  }

  let company = null;
  let via = null;
  if (headerCompany) {
    company = canonicalFolder(headerCompany);
    via = 'header';
  } else {
    // No usable header. Match the filename prefix to an existing folder first.
    const lc = base.toLowerCase();
    const match = existingFolders.find((f) => {
      const s = slug(f);
      return lc.startsWith(s + '-') || lc.startsWith(s + '.');
    });
    if (match) {
      company = match;
      via = 'folder-match';
    } else {
      // Last resort: de-slug the prefix before "-round-". Casing is a guess.
      const prefix = base.replace(/\.md$/i, '').split(/-round-/i)[0];
      const guess = prefix
        .split('-')
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(' ')
        .trim();
      if (guess) { company = canonicalFolder(guess); via = 'filename-guess'; }
    }
  }

  if (!company) {
    unresolved.push({ file: base, reason: 'could not determine company (no header, no matching folder)' });
    continue;
  }

  const dest = path.join(DIR, company, base);
  if (fs.existsSync(dest)) {
    skipped.push({ file: base, reason: `destination already exists: ${company}/${base}` });
    continue;
  }
  moves.push({ file: base, company, via });
}

// ── Apply ──────────────────────────────────────────────────────────────────────
let applied = 0;
let failed = 0;
if (APPLY) {
  for (const m of moves) {
    try {
      fs.mkdirSync(path.join(DIR, m.company), { recursive: true });
      fs.renameSync(path.join(DIR, m.file), path.join(DIR, m.company, m.file));
      m.done = true;
      applied++;
    } catch (e) {
      m.error = e.message;
      failed++;
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────────
if (JSON_OUT) {
  console.log(JSON.stringify({ dir: DIR, apply: APPLY, moves, skipped, unresolved, applied, failed }, null, 2));
} else {
  console.log(`\ninterview-prep organizer — ${APPLY ? 'APPLYING' : 'DRY RUN (no files moved)'}`);
  console.log(`dir: ${DIR}\n`);
  if (moves.length === 0) {
    console.log('✅ Nothing to organize — all cheat sheets are already in company folders.');
  } else {
    console.log(`${APPLY ? 'Moved' : 'Would move'} ${moves.length} file(s):`);
    for (const m of moves) {
      const flag = m.via === 'filename-guess' ? '  (!) casing guessed from filename — verify' : '';
      const status = m.error ? `  ✗ FAILED: ${m.error}` : '';
      console.log(`  ${m.file}  ->  ${m.company}/${flag}${status}`);
    }
  }
  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length} file(s):`);
    for (const s of skipped) console.log(`  ${s.file}  (${s.reason})`);
  }
  if (unresolved.length) {
    console.log(`\n⚠️  ${unresolved.length} file(s) need manual filing:`);
    for (const u of unresolved) console.log(`  ${u.file}  (${u.reason})`);
  }
  if (CHECK && (moves.length + unresolved.length) > 0) {
    console.log(`\nCHECK FAILED: ${moves.length + unresolved.length} flat interview-prep artifact(s) that belong in company folders.`);
  }
  if (!APPLY && !CHECK && moves.length) console.log('\nRun again with --apply to perform these moves.');
  console.log('');
}

// --check is a QA gate: any flat artifact (would-move or unresolved) fails.
if (CHECK) process.exit(moves.length + unresolved.length > 0 ? 1 : 0);
process.exit(unresolved.length > 0 || failed > 0 ? 1 : 0);
