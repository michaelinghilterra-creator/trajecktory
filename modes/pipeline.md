# Mode: pipeline — Process the Inbox (data/pipeline.md)

> **OUTPUT LANGUAGE: ENGLISH — MANDATORY.** All section headers, prose, tables, coaching, recommendations, tracker notes, and form drafts must be written in English. The only exception is when the user has explicitly switched to a non-English mode directory (e.g. `modes/de/`, `modes/fr/`, `modes/ja/`).

Processes URLs accumulated in `data/pipeline.md`. This mode runs two ways, and they differ in a few load-bearing places — read the **Invocation context** section below before doing anything else, because it changes steps 0, 1, and 3.

## Invocation context (READ THIS FIRST)

This mode file is shared by:
1. **Interactive** — the user runs `/trajecktory pipeline` themselves in their own terminal.
2. **Dashboard-driven headless** — the trajecktory dashboard runs `claude -p "/trajecktory pipeline...<constraints>"` with no human attached, for both a batch Evaluate run and every single Deep Dive (a Deep Dive is one URL run through this same mode).

**If your invoking prompt appends constraints after this mode's own instructions (a `dashboard-driven` run always does), those appended constraints win wherever they conflict with anything below** — they encode the current dashboard architecture, which this file cannot always mirror without also being the dashboard's own source. In particular, if you were given:
- **pre-reserved report numbers**: use those, in order, and do NOT compute a number yourself (see Numbering below).
- an instruction **not to run `gate-pipeline.mjs`** or **not to use Playwright**: follow that, and use the fetch method the constraint describes instead (skip Step 0 below).
- an instruction **not to edit `data/pipeline.md`**: follow that — checking off rows is handled deterministically after the run (see [`lib/pipeline.mjs`](../lib/pipeline.mjs)), not by you.

If you are running interactively with no such appended constraints, follow this file's own steps in full.

## Step 0 — Liveness gate (interactive runs only)

**REQUIRED for interactive runs, SKIPPED for dashboard-driven runs (they gate server-side and tell you not to).** Run `node gate-pipeline.mjs` before evaluating anything. It Playwright-checks every pending URL and flips dead postings to `- [!]` with a closure reason — without it you burn tokens evaluating expired postings (a stale WebSearch index can make a batch 80%+ dead). Report the live/dead counts, then proceed.

## Step 1 — Read the pending queue

Read `data/pipeline.md`, collect the `- [ ]` rows (the gate already flipped dead ones to `- [!]` — skip those). A row is either:
- an `https://…` posting URL, or
- a `local:jds/<slug>.md` snapshot path — `resolve-jds.mjs` writes these for JS-rendered (SPA) postings that a plain fetch can't read. **Read the file directly with the Read tool.** Its first line is `**Source URL:**` — use THAT as the real posting URL in the report frontmatter and the tracker row; never the `local:` path itself.

## Step 2 — For each pending URL: fetch, evaluate, write

**Extracting the JD**, in priority order:
1. **Interactive session:** Playwright (`browser_navigate` + `browser_snapshot`) first, WebFetch as fallback, WebSearch as last resort.
2. **Dashboard-driven (headless):** follow the appended constraint's fetch order exactly (normally `fetch-jd.mjs` → WebFetch → defer to `needs-manual-jd.tsv`). Playwright is not available headless.
3. **A `local:jds/` row:** read the snapshot file directly (Step 1) — do not fetch it.

If the JD cannot be read by any available method: mark the row `- [!]` with a reason (interactive) or follow the deferral instruction in your appended constraints (headless) — either way, do not fabricate or reconstruct a JD from search snippets, and write no report for it.

**Evaluating:** run the full A-G evaluation exactly as in [`modes/oferta.md`](oferta.md) (Blocks A-F + Block G Posting Legitimacy).

**Numbering:**
- **If your invoking prompt pre-reserved report numbers**, use them in order — one per report you actually write — as both the report filename number and the tracker id. Do not run `node next-jd.mjs`.
- **Otherwise (interactive)**, get the next number from the persistent counter: `node next-jd.mjs --pad`. **Never hand-compute "highest number in `reports/` + 1"** — `reports/` gets pruned between batches while the tracker never is, so a hand-computed max reuses numbers across different companies and drifts the report number away from the tracker id. This is a solved, previously-shipped bug (see `next-jd.mjs`'s own comments) — do not reintroduce it.

**Report format:** v1 JSON frontmatter + narrative body (`schema: "trajecktory-report/v1"`), saved to `reports/{num}-{company-slug}-{YYYY-MM-DD}.md`. Full spec and Output Contract: [`modes/oferta.md`](oferta.md) and [`templates/report-schema-v1.md`](../templates/report-schema-v1.md). Populate the optional sections too (`customizationCV`, `customizationLI`, `starStories` with a `leadStory`, `legitimacy`) — the dashboard drawer reads them directly, not just the score.

**Recording the evaluation:** append ONE nine-column TSV line to `batch/tracker-additions/{num}-{company-slug}.tsv` (format in `AGENTS.md`'s TSV section). **Never edit `data/applications.md` directly** — `merge-tracker.mjs` folds tracker-additions in.

**Source tagging (controls auto-discard):** a role the user pasted or picked themselves (not found via `data/pipeline.md`) gets `[self-sourced] ` prefixed on the tracker note, which exempts it from the low-score auto-discard. A role that came through the scanner needs no prefix. `merge-tracker.mjs` enforces this deterministically regardless of what you write, so when unsure, tag it — see `modes/auto-pipeline.md` Step 0 for the full source-detection rule.

**Checking the pipeline row off:** if your invoking prompt says not to edit `data/pipeline.md`, don't — this is handled after the run by [`lib/pipeline.mjs`](../lib/pipeline.mjs)'s deterministic reconcile, which is CRLF-safe and reads both merged and still-staged evaluations, unlike a prose self-edit. If you are running interactively with no such instruction, flip the row's `- [ ]` to `- [x]` yourself once its report is fully written.

## Step 3 — Parallelism

**Default: run inline, one URL at a time. Do not spawn subagents or background agents.** Dashboard-driven runs on the shared Claude subscription explicitly forbid this (parallel agents trip the plan's usage limit) — follow that instruction if given. **Exception:** if your invoking prompt explicitly says this run is billed to the user's own API key and may parallelize (the dashboard's "power" path), you may launch bounded parallel agents across the batch, still respecting any batch-size cap you were given.

## Step 4 — Summary

When done (or when you hit your batch cap), show a summary table:

```
| # | Company | Role | Score | Report |
```

If 3+ roles scored >= 4.0, send a push notification: `"Pipeline done: {N} evaluated — {top company} {top score}[, {2nd}...] | run /trajecktory apply to proceed"` (under 160 chars, PushNotification tool, status: "proactive"). If nothing scored >= 4.0: `"Pipeline done: {N} evaluated — no strong matches (best: {score})"`.

## Sync check (interactive runs)

Before processing anything, run `node cv-sync-check.mjs` and warn the user if it reports drift.
