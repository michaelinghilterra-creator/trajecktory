// lib/triage-results.mjs — the single owner of data/triage-results.tsv writes.
//
// WHY THIS EXISTS: the triage agent used to write this file itself, directly,
// via Bash/Write/Edit across a long (30-60+ step) turn. That failed two
// different ways in one afternoon (2026-08-06):
//   1. ~50% of runs did real work (fetched and scored real JDs) but never
//      persisted it — the sandbox denies Bash(cat:*), and the Write/Edit
//      fallbacks were inconsistent, with no visible error (the persisted job
//      record only keeps tool-call SUMMARIES, not results).
//   2. Once, a run that reported "wrote nothing" had actually READ the file
//      early in its turn, held that snapshot in context, and near the end
//      wrote it back — silently reverting ~108 rows other rounds had appended
//      in between. A lost-update, not a crash: nothing errored, the count
//      just went backwards.
// Both are the same root problem this whole codebase has already been fixed
// for elsewhere today: an LLM agent doing a direct read-modify-write on a
// growing shared file. The fix is the same shape as lib/pipeline.mjs's
// check-off consolidation and the server-side report-number reservation —
// move the write to deterministic server code, and have the agent emit
// STRUCTURED OUTPUT instead of touching the file at all.
//
// This file is stronger than that pattern requires, because triage-results.tsv
// is purely ADDITIVE — nothing ever edits an existing row, only appends new
// ones. That means the write can be `fs.appendFileSync`, which physically
// cannot truncate or overwrite existing bytes. A bug in this file can produce
// a malformed NEW line; it cannot reproduce incident #2 above, because it
// never reads the file back in order to rewrite it.

import { readFileSync, appendFileSync, existsSync, writeFileSync } from 'fs';
import { canonicalUrl } from './identity.mjs';

export const HEADER = 'url\tcompany\ttitle\tscore\trationale\tdate';

// The delimiter the agent's final response is expected to contain. Deliberately
// NOT a bare ```json fence: the agent's response is free-form prose plus this
// block, and a generic fence is too easy to collide with an unrelated JSON
// snippet quoted while explaining a role. A unique, all-caps sentinel is
// unambiguous to find and cheap to instruct an agent to reproduce exactly.
export const START_MARKER = '<<<TRIAGE_RESULTS>>>';
export const END_MARKER = '<<<END_TRIAGE_RESULTS>>>';

// Extract and validate the JSON array between the markers. Returns
// { rows, errors } — errors are per-row problems (never thrown), so one
// malformed entry does not discard the rest of a real run's work.
export function parseTriageOutput(text) {
  const errors = [];
  const s = String(text || '');
  const startIdx = s.indexOf(START_MARKER);
  const endIdx = s.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { rows: [], errors: ['no TRIAGE_RESULTS block found in the agent output'] };
  }
  // Strip a markdown code fence if the agent wrapped the array in one despite
  // being told not to (a very common LLM habit) -- defense in depth, since the
  // prompt instruction alone is advisory. Only strips a fence that spans the
  // WHOLE block (leading ```/```json and a trailing ```), never touches
  // anything inside a well-formed array.
  let jsonText = s.slice(startIdx + START_MARKER.length, endIdx).trim();
  const fenced = jsonText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenced) jsonText = fenced[1].trim();

  let parsed;
  try { parsed = JSON.parse(jsonText); }
  catch (e) { return { rows: [], errors: [`TRIAGE_RESULTS block is not valid JSON: ${e.message}`] }; }
  if (!Array.isArray(parsed)) return { rows: [], errors: ['TRIAGE_RESULTS block is not a JSON array'] };

  const rows = [];
  for (const [i, entry] of parsed.entries()) {
    if (!entry || typeof entry !== 'object') { errors.push(`entry ${i}: not an object`); continue; }
    const url = String(entry.url || '').trim();
    const company = String(entry.company || '').trim();
    const title = String(entry.title || '').trim();
    const rationale = String(entry.rationale || '').replace(/\t/g, ' ').trim();
    const score = Number(entry.score);
    if (!url) { errors.push(`entry ${i}: missing url`); continue; }
    if (!Number.isFinite(score) || score < 0 || score > 5) { errors.push(`entry ${i} (${url}): score "${entry.score}" is not a number 0-5`); continue; }
    if (!rationale) { errors.push(`entry ${i} (${url}): missing rationale`); continue; }
    rows.push({ url, company, title, score: Math.round(score * 10) / 10, rationale });
  }
  return { rows, errors };
}

// canonicalUrl-keyed set of URLs already present in the file, so a re-run
// (or a duplicate within one run's own output) never appends a second line
// for the same posting. Belt-and-braces on top of the prompt's own
// "skip already-scored URLs" instruction, same precedent as every other
// dedup layer in this codebase (a prose instruction is advisory; this is not).
function existingUrlSet(filePath) {
  const set = new Set();
  if (!existsSync(filePath)) return set;
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('url\t')) continue;
    const url = t.split('\t')[0];
    if (url) set.add(canonicalUrl(url));
  }
  return set;
}

// Append-only write. Creates the file with HEADER if missing. Returns
// { appended, skippedDuplicate, dropped } — dropped counts rows that failed
// validation upstream (informational only; parseTriageOutput already excluded
// them from `rows`, so this fn only ever sees valid ones, but the count is
// threaded through by the caller for one honest summary).
export function appendTriageResults(filePath, rows, dateISO) {
  if (!existsSync(filePath)) writeFileSync(filePath, HEADER + '\n', 'utf8');
  const existing = existingUrlSet(filePath);
  const date = dateISO || new Date().toISOString().slice(0, 10);

  const lines = [];
  let skippedDuplicate = 0;
  const seenThisRun = new Set();
  for (const r of rows) {
    const canon = canonicalUrl(r.url);
    if (existing.has(canon) || seenThisRun.has(canon)) { skippedDuplicate++; continue; }
    seenThisRun.add(canon);
    lines.push([r.url, r.company, r.title, r.score.toFixed(1), r.rationale, date].join('\t'));
  }
  if (lines.length) appendFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  return { appended: lines.length, skippedDuplicate };
}
