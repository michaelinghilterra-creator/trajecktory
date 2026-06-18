# Mode: cheat-sheet — Interview Cheat Sheet

Invoked as `/trajecktory cheat-sheet` or surfaced as a "What's next?" option after auto-pipeline.

Generates a compact, scannable 1–2 page cheat sheet from an existing evaluation report. Designed for a 15-minute pre-interview review — not deep prep (use `/trajecktory interview-prep` for that).

Saves to `interview-prep/` and optionally pushes to Obsidian vault.

---

## Inputs

1. **Company name + role title** — from context, or ask
2. **Evaluation report** in `reports/` — grep for company name; read in full
3. **modes/_profile.md** — cross-cutting advantage, exit narrative, negotiation scripts, sensitive framing
4. **config/profile.yml** — comp targets (minimum, target_range)

---

## Step 1 — Load Context

1. **Find the report**: `Grep reports/ -i {company}` → read the matching `.md` file in full
2. If multiple reports match: use the most recent (sort by date in filename)
3. If no report found: ask the user to run `/trajecktory oferta` first, or paste the JD so the full pipeline can run

---

## Step 2 — Generate Cheat Sheet

Produce a document that answers: "What do I need to remember walking into this interview?"

Every line earns its place. No filler. Tables and bullet points only — no prose paragraphs.

---

```markdown
# Interview Cheat Sheet: {Company} — {Role}

**Date:** {YYYY-MM-DD} | **Score:** {X.X/5} | **Archetype:** {archetype from Block A}
**Report:** [#{report_num}](../reports/{report_filename})

---

## The Role in One Line
{Block A TL;DR — exactly as written in the report, no paraphrasing}

---

## Why You Fit — Top 5 Proof Points
{From Block B — pick the 5 strongest ✅ Direct matches}

| JD Requirement | Your Proof Point |
|----------------|------------------|
| {requirement} | {exact CV evidence, quantified} |
| {requirement} | {exact CV evidence, quantified} |
| {requirement} | {exact CV evidence, quantified} |
| {requirement} | {exact CV evidence, quantified} |
| {requirement} | {exact CV evidence, quantified} |

---

## Lead With This Story
{From Block F "Recommended Case Study" — copy the story name and the 2-sentence pitch verbatim}

**Open with:** "{opening line or hook from Block F recommendation}"
**Close with:** "{the 'system outlasted me' closer from Block F}"

---

## STAR Stories Ready
{From Block F — 3 most important stories, ultra-compressed}

| Topic | Situation (8 words) | Action (8 words) | Result (8 words) |
|-------|--------------------|--------------------|------------------|
| {JD requirement} | {S} | {A} | {R} |
| {JD requirement} | {S} | {A} | {R} |
| {JD requirement} | {S} | {A} | {R} |

---

## Red Flag Questions + Exact Answers
{From Block F "Red-Flag Questions" — copy the question and the recommended framing verbatim}

**"{question}"**
> {exact answer framing from report}

**"{question}"**
> {exact answer framing from report}

{repeat for all red flag questions in the report}

---

## Gaps to Acknowledge
{From Block B Gaps & Mitigations — only ⚠️ Soft and ❌ Hard blockers}

| Gap | Approved Framing |
|-----|-----------------|
| {gap} | {mitigation from report} |

---

## The Angle to Own
{From _profile.md cross-cutting advantage + Block C "Sell Senior Without Lying" phrases}

- **The bilingual angle:** {from _profile.md + adapted to this archetype}
- **The builder proof:** {which specific deliverable(s) outlasted you — relevant to this role}
- **The closer:** {the "here's what I'd build here" line from Block F recommendation}

---

## Sensitive Framing Reminders
{Pull directly from _profile.md — only include the items relevant to this role}

**Departure from Northwind Logistics:**
> "My role was eliminated in a restructuring at the end of 2025. It wasn't a performance issue — I had just led the build-out of a reporting infrastructure supporting $400M in revenue across four regions. The timing was theirs, not mine."

**Director BDS (if tenure comes up):**
> "CRO-sponsored strategic rotation — not a lateral move, not a step back. The CRO identified a commercial gap and asked me to own it."

{include other items from _profile.md sensitive framing only if relevant to the specific archetype}

---

## Comp Anchor
{From Block D + config/profile.yml}

| | Amount |
|--|--------|
| **JD stated range** | {from Block D — OTE or base if OTE not listed} |
| **Your target** | {target_range from profile.yml} |
| **Your floor** | {minimum from profile.yml} |

**If asked:** *"Based on market data for this role, I'm targeting {target}. I'm flexible on structure — what matters is the total package and the opportunity."*

**If offered below target:** *"I'm comparing with opportunities in the {higher range}. I'm drawn to {company} because of [reason]. Can we explore {target}?"*

---
```

