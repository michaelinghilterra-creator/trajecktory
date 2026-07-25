# trajecktory Run Sheet Schema - v1

The v1 format that powers the dashboard's **Interview > Live** board: a click-a-cue,
read-the-spoken-answer instrument you keep on screen *during* an interview.

## Why this exists

A run sheet is **not** a cheat sheet. They are two products with two lifecycles:

| | Prep file (`*-round-N-*.md`) | Run sheet (`*-round-N-*.run.md`) |
|---|---|---|
| **Purpose** | Durable research. Read and printed before the call. | Performance script. On screen during the call. |
| **Shape** | Narrative prose, sections §0-§10. | Cues to spoken answers. |
| **Lifecycle** | Hand-revised as intel drops, over weeks. | Compiled from the prep file, tuned in the last hour. |
| **Regeneration** | Never clobbered. | Safe full-file overwrite. |
| **Read by** | A human. | The board, then a human at 2 feet, mid-sentence. |

The run sheet is a **compiled output** of the prep file. It lives beside it as a sidecar
so regenerating the board can never destroy hand-edited research, and so ~40KB of JSON
never sits on top of a document you actually read.

**Prep files never migrate.** A round with no `.run.md` simply has no board. That is a
correct state, not a debt.

## The worked examples

One per shape. Both are complete, valid v1 files:

| File | Template | Rendered |
|---|---|---|
| [`runsheet-example.run.md`](runsheet-example.run.md) | `hm-round` | 15 cues, 12 answers, 6 sections |
| [`runsheet-example-screen.run.md`](runsheet-example-screen.run.md) | `screen` | 18 cues, 17 answers, 6 sections |

Every rule below is visible in one or both, and the counts quoted in this spec are their
real rendered output. The `hm-round` file is **abridged on purpose**: 15 cues where a full
one runs ~40-45, so it stays readable in one sitting. It demonstrates the *shape*, not the
target size. The `screen` file is full size, because a screen board really is that small.

