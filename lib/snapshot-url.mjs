/**
 * snapshot-url.mjs — recover the original posting URL from a local JD snapshot.
 *
 * WHY THIS EXISTS:
 * resolve-jds.mjs repoints a pipeline row from its URL to `local:jds/<file>.md`
 * so eval agents can read SPA postings that a plain fetch renders blank. That
 * rewrite made gate-pipeline.mjs structurally blind: its pattern accepted only
 * http(s) rows, so a fully resolved queue matched ZERO rows and the gate printed
 * "nothing to gate" and exited 0. Two documented steps in the batch workflow
 * cancelled each other, and the loser is the step AGENTS.md calls the most
 * important one — the guard against spending evaluation budget on dead postings.
 *
 * It failed SILENTLY, reporting success, which is why it survived: a gate that
 * finds nothing looks exactly like a queue with nothing wrong.
 *
 * Kept as a compatibility adapter for existing imports. Identity resolution now
 * lives in lib/identity.mjs so all posting comparisons use the same helper.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sourceUrlFromSnapshot as resolveSnapshotUrl } from './identity.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * sourceUrlFromSnapshot(ref, readFile?) -> url string, or null.
 *
 * Returns null on anything ambiguous. The caller MUST treat null as "leave this
 * row pending", never as "gate it dead": discarding a live posting costs a job,
 * while keeping a dead one costs a single evaluation.
 */
export function sourceUrlFromSnapshot(localRef, readFile = readFileSync) {
  return resolveSnapshotUrl(localRef, ROOT, readFile);
}
