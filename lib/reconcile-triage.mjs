// lib/reconcile-triage.mjs — decide which pipeline.md rows are already covered
// by data/triage-results.tsv (or a full evaluation), so they can be checked off.
//
// WHY THIS EXISTS: triage deliberately never checks off a pipeline row itself
// (see modes/triage.md — "Triage is non-destructive, the deep evaluation owns
// that"), so a role that's already been triage-scored sits in the queue as
// "- [ ]" forever. During the 2026-08-06 mass-triage session this meant every
// retry round re-verified the same already-scored rows from scratch — the
// triage agent correctly recognized them as duplicates (so nothing was ever
// double-counted or corrupted), but it burned a full LLM round doing that
// recognition over and over instead of reaching genuinely new roles. This file
// formalizes the ad hoc matching built by hand that day into one reusable,
// tested module — the same "stop re-deriving it every time" fix
// lib/pipeline.mjs's reconcileHandled() already is for applications.md.
//
// Matching is intentionally layered, richest signal first, because pipeline.md
// rows and triage-results.tsv rows do not always describe the same posting the
// same way:
//   1. Exact URL match — the strongest signal, but breaks when resolve-jds.mjs
//      later repoints a pipeline row from its original https:// URL to a
//      local:jds/… snapshot AFTER that URL was already scored under the old
//      address. Two representations, one posting.
//   2. Exact company + title match — survives the URL-representation drift
//      above, since triage-results.tsv always records the real company/title
//      regardless of which URL form scored it.
//   3. For an older ingestion batch whose pipeline.md row never got a real
//      company/title (some numbered "jds/9001-…" rows carry the filename slug
//      or nothing at all as their "title"), fall back to matching the row's
//      combined title text against a scored title, in both directions
//      (substring), since the batch's title field sometimes embeds the
//      company name INSIDE the title ("Head of X — Acme Co") rather than
//      as a separate field.
//   4. For that same numbered-batch shape, the filename itself often carries
//      the tracker id ("jds/4200-acme-co.md" ↔ applications.md row #4200)
//      from a role that was fully evaluated (not just triaged) in an earlier
//      session, before the pipeline row was ever checked off. That id is
//      checked against applications.md directly.
//
// Each layer only ever produces a false NEGATIVE (a genuine duplicate that
// stays open one more round) never a false POSITIVE (marking a real, unscored
// role as done) — the guiding rule used everywhere else in this codebase
// (lib/identity.mjs's "ambiguous is unresolvable, never merges").

import { readFileSync, existsSync } from 'fs';
import { updatePipelineRows } from './pipeline.mjs';

const MIN_TITLE_LEN_FOR_SUBSTRING = 8; // guards against a short generic title false-matching everything

// Parse data/triage-results.tsv content into lookup structures.
export function buildTriageIndex(triageResultsText) {
  const urls = new Set();
  const keys = new Set();      // "normalized company::normalized title"
  const titles = new Set();    // normalized title alone (dedup'd)
  const lines = String(triageResultsText || '').split('\n').slice(1).filter(Boolean);
  for (const line of lines) {
    const cells = line.split('\t');
    const url = (cells[0] || '').trim();
    const company = (cells[1] || '').toLowerCase().trim();
    const title = (cells[2] || '').toLowerCase().trim();
    if (url) urls.add(url);
    if (company && title) keys.add(`${company}::${title}`);
    if (title) titles.add(title);
  }
  return { urls, keys, titles };
}

// Parse data/applications.md content into the set of tracker row ids present
// (any status — the point is only "this JD number was already processed
// end-to-end by SOME earlier session", not what its outcome was).
export function buildTrackedIdIndex(applicationsMdText) {
  const ids = new Set();
  for (const line of String(applicationsMdText || '').split('\n')) {
    const m = line.match(/^\|\s*(\d+)\s*\|/);
    if (m) ids.add(m[1]);
  }
  return ids;
}

