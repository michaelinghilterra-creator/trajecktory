#!/usr/bin/env node
/**
 * prune-history.mjs — Remove aged-out entries from scan-history.tsv
 *
 * Removes rows where action==="added" AND date is older than --days (default 30).
 * Rows with action==="skipped_expired", "skipped_dup", etc. are always kept so
 * the dashboard retains its historical skipped counts.
 *
 * Usage:
 *   node prune-history.mjs            # prune entries older than 30 days
 *   node prune-history.mjs --days 60  # custom cutoff
 *   node prune-history.mjs --dry-run  # preview only
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const SCAN_HISTORY_PATH = 'data/scan-history.tsv';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const daysFlag = args.indexOf('--days');
const days = daysFlag !== -1 ? parseInt(args[daysFlag + 1], 10) || 30 : 30;

if (!existsSync(SCAN_HISTORY_PATH)) {
  console.error(`Not found: ${SCAN_HISTORY_PATH}`);
  process.exit(1);
}

const raw = readFileSync(SCAN_HISTORY_PATH, 'utf-8');
const lines = raw.split('\n');
const header = lines[0];
const rows = lines.slice(1);

const cutoffMs = Date.now() - days * 86400000;
let pruned = 0;
let kept = 0;

const remaining = rows.filter(line => {
  if (!line.trim()) return false; // drop blank lines (we'll add one trailing newline)
  const parts = line.split('\t');
  const dateStr = parts[1];  // first_seen
  const status = parts[5];   // status (url, first_seen, portal, title, company, status)

  // Only age out "added" entries — keep skipped_expired/skipped_dup/etc. forever
  if (status !== 'added') {
    kept++;
    return true;
  }

  if (dateStr) {
    const entryTime = new Date(dateStr).getTime();
    if (!isNaN(entryTime) && entryTime < cutoffMs) {
      pruned++;
      return false;
    }
  }

  kept++;
  return true;
});

console.log(`Cutoff: ${new Date(cutoffMs).toISOString().slice(0, 10)} (${days} days ago)`);
console.log(`Rows before: ${rows.filter(l => l.trim()).length}`);
console.log(`Pruned:      ${pruned}`);
console.log(`Kept:        ${kept}`);

if (dryRun) {
  console.log('(dry run — no changes written)');
  process.exit(0);
}

const output = [header, ...remaining, ''].join('\n');
writeFileSync(SCAN_HISTORY_PATH, output, 'utf-8');
console.log(`Written: ${SCAN_HISTORY_PATH}`);
