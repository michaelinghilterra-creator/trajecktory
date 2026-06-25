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

## Inputs (read first)
- `cv.md` — candidate evidence for the CV-match read
- `modes/_profile.md` — target archetypes, level, deal-breakers, location policy
- `config/profile.yml` — comp band, location policy, archetype list
- `data/pipeline.md` — pending postings under "Pendientes" as `- [ ] {url} | {company} | {title}`, ordered best-fit first

## What to score
Take the **TOP N unchecked URLs** (default 15) from the top of the pending list. For each:
1. Read the JD with **WebFetch** first, **WebSearch** as a fallback. If it cannot be read, skip it (do not guess).
2. Score FIT **0.0-5.0** (one decimal) using the rubric + anti-inflation calibration below.
3. Write a **one-sentence rationale** naming the main fit driver or gap.

## Scoring rubric
Weigh, in order of importance:
- **North-Star archetype + level fit (BIGGEST factor):** match against the HIGH/MEDIUM archetypes and the Director/VP level in `_profile.md`. A Manager/IC/below role is a weak fit; C-suite is the wrong level.
- **CV evidence match** (skills / experience / proof points from `cv.md`).
- **Location policy** (`profile.yml` `location.policy`): fully remote is always fine; onsite/hybrid is acceptable only in the approved DFW-metro list; onsite/hybrid required outside it is a hard no.
- **Comp** vs the target band; comp not stated = neutral.
- **Red flags / deal-breakers.**

**HARD DEAL-BREAKERS (cap the score at 2.5 or below):**
- Pure individual-contributor or quota-carrying field-sales roles.
- Dropped tracks: Sales Development (SDR/BDR) leadership and Business Development / Corporate Development.
- Onsite or hybrid required outside the approved DFW-metro list.
- Roles that are mostly marketing, finance/FP&A-only, product management, or engineering.

**Anchors:** 4.5+ strong (apply now) · 4.0-4.4 good (worth applying) · 3.5-3.9 decent-not-ideal · below 3.5 recommend against.

**ANTI-INFLATION (critical):** Across this candidate's history only about **1 in 5 roles is a genuine 4.0+**. Do NOT inflate. Default into the **2.5-3.5** range unless the role clearly hits the right archetype AND level AND location. A RevOps/Analytics-sounding title alone is NOT enough for a 4 — check level, function, location, and real CV evidence.

## Output — `data/triage-results.tsv`
Append one tab-separated line per scored role. If the file does not exist, create it with this header row first:

```
url	company	title	score	rationale	date
```

- `score` — `X.X` (e.g. `4.2`)
- `rationale` — one sentence, no tabs
- `date` — today, `YYYY-MM-DD`

**Do NOT** write a report, generate a PDF, write a `batch/tracker-additions/` TSV, or check off the `data/pipeline.md` checkboxes. Triage is non-destructive — the deep evaluation owns those.

## Dashboard constraints
Invoked headless by the dashboard. Work **inline** (no subagents, no Playwright). Stop after the top N. When done, report how many roles were scored.
