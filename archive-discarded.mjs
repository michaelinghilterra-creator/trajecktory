#!/usr/bin/env node
// archive-discarded.mjs — Move noise entries dated <DATE> from
// applications.md into a date-stamped archive file. Reversible.
//
// Usage:
//   node archive-discarded.mjs 2026-05-12                  # dry-run, Discarded only
//   node archive-discarded.mjs 2026-05-12 --apply          # apply, Discarded only
//   node archive-discarded.mjs 2026-05-06 --noscore        # dry-run, SKIP+Discarded with N/A score
//   node archive-discarded.mjs 2026-05-06 --noscore --apply# apply noscore mode
//   node archive-discarded.mjs --ids 269,272,274 --tag 2026-05-06-nonfit         # dry-run by IDs
//   node archive-discarded.mjs --ids 269,272,274 --tag 2026-05-06-nonfit --apply # apply by IDs
//   node archive-discarded.mjs --restore 2026-05-12        # put them back
//   node archive-discarded.mjs --restore-tag 2026-05-06-nonfit                   # restore an --ids archive
//
// What it does:
//   - Default: archive rows where status === 'Discarded' on the given date
//   - --noscore: archive rows where score is N/A AND status is SKIP or Discarded
//   - --ids <csv>: archive rows whose # column matches one of the IDs (surgical mode, requires --tag)
//   - NEVER touches Applied / Responded / Interview / Offer / Rejected / Evaluated

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'url';
import { parseTrackerLine } from './lib/tracker.mjs';
import { localToday, logWritesEnabled, writeTableText } from './lib/log-writes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.TJK_DATA_DIR ? path.resolve(process.env.TJK_DATA_DIR) : path.join(__dirname, 'data');
const APPS = path.join(DATA_DIR, 'applications.md');

function writeApplications(baseText, newText, action) {
  if (!logWritesEnabled(DATA_DIR)) {
    fs.writeFileSync(APPS, newText);
    return true;
  }
  try {
    writeTableText({
      dataDir: DATA_DIR,
      file: 'applications.md',
      baseText,
      newText,
      rowKey: line => {
        const row = parseTrackerLine(line);
        return row ? String(row.num) : null;
      },
      buildEvents: ({ added, changed, removed }) => {
        if (changed.length) throw new Error('archive-discarded may only add or remove tracker rows');
        const selected = action === 'restore' ? added : removed;
        const unexpected = action === 'restore' ? removed : added;
        if (unexpected.length) throw new Error(`archive-discarded ${action} produced an unexpected tracker change`);
        return selected.map(change => {
          const row = parseTrackerLine(change.raw);
          return {
            type: 'legacy_record',
            application_id: String(row.num),
            occurred_on: localToday(),
            payload: {
              reason: action === 'restore' ? 'tracker_row_restored' : 'tracker_row_archived',
              ref: `app:${row.num}`, state: row.status, legacy_effects: [change.effect],
            },
          };
        });
      },
    });
  } catch (error) {
    if (error.code === 'RENDER_FAILED') {
      console.warn(`Warning: ${error.message}`);
      return true;
    }
    console.error(error.message);
    return false;
  }
  return true;
}

function removeStagedArchive(tempFile) {
  try {
    fs.unlinkSync(tempFile);
    return true;
  } catch (error) {
    console.error(`Could not remove staged archive ${tempFile}: ${error.message}`);
    return false;
  }
}

function commitArchive({ archive, content, baseText, newText }) {
  const tempFile = `${archive}.tmp-${process.pid}-${randomUUID()}`;
  try {
    fs.writeFileSync(tempFile, content, { flag: 'wx' });
  } catch (error) {
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch { /* best effort */ }
    console.error(`Could not stage archive ${tempFile}: ${error.message}`);
    return false;
  }

  let trackerWritten;
  try {
    trackerWritten = writeApplications(baseText, newText, 'archive');
  } catch (error) {
    removeStagedArchive(tempFile);
    console.error(error.message);
    return false;
  }
  if (!trackerWritten) {
    removeStagedArchive(tempFile);
    return false;
  }

  try {
    fs.renameSync(tempFile, archive);
  } catch (error) {
    console.error(`Archive rename failed after applications.md was updated: ${error.message}`);
    console.error(`Recover the archived rows from temporary file: ${tempFile}`);
    return false;
  }
  return true;
}

