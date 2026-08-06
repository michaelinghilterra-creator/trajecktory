#!/usr/bin/env node
// reconcile-pipeline.mjs — check off pipeline.md rows that are already handled.
//
// Thin CLI over lib/pipeline.mjs (the single owner of pipeline checkbox state).
// It flips every unchecked "- [ ]" row whose posting is already evaluated
// (applications.md) or dismissed (triage-dismissed.tsv) to "- [x]", leaving only
// genuinely-new roles in the queue.
//
// WHY: three things put a "- [ ]" row in the queue but historically only ONE
// (Evaluate → merge-tracker) ever checked one back off, so dismissed and some
// evaluated rows piled up and clogged the triage top-15 window. The dashboard now
// runs this automatically after every agent run; this CLI is the manual/backfill
// entry point and what the batch workflow can call.
//
// Dry-run by default. Pass --apply to write. Idempotent.

import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { reconcileHandled } from './lib/pipeline.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

const { flipped, rows } = reconcileHandled(join(ROOT, 'data/pipeline.md'), {
  appsPath: join(ROOT, 'data/applications.md'),
  dismissedPath: join(ROOT, 'data/triage-dismissed.tsv'),
  additionsDir: join(ROOT, 'batch/tracker-additions'),
  needsManualPath: join(ROOT, 'data/needs-manual-jd.tsv'),
  rootDir: ROOT,
  apply: APPLY,
});

if (!flipped) {
  console.log('✓ Pipeline already reconciled — no already-handled rows left unchecked.');
  process.exit(0);
}

console.log(`${APPLY ? 'Flipped' : 'Would flip'} ${flipped} already-handled row(s) "- [ ]" → "- [x]":`);
for (const r of rows) console.log(`  ${r.url.slice(0, 84)}`);
console.log(APPLY ? '\n✓ Wrote data/pipeline.md.' : '\n(dry run — re-run with --apply to write)');
