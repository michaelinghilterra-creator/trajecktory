# Mode: auto-pipeline — Complete Automatic Pipeline

> **OUTPUT LANGUAGE: ENGLISH — MANDATORY.** All section headers, prose, tables, coaching, recommendations, tracker notes, and form drafts must be written in English. Do not use Spanish phrasing even if this file or another mode file contains residual Spanish. The only exception is when the user has explicitly switched to a non-English mode directory (e.g. `modes/es/`, `modes/de/`, `modes/fr/`, `modes/ja/`).

When the user pastes a JD (text or URL) without an explicit sub-command, execute the ENTIRE pipeline in sequence:

## Step 0 — Extract JD and detect source

If the input is a **URL** (not pasted JD text), follow this extraction strategy:

**Priority order:**

1. **Playwright (preferred):** Most job portals (Lever, Ashby, Greenhouse, Workday) are SPAs. Use `browser_navigate` + `browser_snapshot` to render and read the JD.
2. **WebFetch (fallback):** For static pages (ZipRecruiter, WeLoveProduct, company career pages).
3. **WebSearch (last resort):** Search for the role title + company on secondary portals that index the JD as static HTML.

**If no method works:** Ask the candidate to paste the JD manually or share a screenshot.

**If the input is JD text** (not a URL): use it directly, no fetch needed.

**Source detection — set this flag before continuing:**
- Input is raw JD text (no URL) → `source = "self-sourced"` — the candidate found this role independently
- Input is a URL → `source = "sourced"` — came through scanner or pipeline

## Step 0.5 — Clarifying Questions (self-sourced only)

**Run this step ONLY if `source = "self-sourced"` (raw JD text was pasted).**

Before running the evaluation, ask these three questions in a single message. Ask all three at once — do not ask one at a time. Wait for answers before proceeding.

> **Before I start the evaluation, three quick questions:**
>
> 1. Do you have the hiring manager's name and title? (Used later for cover letter salutation — "Hiring Team" if not known.)
> 2. Did you find this role through a referral, or do you know anyone at the company?
> 3. Anything specific you want emphasized or downplayed for this role — a particular skill, a specific experience, or anything to steer around?

Record the answers. Use them to inform:
- Block C framing (level strategy and emphasis)
- Block E customization plan (specific angles to push or avoid)
- Block F interview plan (referral context if applicable)
- Notes column in tracker (flag referral source if one exists)

## Step 1 — Evaluation A-G
Execute exactly like the `oferta` mode (read `modes/oferta.md` for all blocks A-F + Block G Posting Legitimacy).

## Step 2 — Save Report .md
Save the complete evaluation to `reports/{###}-{company-slug}-{YYYY-MM-DD}.md` (see format in `modes/oferta.md`).
Include Block G in the saved report. Add `**Legitimacy:** {tier}` to the report header.

## Step 3 — Draft Application Answers (only if score >= 4.5)

If the final score is >= 4.5, generate draft responses for the application form:

1. **Extract form questions**: Use Playwright to navigate to the form and snapshot it. If extraction fails, fall back to the generic questions.
2. **Generate responses** following the tone rules below.
3. **Save in the report** as a `## H) Draft Application Answers` section.

### Generic questions (use if form extraction fails)

- Why are you interested in this role?
- Why do you want to work at [Company]?
- Tell us about a relevant project or achievement
- What makes you a good fit for this position?
- How did you hear about this role?

### Tone for Form Answers

**Posture: "I'm choosing you."** The candidate has options and is choosing this company for concrete reasons.

**Tone rules:**
- **Confident without arrogance**: "I've spent the past year building production AI agent systems — your role is where I want to apply that experience next"
- **Selective without ego**: "I've been intentional about finding a team where I can contribute meaningfully from day one"
- **Specific and concrete**: Always reference something REAL from the JD or company, and something REAL from the candidate's experience
- **Direct, no fluff**: 2-4 sentences per answer. No "I'm passionate about..." or "I would love the opportunity to..."
- **The hook is the proof, not the claim**: Instead of "I'm great at X", say "I built X that does Y"

**Framework per question:**
- **Why this role?** → "Your [specific thing] maps directly to [specific thing I built]."
- **Why this company?** → Mention something concrete about the company. "I've been using [product] for [time/purpose]."
- **Relevant experience?** → A quantified proof point. "Built [X] that [metric]. Sold the company in 2025."
- **Good fit?** → "I sit at the intersection of [A] and [B], which is exactly where this role lives."
- **How did you hear?** → Honest: "Found through [portal/scan], evaluated against my criteria, and it scored highest."

**Language**: Always in the JD's language (English default). Apply `/tech-translate` if needed.

## Step 4 — Update Tracker
Register in `data/applications.md`. PDF column is always ❌ at evaluation time — CV is generated only when the user explicitly applies (`/trajecktory apply` or `/trajecktory pdf`).

**Source tagging in Notes column (CRITICAL — controls auto-discard behavior):**
- If `source = "self-sourced"`: prefix the notes with `[self-sourced] ` — e.g., `[self-sourced] Strong fit — apply`
- If referral was identified in Step 0.5 Q2: prefix with `[referral: NAME] ` instead — e.g., `[referral: Jane Smith] Strong fit — apply`
- If `source = "sourced"` (came through scanner/pipeline): no prefix needed

**Why the tag matters:** `merge-tracker.mjs` auto-discards entries with score <3.0 or "do not apply" verdicts so the dashboard stays focused on viable roles. **`[self-sourced]` and `[referral:]` tags EXEMPT the entry from auto-discard** — the user explicitly chose this JD, so the evaluation is shown regardless of score. Always tag user-initiated evaluations correctly.

**If any step fails**, continue with the next steps and mark the failed step as pending in the tracker.

## Step 5 — What's Next? (score >= 4.0 only)

After the tracker is updated, if the global score is >= 4.0, display this prompt:

```
─────────────────────────────────────────────
✅ Pipeline complete — {Company} | {Role} | Score: {X.X}/5

Ready to apply? Two more tools available:

  /trajecktory cover-letter  → Generates a tailored cover letter + optional PDF
                              (uses your voice rules, proof points from this report,
                               and hiring manager info from your answers above)

  /trajecktory cheat-sheet   → Generates a 1–2 page interview cheat sheet
                              (STAR stories, red-flag Q&As, comp anchor, lead story)
                              + optional push to your Obsidian vault
─────────────────────────────────────────────
```

Do NOT auto-run these modes. Display the prompt and wait for the user to invoke them explicitly.

If score < 4.0: skip this prompt entirely.
