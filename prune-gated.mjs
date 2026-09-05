#!/usr/bin/env node
/**
 * prune-gated.mjs — Remove aged-out gated entries from pipeline.md
 *
 * Usage:
 *   node prune-gated.mjs             # dry run, 30-day cutoff
 *   node prune-gated.mjs --apply     # write changes
 *   node prune-gated.mjs --days 60   # custom cutoff
 *   node prune-gated.mjs --prune-undated   # also drop rows with no date record
 *
 * A gated row is only removed when a date record proves it is older than the
 * cutoff. A row with no date, or an unparseable one, is KEPT: the absence of a
 * date says the history files did not record it, not that the row is old. It
 * would otherwise be possible to delete a row created minutes ago just because
 * gate-history.tsv was missing or had been rebuilt.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { canonicalUrl } from './lib/identity.mjs';
import { parsePipelineRow } from './lib/pipeline.mjs';

const PIPELINE_PATH = 'data/pipeline.md';
const GATE_HISTORY_PATH = 'data/gate-history.tsv';
const SCAN_HISTORY_PATH = 'data/scan-history.tsv';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const pruneUndated = args.includes('--prune-undated');
const daysFlag = args.indexOf('--days');
// Explicit, because `parseInt(...) || 30` silently turns `--days 0` into 30, and
// this is a deletion tool: a cutoff the caller did not ask for is a data-loss bug.
let days = 30;
if (daysFlag !== -1) {
  const parsed = parseInt(args[daysFlag + 1], 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.error(`Invalid --days value: ${args[daysFlag + 1]}`);
    process.exit(1);
  }
  days = parsed;
}

if (!existsSync(PIPELINE_PATH)) {
  console.error(`Not found: ${PIPELINE_PATH}`);
  process.exit(1);
}

const cutoffMs = Date.now() - days * 86400000;
const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);

// Build date lookups: gate-history (preferred) and scan-history (fallback)
const gateDates = new Map();
if (existsSync(GATE_HISTORY_PATH)) {
  const rows = readFileSync(GATE_HISTORY_PATH, 'utf-8').split('\n').slice(1);
  for (const row of rows) {
    if (!row.trim()) continue;
    const [date, url] = row.split('\t');
    if (date && url) gateDates.set(canonicalUrl(url), date);
  }
}

const scanDates = new Map();
if (existsSync(SCAN_HISTORY_PATH)) {
  const rows = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n').slice(1);
  for (const row of rows) {
    if (!row.trim()) continue;
    const [url, firstSeen] = row.split('\t');
    if (url && firstSeen) {
      const key = canonicalUrl(url);
      if (!scanDates.has(key)) scanDates.set(key, firstSeen);
    }
  }
}

// With no date source at all, every gated row looks undated and --prune-undated
// would wipe the whole gated set in one pass. Refuse rather than trust the gap.
if (!gateDates.size && !scanDates.size) {
  console.error('No date records: gate-history.tsv and scan-history.tsv are both missing or empty.');
  console.error('Every gated row would look undated. Refusing to run; restore a history file first.');
  process.exit(1);
}

function getDate(canonical) {
  return gateDates.get(canonical) || scanDates.get(canonical) || null;
}

const raw = readFileSync(PIPELINE_PATH, 'utf-8');
const lines = raw.split('\n');

const removed = [];
let keptAged = 0;
let keptUndated = 0;

const remaining = lines.filter((line) => {
  const row = parsePipelineRow(line);
  if (!row || row.state !== 'dead') return true;

  const dateStr = getDate(row.canonical);
  const entryMs = dateStr ? new Date(dateStr).getTime() : NaN;

  // No date, or one that will not parse. Either way the record does not establish
  // age, so the row survives unless the caller explicitly opted in.
  if (!Number.isFinite(entryMs)) {
    if (!pruneUndated) { keptUndated++; return true; }
    removed.push({ url: row.url, date: dateStr || 'none', reason: 'no usable date (--prune-undated)' });
    return false;
  }

  if (entryMs < cutoffMs) {
    removed.push({ url: row.url, date: dateStr, reason: `older than ${cutoffDate}` });
    return false;
  }

  keptAged++;
  return true;
});

console.log(`Cutoff:       ${cutoffDate} (${days} days ago)`);
console.log(`Gated total:  ${removed.length + keptAged + keptUndated}`);
console.log(`  To remove:  ${removed.length}`);
console.log(`  Kept:       ${keptAged} (newer than cutoff)`);
console.log(`  Kept:       ${keptUndated} (no date record${pruneUndated ? '' : '; pass --prune-undated to drop these'})`);

// Nothing is silently dropped: name every row before it goes.
if (removed.length) {
  console.log('\nRemoving:');
  for (const r of removed) console.log(`  ${r.date}  ${r.url}  (${r.reason})`);
}

if (!apply) {
  console.log('\n(dry run, pass --apply to write)');
  process.exit(0);
}

if (!removed.length) {
  console.log('\nNothing to remove.');
  process.exit(0);
}

writeFileSync(PIPELINE_PATH, remaining.join('\n'), 'utf-8');
console.log(`\nWritten: ${PIPELINE_PATH} (${removed.length} rows removed)`);