const args = process.argv.slice(2);
const restoreIdx = args.indexOf('--restore');
const restoreTagIdx = args.indexOf('--restore-tag');
const apply = args.includes('--apply');
const noscore = args.includes('--noscore');
const idsIdx = args.indexOf('--ids');
const tagIdx = args.indexOf('--tag');
const idsList = idsIdx >= 0 ? new Set(args[idsIdx + 1].split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))) : null;
const archiveTag = tagIdx >= 0 ? args[tagIdx + 1] : null;

// ── Restore mode ──────────────────────────────────────────────────────────────
// Restore-by-tag: complement of --ids archive
if (restoreTagIdx >= 0) {
  const tag = args[restoreTagIdx + 1];
  if (!tag) { console.error('Usage: --restore-tag <tag>'); process.exit(1); }
  const archive = path.join(DATA_DIR, `applications-archive-${tag}.md`);
  if (!fs.existsSync(archive)) { console.error(`No archive at ${archive}`); process.exit(1); }
  const archived = fs.readFileSync(archive, 'utf8').split('\n').filter(line => parseTrackerLine(line));
  const baseText = fs.readFileSync(APPS, 'utf8');
  const apps = baseText.split('\n');
  const sepIdx = apps.findIndex(l => /^\|[-\s|]+\|$/.test(l.trim()));
  if (sepIdx === -1) { console.error('Could not find applications.md table header'); process.exit(1); }
  apps.splice(sepIdx + 1, 0, ...archived);
  if (!writeApplications(baseText, apps.join('\n'), 'restore')) process.exit(1);
  fs.unlinkSync(archive);
  console.log(`✅ Restored ${archived.length} entries from ${path.basename(archive)}. Archive file removed.`);
  process.exit(0);
}

if (restoreIdx >= 0) {
  const date = args[restoreIdx + 1];
  if (!date) { console.error('Usage: --restore YYYY-MM-DD [--noscore]'); process.exit(1); }
  const restoreNoscore = args.includes('--noscore');
  const suffix = restoreNoscore ? `-noscore` : '';
  const archive = path.join(DATA_DIR, `applications-archive-${date}${suffix}.md`);
  if (!fs.existsSync(archive)) {
    console.error(`No archive at ${archive}`);
    process.exit(1);
  }
  const archived = fs.readFileSync(archive, 'utf8').split('\n')
    .filter(line => parseTrackerLine(line));
  console.log(`Restoring ${archived.length} entries from ${archive}`);

  const baseText = fs.readFileSync(APPS, 'utf8');
  const apps = baseText.split('\n');
  // Insert after the table header (the |---|---|... separator row)
  const sepIdx = apps.findIndex(l => /^\|[-\s|]+\|$/.test(l.trim()));
  if (sepIdx === -1) { console.error('Could not find applications.md table header'); process.exit(1); }

  apps.splice(sepIdx + 1, 0, ...archived);
  if (!writeApplications(baseText, apps.join('\n'), 'restore')) process.exit(1);
  fs.unlinkSync(archive);
  console.log(`✅ Restored. Archive file removed.`);
  process.exit(0);
}

