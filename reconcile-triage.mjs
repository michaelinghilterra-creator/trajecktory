#!/usr/bin/env node
// reconcile-triage.mjs — check off pipeline.md rows already covered by
// data/triage-results.tsv (or a full evaluation already in applications.md).
//
// Thin CLI over lib/reconcile-triage.mjs + lib/pipeline.mjs. Triage
// deliberately never checks off a pipeline row itself (see modes/triage.md),
// so an already-scored role sits in the queue as "- [ ]" until Deep Dive
// eventually evaluates it — which most low scores never reach. Run this after
// a triage batch (or anytime) to keep the queue's unchecked count meaning
// "genuinely unscored", not "scored, just never marked".
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

console.log(`${APPLY ? 'Flipped' : 'Would flip'} ${flipped.length} already-triaged row(s) "- [ ]" → "- [x]":`);
for (const r of flipped) console.log(`  ${r.url.slice(0, 78)}  (${r.reason})`);
console.log(APPLY ? `\n✓ Wrote ${PIPELINE}.` : '\n(dry run — re-run with --apply to write)');
