#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openEventStore } from '../lib/event-store.mjs';
import { compareTracker, importTracker } from '../lib/import/tracker-import.mjs';

function refuse(message) {
  console.error(message);
  process.exit(2);
}

function argumentsFrom(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) refuse('usage: --apps, --db and --report are required');
    options[key.slice(2)] = value;
  }
  return options;
}

function isInside(candidate, parent) {
  const rel = relative(parent, candidate);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function localDate() {
  const now = new Date();
  const part = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())}`;
}

const options = argumentsFrom(process.argv.slice(2));
if (!options.apps || !options.db || !options.report) refuse('usage: --apps, --db and --report are required');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, 'data');
const dbPath = resolve(options.db);
const reportPath = resolve(options.report);
if (isInside(dbPath, dataDir)) refuse('--db must not be inside the repository data folder');
if (isInside(reportPath, dataDir)) refuse('--report must not be inside the repository data folder');
if (existsSync(dbPath)) refuse('--db must not already exist');

const text = readFileSync(resolve(options.apps), 'utf8');
const store = openEventStore(dbPath);
let report;
let comparison;
try {
  report = importTracker(store, text, {
    definitionsVersion: options['definitions-version'] ?? 'v1',
    importedOn: localDate(),
  });
  comparison = compareTracker(text, store);
} finally {
  store.close();
}

writeFileSync(reportPath, `${JSON.stringify({
  ...report,
  match: comparison.match,
  mismatches: comparison.mismatches,
  rendered_identical: comparison.rendered_identical,
  rendered_different: comparison.rendered_different,
  rendered_different_positions: comparison.rendered_different_positions,
}, null, 2)}\n`, 'utf8');
const flagCounts = {};
for (const flag of report.flags) flagCounts[flag.type] = (flagCounts[flag.type] ?? 0) + 1;
console.log(JSON.stringify({
  counts: report.counts,
  flags: flagCounts,
  shared_postings: report.shared_postings.length,
  company_spellings: report.company_spellings.length,
  merge_candidates: report.merge_candidates.length,
  rendered_identical: comparison.rendered_identical,
  rendered_different: comparison.rendered_different,
}, null, 2));
console.log(comparison.match ? 'MATCH' : 'MISMATCH');
process.exit(comparison.match ? 0 : 1);
