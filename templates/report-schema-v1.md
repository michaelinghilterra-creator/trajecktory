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
| `score` | number | Overall 0–5 score. |
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

### Global score breakdown
```json
"globalScore": [
  { "dim": "CV Match", "val": 4, "max": 5 },
  { "dim": "North Star Alignment", "val": 5, "max": 5 },
  { "dim": "Comp", "val": 5, "max": 5 },
  { "dim": "Cultural Signals", "val": 2, "max": 5 },
  { "dim": "Red Flags", "val": -3, "max": 5 }
]
```
Negative values render as red bars. `max` is per-dimension (usually 5).

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
    "proof": "Owned BI across NA + AMEA — 11 reports, 4 regions, $400M ARR",
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
  "walkaway": 200,
  "verdict": "Meets target at floor, exceeds at ceiling",
  "market": "VP RevOps at AI-native Series C is high-demand, low-supply"
}
```
`walkaway` is an integer (thousands USD).

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
  { "title": "First EMEA Carrier Scorecard", "req": "Establish unified revenue KPIs",
    "S": "...", "T": "...", "A": "...", "R": "..." }
],
"leadStory": {
  "title": "MEDDPICC + KPI baseline",
  "reason": "Shows org change at 150+ sellers, RevOps thinking, systems builder",
  "script": "Optional verbatim opening line"
},
"redFlagQs": [
  { "q": "You're a Director. Why apply for VP?",
    "behind": "Recruiter wants title-vs-scope honesty",
    "a": "Scope, not title. I owned BI/RevOps for $400M ARR..." }
]
```

### Legitimacy
```json
"legitimacy": {
  "tier": "High Confidence",
  "conclusion": "Verified Series C, posting freshness confirmed",
  "signals": [
    { "signal": "Description quality", "finding": "States $250K–$350K range, names reporting line", "good": true },
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
