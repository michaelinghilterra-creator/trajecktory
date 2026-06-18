# Mode: docx — Full-Tailor Word Resume

Produce a tailored .docx by copying the user's master Word resume
(`templates/cv-master.docx`) and surgically swapping the four top slots
with more aggressive JD-aware rewriting than `modes/docx-light.md`.
Everything below "PROFESSIONAL EXPERIENCE" (bullets, italics, dates,
companies, tabs, fonts) is preserved byte-for-byte.

**Output location:** write the tailored .docx into the folder named by
`outputs.resume_dir` in `config/profile.yml` (default `output/`). Pass it as
`--output <resume_dir>/<filename>.docx` to `generate-docx-from-template.mjs`.

## When to use this mode

The user wants substantial tailoring of how they frame themselves for a
specific JD — fresh summary written through the JD's lens, Areas of
Expertise rebuilt around the JD's must-haves — while keeping their actual
bullets verbatim. If the user said "don't touch my bullets, but write the
top of the resume for this role," this is the right mode.

For a lighter touch (preserve the candidate's existing summary voice
heavily, only nudge vocabulary), use `modes/docx-light.md`.

For literal bullet reordering or per-bullet keyword injection: not
supported in this version. The template-swap engine preserves bullet
paragraphs exactly. A future iteration could add `--reorder-bullets`.

## What this mode tailors

Same four slots as `docx-light`:

| Slot | Baseline length | Tailoring depth |
|------|-----------------|------------------|
| `title` | ~50 chars | Mirror JD's exact role title (truthful match required) |
| `subtitle_secondary` | ~60 chars | JD's three top role themes, " | " separated |
| `summary` | ~870 chars / ~130 words | **Substantive rewrite** through the JD's lens; reuse candidate's proof points but reframe priorities |
| `areas_of_expertise` | ~410 chars / ~50 words / 12 phrases | **Rebuild from JD requirements**; every phrase must trace to a real bullet |

## What this mode NEVER touches

Same as `docx-light`: every paragraph from "PROFESSIONAL EXPERIENCE"
downward stays byte-identical to the master.

## Pipeline

Steps are identical to `modes/docx-light.md` except as noted. **Step 4b
(resolve archetype framing) still applies and is REQUIRED** — read the
matched archetype's `resume_framing` from `config/profile.yml` before
writing any swap strings, so the full rewrite is anchored to the right
archetype rather than the BI-default master.

- **Step 5 (generate swap strings)**: the title still comes from the
  archetype's `preferred_title` (or a more specific truthful JD title); do
  not let the substantive rewrite drift the title back toward BI for a
  non-BI role. Open the summary with the archetype's `summary_lead`, then
  rewrite the body substantively through the JD's lens. The candidate's
  signature line ("Operates on a single test for every dashboard...") may
  be replaced or repositioned if a better JD-tailored closing exists in the
  candidate's real experience. Rebuild the Areas of Expertise list around
  the JD's top requirements, leading with the archetype's `aoe_priority`
  phrases, not the candidate's BI-default emphasis.
- **Step 7 (company slug)**: short company name, no spaces, preserve
  internal capitalization (e.g. `Gartner`, `RealPage`, `DuckCreek`,
  `Snowflake`, `Stripe`). Drop "Inc.", "LLC", "Corp", suffix punctuation.
  Hyphenate only if the brand itself contains a hyphen (e.g. `T-Mobile`).
- **Step 8 (filename)**: write to
  `output/{FirstName}_{LastName}_Resume_{Company}_{MM-DD-YYYY}.docx`.
  No `_light` suffix — full tailor is the default.

Run:
```bash
node generate-docx-from-template.mjs \
  --swaps /tmp/cv-swaps-{Company}.json \
  --output output/{FirstName}_{LastName}_Resume_{Company}_{MM-DD-YYYY}.docx
```

The generator's page-break-sensitive length guardrail (±15% drift on
summary and areas_of_expertise) still applies.

## Ethical rules (same as docx-light)

- NEVER add skills the candidate doesn't have.
- Every Areas of Expertise phrase must trace to at least one bullet in
  `cv.md`.
- Every summary claim must be supported by a real bullet.
- Title must legitimately match the candidate's level — no promotions.

## Output

- File: `output/{FirstName}_{LastName}_Resume_{Company}_{MM-DD-YYYY}.docx`
- Example: `output/Jordan_Avery_Resume_Gartner_06-05-2026.docx`
- Tracker update: flip PDF column to ✅ if the offer is already logged.

## Requirements

Same as `modes/docx-light.md`.
