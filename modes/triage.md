# Mode: triage — Fast Fit Scoring (Haiku)

Lightweight first-pass scoring of the top pending postings. Produces a **0.0-5.0
fit score** and a **one-line rationale** per role. This is NOT a full evaluation:
no A-G report, no PDF, no tracker entry. The deep Sonnet/Opus evaluation happens
separately (Evaluate / deep dive).

> **Model:** the dashboard forces `--model haiku` for this mode. Haiku was
> calibrated against Sonnet on this exact task and is faithful (r≈0.89, 100% recall
> of strong roles) — but ONLY when the anti-inflation discipline below is applied.
> A generic, un-calibrated prompt makes Haiku score everything 4+. Do not skip the
> calibration rules.

## Invocation context

This file is shared by an interactive `/trajecktory triage` (typed directly in
a terminal) and a dashboard-driven headless run (`claude -p` with constraints
appended after this file's own instructions). **Where they conflict, the
appended constraints win** — this applies most to the Output section below:
a dashboard-driven run is told to emit JSON instead of writing the file
itself, and that instruction overrides this file's own write-it-yourself
default.

## Inputs (read first)
- `cv.md` — candidate evidence for the CV-match read
- `modes/_profile.md` — target archetypes, level, deal-breakers, location policy
- `config/profile.yml` — comp band, location policy, archetype list
- `data/pipeline.md` — pending postings as flat `- [ ] {url} | {company} | {title}` rows (no section headers), ordered best-fit first

## What to score
Take the **TOP N unchecked URLs** (default 15) from the top of the pending list. **Before scoring, read `data/triage-results.tsv` (if it exists) and skip any URL that already has a row there — it was scored by a prior run — and take the next unchecked URL instead.** Nothing checks off a pipeline row after triage, so without this step every run re-reads the exact same top-of-file URLs forever and never reaches the rest of the queue. This is the single most important rule in this file: getting it wrong silently wastes an entire run's cost on roles you already scored.

**Match on the exact URL, never on company name alone.** A company can post several genuinely different roles at once (multiple titles, multiple cities) — each is a separate posting with its own row in `data/pipeline.md` and needs its own score. Seeing "Acme Corp" already has a row in `triage-results.tsv` is NOT a reason to skip a different Acme Corp URL/title. Compare the full URL (or the exact title, for a `local:jds/…` snapshot) — not just the employer name.
For each URL that survives that filter:
1. Read the JD.
   - **If the row is a `local:jds/…` snapshot path (NOT an `http(s)` URL), read that file directly with the Read tool. Do NOT WebFetch it** — it is a local file, not a web address, so a fetch fails and you would wrongly skip a JD that is sitting readable on disk. `resolve-jds.mjs` writes these snapshots for JS-rendered (SPA) postings precisely so you can read them directly; when the queue is mostly `local:jds/…` rows, treating them as un-fetchable makes an entire run score nothing.
   - Otherwise (an `http(s)` URL), read it with **WebFetch** first, **WebSearch** as a fallback.
   - If it genuinely cannot be read either way, skip it (do not guess).
2. Score FIT **0.0-5.0** (one decimal) using the rubric + anti-inflation calibration below.
3. Write a **one-sentence rationale** naming the main fit driver or gap.

## Scoring rubric
Weigh, in order of importance:
- **North-Star archetype + level fit (BIGGEST factor):** match against the HIGH/MEDIUM archetypes and the Director/VP level in `_profile.md`. A Manager/IC/below role is a weak fit; C-suite is the wrong level.
- **CV evidence match** (skills / experience / proof points from `cv.md`).
- **Location policy** (`profile.yml` `location.policy`): fully remote is always fine. Onsite/hybrid is fine inside the approved DFW-metro list. A role OUTSIDE that list is a hard no **only if it REQUIRES onsite/hybrid attendance with no remote option.** If the posting offers a remote / "Remote U.S." option, OR makes onsite conditional on living near an office (e.g. "hybrid 50% if within commuting distance"), it is NOT a hard no — the candidate takes the remote option, so score it on fit and treat the hybrid clause as ~3.0, not a deal-breaker. Read the location line carefully: a listed "Remote" option beside NYC/other offices means remote is available.
- **Comp** vs the target band; comp not stated = neutral.
- **Red flags / deal-breakers.**

**HARD DEAL-BREAKERS (cap the score at 2.5 or below):**
- Pure individual-contributor or quota-carrying field-sales roles.
- Dropped tracks: Sales Development (SDR/BDR) leadership and Business Development / Corporate Development.
- Onsite or hybrid **required** outside the approved DFW-metro list **with no remote option** (a stated "Remote U.S." / remote option, or onsite that is only conditional on living near an office, means this deal-breaker does NOT apply).
- Roles that are mostly marketing, finance/FP&A-only, product management, or engineering.

**Anchors:** 4.5+ strong (apply now) · 4.0-4.4 good (worth applying) · 3.5-3.9 decent-not-ideal · below 3.5 recommend against.

**ANTI-INFLATION (critical):** Across this candidate's history only about **1 in 5 roles is a genuine 4.0+**. Do NOT inflate. Default into the **2.5-3.5** range unless the role clearly hits the right archetype AND level AND location. A RevOps/Analytics-sounding title alone is NOT enough for a 4 — check level, function, location, and real CV evidence.

## Output — `data/triage-results.tsv`

**If your invoking prompt tells you to output your results as JSON between marker lines instead of writing the file yourself (a dashboard-driven run always does this), follow that instead of the rest of this section.** That is the correct, current path: the dashboard server appends deterministically after you finish, which is what actually persists reliably. Two real incidents on 2026-08-06 came from an agent writing this file directly across a long run — once as a silent failure (the sandbox denies `Bash(cat:*)`, and the Write/Edit fallback was inconsistent), once as a silent **data loss** (a run held a stale early-turn snapshot of the file in context and overwrote ~108 rows other runs had appended in the meantime by writing that snapshot back at the end). Do not reintroduce a direct write from a dashboard-driven run.

**Only if you are running interactively with no such instruction** (a bare `/trajecktory triage` typed directly in a terminal, no dashboard involved): append one tab-separated line per scored role yourself. If the file does not exist, create it with this header row first:

```
url	company	title	score	rationale	date
```

- `score` — `X.X` (e.g. `4.2`)
- `rationale` — one sentence, no tabs
- `date` — today, `YYYY-MM-DD`

Use the Write or Edit tool directly on `data/triage-results.tsv`. Do NOT use `Bash(cat > ...)` or a heredoc. Read the file ONCE, immediately before writing, not earlier in the session — batch all scored roles into ONE Write/Edit call at the end rather than one call per role, and never rely on an earlier Read's content when composing that final write.

**Do NOT** write a report, generate a PDF, write a `batch/tracker-additions/` TSV, or check off the `data/pipeline.md` checkboxes. Triage is non-destructive — the deep evaluation owns those.

## Dashboard constraints
Invoked headless by the dashboard. Work **inline** (no subagents, no Playwright). Stop after the top N. When done, report how many roles were scored.
