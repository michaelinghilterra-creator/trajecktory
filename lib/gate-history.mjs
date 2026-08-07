// lib/gate-history.mjs — the single owner of data/gate-history.tsv writes.
//
// WHY THIS EXISTS: gate-pipeline.mjs's liveness verdicts (which postings are
// live vs. dead, and why) used to live ONLY inside data/pipeline.md itself, as
// the "- [!] ... — gated: <reason>" text on each row. There was no separate
// record. When pipeline.md was accidentally wiped on 2026-08-06 (a bug in an
// unrelated ingestion script truncated it), every dead/live disposition that
// gate-pipeline had ever computed was gone with it — reconstructing the queue
// from data/scan-history.tsv could recover WHICH urls had existed, but not
// which of them had already been checked and found dead, so the queue had to
// be re-gated from scratch to regain that information.
//
// This file makes that class of loss impossible going forward: every liveness
// verdict (live, dead, uncertain, or suppressed as already-decided/repost) is
// appended here, in addition to being written into pipeline.md. If pipeline.md
// is ever lost again, this file alone is enough to answer "was this URL
// already checked, and what did we find" without re-running Playwright against
// every posting again.
//
// Same shape as lib/triage-results.mjs: purely additive (nothing here is ever
// edited, only appended), so the write is `fs.appendFileSync` — physically
// unable to truncate or overwrite a prior run's rows.

import { readFileSync, appendFileSync, existsSync, writeFileSync } from 'fs';

export const HEADER = 'date\turl\tcompany\trole\tresult\treason';

// result is one of: active | expired | uncertain | decided | repost
// (the first three come from the Playwright liveness check; the last two are
// the pre-browser suppression checks gate-pipeline already runs — logging them
// too means a user can answer "why did this URL never even get checked" later)
const VALID_RESULTS = new Set(['active', 'expired', 'uncertain', 'decided', 'repost']);

// Normalize one verdict row. Returns null (and does not throw) for a malformed
// entry, so one bad row from a caller does not abort an otherwise-good append.
function normalizeRow(entry) {
  const url = String(entry?.url || '').trim();
  const result = String(entry?.result || '').trim();
  if (!url || !VALID_RESULTS.has(result)) return null;
  return {
    url,
    company: String(entry?.company || '').replace(/\t/g, ' ').trim(),
    role: String(entry?.role || '').replace(/\t/g, ' ').trim(),
    result,
    reason: String(entry?.reason || '').replace(/\t/g, ' ').replace(/[\r\n]+/g, ' ').trim(),
  };
}

// Append-only write. Creates the file with HEADER if missing. Every row that
// survives normalizeRow is appended — this file is a LOG, not a deduped state
// table, so the same URL legitimately appears again on a later re-gate (its
// disposition may have changed). Returns the count actually written.
export function appendGateHistory(filePath, rows, dateISO) {
  const date = dateISO || new Date().toISOString().slice(0, 10);
  const lines = [];
  for (const entry of rows || []) {
    const r = normalizeRow(entry);
    if (!r) continue;
    lines.push([date, r.url, r.company, r.role, r.result, r.reason].join('\t'));
  }
  if (!lines.length) return { appended: 0 };
  if (!existsSync(filePath)) writeFileSync(filePath, HEADER + '\n', 'utf8');
  appendFileSync(filePath, lines.join('\n') + '\n', 'utf8');
  return { appended: lines.length };
}

// Look up the most recent verdict for a URL, for callers that want to answer
// "what did we last find for this posting" without re-checking it. Returns
// null if the URL has never been logged. Reads the whole file each call
// (this log is expected to stay small relative to pipeline.md), so it is a
// convenience for scripts/CLI use, not a hot path.
export function lastVerdictFor(filePath, url) {
  if (!existsSync(filePath)) return null;
  const target = String(url || '').trim();
  if (!target) return null;
  const lines = readFileSync(filePath, 'utf8').split('\n');
  let found = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('date\t')) continue;
    const cells = t.split('\t');
    if (cells[1] === target) {
      found = { date: cells[0], url: cells[1], company: cells[2], role: cells[3], result: cells[4], reason: cells[5] || '' };
    }
  }
  return found;
}