// Pull { company, title } out of a pipeline row's raw metadata suffix
// (" | Company | Title", possibly with an embedded "|" inside the title
// itself, which is why title is a REJOIN of every part past index 1, not a
// naive parts[2]).
function parseRowMeta(rest) {
  const parts = String(rest || '').split('|').map(s => s.trim());
  const company = (parts[1] || '').toLowerCase().trim();
  const title = parts.slice(2).join(' | ').toLowerCase().trim();
  return { company, title };
}

// The core decision: is this pipeline row already covered? `row` is a parsed
// row from lib/pipeline.mjs's readPipelineRows/updatePipelineRows (has `.url`
// and `.rest`). Returns a short reason string (truthy) if covered, or null if
// this looks like a genuinely new, unscored posting.
export function alreadyHandledByTriage(row, { triageIndex, trackedIds }) {
  const url = row.url;
  if (triageIndex.urls.has(url)) return 'exact URL already in triage-results.tsv';

  const { company, title } = parseRowMeta(row.rest);
  if (!title) {
    // No metadata at all (a bare URL row) — only the filename-tracker-id layer
    // can possibly resolve this one.
  } else if (company) {
    if (triageIndex.keys.has(`${company}::${title}`)) return 'exact company+title match';
  } else {
    // Numbered-legacy-batch shape: company blank, title may embed the company
    // name, or be truncated/garbled. Exact title match first (cheap, precise).
    if (triageIndex.titles.has(title)) return 'exact title match (company field blank)';
    // Then bidirectional substring, guarded by a minimum length so a short
    // title like "Manager" cannot false-match half the file.
    if (title.length >= MIN_TITLE_LEN_FOR_SUBSTRING) {
      for (const scoredTitle of triageIndex.titles) {
        if (scoredTitle.length < MIN_TITLE_LEN_FOR_SUBSTRING) continue;
        if (title.includes(scoredTitle) || scoredTitle.includes(title)) {
          return 'title substring match (company embedded in title text)';
        }
      }
    }
  }

  // Filename-embedded tracker id: "local:jds/4200-acme-co.md" → id "4200".
  // If applications.md already has a row #4200, this posting was fully
  // evaluated in an earlier session before ever being checked off here.
  const fm = url.match(/^local:jds\/(\d+)-/);
  if (fm && trackedIds.has(fm[1])) return `tracker row #${fm[1]} already exists in applications.md`;

  return null;
}

// Check off every open pipeline.md row already covered by triage-results.tsv
// (or a full evaluation in applications.md). This is the SAME work the
// reconcile-triage.mjs CLI does, factored out so the dashboard's after-run
// self-heal can call it too (see dashboard-web/server/routes/agent.mjs). The
// server's reconcileHandled() covers applications.md/dismissed/staged but not
// triage-results.tsv, so a triage-scored-but-unevaluated row would otherwise
// keep re-surfacing every run. Pass apply:false for a dry run (report only).
// Best-effort by contract: missing files yield an empty result, never a throw.
export function reconcileTriageResults(pipelinePath, { triageResultsPath, appsPath = null, apply = false }) {
  if (!existsSync(triageResultsPath)) return { flipped: [], changed: 0 };
  const triageIndex = buildTriageIndex(readFileSync(triageResultsPath, 'utf8'));
  const trackedIds = appsPath && existsSync(appsPath)
    ? buildTrackedIdIndex(readFileSync(appsPath, 'utf8'))
    : new Set();

  const flipped = [];
  const { changed } = updatePipelineRows(pipelinePath, (row) => {
    if (row.state !== 'open') return null;
    const reason = alreadyHandledByTriage(row, { triageIndex, trackedIds });
    if (!reason) return null;
    flipped.push({ url: row.url, reason });
    return apply ? { box: 'x' } : null; // dry run: report, don't mutate
  });
  return { flipped, changed };
}