// ── --ids mode (surgical archive) ────────────────────────────────────────────
if (idsList) {
  if (!archiveTag) {
    console.error('--ids requires --tag <name> (used to label the archive file)');
    process.exit(1);
  }
  const baseText = fs.readFileSync(APPS, 'utf8');
  const lines = baseText.split('\n');
  const keep = [];
  const move = [];
  for (const line of lines) {
    const row = parseTrackerLine(line);
    if (!row) { keep.push(line); continue; }
    const id = row.num;
    const status = row.status;
    // NEVER touch user-progressed statuses, regardless of ID list
    const safeForArchive = ['SKIP', 'Discarded', 'Evaluated', 'Rejected'].includes(status);
    if (idsList.has(id) && safeForArchive) move.push(line);
    else keep.push(line);
  }
  console.log(`\n[--ids mode] Match: ${move.length} of ${idsList.size} requested IDs`);
  if (move.length < idsList.size) {
    const matched = new Set(move.map(l => parseInt(l.split('|')[1].trim(), 10)));
    const missing = [...idsList].filter(id => !matched.has(id));
    console.log(`Missing/skipped (not safe to archive): ${missing.join(', ')}`);
  }
  if (!apply) {
    console.log('\nSample of what would move:');
    for (const l of move.slice(0, 5)) {
      const p = l.split('|').map(c => c.trim());
      console.log(`  #${p[1].padEnd(4)} ${p[3].padEnd(22).slice(0,22)} ${p[4].slice(0, 55)}`);
    }
    console.log(`\nRun with --apply to archive → data/applications-archive-${archiveTag}.md`);
    process.exit(0);
  }
  const archive = path.join(DATA_DIR, `applications-archive-${archiveTag}.md`);
  const header = [
    `# Applications Archive — ${archiveTag}`,
    '',
    `Archived from applications.md on ${new Date().toISOString().slice(0,10)}.`,
    `${move.length} entries archived by ID (surgical archive).`,
    `Restore with: node archive-discarded.mjs --restore-tag ${archiveTag}`,
    '',
    '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
    '|---|------|---------|------|-------|--------|-----|--------|-------|',
    ...move,
  ];
  if (!commitArchive({ archive, content: header.join('\n'), baseText, newText: keep.join('\n') })) process.exit(1);
  console.log(`\n✅ Archived ${move.length} entries → ${path.basename(archive)}`);
  console.log(`   Restore with: node archive-discarded.mjs --restore-tag ${archiveTag}`);
  process.exit(0);
}

// ── Date-based archive mode ───────────────────────────────────────────────────
const date = args[0];
if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error('Usage: node archive-discarded.mjs YYYY-MM-DD [--apply] | --ids <csv> --tag <name>');
  process.exit(1);
}

const baseText = fs.readFileSync(APPS, 'utf8');
const lines = baseText.split('\n');
const keep = [];
const move = [];

for (const line of lines) {
  const row = parseTrackerLine(line);
  if (!row) { keep.push(line); continue; }
  const rowDate = row.date;
  const score = row.score;
  const status = row.status;

  // Match criteria
  let shouldMove = false;
  if (rowDate === date) {
    if (noscore) {
      // --noscore mode: SKIP or Discarded rows with N/A score (pure scanner noise)
      const isNoScore = /N\/A/i.test(score) || score === '' || score === '-';
      const isSafeStatus = status === 'SKIP' || status === 'Discarded';
      shouldMove = isNoScore && isSafeStatus;
    } else {
      // Default mode: any Discarded row
      shouldMove = status === 'Discarded';
    }
  }

  if (shouldMove) move.push(line);
  else keep.push(line);
}

const modeLabel = noscore ? 'SKIP/Discarded N/A-score' : 'Discarded';
console.log(`\nFound ${move.length} ${modeLabel} entries on ${date}`);
console.log(`Would keep ${keep.filter(l => l.startsWith('|')).length - 2} other tracker rows`); // -2 for header + separator

if (move.length === 0) {
  console.log('Nothing to archive.');
  process.exit(0);
}

if (!apply) {
  console.log('\n[dry-run] Sample of what would move:');
  for (const l of move.slice(0, 5)) {
    const p = l.split('|').map(c => c.trim());
    console.log(`  #${p[1].padEnd(4)} ${p[3].padEnd(28).slice(0,28)} ${p[4].slice(0, 50)}`);
  }
  console.log('\nRun with --apply to actually archive.');
  process.exit(0);
}

// Write archive
const suffix = noscore ? `-noscore` : '';
const archive = path.join(DATA_DIR, `applications-archive-${date}${suffix}.md`);
const archiveLabel = noscore ? 'SKIP/Discarded N/A-score scanner noise' : 'Discarded entries';
const header = [
  `# Applications Archive — ${date} (${archiveLabel})`,
  '',
  `Archived from applications.md on ${new Date().toISOString().slice(0,10)}.`,
  `These ${move.length} entries were noise from ${date} (scanner hits never worth pursuing).`,
  `Restore with: node archive-discarded.mjs --restore ${date}${noscore ? ' --noscore' : ''}`,
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|-------|',
  ...move,
];
if (!commitArchive({ archive, content: header.join('\n'), baseText, newText: keep.join('\n') })) process.exit(1);
console.log(`\n✅ Archived ${move.length} entries → ${path.basename(archive)}`);
console.log(`   applications.md now has ${keep.filter(l => l.startsWith('| ') && /^\| \d/.test(l)).length} tracker rows`);
console.log(`   Restore anytime with: node archive-discarded.mjs --restore ${date}`);
