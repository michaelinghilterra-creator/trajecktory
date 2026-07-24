# trajecktory Report Schema — v1

The v1 standardized report format that powers the dashboard drawer's right-side panel.

## Why this exists

The legacy report format is freeform markdown with `## A)` … `## G)` block headings.
The dashboard parser ([`parser.mjs`](../dashboard-web/server/parser.mjs), ~1300 lines of regex)
tries to extract structured data from prose. When agents write `## Block A —` or `## A.`
instead of `## A)`, sections vanish from the drawer.

v1 inverts the contract: **structured data goes in JSON frontmatter; the markdown body is
purely narrative** for the "Full Report" tab. No regex scraping, no drift.

## File layout

```
---
<json object — see schema below>
---
# Narrative body in markdown
...
```

The frontmatter is **JSON between two `---` lines** (not YAML). Reasons:
- No new dependencies — `JSON.parse()` works.
- Matches the JSON-emission pattern agents already use in this codebase for cover
  letters and tailored CV summaries.
- Unambiguous nested arrays/objects.

The body below the closing `---` is rendered verbatim by the existing markdown→HTML
converter for the Full Report tab. The structured tabs read **only** from frontmatter.

## Required top-level fields

| Field | Type | Notes |
|---|---|---|
| `schema` | string | Must be `"trajecktory-report/v1"`. |
| `id` | integer | Application id (matches `applications.md` row). |
| `company` | string | |
| `role` | string | |
| `date` | string (YYYY-MM-DD) | |
| `url` | string | JD URL. |
| `jdSnapshot` | string | Relative path to the saved posting text, e.g. `"jds/912-example-co.md"`. A posting is taken down the day it is filled, so the URL alone is worthless by the time a later interview round comes around. Write it for every evaluation. The dashboard reads it for the Posting tab and refuses any path outside `jds/`. |
| `score` | number | Overall 0–5 headline. **Derived** by `lib/score.mjs` from the keyed `globalScore` dimensions + `config/profile.yml` weights, not authored. See **Derived vs legacy score**. |
| `legitimacy` | object | See **Legitimacy** below. |
| `domain` | string | E.g. `"AI/ML Observability, B2B SaaS"`. Used by the sector classifier. |

## Optional sections (omit when not generated)

### Role summary
```json
"summary": {
  "archetypeDetected": "Director / VP of Revenue Operations",
  "function": "Revenue Operations",
  "seniority": "VP (reports to President)",
  "remote": "On-site required — SF Bay Area",
  "teamSize": "Cross-functional across Sales, Marketing, CS",
  "compStated": "$250,000–$350,000 total compensation",
  "tldr": "VP-level RevOps leader to own KPIs...",
  "companyBrief": "Series C, $135M+ funded. 150+ enterprise customers..."
}
```

### Recommendation
```json
"recommendation": "Strong archetype and comp alignment, but SF on-site is a hard barrier..."
```

### Keywords
```json
"keywords": ["revenue operations", "MEDDPICC", "Salesforce", ...]
```

### Global score breakdown (the dimensions the headline is derived from)

The model rates each dimension 0–5 **with the evidence for that rating** (judgment is
what the model is good at). It does **not** author the headline `score`; the
headline is DERIVED by `lib/score.mjs` (`deriveScore`) as the weighted average of
these dimensions minus a red-flag penalty. Weights live in `config/profile.yml`
(`scoring.weights`). Give each entry a stable `key` so the code can match it to a
weight; a `dim` label and `evidence` string are for display.

```json
"globalScore": [
  { "key": "fit",       "dim": "Fit / CV Match",        "val": 4, "max": 5, "evidence": "Ran carrier scorecards across EMEA + LATAM at Northwind; the JD's BI stack lines up" },
  { "key": "northStar", "dim": "North Star Alignment",  "val": 5, "max": 5, "evidence": "Matches the candidate's top target archetype" },
  { "key": "level",     "dim": "Level Match",           "val": 4, "max": 5, "evidence": "JD asks VP; the candidate sits Director/Senior Director. Title stretch, scope fits" },
  { "key": "comp",      "dim": "Comp",                  "val": 3, "max": 5, "evidence": "Band clears the floor, trails the ceiling" },
  { "key": "location",  "dim": "Location / Logistics",  "val": 5, "max": 5, "evidence": "Remote, US time zones" },
  { "key": "redFlags",  "dim": "Red Flags",             "val": 5, "max": 5, "evidence": "Clean: fresh posting, funded round, scoped mandate" }
]
```

**Canonical keys** (match `SCORE_DIMENSIONS` / `RED_FLAGS_KEY` in `lib/score.mjs`):
`fit`, `northStar`, `level`, `comp`, `location` are the weighted positive
dimensions; `redFlags` is a **penalty** rated 0–5 where **5 = clean, 0 = severe**
(NOT a negative value; it subtracts up to `scoring.redFlagPenalty` points after the
average). `max` is per-dimension (usually 5). Weights renormalize over whichever
dimensions are present, so omitting one (e.g. `location` for a remote-anywhere role)
is fine.

Legacy reports predate this: their entries have no `key` (labels like
`"Cultural Signals"`, and `Red Flags` stored as a negative `val`). Those are NOT
re-derived. See **Derived vs legacy score** below.

### Derived vs legacy score
```json
"score": 4.1,
"scoreSource": "derived",
"scoreBasis": {
  "weights": { "fit": 0.35, "northStar": 0.25, "level": 0.15, "comp": 0.15, "location": 0.10 },
  "contributions": [
    { "key": "fit", "val": 4, "weight": 0.35, "points": 1.4 }
  ],
  "penalty": 0,
  "weightedAverage": 4.1
}
```
- `scoreSource`: `"derived"` (headline computed by `deriveScore` from the keyed
  dimensions above) or `"legacy"` (authored under the old rubric). **Absent means
  legacy**: old reports are read as legacy without being rewritten, and their
  authored number is preserved, never silently recomputed.
