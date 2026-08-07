// lib/pipeline.mjs — the SINGLE owner of data/pipeline.md checkbox state.
//
// WHY THIS FILE EXISTS
// Four separate hand-rolled implementations used to flip a pipeline row's
// checkbox ("- [ ]" → "- [x]"), and they disagreed on the two things that
// actually decide whether a row gets marked:
//   • line endings — pipeline.md carries MIXED "\n" and "\r\n". A regex ending
//     in "(.*)$" cannot match across a trailing "\r" (JS "." and "$" stop before
//     it), so every CRLF row was silently skipped. That one detail produced four
//     "triage wrote nothing / queue clogged" incidents in ten days.
//   • URL shape — some matchers only handled "https://" rows and ignored the
//     "local:jds/…" snapshot rows, and nothing bridged an evaluated snapshot row
//     (URL "local:jds/foo.md") back to the real posting URL recorded in the
//     tracker, so it never got checked off either.
//
// This is the same consolidation lib/tracker.mjs and lib/identity.mjs made for
// applications.md: ONE parser, ONE writer, guarded by tests (tests/pipeline.test.mjs)
// and a run-time invariant (verify-reports.mjs). If you are about to write another
// pipeline.md checkbox regex, call these functions instead.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { canonicalUrl, buildDecidedIndex, urlFromReport } from './identity.mjs';

// A pipeline row: "- [ ] <url> | Company | Title", "- [x] …", or "- [!] … — reason".
// The URL is the first whitespace-delimited token after the box and may be an
// "https://…" posting or a "local:jds/….md" snapshot. Everything after the URL
// (the "| Company | Title" metadata, or a gated "— reason") is preserved verbatim.
const ROW_RE = /^(\s*-\s*)\[( |x|!)\](\s+)(\S+)(.*)$/;
const BOX = { open: ' ', done: 'x', dead: '!' };
const STATE = { ' ': 'open', x: 'done', '!': 'dead' };

// Parse ONE raw line (which may carry a trailing "\r"). Returns null for any line
// that is not a checkbox row, so callers can map over a whole file safely.
export function parsePipelineRow(rawLine) {
  const cr = rawLine.endsWith('\r');
  const line = cr ? rawLine.slice(0, -1) : rawLine;
  const m = line.match(ROW_RE);
  if (!m) return null;
  const url = m[4].trim();
  return {
    prefix: m[1], box: m[2], gap: m[3], url, rest: m[5], cr,
    state: STATE[m[2]],
    canonical: canonicalUrl(url),
  };
}

// Render a parsed row back to a line, optionally changing its box char and/or the
// trailing text. Re-attaches the row's original "\r" so line endings never drift.
function renderRow(row, { box = row.box, rest = row.rest } = {}) {
  const s = `${row.prefix}[${box}]${row.gap}${row.url}${rest}`;
  return row.cr ? s + '\r' : s;
}

// Every parsed row in a file, optionally filtered to one state ('open'|'done'|'dead').
export function readPipelineRows(file, state = null) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n')
    .map(parsePipelineRow).filter(Boolean)
    .filter((r) => !state || r.state === state);
}

// Core writer: walk every row, let mutate(row) return null (leave it) or
// { box?, rest? } to rewrite it. Writes only when something changed, and preserves
// each row's own line ending. EVERY checkbox change goes through here.
export function updatePipelineRows(file, mutate) {
  if (!existsSync(file)) return { changed: 0 };
  let changed = 0;
  const out = readFileSync(file, 'utf8').split('\n').map((raw) => {
    const row = parsePipelineRow(raw);
    if (!row) return raw;
    const patch = mutate(row);
    if (!patch) return raw;
    const box = patch.box ?? row.box;
    const rest = patch.rest ?? row.rest;
    if (box === row.box && rest === row.rest) return raw;
    changed++;
    return renderRow(row, { box, rest });
  }).join('\n');
  if (changed) writeFileSync(file, out, 'utf8');
  return { changed };
}

// Flip the given canonical URLs from OPEN ("- [ ]") to DONE ("- [x]"). Only touches
// currently-open rows — never un-gates a "- [!]" or re-marks a done row. Accepts a
// Set or array of canonical URLs. Returns how many rows flipped.
export function markDone(file, canonicalUrls) {
  const set = canonicalUrls instanceof Set ? canonicalUrls : new Set(canonicalUrls);
  if (!set.size) return 0;
  return updatePipelineRows(file, (row) =>
    row.state === 'open' && set.has(row.canonical) ? { box: BOX.done } : null
  ).changed;
}

// ── "Already handled" reconciliation ─────────────────────────────────────────
// The recurring failure: a row for a posting that is ALREADY evaluated (in
// applications.md) or dismissed (triage-dismissed.tsv) stays "- [ ]" open, so it
// keeps re-entering the triage top-15 window and eventually crowds out genuinely-
// new roles. These functions find and close exactly those rows.

