# Mode: docx-light — Light-Tailor Word Resume

Produce a tailored .docx by copying the user's master Word resume
(`templates/cv-master.docx`) and surgically swapping ONLY the top four
slots: title, 3-keyword subtitle, professional summary, and Areas of
Expertise. Every other paragraph, bullet, font, color, tab stop, page
break, and byte of formatting is preserved exactly as in the master.

**Output location:** write the tailored .docx into the folder named by
`outputs.resume_dir` in `config/profile.yml` (default `output/`), passed as
`--output <resume_dir>/<filename>.docx`.

## When to use this mode

The user said something like "I like my bullets and structure as-is, just
match the title and keywords to this JD." For more aggressive tailoring
(deeper rewrite of the summary, broader AoE rebuild), use `modes/docx.md`.

## What this mode tailors

| Slot | Locator in master | Baseline length | What gets swapped |
|------|-------------------|-----------------|--------------------|
| `title` | "Regional Logistics & Freight Operations Director" | ~50 chars | Bold centered role-title line under the name |
| `subtitle_secondary` | "Sales Operations \| Revenue Operations \| Go-to-Market Strategy" | ~60 chars | 3-keyword centered line below the title |
| `summary` | starts with "Regional Freight Operations Director" | **~870 chars / ~130 words** | Professional summary paragraph |
| `areas_of_expertise` | starts with "Carrier Scorecarding & Tender Analytics" | **~410 chars / ~50 words / 12 phrases** | Comma-separated areas-of-expertise list |

Slot definitions live in `templates/cv-template-slots.json` — if the master
changes structurally, update locators there.

## What this mode NEVER touches

- Professional Experience: company lines, role titles, dates, italic role
  descriptions, every bullet — preserved byte-for-byte from
  `templates/cv-master.docx`.
- Additional Relevant Experience entries.
- Selected Tools & Platforms.
- Professional Development.
- Education.
- Name, contact line (phone, email, LinkedIn, portfolio).
- All fonts, colors, page margins, tab stops, line spacing.

## Pipeline

1. Read `templates/cv-master.docx` is the source of structure and styling.
   Read `cv.md` only to know what content the candidate has (for ethical
   keyword-injection checks).
2. Ask the user for the JD if not in context (text or URL).
3. Extract 15-20 keywords from the JD.
4. Detect JD language → CV language (EN default).
4b. **Resolve archetype framing (REQUIRED — prevents BI-default drift).**
   The master CV defaults to BI/Analytics framing. For non-Analytics roles,
   you MUST re-point the resume or it reads as a BI candidate misapplying.
   - Identify the JD's archetype: use the evaluation report's Block A if a
     report exists for this company; otherwise match the JD title against
     `config/profile.yml` → `archetypes[].title_variants`.
   - Read that archetype's `resume_framing` block from `config/profile.yml`.
     If the matched archetype has no `resume_framing`, fall back to the
     closest active archetype that does (Analytics, RevOps, SalesOps, BizDev,
     or GTM Analytics).
   - Carry `preferred_title`, `subtitle`, `summary_lead`, `aoe_priority`
     into step 5. Do NOT re-improvise these — they are pinned per archetype.
5. Generate the four swap strings, respecting the **baseline length
   budgets** in `templates/cv-template-slots.json`:
   - `title`: ~50 chars. Use the archetype's `preferred_title` from step 4b.
     Override it ONLY when the JD's exact role title is a more specific
     truthful match at the same level (e.g. JD says "Director of Sales
     Operations" → use that verbatim instead of the generic preferred_title).
     Never default to the BI master title for a non-BI role.
   - `subtitle_secondary`: ~60 chars, three phrases separated by " | ".
     Start from the archetype's `subtitle`, adjust toward the JD's top themes.
   - `summary`: target ~130 words / ~870 chars. **Open with the archetype's
     `summary_lead`**, then tailor the remaining sentences to the JD using
     its vocabulary; do NOT invent skills. For non-BI archetypes, the
     candidate's BI signature line ("Operates on a single test for every
     dashboard...") becomes supporting evidence, not the lead — it may move
     down or be cut if a stronger archetype-aligned close exists.
   - `areas_of_expertise`: 12 comma-separated phrases, ~50 words / ~410
     chars total. **Lead with the archetype's `aoe_priority` phrases** (in
     order), then fill the remaining slots from the master AoE list. Each
     phrase must trace to a real bullet in `cv.md`.
6. Write the four strings to `/tmp/cv-swaps-{candidate}-{company}.json`
   (object: `{ "title": ..., "subtitle_secondary": ..., "summary": ...,
   "areas_of_expertise": ... }`).
7. Compose the company slug: short company name, no spaces, preserve
   internal capitalization (e.g. `Gartner`, `RealPage`, `DuckCreek`,
   `Snowflake`, `Stripe`). Drop "Inc.", "LLC", "Corp", suffix punctuation.
   Hyphenate only if the brand itself contains a hyphen (e.g. `T-Mobile`).
8. Run:
   ```bash
   node generate-docx-from-template.mjs \
     --swaps /tmp/cv-swaps-{Company}.json \
     --output output/{FirstName}_{LastName}_Resume_{Company}_{MM-DD-YYYY}_light.docx
   ```
   `{MM-DD-YYYY}` is today's date in US format (e.g. `06-05-2026`).
   `_light` suffix prevents collision when both `docx` and `docx-light`
   variants are generated for the same company on the same day.
9. The generator exits non-zero if any **page-break-sensitive** slot
   (summary, areas_of_expertise) drifts more than ±15% from the master
   baseline. If that happens, tighten or extend the text and retry — do NOT
   pass `--allow-length-drift` unless the user explicitly accepts that page
   breaks may shift.
10. Report: DOCX path, slots swapped with drift %, page-break warning if
    any survived.

## Truth tests

Before writing the four swap strings, verify:

- **Title test:** Candidate's most recent role legitimately ladders to the
  JD title. If JD says "VP of Revenue Operations" and candidate is
  Director, do NOT promote — keep their actual rung.
- **Areas of Expertise test:** Every phrase added must trace to at least
  one real bullet in `cv.md`. If you cannot point to a bullet, drop the
  phrase.
- **Summary test:** Every claim in the new summary must be supported by an
  existing bullet. If you cannot back the claim, cut it.

## Output

- File: `output/{FirstName}_{LastName}_Resume_{Company}_{MM-DD-YYYY}_light.docx`
- Example: `output/Jordan_Avery_Resume_Gartner_06-05-2026_light.docx`
- Tracker update: same convention as before — flip the PDF column to ✅
  if the offer is already logged. (Column header is historical — it tracks
  "tailored CV generated", DOCX or otherwise.)

## Requirements

- `templates/cv-master.docx` exists (the candidate's master Word resume).
- `templates/cv-template-slots.json` exists with current slot locators.
- `cv.md` exists and mirrors `cv-master.docx` content for evaluation use.

No external tools required — the generator is pure Node + `adm-zip`.
