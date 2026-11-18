#!/usr/bin/env node
/**
 * prune-history.mjs: Remove aged-out entries from scan-history.tsv
 *
 * Removes added rows older than --days (default 30). With
 * --skips-older-than, it also removes old skipped_dup and skipped_title records.
 * Other skipped statuses are permanent because they represent expired postings
 * or stable policy filters. Dashboard counts of historical skips drop when this
 * option is used.
 *
 * Usage:
 *   node prune-history.mjs
 *   node prune-history.mjs --days 60
 *   node prune-history.mjs --skips-older-than 90
 *   node prune-history.mjs --dry-run
 */

import { copyFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { atomicWriteFileSync } from './lib/atomic-write.mjs';
import { enforceArgs } from './lib/cli-args.mjs';
import { localToday } from './lib/local-date.mjs';
import {
  AGEABLE_STATUSES,
  isAgedOut,
  readHistoryLines,
  readHistoryRawRows,
} from './lib/scan-history.mjs';

export { AGEABLE_STATUSES };

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';
const USAGE = 'Usage: node prune-history.mjs [--dry-run] [--days DAYS] [--skips-older-than DAYS]\n'
  + '  --skips-older-than removes only skipped_dup and skipped_title; other skip statuses are permanent.';
const DAY_MS = 86400000;
const AGEABLE_SKIP_STATUSES = new Set(AGEABLE_STATUSES.filter(status => status.startsWith('skipped_')));

function valueFor(args, flag) {
  const index = args.indexOf(flag);
  if (index !== -1) return args[index + 1];
  const prefix = `${flag}=`;
  const match = args.find(arg => arg.startsWith(prefix));
  return match?.slice(prefix.length);
}

function validDays(value, minimum = 1) {
  return /^\d+$/.test(value || '') && Number(value) >= minimum;
}

export function decidePrune(row, { addedCutoffMs, skipCutoffMs = null }) {
  if (row.status === 'added' && isAgedOut(row, addedCutoffMs)) return 'prune_added';
  if (skipCutoffMs !== null
      && AGEABLE_SKIP_STATUSES.has(row.status)
      && isAgedOut(row, skipCutoffMs)) {
    return 'prune_skip';
  }
  return 'keep';
}

function timestamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function runPrune(args = process.argv.slice(2)) {
  const exitCode = enforceArgs(args, {
    flags: ['--dry-run'],
    valueFlags: ['--days', '--skips-older-than'],
    usage: USAGE,
  });
  if (exitCode !== null) return exitCode;

  const daysValue = valueFor(args, '--days');
  const skipDaysValue = valueFor(args, '--skips-older-than');
  if ((daysValue !== undefined && !validDays(daysValue))
      || (args.includes('--days') && daysValue === undefined)
      || (args.includes('--skips-older-than') && skipDaysValue === undefined)
      || (skipDaysValue !== undefined && !validDays(skipDaysValue, 30))) {
    console.error(USAGE);
    return 2;
  }

  if (!existsSync(SCAN_HISTORY_PATH)) {
    console.error(`Not found: ${SCAN_HISTORY_PATH}`);
    return 1;
  }

  const dryRun = args.includes('--dry-run');
  const days = daysValue === undefined ? 30 : Number(daysValue);
  const skipDays = skipDaysValue === undefined ? null : Number(skipDaysValue);
  const nowMs = Date.now();
  const addedCutoffMs = nowMs - days * DAY_MS;
  const skipCutoffMs = skipDays === null ? null : nowMs - skipDays * DAY_MS;
  const lineIterator = readHistoryLines(SCAN_HISTORY_PATH);
  const firstLine = lineIterator.next();
  lineIterator.return();
  const header = firstLine.done ? '' : firstLine.value;
  const remaining = [];
  const skipCounts = new Map();
  let rowsBefore = 0;
  let prunedAdded = 0;

  for (const row of readHistoryRawRows(SCAN_HISTORY_PATH)) {
    rowsBefore++;
    const decision = decidePrune(row, { addedCutoffMs, skipCutoffMs });
    if (decision === 'prune_added') prunedAdded++;
    else if (decision === 'prune_skip') {
      skipCounts.set(row.status, (skipCounts.get(row.status) || 0) + 1);
    } else remaining.push(row.rawLine);
  }

  const prunedSkips = [...skipCounts.values()].reduce((sum, count) => sum + count, 0);
  const pruned = prunedAdded + prunedSkips;
  const output = [header, ...remaining].join('\n') + '\n';
  const sizeBefore = statSync(SCAN_HISTORY_PATH).size;
  const sizeAfter = Buffer.byteLength(output, 'utf8');

  console.log(`Cutoff: ${localToday(new Date(addedCutoffMs))} (${days} days ago)`);
  if (skipDays !== null) {
    console.log(`Skip cutoff: ${localToday(new Date(skipCutoffMs))} (${skipDays} days ago)`);
  }
  console.log(`Rows before: ${rowsBefore}`);
  console.log(`Pruned:      ${pruned}`);
  console.log(`Pruned added: ${prunedAdded}`);
  console.log('Pruned skip records by status:');
  if (skipCounts.size === 0) console.log('  none: 0');
  for (const [status, count] of [...skipCounts].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${status}: ${count}`);
  }
  console.log(`Kept:        ${remaining.length}`);
  console.log(`Rows kept: ${remaining.length}`);
  console.log(`Size before: ${formatMb(sizeBefore)} MB`);
  console.log(`Size after:  ${formatMb(sizeAfter)} MB${dryRun ? ' (estimated)' : ''}`);

  if (dryRun) {
    console.log('(dry run, no changes written)');
    return 0;
  }

  const backup = `${SCAN_HISTORY_PATH}.bak-${timestamp()}-prune`;
  copyFileSync(SCAN_HISTORY_PATH, backup);
  console.log(`Backup: ${backup}`);
  atomicWriteFileSync(SCAN_HISTORY_PATH, output, 'utf8');
  console.log(`Written: ${SCAN_HISTORY_PATH}`);
  return 0;
}

if (invokedDirectly) process.exit(runPrune());