Both are the same fictional application one round apart (Northwind Logistics #417), which
makes the difference between the shapes legible side by side.

> **Every shape ships an example, and that is a rule, not a convenience.** While only the
> `hm-round` file existed, every claim this spec made about the `screen` shape was measured
> off a real board in the author's gitignored `interview-prep/`, because that was the only
> screen board in existence. A spec sourced from a private file cannot be checked by its
> readers and quietly publishes whatever it measured. When `final-loop` is built, it ships
> an example in the same commit.

## File layout

```
interview-prep/{Company}/{company-slug}-round-{N}-{descriptor}.run.md

---
<json object - see schema below>
---
# Debrief (narrative, written after the call)
...
```

Frontmatter is **JSON between two `---` lines** (not YAML), same as
[`report-schema-v1.md`](report-schema-v1.md): `JSON.parse()` works, no new deps.

The body below the closing `---` is the **debrief**: what landed, what did not, open
questions, next-round intel. It is why this file is `.md` and not `.json`. The board
reads **only** frontmatter.

## Required top-level fields

| Field | Type | Notes |
|---|---|---|
| `schema` | string | Must be exactly `"trajecktory-runsheet/v1"`. Loaders dispatch on an **exact string match**, never a regex. |
| `id` | integer | Application id (matches the `applications.md` row and the report). |
| `company` | string | Display name, e.g. `"Northwind Logistics"`. |
| `role` | string | |
| `stage` | string | Canonical tracker status from `templates/states.yml`, e.g. `"1st Interview"`. |
| `round` | integer | The **company's** process ordinal, e.g. `2`. |
| `template` | string | `"screen"` \| `"hm-round"` \| `"final-loop"`. |
| `prep` | string | Basename of the sibling prep file. |
| `generated` | string (YYYY-MM-DD) | |
| `sections` | array | The board. See below. |
| `answers` | object | Keyed answer bodies. See below. |

### `stage` and `round` are BOTH required and neither derives the other

The example's status is `1st Interview` while its file is `round-2`, because that company
opens with a TA screen. That the two happen to be off by exactly one is a **coincidence of
a 3-round process**. A company that opens with a hiring-manager round writes `round-1`
while the tracker still says `Phone Screen`.

> **Never compute one from the other at render time.** Carry both. The picker matches on
> `stage`; the file and the header display `round`.

## `session`

Optional. Renders the board header.

```json
"session": {
  "who": "Dana Whitfield, VP of Global Logistics",
  "when": "2026-01-16T10:30:00-06:00",
  "minutes": 30,
  "format": "Zoom",
  "rule": "One story per job. Click a cue. Eyes up."
}
```

## `sections`

Ordered. Each renders one panel on the board.

```json
"sections": [
  { "id": "opening", "n": 1, "title": "Opening and why",
    "cues": [
      { "cue": "First 15 seconds",              "answer": "opener" },
      { "cue": "Tell me about your background", "answer": "frame", "label": "90-sec frame" }
    ] },
  { "id": "hero",  "n": 2, "title": "Hero story, use once", "style": "hero",  "cues": [ ... ] },
  { "id": "blank",          "title": "Blank? Bucket it",    "style": "panic", "cues": [ ... ] },
  { "id": "tradeoff", "n": 4, "title": "Tradeoff and tough", "cameraGap": true, "cues": [ ... ] }
]
```

| Field | Type | Notes |
|---|---|---|
| `id` | string | Stable slug. |
| `n` | integer, optional | Display number. Omit for panels outside the chronology (the blank panel has no `n`). |
| `title` | string | |
| `style` | string, optional | `"hero"` (amber) \| `"panic"` (green) \| `"rules"` (red). Default: normal. |
| `cameraGap` | bool, optional | Insert the camera clearance gap **above** this panel. |
| `cues[].cue` | string | The trigger text, left column. |
| `cues[].answer` | string | **A key into `answers{}`.** Not inline content. |
| `cues[].label` | string, optional | Right-column text. Defaults to the answer's `title`, or the story-bank title. |

### Why `answer` is a key and not inline content

This indirection is the whole schema. The example board has **15 cues but only 12 unique
answers**, because one answer is legitimately reachable from several cues (a behavioral
prompt and the panic net's bucket both want the same story).

Inlining would duplicate prose *and* make collision detection impossible.

## `answers`

```json
"answers": {
  "hero": {
    "title": "HERO: The carrier scorecard rebuild",
    "tag": "2.5 to 3 min",
    "story": 1,
    "hero": true,
    "useOnce": true,
    "seconds": 165,
    "spoken": [
      "Contoso Freight had no shared carrier scorecard. Eleven carriers, four regional teams, and each team ranked them off a spreadsheet it maintained itself...",
      "Two moves. First, I moved measurement to the source: on-time and damage came straight off the dock scans..."
    ],
    "notes": [
      "ONLY for \"biggest build / most impactful.\" Never spend it on a behavioral.",
      "This is the story they retell to the panel. Land it once, cleanly."
    ]
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `title` | string | Headline in the answer box. |
| `tag` | string, optional | Freeform *delivery intent*, rendered verbatim, e.g. `"only if they raise it"`, `"deliver near-verbatim"`. **Must not assert any derivable fact** - see below. |
| `story` | integer \| null | **Story-bank id.** Load-bearing. See below. |
| `hero` | bool, optional | Exactly one answer per run sheet may set this. |
| `useOnce` | bool, optional | Authored intent. The renderer ORs this with derived collisions. |
| `seconds` | integer, optional | Spoken length. Feeds the timing budget. |
| `spoken` | array of strings | **Required.** One string per paragraph. No cap - see Hard caps. |
| `notes` | array of strings, optional | Delivery sidebar: traps, warnings, what to land. |

### `tag` must never assert a derivable fact

`tag` is rendered **verbatim**, so anything typed there can silently contradict what the
renderer computes. Never type into `tag`:

- **"use once"** - the renderer appends it from `useOnce || derivedCollision`.
- **Any home or collision count** ("2 homes", "3 cues", "also used in X").
- **Hero status** - derived from `hero: true`.
- **Round or stage** - derived from `round` / `stage`.

This is not hypothetical. Author `"tag": "2 homes · angle it"` onto the example's
`definition` answer and the board renders "2 homes" one line above its own derived
warning saying **3**, because `definition` is reachable from three cue rows. The authored
count is the one that is wrong, and it goes wrong the moment a cue is added or moved,
which is exactly when nobody re-reads the tag. An authored tag that claims a home count
will eventually contradict the derived warning printed next to it.

**The rule generalizes:** if the renderer can compute it, `tag` must not claim it. `tag`
carries only how to *deliver* the answer ("land it, then pause"), never facts about the
board's shape.

### `story` is the load-bearing field

Not every answer has one. `opener`, `qScope`, and `toolGap` are not stories, so they carry
`"story": null` or omit it. But every answer drawn from
[`story-bank.md`](../interview-prep/story-bank.md) **must** carry its integer id.

Two reasons, and the second is the one that matters:

1. `label` and story titles derive from the bank instead of being retyped.
2. **Collisions are only visible at the story level.** Two different answer keys can tell
   the *same story* from two angles: an "impossible deadline" answer and a "shipped
   something you weren't happy with" answer can both be story #3, one framed on the
   deadline and one on the compromise. Key-level dedupe cannot see that. Only `story` can.

A hand-maintained warning panel names the collisions someone noticed on the day they wrote
it, and every later edit silently invalidates the count. Boards drift; counts written by
hand do not follow. That is why collisions are derived, never authored.

### The hero's story is EXCLUDED from the plain collision count

Two derived rules can both fire on the same story, and the spec must say which owns it:

1. **Collision:** group `answers` by `story`, count cue rows, `>1` is an overlap.
2. **Hero integrity:** warn if a cue outside the hero section points at the hero's story.

When an answer outside the hero section honestly carries the hero's id (a behavioral
answer carved from the hero's story is the common case), both rules match it. A literal
implementation fires **both** and reports the same story twice: once as a generic overlap
and once as a hero warning.

> **Rule: skip the hero's `story` when counting plain collisions.** Hero integrity owns
> it, and says something strictly more useful ("using this burns the hero") than a generic
> overlap warning.

The two rules are different *kinds* of warning, not two counts of one thing. A hero
warning was never a collision at all. `render-runsheet.mjs` implements the skip: re-point
the example's `adoption` answer at story 1 (the hero's) and it derives exactly 2
collisions + 1 hero warning, with story #1 never appearing as a plain overlap.

Do **not** set `story: null` on an answer just to silence the double-report. That would
make hero integrity unable to fire at all, and the "never spend the hero on a behavioral"
check - the single most valuable warning on the board - would be unrecoverable.

### Markdown bold, never HTML

Emphasis inside `spoken` uses `**double asterisks**`. Never raw `<b>`, which forces
`dangerouslySetInnerHTML` in the renderer. The board splits on `/\*\*(.+?)\*\*/`.

## `guardrails`

Authored, factual, non-derivable. Renders in the red panel **below** any derived
collision warnings.

```json
"guardrails": [
  "Q3 numbers ONLY. Q4 is not public until the February call",
  "Never bluff the TMS. Name the gap, reframe to the layer above it",
  "Do not raise comp in this round. It belongs with the recruiter"
]
```

## The blank-recovery net is a SECTION, not a separate field

**Every board MUST carry exactly one `style: "panic"` section**, regardless of `template`.
It is the net that makes a wrong cue guess survivable, and it is the reason "confidence,
not exhaustiveness" is a safe premise: guess wrong and you just don't click it; blank with
no net and you are stranded.

```json
{ "id": "blank", "title": "Blank? Bucket it, grab the default", "style": "panic",
  "cues": [
    { "cue": "The stall line + universal opener",         "answer": "blank" },
    { "cue": "Failure, or a call you got wrong",          "answer": "routingRule" },
    { "cue": "People, alignment, or conflict",            "answer": "definition" },
    { "cue": "Influence, driving change, disagreeing up", "answer": "definition" }
  ] }
```

> **Retired: the top-level `fallbacks` array.** v1 briefly modelled the net as a separate
> `fallbacks: [{bucket, answer}]` field *and* showed a `style:"panic"` section in the same
> spec, never saying which one rendered. A board that authored `fallbacks` and no panic
> section left its fallback stories reachable by **nothing** under any renderer that draws
> only `sections` (which is every sane renderer), and the net silently did not exist.
> A board whose safety net is invisible is worse than one with no net, because you plan
> around having it.
>
> Buckets are cues. Cues live in sections. `fallbacks` bought nothing and cost the net.

The bucket cue text is the *question shape*, not a story title: you reach for it when you
blank, so it must be findable by feel ("Failure, or a call you got wrong"), not by
recalling which story you filed it under.

## Derived, never authored

The renderer computes these. Do **not** write them into the file:

| Derived | From |
|---|---|
| Collision / overlap warnings | Group `answers` by `story`; count cue rows per story; `>1` is an overlap. **Skip the hero's story** - hero integrity owns it. |
| The `· use once` tag suffix | `useOnce \|\| derivedCollision` |
| Hero integrity | Exactly one `hero: true`; warn if a cue outside the hero section points at the hero's `story`. |
| Default cue `label` | The answer's `title`, else the story-bank H3. |
| Round / stage header | `stage` + `round`, shown together, always. |
| Timing budget | `sum(seconds)` vs `session.minutes`. |
| Fit preflight | Measured `scrollHeight > innerHeight`. |

Reference implementation: [`render-runsheet.mjs`](../render-runsheet.mjs) (`derive()`).

## Hard caps

These are **not style preferences**. They are the no-scroll constraint on the **board
grid** expressed as numbers. The board is useless the moment it scrolls.

| Cap | Value | Why |
|---|---|---|
| Cues per board | **48** | Rows drive grid height. 45 fit on a 1440p display at 17px; 48 is the measured ceiling. |
| Sections per board | **8** | Panel chrome (heading + padding + margin) costs ~74px each. |

**There is deliberately no cap on `spoken` paragraphs.** An earlier version of this spec
capped them at 3 "as the no-scroll constraint expressed as a number." That was wrong, and
porting a real `hm-round` board proved it: a third of its answers exceeded the cap and the
hero needed six paragraphs. The reasoning was mis-derived. `spoken` renders inside the
answer overlay, which is `#detail{max-height:56vh}` with `.dbody{overflow-y:auto}` - a
container that **scrolls by design**. Capping it defended a constraint that field does not
have.

The real limit on `spoken` is human, not layout: you are reading it aloud at 2 feet
mid-sentence. Keep answers short because long ones do not get read, not because the box
cannot hold them. Use `seconds` to express that intent.

Boards are **stage-tuned**: sections are data, not hardcode. Sizes are measured off
shipped boards, counted as **chronology cues** (everything except the panic net, which is
a fixed ~4 and is mandatory everywhere).

> **These per-template sizes are ADVISORY, and deliberately so.** Only the global caps
> above (48 cues, 8 sections) are enforced; `verify-runsheets.mjs` does not check a board
> against the range for its own `template`, so a `screen` board carrying 45 cues passes.
> That is a decision, not an oversight (2026-07-24). Each range was measured off exactly
> ONE shipped board of that shape, and promoting a sample of one into a blocking check
> would fail boards for departing from a number that was never load-bearing — the same
> over-fitting the `spoken` cap already got wrong once. The global caps defend the real
> constraint, which is that the grid must not scroll. These ranges tell you what a
> well-shaped board has looked like. If a mis-shaped board ever actually causes a problem,
> tighten it then, with that board as the evidence.

| Template | Chronology cues (advisory) | Hero | Shape |
|---|---|---|---|
| `screen` | ~12-17 (+4 net = ~16-21 total) | **none** — the hero belongs to a later round | comp, location, timing, soft spots, your questions |
| `hm-round` | ~40-45 (+4 net = ~44-49 total) | exactly one | the behavioral bank, tradeoff probes, the hero |
| `final-loop` | not yet shipped | TBD | a panel round is a presentation; shape it when you build one |

## Validation

`verify-runsheets.mjs` checks the **frontmatter**, not the prose:

- `schema` is an exact string match (never a regex - a v2 file must not be fed to a v1 loader).
- Required fields present and correctly typed.
- Every `cues[].answer` resolves to a key in `answers{}`.
- **No orphan answers**: every key in `answers{}` is reachable from at least one cue.
- Every non-null `story` resolves to a real entry in `story-bank.md`.
- At most one `hero: true`.
- **Exactly one `style: "panic"` section.**
- Cue and section counts within caps.
- No raw `<b>` in `spoken` or `notes`.
- **No derivable fact asserted in `tag`** (`use once`, home/collision counts, hero, round, stage).

Run sheets are excluded from `verify-interview-prep.mjs`: they are compiled sidecars with
no §-sections, and its `inferStage()` would file every one as a legacy warning.

## Open before this schema can be called frozen

One gap remains. It is written down here because an unrecorded blocker is
indistinguishable from a resolved one: the count of what was outstanding had
already been lost once.

1. **`final-loop` is a legal `template` value with no defined shape.** The validator
   accepts it, the shape table says "not yet shipped / TBD", and there is no worked
   example. So a `final-loop` board would validate against a spec that says nothing
   about how many cues it may carry, whether it has a hero, or what its sections are.
   A shape with no shipped example is a shape whose spec is unverifiable, which is the
   same reasoning that put both current examples in `verify-runsheets.mjs`. Either
   build one and measure it, or drop `final-loop` from the enum until a panel round
   actually happens. **Build it the first time a real panel round lands**, then write
   this row from the board that was actually used, exactly as the other two rows were.

**Resolved 2026-07-24.**

- `stage` was typed as "any string", so a board carrying the retired generic
  `Interview`, or a typo, validated clean and was then never found by the picker that
  matches on it. It is now checked against the labels in `templates/states.yml`.
- The per-template cue budgets stay **advisory** and the shape table now says so. Each
  was measured off a single board, so enforcing them would fail boards for missing a
  number that was never load-bearing. The global caps already defend the constraint
  that matters. Revisit only if a mis-shaped board causes a real problem.

## Design principle

> **Confidence, not exhaustiveness.**

The board is a best guess at what is most likely to come up. A wrong guess is cheap: you
do not click it. The expensive failure is blanking with no net, which is why the
**`style:"panic"` section is mandatory** and why cue phrasing uses **your** shorthand
("Getting the field to do what they didn't want"), not a verbatim interview question.
Shorthand scans faster under pressure.
