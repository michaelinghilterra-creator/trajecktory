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
 * Lives in its own module rather than inside gate-pipeline.mjs because that file
 * has no main guard, so importing it to test a helper executes the whole gate.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * sourceUrlFromSnapshot(ref, readFile?) -> url string, or null.
 *
 * Returns null on anything ambiguous. The caller MUST treat null as "leave this
 * row pending", never as "gate it dead": discarding a live posting costs a job,
 * while keeping a dead one costs a single evaluation.
 */
export function sourceUrlFromSnapshot(localRef, readFile = readFileSync) {
  const rel = String(localRef || '').replace(/^local:/, '').trim();
  if (!rel) return null;
  let body;
  try {
    body = readFile(join(ROOT, rel), 'utf8');
  } catch (err) {
    // Only a missing/unreadable FILE is an expected null. A programming error
    // must not be silently converted into "no URL found" -- a blanket catch here
    // once turned an undefined variable into 107 rows reported as unresolvable,
    // which is the same silent-success failure this module exists to fix.
    if (err && (err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'EACCES')) return null;
    throw err;
  }
  // The labelled line wins. A JD body is full of URLs (company site, privacy
  // policy, benefits); picking the wrong one would gate a live posting against
  // an unrelated page.
  const labelled = body.match(/\*\*Source URL:\*\*\s*(https?:\/\/\S+)/i);
  if (labelled) return labelled[1].trim();
  const bare = body.match(/https?:\/\/\S+/);
  return bare ? bare[0].trim() : null;
}
