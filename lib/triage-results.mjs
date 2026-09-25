// lib/triage-results.mjs — the single owner of the Spark pre-filter discard log.
//
// WHY THIS EXISTS: older agent workflows used to write this file directly,
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
// move the write to deterministic code.
//
// This file is stronger than that pattern requires, because the discard log
// is purely ADDITIVE — nothing ever edits an existing row, only appends new
// ones. That means the write can be `fs.appendFileSync`, which physically
// cannot truncate or overwrite existing bytes. A bug in this file can produce
// a malformed NEW line; it cannot reproduce incident #2 above, because it
// never reads the file back in order to rewrite it.

import { readFileSync, appendFileSync, existsSync, writeFileSync } from 'fs';
import { basename, dirname } from 'path';
import { canonicalPostingUrl } from './identity.mjs';
import { localToday } from './local-date.mjs';

export const HEADER = 'url\tcompany\ttitle\tscore\trationale\tdate';

// canonicalUrl-keyed set of URLs already present in the file, so a re-run
// (or a duplicate within one run) never appends a second line for the same posting.
function rootForResults(filePath) {
  const parent = dirname(filePath);
  return basename(parent).toLowerCase() === 'data' ? dirname(parent) : parent;
}

function existingUrlSet(filePath, rootDir) {
  const set = new Set();
  if (!existsSync(filePath)) return set;
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('url\t')) continue;
    const url = t.split('\t')[0];
    if (url) set.add(canonicalPostingUrl(url, rootDir));
  }
  return set;
}

// Append-only write. Creates the file with HEADER if missing. Returns
// { appended, skippedDuplicate }.
export function appendTriageResults(filePath, rows, dateISO) {
  if (!existsSync(filePath)) writeFileSync(filePath, HEADER + '\n', 'utf8');
  const rootDir = rootForResults(filePath);
  const existing = existingUrlSet(filePath, rootDir);
  const date = dateISO || localToday();

  const lines = [];
  let skippedDuplicate = 0;
  const seenThisRun = new Set();
  for (const r of rows) {
    const canon = canonicalPostingUrl(r.url, rootDir);
    if (existing.has(canon) || seenThisRun.has(canon)) { skippedDuplicate++; continue; }
    seenThisRun.add(canon);
    lines.push([r.url, r.company, r.title, r.score.toFixed(1), r.rationale, date].join('\t'));
  }
  if (lines.length) appendFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  return { appended: lines.length, skippedDuplicate };
}
