# Mode: runsheet - Compile the Live Board

Compiles a **run sheet** from an existing prep file: the click-a-cue, read-the-spoken-answer
board the user keeps on screen *during* an interview.

**Invocation (pinned, both sides build to this):**

```
/trajecktory runsheet {Company} round {N}          e.g. /trajecktory runsheet Northwind Logistics round 2
/trajecktory interview-prep {Company} round {N}    e.g. /trajecktory interview-prep Northwind Logistics round 3
```

**Trigger phrases:** "make me a run sheet", "compile the board", "build the live board for round N",
"I want the on-screen cheat sheet for the Northwind call".

**The dashboard never generates this.** It hands the user a copy-paste prompt they run in their own
Claude Code. That is the established Launchpad division of labor (see `AGENTS.md`, "Launchpad -
Visual Onboarding"): the dashboard does deterministic work, the agent does generative work. If you
were invoked from a dashboard prompt, you are the generative half. Behave identically either way.

**This mode compiles. It does not research.** The prep file is the research. If the prep file does
not say it, the board does not say it. See [GROUNDING](#grounding---the-hard-rule).

**Output location:** the run sheet is written into the folder named by `outputs.interview_prep_dir`
in `config/profile.yml` (default `interview-prep/`), then into the **per-company subfolder** inside
it, as a **sibling of the prep file it was compiled from**. This is the same company-subfolder rule
`modes/interview-prep.md` and `modes/cheat-sheet.md` follow: derive `{Company Folder}` from the
company's display name as it appears in the report header / the `data/applications.md` company
column, strip trailing legal suffixes (`, Inc.`, `, LLC`, `, Corp.`, `Corporation`), replace any
Windows-forbidden path character (`\ / : * ? " < > |`) with a space, then trim. "Northwind Logistics,
Inc." to `Northwind Logistics`; a name with no suffix passes through unchanged. Never create a new
folder here: the prep file already lives in one, and the run sheet goes beside it. `story-bank.md`
stays at the top level of `interview-prep/`, never inside a company folder.

---

## ⚡ OUTPUT CONTRACT (READ FIRST)

The run sheet is **strict JSON frontmatter between two `---` lines, plus a `# Debrief` narrative
body**. Not YAML. Not freeform markdown. `JSON.parse()` must work on the frontmatter or the board
does not load at all.

**Authoritative spec:** [`templates/runsheet-schema-v1.md`](../templates/runsheet-schema-v1.md).
**Read it before you emit anything.** Every rule below is that spec applied to the write side; the
spec wins any disagreement.

**The worked example. Read it before you write. It is the format, not an illustration:**

| Example | Template | Shape |
|---|---|---|
| [`templates/runsheet-example.run.md`](../templates/runsheet-example.run.md) | `hm-round` | 15 cues, 12 answers, 6 sections, hero, mandatory panic net, 2 derived collisions |

It is **abridged on purpose**: a real `hm-round` runs ~40-45 chronology cues (Step 3), where the
example runs 11 plus the 4-cue net. It demonstrates the shape, the key indirection, and the derived
collisions in a file you can read in one sitting. Do not read its size as the target.

**The `screen` shape has no shipped file.** It is the same schema with a different layout: **no
hero**, ~12-16 chronology cues plus the mandatory 4-cue net across 5-6 sections, and panels for
comp/location/timing, soft spots, and questions to ask. Step 3 and Step 4 specify it in full.

The input shape you will be reading is the **prose prep file** that sits beside the run sheet as its
sibling (`{interview_prep_dir}/{Company Folder}/{company-slug}-round-{N}-{descriptor}.md`): the
§0-§10 narrative that `modes/interview-prep.md` produces.

**Skeleton (annotated below for you; the file you write is strict JSON with no comments):**

```markdown
---
{
  "schema": "trajecktory-runsheet/v1",  // exact string. Loaders match literally, never by regex.
  "id": 417,                            // application id == report number. Read it, never mint it.
  "company": "Northwind Logistics",     // display name, same as the tracker column
  "role": "Director of Revenue Operations",
  "stage": "1st Interview",             // canonical status from templates/states.yml
  "round": 2,                           // the COMPANY's process ordinal. NEVER derived from stage.
  "template": "hm-round",               // "screen" | "hm-round" | "final-loop"
  "prep": "northwind-logistics-round-2-hiring-manager.md",  // basename of the SIBLING prep file
  "generated": "2026-01-15",            // YYYY-MM-DD

  "session": {                          // optional. Renders the board header.
    "who": "Alex Chen, VP of Sales",
    "when": "2026-01-16T10:30:00-06:00",
    "minutes": 30,
    "format": "Zoom",
    "rule": "One story per job. Click a cue. Eyes up."
  },

  "sections": [                         // the board, ordered. DATA, not a fixed list. Cap: 8.
    { "id": "opening", "n": 1, "title": "Opening and why",
      "cues": [                         // cap: 48 cues across the whole board
        { "cue": "First 15 seconds", "answer": "opener" },
        { "cue": "Tell me about your background", "answer": "frame", "label": "90-sec frame" }
      ] },
    { "id": "hero", "n": 2, "title": "Hero story, use once", "style": "hero", "cues": [ ... ] },
    { "id": "blank", "title": "Blank? Bucket it", "style": "panic", "cues": [ ... ] },  // MANDATORY
    { "id": "tradeoff", "n": 4, "title": "Tradeoff and tough", "cameraGap": true, "cues": [ ... ] }
  ],

  "answers": {                          // cues[].answer is a KEY into this object, never inline text
    "hero": {
      "title": "HERO: The forecast rebuild",
      "tag": "2.5 to 3 min",            // delivery INTENT only. Never a derivable fact.
      "story": 1,                       // story-bank id, or null for non-story answers
      "hero": true,                     // at most one answer on the whole board
      "useOnce": true,
      "seconds": 165,
      "spoken": [ "...", "..." ],       // REQUIRED. One string per paragraph. **bold** the landing lines.
      "notes": [ "...", "..." ]         // delivery sidebar: traps, warnings, what to land
    }
  },

  "guardrails": [                       // authored, factual, non-derivable. Red panel.
    "Q3 numbers ONLY. Q4 is not public until the February call",
    "Never bluff the quoting platform. Name the gap, reframe to the layer above it"
  ]
}
---
# Debrief

(narrative body, written by the user AFTER the call. You write the stub. See Step 7.)
```

**Contract rules:**

- **Omit, do not null.** If a field does not apply, leave the key out. Do not write `null`, `""`, or
  `[]` as placeholders. The one exception is `story`, where `null` is meaningful and explicit: it
  says "this answer is not from the bank." (Same posture as `modes/oferta.md`'s output contract.)
- `stage` and `round` are **both required and neither derives the other.** The example's tracker says
  `1st Interview` while its file says `round-2`, because that company opens with a TA screen. That
  they are off by one is a coincidence of a 3-round process. Carry both. Never compute one from the
  other.
- `sections` is **data**. There is no canonical section list. A screen board and an hm-round board
  have different panels because they are different events. See Step 3.
- **Exactly one `style: "panic"` section on every board**, regardless of template. See Step 4.
- Emphasis inside `spoken` and `notes` is `**markdown bold**`. **Never raw `<b>`** or any HTML tag:
  it forces `dangerouslySetInnerHTML` in the renderer and the validator rejects it.
- Below the closing `---`, write only the `# Debrief` stub. The board reads **only** frontmatter.

---

## Preconditions - STOP if any of these fail

Check all four before writing a single line. Each one is a hard stop with a specific message. Do not
proceed on a guess; a board built on a missing input is exactly the failure this mode exists to
prevent.

**1. The prep file for that round MUST exist.**

Glob `{interview_prep_dir}/{Company Folder}/*round-{N}*.md`, excluding `*.run.md`. If nothing
matches, STOP:

> No prep file for {Company} round {N}. The run sheet is a **compiled output** of the prep file, so
> there is nothing to compile yet. Run `/trajecktory interview-prep {Company} round {N}` first, read
> what it produces, then come back and I'll compile the board.

**Never invent prep.** Do not research the company, do not draft answers from the report, do not
"bootstrap a minimal prep file." A board compiled from nothing is a board of confident inventions,
and the user reads it aloud to a VP. Refuse and route to `interview-prep`.

**2. The round must be unambiguous.** If the glob matches more than one file (e.g. a round-2 HM file
and a round-2 panel file), list them and ask which one. Do not pick.

**3. `interview-prep/story-bank.md` must exist** if the board will carry any behavioral answer. It
is where `story` ids come from, and `verify-runsheets.mjs` resolves every non-null `story` against
it. If it is missing, say so and ask whether to proceed with a story-free board (valid for a thin
screen, wrong for an hm-round).

**4. The application must have a tracker row.** You need `id` and `stage` from it. If
`data/applications.md` has no row for this company + role, STOP and say so: `id` is the application
id and it must match the report and the tracker. **Never run `node next-jd.mjs`** here. That counter
mints ids for *new* JDs. This application already has one; minting a second is the exact
number-drift bug the counter exists to prevent.

**Overwrite is safe and expected.** A `.run.md` is a compiled artifact with no hand-edited research
in its frontmatter, so regenerating it is a full-file overwrite, no diffing, no merge. **The prose
prep file is never touched, never clobbered, never migrated.** If the user already wrote a `# Debrief`
body under the closing `---`, preserve it verbatim and replace only the frontmatter.

---

## Inputs

Read all of these before writing anything (Step 1).

| # | Input | What you take from it |
|---|---|---|
| 1 | **The round's prep file** (primary) `{interview_prep_dir}/{Company Folder}/{company-slug}-round-{N}-{descriptor}.md` | **Everything spoken.** Every cue, every `spoken` line, every note, every guardrail. This is the source. |
| 2 | **`interview-prep/story-bank.md`** | `story` ids (the H3 numbers), canonical story titles, the STAR+R body when the prep file only names a story by number. |
| 3 | **The eval report frontmatter** `reports/{id}-{company-slug}-{date}.md` | `id`, `role`, comp anchor (`comp.stated`, `comp.walkaway`), company facts, `redFlagQs`, `leadStory`. JSON frontmatter, `JSON.parse` it. |
| 4 | **`config/profile.yml`** | `outputs.interview_prep_dir`, comp floor and target range, location, notice period. |
| 5 | **`cv.md`** | Metric verification only. Never a source of new claims. If a number in the prep file is not in the CV or the report, see GROUNDING. |
| 6 | **`data/applications.md`** | `id`, `company`, `role`, and the current canonical `stage`. |
| 7 | **`templates/states.yml`** | The canonical `stage` vocabulary. `stage` must be one of these strings exactly. |

Precedence when two inputs disagree: **the prep file wins on anything spoken** (it is the most
recently hand-revised artifact and carries the intel the report predates), the **tracker wins on
`stage`**, and the **report wins on `id`**. If the prep file contradicts the report on a *fact*
(a number, a name, a date), do not silently pick: surface it as a gap (see GROUNDING) and put the
resolution in `guardrails`.

---

## Output

```
{interview_prep_dir}/{Company Folder}/{company-slug}-round-{N}-{descriptor}.run.md
```

**The basename is inherited, not re-derived.** Take the prep file's basename and swap `.md` for
`.run.md`. That is the whole rule. It guarantees the two files sit as siblings and that the `prep`
field is exactly the prep file's basename.

Do **not** re-derive `{descriptor}` from the stage. **Mirror the prep file's basename exactly.** The
descriptor is whatever the prep file already chose, and prep files legitimately choose differently:
some name the round's shape, some name the stage.

| Prep file | Run sheet | Descriptor is |
|---|---|---|
| `northwind-logistics-round-2-hiring-manager.md` | `northwind-logistics-round-2-hiring-manager.run.md` | the round's shape |
| `northwind-logistics-round-1-phone-screen.md` | `northwind-logistics-round-1-phone-screen.run.md` | the stage |

> **A descriptor is NEVER a person's name.** `modes/interview-prep.md` owns that rule; this mode
> inherits it by mirroring. If you are handed a prep file named after an interviewer, mirror it
> anyway (an orphan pair is worse than a bad name) and **tell the user it should be renamed to the
> round type**. Filenames leak into public path examples; the interviewer's name belongs inside the
> file, in `session.who`.

A re-derived descriptor produces `northwind-logistics-round-2-hm-round.run.md` sitting next to
`northwind-logistics-round-2-hiring-manager.md`, an orphan pair where the board looks like it belongs
to a round that does not exist.

---

## GROUNDING - the hard rule

> **Every spoken line must trace to the prep file, the story bank, the eval report,
> `modes/_profile.md`, `cv.md`, or `config/profile.yml`. INVENT NOTHING.**

**Two carve-outs, and only two.** Both are craft, not claims about the user's life — that is the
line. Everything that asserts a fact about them, their work, or the company traces to a source.

1. **The stall/principle answer** (`blank`, the first cue in the panic net) is **mode-supplied
   craft content**, not research. "Good question, let me pick the best example" and the
   listen-diagnose-co-author principle appear in no prep file, no story bank, and no profile —
   they are how you buy four seconds and start talking, and they are the same on every board.
   Write them. If `modes/_profile.md` states the user's own operating principle, prefer that
   wording over the generic one; it is their voice.
2. **Connective tissue.** Cue phrasing, section titles, and the wording that joins two sourced
   facts into a spoken sentence. You are compiling prose, not concatenating quotes.

Neither carve-out licenses a **number, a metric, a company fact, or a claim about what the user
did**. Those trace or they do not ship.

This is the rule the whole mode is built around. A cheat sheet that is 10% wrong is a document the
user notices is wrong while reading it at their desk. A **board** that is 10% wrong is a line the
user reads **aloud, live, to a VP**, in their own voice, with confidence, because the board told
them to. There is no recovery from that. **A confident wrong line read aloud to a VP is the worst
failure this feature has**, and it is worse than having no board at all.

So:

- **No fabricated metrics.** Not one. If the prep file says "$18M in pipeline," the board says $18M.
  If the prep file says "significant pipeline," the board says what the story bank says, or it says
  nothing. Never round, never sharpen, never "improve" a number. Do not turn "roughly 12%" into "12%".
- **No fabricated names, dates, titles, quarters, or company facts.** If the prep file's fact pack
  has Q3 revenue and not Q4, the board has Q3 and not Q4, and Q4's absence goes in `guardrails`.
- **No invented interviewer intel.** If the prep file does not name the HM's background, `session.who`
  gets the title only.
- **Compression is allowed. Invention is not.** Turning a §5 STAR+R block into a 6-paragraph `spoken`
  array is the job. Adding a beat that was not in the STAR+R is not.
- **Rephrasing into spoken voice is allowed** (see [Voice](#voice)). The prep file writes "Judgment
  moment: leadership wanted headcount instead; you modeled both paths." The board writes "The
  judgment moment I'd point to: leadership's first instinct was to just add headcount. I modeled
  both paths against the same target." Same facts, first person, said out loud. That is compilation.

**If the prep file lacks something the board needs, report the gap. Do not fill it with plausible
prose.** Plausible prose is the failure mode. It reads as authoritative precisely because you wrote
it well.

Report gaps like this, after the board is written, alongside the verify output:

```
⚠️  Gaps - the prep file did not cover these, so the board does not either:

  - No comp anchor in §0 or the report's comp.stated. The "Comp expectations" cue is
    NOT on the board. If comp can come up in this round, add it to the prep file and
    re-run, or tell me the number and I'll add it.
  - §4B maps "operating in ambiguity" to "the platform migration," which is not a numbered
    story in the bank. I wrote the answer with "story": null from the §4B text only.
    If you want the full STAR+R, it needs to be added to story-bank.md first.
```

A board with a missing cue is a board with a missing cue. **That is a correct state**, and the same
posture the schema takes on run sheets themselves: "a round with no `.run.md` simply has no board.
That is a correct state, not a debt." A board with an invented cue is a liability.

---

## DERIVED, NEVER AUTHORED

The renderer computes these. **Writing them into the file is a bug**, and for four of them the
validator will reject the file outright.

| Derived thing | Computed from | So you must NOT |
|---|---|---|
| Collision / overlap warnings | Group `answers` by `story`, count cue rows per story, `>1` is an overlap. The hero's story is **skipped** (hero integrity owns it). | Type "2 homes", "also used in X", "3 cues", or any count into `tag` or `title`. |
| The `· use once` tag suffix | `useOnce \|\| derivedCollision` | Type "use once" into `tag`. Set the `useOnce` **boolean** instead. |
| Hero integrity | Exactly one `hero: true`; warn if any cue outside the hero section points at the hero's `story`. | Type "hero" into `tag`, or set `story: null` on a hero-DNA answer to silence the warning. |
| Default cue `label` | The answer's `title`, else the story-bank H3. | Author `label` when it would just repeat `title`. Omit it. |
| Round / stage header | `stage` + `round`, always shown together. | Type "round 2" or "1st interview" into `tag`. |
| Timing budget | `sum(seconds)` vs `session.minutes`. | Hand-total the board's runtime into a note. |
| Fit preflight | Measured `scrollHeight > innerHeight`. | Guess whether it scrolls. Run the renderer (Step 8). |

Reference implementation: [`render-runsheet.mjs`](../render-runsheet.mjs), `derive()`. The dashboard
imports `derive()` from that same file, so there is exactly **one** collision engine. If you would
have to compute it, it is already computed.

### Why this rule exists, with a worked example

`tag` renders **verbatim**. Anything you type there sits next to a derived warning and can silently
contradict it.

The example board's `definitions` answer is story **#7**. It is reachable from **three** cue rows:
"Aligning teams that disagreed" (behavioral), "People, alignment, or conflict" (the net), and
"Influence, driving change, disagreeing up" (the net). Type `"tag": "2 homes · angle it"` onto it and
the board renders "2 homes" one line above its own derived warning:

```
⚠ Story #7 is reachable from 3 cues (Finance vs Sales on the definitions). Tell it ONCE.
```

The authored count is the one that is wrong, and it goes wrong the moment a cue is added or moved,
which is exactly when nobody re-reads the tag. That is not a rounding error, it is a **miscount of
the board's own shape**, hand-maintained across edits until it drifts. Humans cannot count this
reliably; a hand-written panel names what someone noticed on the day they wrote it. The renderer
recomputes it on every render. That is the whole argument.

**The rule generalizes: if the renderer can compute it, `tag` must not claim it.** `tag` carries only
how to *deliver* the answer ("land it, then pause", "deliver near-verbatim", "only if they raise it",
"2.5 to 3 min"), never a fact about the board's shape.

`verify-runsheets.mjs` enforces this with a regex over `tag` (`\d+ homes?`, `use once`, `hero`,
`round \d`, `1st|2nd|3rd|4th interview`). If you author a derivable fact, the file fails validation.

---

## Step 1 - Read everything before you write anything

In this order, and completely:

1. The **prep file**. All of it, including the §-sections you think you will not use.
   **Navigate it by section NAME, never by number.** The numbers are template-dependent and
   will burn you: on an `hm-round` §7 is Tradeoff Probes and §9 is the Logistics Checklist, but
   on a `screen` §7 is Questions to Ask and §9 is a **recruiter reply draft**. Follow §-numbers
   literally across templates and you will file questions-to-ask as `guardrails`. Step 4 has the
   per-template map; use it. What you are looking for, by name:
   - the **mental model** section -> the board's `session.rule`
   - the **logistics checklist** -> `session.format` and `when`
   - the **traps / red-flag** section -> `notes` and `guardrails`
   - the **questions to ask** section -> the final chronology panel
2. **`story-bank.md`**. Build a `{id -> title}` map for every H3. You will need it for every
   `story` field and for label defaults.
3. The **eval report** frontmatter (`JSON.parse` it) for `id`, `role`, comp, `redFlagQs`.
4. **`modes/_profile.md`**. The cross-cutting advantage, exit narrative, and — critically — the
   **prohibited phrases**. The run sheet is the one artifact read *aloud, live, to a hiring
   manager*, so it is where a banned phrase costs the most. Honor that list even inside verbatim
   spoken text.
5. **`config/profile.yml`** (`outputs.interview_prep_dir`, comp floor/target), **`data/applications.md`**
   (the row: `id`, `stage`), **`templates/states.yml`** (the canonical `stage` string).
6. **`cv.md`** only if a metric in the prep file needs checking.

Then fill the header fields:

| Field | Where it comes from |
|---|---|
| `id` | The tracker row / the report number. They are the same number. |
| `company`, `role` | The tracker row, matching the report header. |
| `stage` | The tracker row's **current** status, verbatim from `templates/states.yml`. |
| `round` | The **prep file's** round (its filename and its `**Stage:**` line agree). |
| `template` | Step 3. |
| `prep` | The prep file's basename. |
| `generated` | Today. |
| `session` | The prep file's header block: HM name + title, the date/time, the duration, the format. `rule` is the round's one-line posture, taken from §1. |

`session.rule` is the line the user reads when they look up. **Take it from the prep file's mental
model section, do not compose a new one.** An hm-round whose §1 says "one hero story, not three"
earns the example's rule: "One story per job. Click a cue. Eyes up." A screen whose §1 posture is a
reconnection rather than an audition earns the opposite instruction: "Reconnecting, not auditioning.
Short answers. Save the hero for the HM." Same field, different rounds, which is exactly why you read
it off the prep file instead of composing one.

---

## Step 2 - Inventory the prep file before you lay out the board

Do not start writing sections. First list, from the prep file:

- **Every question it anticipates** (the anticipated-questions table, the behavioral bank, the tradeoff probes, the red-flag section — found by NAME, not number).
- **Every story it maps**, with the bank id.
- **Every fact** in the fact pack, and what conversation each one is for.
- **Every trap and never-say** (the traps/red-flag section, the "Do NOT" list, the culture wall).
- **Every question to ask** (§8), and which is mandatory.

This inventory is the board. Sections are just how you group it. If the inventory is thin, the board
is small, and that is the honest answer: **confidence, not exhaustiveness.**

---

## Step 3 - Pick the template, size the board

`template` is one of `screen` | `hm-round` | `final-loop`. It comes from what the round **is**, per
the prep file's §1 and the template it declares in its own header block (`> **Template:**
interview-cheatsheet-hm-round`). Read it, do not infer it from the round number.

| `template` | The round | Cues | Sections | Hero | Carries |
|---|---|---|---|---|---|
| `screen` | Recruiter / TA / first conversation | **~12-16 in the chronology + the 3-4 cue panic net (~16-21 total)** | 5-6 | **NO** | Comp, location, notice, "interviewing elsewhere", soft spots, loop + timeline |
| `hm-round` | Hiring manager / functional leader | **~45** (cap 48) | 7-8 | **Yes, exactly one** | Hero, behavioral bank, fact pack, substance, tradeoffs, questions to ask |
| `final-loop` | Panel / onsite / final | ~30-45 | 7-8 | Yes (the same hero, polished) | Cross-panel threading, the case/exercise, per-panelist angles, comp now firm |

**A screen board has NO hero.** The hero belongs to a later round. Spending it on a recruiter is
spending it on someone who cannot hire you, and it arrives at the HM secondhand and flattened. The
screen board gives the hero **one line** inside the 60-second pitch and nothing more, then says so
out loud in `guardrails`:

> `"Do not burn the forecast rebuild story. One line only. It is the hero for the HM round."`

`verify-runsheets.mjs` warns on a `screen` board with `hero: true`. Treat that warning as an error
unless the user explicitly told you this screen is the only round.

**On the screen cue count:** the schema's "~12-16 cues" is a target for the chronology sections. The
mandatory panic net adds 3-4 more, so a screen board lands around 16-21 total. Aim at the schema's
range for the chronology and let the net sit on top. If a screen board is pushing 25, you are writing
the HM round early.

**The caps are physics, not taste.** 48 cues, 8 sections. Rows drive grid height; panel chrome costs
~74px each. **The board is useless the moment it scrolls**, because the user is reading it at 2 feet
mid-sentence and cannot scroll while talking. If you are at the cap, cut cues. Do not shrink content
to fit; drop the cue you are least likely to need. That is what "confidence, not exhaustiveness"
buys you: a wrong guess costs nothing (you just don't click it), so cut freely.

---

## Step 4 - Lay out `sections[]`

**Sections are DATA, not a fixed list.** There is no canonical set. Do not copy the hm-round's eight
panels onto a screen. The panels come from what the round is and what the prep file inventoried.

Section fields: `id` (stable slug), `n` (display number, **omit** for panels outside the chronology),
`title`, `style` (`hero` | `panic` | `rules`, omit for normal), `cameraGap` (bool, optional).

### The mapping that produces each shape

**`hm-round`** (the full 8-panel mapping, prep §-section on the left. The shipped example is an
abridged 6 of these: it drops `facts` and `substance`):

| Prep source | Board section | `n` | `style` |
|---|---|---|---|
| §0 strip + §2 frame + §3 why-this-role | `opening` "Opening and why" | 1 | |
| §3 fact pack | `facts` "Facts, which one when" | 2 | |
| §5 hero story | `hero` "Hero story, use once" | 3 | `hero` |
| **(mandatory, no prep source)** | `blank` "Blank? Bucket it, grab the default" | *(none)* | `panic` |
| §4B behavioral bank | `behavioral` "Behavioral, \"tell me about a time...\"" | 4 | |
| §4 likely HM questions | `substance` "Substance questions" | 5 | |
| §7 tradeoff probes | `tradeoff` "Tradeoff and tough" | 6 | `cameraGap: true` |
| §8 questions to ask | `questions` "Your questions to ask · last 5 min" | 7 | |

**`screen`** (6 sections, no shipped file):

| Prep source | Board section | `n` | `style` |
|---|---|---|---|
| §0 strip + §2 60-second pitch | `opening` "Open and reconnect" | 1 | |
| §3 why-company/why-now + §4 | `why` "Why this, why you" | 2 | |
| §4 recruiter questions (comp/location/timing) | `logistics` "Comp, location, timing" | 3 | |
| §6 red-flag handling | `softspots` "Soft spots, answer straight" | 4 | |
| **(mandatory, no prep source)** | `blank` "Blank? Bucket it, grab the default" | *(none)* | `panic` |
| §7 questions to ask | `questions` "Your questions" | 5 | |

**`final-loop`** has **no shipped worked example.** Compile it from
`templates/interview-cheatsheet-final-loop.md`'s sections (§2 panel-by-panel, §3 cross-panel
threading, §4 likely case/exercise, §5 hero, §7 hard questions, §8 questions by interviewer type),
plus the panic net. **Tell the user the loop layout is unproven** and ask them to review it harder
than usual (Step 9). Two constraints that bite here:

- **Do not build one section per panelist.** A 5-person loop plus the hero plus the net plus questions
  blows the 8-section cap. Group by **question shape** as always, and carry panelist identity in the
  cue text ("CFO round: forecast defensibility") or the `label`. One panel per panelist is only
  viable for a loop of 3 or fewer.
- `session.who` is a single string. For a loop, write the roster compactly
  ("Panel: Chen (Sales), Rivera (Finance), Okafor (Product)") or put the composition in
  `session.rule`.

### The panic section is MANDATORY on every board

**Every board carries exactly one `style: "panic"` section, regardless of template.** No exceptions,
no "this round is short," no "the user knows their stories."

It is the net that makes a wrong cue guess survivable, and it is the entire reason "confidence, not
exhaustiveness" is a safe premise. Guess a cue wrong and you just don't click it: free. Blank with no
net and you are **stranded, on camera, mid-sentence**. The net is what converts the board's cheapest
failure mode into a non-event.

```json
{ "id": "blank", "title": "Blank? Bucket it, grab the default", "style": "panic",
  "cues": [
    { "cue": "The stall line + universal opener",         "answer": "blank" },
    { "cue": "Failure, or a call you got wrong",          "answer": "badKpi" },
    { "cue": "People, alignment, or conflict",            "answer": "definitions" },
    { "cue": "Influence, driving change, disagreeing up", "answer": "definitions" }
  ] }
```

Rules for the net:

- **The net has no `n`.** It is outside the chronology; it fires whenever it fires.
- **First cue is always the stall-and-principle answer** (`blank`): buy time out loud, reframe the
  question back, lead with the principle. It is the one answer that works when you cannot even
  classify the question.
- **Then 3 buckets**, one per behavioral shape: failure/judgment, people/alignment, leadership/influence.
  Where they come from depends on the template, and **only `hm-round` can transcribe**:

  - **`hm-round`: transcribe.** The prep file names them outright. A §4B says it in one line:
    "judgment/failure question -> #4, people/alignment question -> #7, leadership/influence
    question -> #7." That line **is** the net. Read it and transcribe it.
  - **`screen` / `final-loop`: SELECT from the story bank.** These templates have no §4B and name no
    buckets, so selecting is not a GROUNDING violation, it is the only legal move, and this rule
    authorizes it:
    1. Pick one story per behavioral shape from `interview-prep/story-bank.md`.
    2. **Prefer stories the prep file already references.** If it does not reference any, pick on
       shape alone.
    3. **Do not reach for a story the board reserves.** On a screen, the hero cluster belongs to a
       later round; a net cue that burns it defeats the point of reserving it.
    4. **Report the selection to the user in Step 9** and say it was your pick, not the prep file's.
       This is a judgment call and they get to overrule it.

  Selecting the *bucket assignment* is authorized. Inventing the story's **content** is not: the
  spoken text still traces to `story-bank.md` like every other answer.
- **Bucket cue text is the QUESTION SHAPE, not the story title.** "Failure, or a call you got wrong",
  never the story's name. You reach for the net **because you blanked**, so it must be findable by
  feel, not by recalling which story you filed under which name. If you could recall that, you would
  not need the net.
- **Never author a top-level `fallbacks` array.** It is retired. v1 briefly modelled the net as both a
  `fallbacks: [{bucket, answer}]` field *and* a panic section, never saying which rendered. A board
  that authored `fallbacks` and no panic section left its fallback stories reachable by **nothing**
  under any renderer that draws only `sections` (which is every sane renderer). The net silently did
  not exist. A board whose safety net is invisible is worse than one with no net, because you plan
  around having it. Buckets are cues; cues live in sections. `verify-runsheets.mjs` hard-fails on a
  `fallbacks` key.

### Cues

`cue` is the trigger text in the left column. `answer` is a **key into `answers{}`**, never inline
content.

- **Cue phrasing is the user's shorthand, not the interviewer's verbatim question.** "Get sellers to
  do what they didn't want", not "Tell me about a time you had to influence a sales team to adopt a
  process they were resistant to." Shorthand scans faster under pressure, and pressure is the only
  condition this board is ever read under.
- **`label` is optional and usually omitted.** It defaults to the answer's `title`, else the
  story-bank H3. Author it only when the title is too long for the column (the example's
  `"HERO: The forecast rebuild"` becomes label `"FORECAST REBUILD"`) or when this specific cue needs
  a different angle hint than the title gives (`"Definitions (land it, pause)"`). If your label would
  just repeat the title, delete it.
- **One answer, several cues, is correct and intended.** The example board has 15 cues and 12 unique
  answers because a behavioral prompt and the panic net's bucket both legitimately want the same
  story. That indirection is the whole schema: inlining would duplicate prose **and** make collision
  detection impossible.
- **`cameraGap`** goes on **at most one** section: the one that starts the lower third of the second
  column, so the answer overlay parks under the webcam. The example sets it on `tradeoff`. Omit it
  unless the board is full enough that the lower panels sit behind the camera.

---

## Step 5 - Write `answers{}`

One entry per key referenced by a cue. **No orphans**: every key in `answers{}` must be reachable
from at least one cue, and `verify-runsheets.mjs` fails the file otherwise. An orphan answer is prose
the user paid for and can never reach.

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Headline in the answer box. Defaults the cue's `label`, so keep it scannable. |
| `spoken` | **yes** | Array of strings, one per paragraph. The thing said out loud. |
| `story` | yes when from the bank | Integer bank id, or `null`. See Step 6. |
| `tag` | optional | Delivery **intent**, rendered verbatim. Never a derivable fact. |
| `notes` | optional | Delivery sidebar: traps, warnings, what to land. |
| `hero` | optional | `true` on **at most one** answer, board-wide. |
| `useOnce` | optional | Authored intent. Renderer ORs it with derived collisions. |
| `seconds` | optional | Spoken length. Expresses length intent. |

**`spoken` has no paragraph cap.** An earlier spec capped it at 3 "as the no-scroll constraint
expressed as a number." That was wrong, and porting a real hm-round board proved it: a third of its
answers exceeded three and its hero needed six. `spoken` renders inside the answer overlay, which is
`#detail{max-height:56vh}` with `.dbody{overflow-y:auto}`, a container that **scrolls by design**.
The cap defended a constraint that field does not have.

**The real limit on `spoken` is human, not layout.** The user is reading it aloud at 2 feet
mid-sentence. Keep answers short because **long ones do not get read**, not because the box cannot
hold them. Use `seconds` to carry that intent (the example's hero is 165; a one-line availability
answer on a screen is 10).

**`notes` is where the danger lives.** This is the sidebar the user's eye hits before they speak.
Traps, never-says, and what to land go here, not in `spoken`:

```json
"notes": [
  "**Never bluff a tool you have not used.** One bluffed answer kills the candidacy; the honest lane wins it.",
  "Name the gap, then reframe to the layer the JD actually asks for.",
  "**Say it once, calmly, then move on.** Over-explaining reads as defensive."
]
```

Pull these straight from the prep file's traps/red-flag section, its "Do NOT" list, and the per-question delivery
notes. They are the highest-value bytes on the board and they are already written; do not paraphrase
them into something softer.

**`tag` carries delivery intent only.** Good: `"2.5 to 3 min"`, `"deliver near-verbatim"`, `"only if
they raise it"`, `"land it, then pause"`, `"say once, move on"`, `"your read, not a claim"`. Banned:
anything in the [DERIVED](#derived-never-authored) table.

---

## Step 6 - `story` is the load-bearing field

**Every answer drawn from the story bank carries its integer id.** Non-story answers carry `null` or
omit the key: the opener, the 90-second frame, fact-pack answers, questions-to-ask, the comp line,
the blank-recovery stall. Those are not stories and must not claim to be.

Two reasons, and the second is the one that matters:

1. `label` and story titles derive from the bank instead of being retyped.
2. **Collisions are only visible at the story level.** Two different answer keys can tell the **same
   story** from two angles: an "impossible deadline" answer and a "shipped something you weren't
   happy with" answer can both be story #3, one framed on the deadline and one on the compromise.
   Key-level dedupe is blind to exactly that. **Only `story` can see it.** Get the id wrong or leave
   it off, and the user tells the same story twice in one interview and never gets warned.

**Do NOT set `story: null` on an answer just to silence a double-report.** That is the tempting wrong
move on hero-DNA answers: a behavioral answer honestly carved from the hero's story carries the
hero's id, and the board will say so. Nulling it would make hero integrity unable to fire at all, and
"never spend the hero on a behavioral" is **the single most valuable warning on the board**. Carry
the honest id and let the warning fire. It is telling the truth.

**The hero's story is EXCLUDED from the plain collision count.** Two derived rules can fire on the
same story, and hero integrity owns it because it says something strictly more useful ("using this
burns the hero") than a generic overlap warning. That is renderer behavior, not something you author
around.

Every non-null `story` must resolve to a real H3 in `story-bank.md`. `verify-runsheets.mjs` checks it.
If the prep file maps a question to something that is not a numbered story ("the platform migration",
"3 emerging programs at once"), write the answer from the prep text with `story: null` and **report
it as a gap** (see GROUNDING), suggesting the user add it to the bank.

---

## Step 7 - `guardrails[]` and the Debrief stub

**`guardrails`** is authored, factual, and **non-derivable**. It renders in the red panel *below* the
derived collision warnings. It is the never-say list, and it comes from the prep file's traps/red-flag section, its
"Do NOT" block, and any fact with a shelf life.

```json
"guardrails": [
  "Q3 numbers ONLY. Q4 is not public until the February call",
  "Never bluff the quoting platform. Name the gap, reframe to the layer above it",
  "Do not raise comp in this round. It lands in the recruiter back-channel"
]
```

Short, imperative, scannable at a glance. If it needs a paragraph it belongs in an answer's `notes`.
**Nothing derivable goes here** (a home count in a guardrail is the same bug as a home count in a
`tag`: it is the renderer's to compute, and a hand-written one drifts the moment a cue moves).

**The Debrief stub.** Below the closing `---`, write only:

```markdown
# Debrief

> Written after the call. The board reads only the frontmatter above. This section is for you.

## Answers I walked away with

- **{the must-ask question from the questions-to-ask section}:**
- **{the second must-know}:**

## What landed

## What did not

## Open questions for the next round

## Next-round intel

- **Confirmed {next interviewer}:**
- **Their lens / what they pushed on:**
- **Anything that changes the hero pick:**

## Actions

- [ ] Thank-you note to {interviewer}, same day
- [ ] Log call notes in `data/applications.md` notes column for #{id}
- [ ] Update the status ladder if advanced
- [ ] If advanced: open the round-{N+1} prep from the `{next template}` template
```

Seed the "Answers I walked away with" bullets from the round's own must-ask questions (§8), so the
user has a slot waiting for each one. This is why the file is `.md` and not `.json`. **If a `# Debrief`
body already exists, preserve it verbatim** and replace only the frontmatter.

---

## Step 8 - VERIFY (mandatory, never skip)

Run both, in order, from the repo root. **Neither is optional and neither substitutes for the other:**
the validator checks the contract, the renderer computes the derived truths. A board that validates
can still have collisions nobody knows about.

```bash
node verify-runsheets.mjs
node render-runsheet.mjs "interview-prep/{Company Folder}/{company-slug}-round-{N}-{descriptor}.run.md"
```

**`verify-runsheets.mjs` MUST show ✅ before you hand the board over.** Same posture as
`verify-reports.mjs` in the batch workflow (`AGENTS.md`): a ⚠️ or ❌ means the board is broken for the
user, so fix it before moving on, do not report it as a caveat. It checks: exact `schema` string,
required fields and types, every `cues[].answer` resolves, **no orphan answers**, every non-null
`story` resolves in the bank, at most one `hero`, **exactly one panic section**, no retired
`fallbacks` key, caps, no raw `<b>`, and **no derivable fact in `tag`**.

`render-runsheet.mjs` writes `{basename}.board.html` beside the run sheet (use `-o <path>` to
redirect; `interview-prep/*` is gitignored either way, so the sidecar is harmless). It exits non-zero
on blocking problems. Its stdout is what you report. Run against the worked example, it prints:

```
Northwind Logistics · 1st Interview · round 2 · template hm-round
15 cues · 12 answers · 6 sections
  ⚠ Story #4 is reachable from 2 cues (The KPI that paid for the wrong thing). Tell it ONCE.
  ⚠ Story #7 is reachable from 3 cues (Finance vs Sales on the definitions). Tell it ONCE.
```

**Report the derived collision count back to the user. Always, even when it is zero.** It is the one
number that tells them how much of the board is double-booked, and it is the number no human can
compute by reading the file. Separate the two kinds:

```
✅ Board compiled: interview-prep/Northwind Logistics/northwind-logistics-round-2-hiring-manager.run.md
   15 cues · 12 answers · 6 sections · template hm-round · verify: ✅

   Derived: 2 story collisions + 0 hero-integrity warnings.
   2 stories are reachable from more than one cue (#7 ×3, #4 ×2).
   That is by design: one story, several angles. The board warns you so you tell each ONCE.
   The hero (#1) is reachable only from its own cue, so nothing on the board burns it.

   Board preview: interview-prep/Northwind Logistics/northwind-logistics-round-2-hiring-manager.board.html
```

**If a hero-integrity warning fires, it is the one to read.** It means a cue outside the hero section
points at the hero's story, so clicking it spends the hero on a behavioral. It reads like this:

```
⚠ "Getting sellers to do what they didn't want" shares the HERO's story (#1). Using it burns the hero. Prefer another story.
```

Report it separately from the plain collisions. It is a different **kind** of warning, not one more
overlap, which is why the hero's story is skipped when counting collisions at all.

Do not present collisions as defects. **They are the feature.** The board computes in one second what
a hand-audit takes an hour to find and still gets wrong. Zero collisions on an hm-round board is the
suspicious result: it usually means `story` ids were left off.

---

## Step 9 - Human review gate

**Never present a generated board as final.** It is a draft until the user has read it. The user
reads it before it is trusted, and they read it **now**, not at 10:29 with the call link open.

Close with a review ask that is specific enough to actually be done:

> This is a **draft board**. Read it before you trust it. Four things worth your eyes, in order:
>
> 1. **The hero** (`hero`, story #1). Is that still the story you want to spend on this round?
>    Everything else is arranged around it.
> 2. **The panic net's 3 buckets.** Failure to #4, people to #7, influence to #7. If you would
>    reach for a different story when you blank, tell me and I'll swap it. This is the one section you
>    use when you cannot think.
> 3. **Every number, out loud.** $400M, three business units, 90 sellers. They all came from your
>    prep file and the story bank, but you are the one saying them.
> 4. **The guardrails.** Q3 only, never bluff the quoting platform, no comp talk. Anything stale?
>
> Read the hero aloud once, timed. It is written for 2.5-3 min.

Then, if anything was thin, the gaps block from [GROUNDING](#grounding---the-hard-rule).

Rerunning is cheap: the frontmatter is a compiled artifact and a full overwrite is safe. Say so, so
the user asks for changes instead of hand-editing 40KB of JSON.

---

## Voice

The board is **spoken**, not read. That is the only style rule and everything follows from it.

- **First person, out loud, conversational.** Contractions. The rhythm of speech, not prose. Say
  "That's my pattern", not "The candidate's pattern is". If it does not survive being said aloud, it
  is wrong, no matter how well it reads.
- **Full sentences in quotes for anything delivered verbatim.** `"Alex, thanks for making the
  time..."`. The user is reading this off the screen while a VP watches their eyes.
- **`**bold** the landing lines.** The single clause that has to land. Bold is what the eye finds
  when it flicks down mid-sentence, so bold **one thing per paragraph**, not three. Bold the claim,
  not the setup: **"The data won the argument, not my opinion."**
- **`notes` carry traps and warnings**, in the prep file's own blunt register. "Never bluff a tool you
  have not used." "Say it once, calmly, then move on." "**Only if they raise it.** Don't volunteer
  competitor wins unprompted."
- **Working doc, not a pep talk.** Direct. Specific numbers, verbatim phrases. No corporate filler,
  no encouragement, no "you've got this." Same house style as `modes/cheat-sheet.md` and
  `modes/interview-prep.md`: every line earns its place.
- **Generate in the language of the JD** (EN default).

Compression from the prep file's prose into spoken voice is the craft of this mode. §5's
`**A:** Two moves. First, I made qualification enforceable instead of aspirational...` is already
almost speakable; the compile turns it into first-person paragraphs, bolds the landing clauses,
and stops. It does not add a beat.

---

## Rules

- **The prep file must exist. Never invent prep.** Missing prep is a STOP and a route to
  `/trajecktory interview-prep {Company} round {N}`.
- **INVENT NOTHING.** Every spoken line traces to the prep file, `story-bank.md`, the report,
  `cv.md`, or `profile.yml`. No fabricated metrics, names, dates, or quarters. Missing input is a
  reported gap, never plausible prose.
- **Never write a derivable fact into `tag`**: no "use once", no home or collision counts, no hero,
  no round or stage. Set the `useOnce` / `hero` booleans and let the renderer speak.
- **Every board carries exactly one `style: "panic"` section.** Every template. No exceptions.
- **A screen board has no hero.** One line in the pitch, and a guardrail saying so.
- **Every bank-drawn answer carries its integer `story` id.** Never null one out to silence a warning.
- **Never author `fallbacks`.** Retired. The panic section is the net.
- **`**markdown bold**`, never raw `<b>`.**
- **Omit, do not null.** Except `story: null`, which is meaningful.
- **The `.run.md` basename is the prep basename with `.md` swapped for `.run.md`.** Never re-derive
  the descriptor.
- **Never touch the prose prep file.** Run sheets are compiled sidecars; prep files are durable
  research. The run sheet is safe to overwrite wholesale; the prep file is never clobbered.
- **`id` comes from the tracker row and the report. Never run `node next-jd.mjs`.**
- **`stage` and `round` are both required and neither derives the other.**
- **Caps: 48 cues, 8 sections.** The board is useless the moment it scrolls. Cut cues, do not shrink
  content.
- **Run `node verify-runsheets.mjs` (must show ✅) then `node render-runsheet.mjs "<path>"`, and
  report the derived collision count.** Every time, including zero.
- **Never present the board as final.** It is a draft until the user has read it.