- `scoreBasis`: the derivation snapshot written by the compute step, so a derived
  headline stays traceable to the exact weights and per-dimension points it used
  even if the weights change later.
- `score` (top-level, required): for a derived report this is what `deriveScore`
  produced; for a legacy report it is the authored number. The drawer marks legacy
  scores so the two are never mistaken for the same thing.
- `scoreCeiling` (optional, 0–5): a HARD cap. Some blockers must keep the headline
  low no matter how well the rest fits (a location the user will not work, visa they
  cannot get, a hard requirement they plainly lack). A 10%-weighted Location
  dimension cannot enforce that, so the eval sets `scoreCeiling` and `compute-scores`
  applies `min(derived, ceiling)`. When it bites, `scoreBasis.ceilingApplied` is true.

The derived fields are written by **`compute-scores.mjs`**, not by the eval model:
the model emits the keyed `globalScore` dimensions (with evidence) and an optional
`scoreCeiling`; running `node compute-scores.mjs <report> --apply` computes `score`,
`scoreSource`, and `scoreBasis`. The model never authors the headline.

### CV match
```json
"cvMatch": [
  {
    "req": "10+ years RevOps/SalesOps in B2B SaaS",
    "evidence": "8 years at Northwind Logistics; prior 6+ years enterprise sales...",
    "strength": "strong",
    "note": "optional refinement"
  }
]
```
`strength`: one of `"strong"` | `"moderate"` | `"weak"`.

### Gaps
```json
"gaps": [
  {
    "gap": "Marketing automation (Marketo/HubSpot)",
    "blocker": "Nice-to-have",
    "mitigation": "Adjacent: enterprise BI governance demonstrates infra sophistication"
  }
]
```

### Level match
```json
"levelMatch": {
  "jdLevel": "VP",
  "naturalLevel": "Director / Senior Director",
  "verdict": "Title stretch; scope match"
}
```

### Sell-senior plan
```json
"sellSenior": [
  {
    "claim": "Open with scope, not title",
    "proof": "Owned carrier analytics across EMEA + LATAM — 22 dashboards, 4 lanes, $260M managed spend",
    "phrase": "The title was Director; the scope was VP."
  }
]
```

### Downlevel plan
```json
"downlevelPlan": "Accept Senior Director if comp ≥ $200K base..."
```

### Comp
```json
"comp": {
  "stated": "$250,000–$350,000",
  "sources": [
    { "src": "Salary.com (SF, 2026)", "data": "VP RevOps ~$346K avg", "note": "SF premium baked in" }
  ],
  "score": 5,
  "note": "recorded, not scored",
  "walkaway": 111,
  "verdict": "Meets target at floor, exceeds at ceiling",
  "market": "VP RevOps at AI-native Series C is high-demand, low-supply"
}
```
`walkaway` is an integer (thousands USD). It is **copied from
`compensation.minimum` in `config/profile.yml`, never estimated** — the 111 above is a
deliberately implausible placeholder so this example is never mistaken for a real floor.
`compensation.target_range` is the aspiration and is a different number: pay below the
floor sets a `scoreCeiling`, pay merely below the aspiration does not.

The comp dimension carries weight 0, so it is rated and displayed but contributes no
points to the headline. `note` is rendered beside the dimension label in the drawer.

### Customization
```json
"customizationCV": [
  { "section": "Professional Summary", "current": "Opens with 'Analytics...'",
    "change": "Reframe: 'Revenue operations executive...'", "why": "Lead with RevOps identity" }
],
"customizationLI": [ /* same shape */ ]
```

### Interview
```json
"starStories": [
  { "title": "First EMEA Carrier Scorecard", "req": "Establish unified carrier KPIs",
    "S": "...", "T": "...", "A": "...", "R": "..." }
],
"leadStory": {
  "title": "Scorecard + tender baseline",
  "reason": "Shows org change at 200+ carriers, ops thinking, systems builder",
  "script": "Optional verbatim opening line"
},
"redFlagQs": [
  { "q": "You're a Director. Why apply for VP?",
    "behind": "Recruiter wants title-vs-scope honesty",
    "a": "Scope, not title. I owned carrier analytics for $260M of managed spend..." }
]
```

### Legitimacy
```json
"legitimacy": {
  "tier": "High Confidence",
  "conclusion": "Verified Series C, posting freshness confirmed",
  "signals": [
    { "signal": "Description quality", "finding": "States $120K–$165K range, names reporting line", "good": true },
    { "signal": "Reposting detection", "finding": "First appearance in scan-history.tsv", "good": true }
  ]
}
```
`tier`: one of `"High Confidence"` | `"Proceed with Caution"` | `"Suspicious"`.

## Backward compatibility

The dashboard server checks for the v1 frontmatter delimiter on every `.md` it serves:

- **v1 detected** → server parses frontmatter directly into the `cs` object; markdown
  body (after the closing `---`) is sent as-is to the Full Report tab.
- **No frontmatter** → falls back to legacy `parser.mjs`. Old reports keep working.

Migration is therefore opt-in per file. Once all reports are v1, `parser.mjs` can be deleted.

## Future: v2

When the schema needs a breaking change, bump to `"trajecktory-report/v2"`. The server
dispatches on the `schema` string, so v1 and v2 reports can coexist indefinitely.
