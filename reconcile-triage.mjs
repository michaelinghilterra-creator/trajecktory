#!/usr/bin/env node
// reconcile-triage.mjs — check off pipeline.md rows recorded in the optional
// Spark pre-filter discard log (or already fully evaluated in applications.md).
//
// Thin CLI over lib/reconcile-triage.mjs + lib/pipeline.mjs. Run it after the
// optional pre-filter to keep the unchecked count limited to roles still eligible
// for evaluation.
//
// Dry-run by default. Pass --apply to write. Idempotent — running it twice
// with nothing new to reconcile is a no-op.

import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { reconcileTriageResults } from './lib/reconcile-triage.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PIPELINE = join(ROOT, 'data/pipeline.md');
const TRIAGE_RESULTS = join(ROOT, 'data/triage-results.tsv');
const APPLICATIONS = join(ROOT, 'data/applications.md');
const APPLY = process.argv.includes('--apply');

if (!existsSync(TRIAGE_RESULTS)) {
  console.log('No data/triage-results.tsv yet — nothing to reconcile against.');
  process.exit(0);
}

const { flipped } = reconcileTriageResults(PIPELINE, {
  triageResultsPath: TRIAGE_RESULTS,
  appsPath: APPLICATIONS,
  apply: APPLY,
});

if (!flipped.length) {
  console.log('✓ Pipeline already reconciled against triage-results.tsv — nothing to flip.');
  process.exit(0);
}

console.log(`${APPLY ? 'Flipped' : 'Would flip'} ${flipped.length} discarded or evaluated row(s) "- [ ]" → "- [x]":`);
for (const r of flipped) console.log(`  ${r.url.slice(0, 78)}  (${r.reason})`);
console.log(APPLY ? `\n✓ Wrote ${PIPELINE}.` : '\n(dry run — re-run with --apply to write)');