**Compression rules for STAR table:**
- Each cell: 8–12 words max
- Situation: one-phrase context, not a story
- Action: the key lever you pulled
- Result: one number or one system-change
- If a result is unquantified: use "System operational when I left" or "Framework still in use"

**Do NOT include:**
- Full paragraphs from the report
- Block D comp source table (just the final numbers)
- Block G legitimacy section (not relevant pre-interview)
- Extended narrative — this is a cram doc, not a memo

---

## Step 3 — Save to File

Derive slugs from company name and role title:
- `{company-slug}` = company name lowercase, spaces → hyphens (e.g., "PulseOps" → "pulseops")
- `{role-slug}` = role title lowercase, spaces → hyphens, strip punctuation (e.g., "Director of Revenue Operations" → "director-revenue-operations")

Save to:
```
interview-prep/{company-slug}-{role-slug}-cheat-sheet.md
```

Print confirmation:
```
✅ Cheat sheet saved: interview-prep/{company-slug}-{role-slug}-cheat-sheet.md
```

---

## Step 4 — Obsidian Push

**Read `config/profile.yml` → `integrations.obsidian.applied_folder`** to get the target path.
**Read `config/profile.yml` → `integrations.obsidian.applied_filename_format`** to get the filename pattern (default if missing: `"{applied_date_mdy} - {company} - {role}"`).
**Read `data/applications.md`** and find the row for this company + role. Check its status column AND the applied date if status = Applied.

**Filename token resolution:**
- `{applied_date_mdy}` = the date the job was marked Applied, formatted `MM-DD-YYYY` (zero-padded). If status is not yet Applied, use today's date as a placeholder.
- `{company}` = company name as it appears in the report header
- `{role}` = role title as it appears in the report header
- After substitution, replace any forbidden Windows path characters (`\ / : * ? " < > |`) with hyphens. Do not include the `.md` extension in the format string — it is appended automatically.

### Branch A — Status is `Applied` (AUTO-PUSH, no confirmation needed)

Push immediately without asking. The job is already applied to — the cheat sheet belongs in the Applied folder.

**Target filepath:** `{applied_folder}/{resolved_filename}.md`

1. Use `mcp__obsidian-vault__obsidian_simple_search` with query `{Company} {Role}` to check for an existing note in the applied folder (filenames may use older formats, so search by content rather than exact filename match).
2. **If exists at the same resolved path:** use `mcp__obsidian-vault__obsidian_patch_content`
   - `filepath`: the existing note's path
   - `content`: full cheat sheet markdown
   - `operation`: `replace` (keeps it clean on re-run)
3. **If exists at a different filename (older naming):** ask the user whether to overwrite the old note in place or create a new one with the current filename format.
4. **If not exists:** use `mcp__obsidian-vault__obsidian_append_content`
   - `filepath`: `{applied_folder}/{resolved_filename}.md`
   - `content`: full cheat sheet markdown
5. Confirm:
   ```
   ✅ Obsidian → {applied_folder}/{resolved_filename}.md
   ```

### Branch B — Status is NOT `Applied` (ask first)

> "Want me to push this to Obsidian? It'll go to your Applied folder (`{applied_folder}`) automatically when you apply — or I can push it there now if you'd like."

- If yes: follow the same push logic as Branch A (use today's date for `{applied_date_mdy}` since the job is not yet marked Applied)
- If no: skip; remind them it will auto-push when the job is marked Applied

**If the user specifies a different subfolder:** use `{custom_folder}/{resolved_filename}.md` instead.

---

## Rules

- **NEVER invent proof points or metrics** — pull all quantified claims from the evaluation report (which sourced them from cv.md)
- **NEVER use prohibited phrases** (read from _profile.md) — even in verbatim sections, flag if any appear in the original report
- **Verbatim answer framing** for red flag questions — copy the exact words from Block F, don't paraphrase; these are trained responses
- **Keep STAR table cells to 8–12 words max** — if you can't compress it, pick a different word
- **Sensitive framing section:** only include items from _profile.md that are relevant to the archetype and likely to come up in this specific interview
- **Comp anchor section:** always include; the floor number is the most important anchor
- Generate in the language of the JD (EN default)