// A "local:jds/foo.md" snapshot records the real posting URL on a header line near
// the top. Three formats exist across the jds/ corpus, from three different
// ingestion paths built at different times, and a snapshot resolves only if its
// OWN format is matched: resolve-jds.mjs (the ATS-API puller) writes
// "**Source URL:**"; an earlier Ashby-pull batch wrote "**URL:**"; the original
// Obsidian-clip ingestion wrote a bare "URL:" with no markdown bold at all.
// Matching only the newest form left every older-batch snapshot unresolvable —
// on 2026-08-06 this meant 24 already-deep-dived roles kept showing as
// unresolved triage cards, because their pipeline row still carried the local:
// snapshot path and nothing could resolve it back to the URL applications.md
// actually stores. Best-effort: a snapshot with none of the three still returns
// null rather than throwing.
export function sourceUrlOf(url, rootDir) {
  if (!rootDir || typeof url !== 'string' || !url.startsWith('local:')) return null;
  try {
    const text = readFileSync(join(rootDir, url.slice('local:'.length)), 'utf8');
    const m = text.match(/^\*{0,2}(?:Source )?URL:\*{0,2}\s*(\S+)/im);
    return m ? canonicalUrl(m[1].trim()) : null;
  } catch { return null; }
}

// One canonicalized-URL Set from triage-dismissed.tsv (column 0). Centralized here
// so there is a single reader (the dashboard route used to have its own copy).
export function loadDismissedSet(dismissedPath) {
  const set = new Set();
  if (!dismissedPath || !existsSync(dismissedPath)) return set;
  for (const raw of readFileSync(dismissedPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('url\t')) continue;
    set.add(canonicalUrl(line.split('\t')[0].trim()));
  }
  return set;
}

// Evaluations that are WRITTEN but not yet merged into applications.md, read from
// the staged tracker-addition TSVs. This closes the window between an Evaluate run
// and the Merge step: an eval agent no longer edits pipeline.md itself (that was
// the flaky, race-prone LLM check-off), so this deterministic pass marks its rows
// done instead — reliably, and without the parallel-write race the API-key path
// created. Column 7 is the "[num](reports/…)" link; urlFromReport reads the real
// posting URL from that report's frontmatter. Only top-level .tsv files are staged
// (merged/ and dropped/ subdirs are skipped by the .tsv name check).
function stagedEvaluatedUrls(additionsDir, rootDir) {
  const urls = new Set();
  if (!additionsDir || !existsSync(additionsDir)) return urls;
  for (const name of readdirSync(additionsDir)) {
    if (!name.endsWith('.tsv')) continue;
    try {
      for (const line of readFileSync(join(additionsDir, name), 'utf8').split('\n')) {
        const cols = line.split('\t');
        if (cols.length < 9) continue;
        const u = urlFromReport(cols[7], rootDir);
        if (u) urls.add(canonicalUrl(u));
      }
    } catch { /* skip an unreadable TSV */ }
  }
  return urls;
}

// Postings the eval deferred to manual JD paste (it could not read them). Column 0
// is the posting URL. Marking them done stops the next run from retrying a posting
// it already knows it cannot read — the other thing the removed LLM check-off did.
function needsManualUrls(needsManualPath) {
  const urls = new Set();
  if (!needsManualPath || !existsSync(needsManualPath)) return urls;
  for (const raw of readFileSync(needsManualPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('url\t')) continue;
    urls.add(canonicalUrl(line.split('\t')[0].trim()));
  }
  return urls;
}

// The canonical URLs that count as "already handled" — we have dealt with the
// posting one way or another, so its pipeline row should not stay open:
//   • evaluated + merged  (applications.md)
//   • evaluated, staged   (batch/tracker-additions/, pre-Merge)
//   • dismissed           (triage-dismissed.tsv)
//   • deferred to manual  (needs-manual-jd.tsv)
// additionsDir / needsManualPath are optional; omit them for a pure "already
// decided" view (that is all the read-only invariant needs).
export function loadHandledSet({ appsPath, dismissedPath, rootDir, additionsDir = null, needsManualPath = null }) {
  const handled = new Set();
  if (appsPath && existsSync(appsPath)) {
    const decided = buildDecidedIndex({ appsPath, rootDir });
    for (const k of decided.byUrl.keys()) handled.add(k);
  }
  for (const u of loadDismissedSet(dismissedPath)) handled.add(u);
  for (const u of stagedEvaluatedUrls(additionsDir, rootDir)) handled.add(u);
  for (const u of needsManualUrls(needsManualPath)) handled.add(u);
  return handled;
}

// Open rows whose URL (directly, or via a snapshot's Source URL) is already
// handled — i.e. the clog. Read-only; the invariant and the reconcile both use it.
export function handledOpenRows(file, handledSet, rootDir = null) {
  return readPipelineRows(file, 'open').filter((r) =>
    handledSet.has(r.canonical) || handledSet.has(sourceUrlOf(r.url, rootDir))
  );
}

// Reconcile the queue: check off every open row that is already handled. Pass
// apply:false to only report what WOULD flip (that is the health-check invariant).
export function reconcileHandled(file, { appsPath, dismissedPath, rootDir, additionsDir = null, needsManualPath = null, apply = false }) {
  const handled = loadHandledSet({ appsPath, dismissedPath, rootDir, additionsDir, needsManualPath });
  const rows = handledOpenRows(file, handled, rootDir);
  if (apply && rows.length) markDone(file, rows.map((r) => r.canonical));
  return { flipped: rows.length, rows };
}
