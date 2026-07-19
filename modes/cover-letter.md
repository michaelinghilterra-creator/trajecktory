# Mode: cover-letter — Generate Cover Letter

Invoked as `/trajecktory cover-letter` or surfaced as a "What's next?" option after auto-pipeline.

Generates a cover letter that follows the voice and structure rules in `modes/_profile.md`. Outputs markdown for review and optionally a PDF using the same Playwright pipeline as the CV.

---

## Inputs

1. **Company name + role title** — from context, or ask
2. **Evaluation report** in `reports/` — grep for company name; read in full
3. **cv.md** — proof points and quantified metrics (NEVER invent)
4. **modes/_profile.md** — voice rules, achievement formula, prohibited phrases, sensitive framing
5. **config/profile.yml** — contact info for header and PDF
6. **Hiring manager name + title** — from Paso 0.5 context if self-sourced; ask if not known

---

## Step 1 — Load Context

1. **Find the report**: `Grep reports/ -i {company}` → read the matching `.md` file in full
2. **Extract from the report**:
   - Block A: Archetype detected, company domain, role function
   - Block A TL;DR: The one-sentence role summary (use as context, not copy-paste)
   - Block B: Top 3–4 direct-match proof points (these become the achievement paragraphs)
   - Block C: "Sell senior without lying" framing — specific phrases to use
   - Block E: Top customization angles — what to emphasize, what to downplay
   - Block F: Recommended case study — which story to lead with
   - Notes column: Referral context if `[referral: NAME]` prefix present
3. **Read cv.md** — pull exact quantified metrics for the two achievement paragraphs
4. **Read _profile.md** — load: achievement formula, prohibited phrases, cover letter structure, sensitive framing, adaptive framing by archetype
5. **Read config/profile.yml** — load: full_name, email, phone, linkedin, location

---

## Step 2 — Gather Hiring Manager Info

If not already in context from Paso 0.5:

> "Do you have the hiring manager's name and title? I'll use 'Hiring Team' if not."

- If known: `SALUTATION = "Dear [First Name],"` or `"Dear [First Name] [Last Name],"`
- If unknown: `SALUTATION = "Dear Hiring Team,"`

`RECIPIENT_NAME` and `RECIPIENT_COMPANY` blocks:
- If hiring manager known: show their name + title on line 1, company name on line 2
- If not known: show company name only, skip the name line

---

## Step 3 — Generate Cover Letter

Follow the **cover letter structure from _profile.md** exactly. Under 350 words body text. First-person "I" throughout.

**Structure:**
1. **Hook** (1–2 sentences) — specific to this company or role; references something real from the JD or Block A. Never opens with "I am writing to express my interest in..." or "I'm excited to apply for..."
2. **Who I am + what I owned** (2–3 sentences) — the exit narrative bridge from _profile.md; establish scope without naming the most recent employer
3. **Achievement 1** (2–3 sentences) — the recommended case study from Block F, quantified; matches the role's primary need from Block E
4. **Achievement 2 or company connection** (2–3 sentences) — second proof point from Block B, OR something specific about this company that maps to your experience
5. **What the resume doesn't show** (1–2 sentences) — the cross-cutting advantage as stated in _profile.md; adapt to the archetype
6. **Direct close** (1 sentence) — confident, specific; never "I look forward to hearing from you"

**Adaptive hook by archetype (read from report Block A):**

| Archetype | Hook angle |
|-----------|------------|
| Revenue Operations | Open on the gap between having a CRM and having a revenue system — then land MEDDPICC |
| Analytics / BI | Open on the gap between dashboards and decisions — then land the executive-reporting infrastructure story (pull the cycle-time numbers from cv.md) |
| Sales Operations | Open on the gap between sales activity and sales clarity — then land MEDDPICC + CRM governance |
| Commercial Excellence / Sales Strategy | Open on the gap between sales effort and sales effectiveness — then land sales process programs + seller productivity |
| Sales / Revenue Enablement | Open on the gap between hiring sellers and ramping them — then land the MEDDPICC rollout as deploying a methodology to a whole salesforce (pull the seller count from cv.md) + seller-productivity systems |

**Keep the letter consistent with the tailored CV.** When a CV is being
generated for the same role, read the archetype's `resume_framing` block in
`config/profile.yml` and lead the "who I am + what I owned" paragraph with
the same `summary_lead` framing. The cover letter and resume must present
the same archetype identity — if the CV says "Sales Operations leader" the
letter cannot read as a BI candidate, or the inconsistency reads as a
generic blast.

**Referral handling:**
If `[referral: NAME]` was in the Notes column: weave it in naturally in paragraph 2 or 3 — "I was introduced to this opportunity by [NAME]..." — not as a standalone statement.

**Prohibited phrases (hard ban — read from _profile.md):**
- "I am writing to express my interest in..."
- "I look forward to hearing from you"
- "results-driven," "passionate," "dynamic," "proven track record"
- "helped," "supported," "assisted," "approximately," "various," "several"
- Passive constructions: "was tasked with," "was selected to," "was responsible for"
- Vague scope: "multiple stakeholders," "various teams," "cross-functional projects"

**Sensitive framing rules:** read from `modes/_profile.md` if present. That file is
the user layer and holds the candidate's own framing and verbatim scripts; this mode
is the system layer and must not restate them. If the section is absent, skip it
rather than improvising a framing for the candidate's background.

---

## Step 4 — Output

Print the complete cover letter as markdown, clearly labeled:

```
## Cover Letter — [Company] | [Role]

---

[DATE]

[RECIPIENT NAME — if known]
[RECIPIENT COMPANY]

[SALUTATION]

[BODY — 5–6 paragraphs]

[CLOSING LINE]

[NAME]
[EMAIL] | [PHONE]
```

Then ask:
> "Want me to generate a PDF? I'll use the same pipeline as the CV. (yes / no)"

---

## Step 5 — PDF Generation (if user confirms)

1. Read `config/profile.yml` → extract: full_name, email, phone, linkedin (url + display), location
2. Detect paper format: US/Canada → `letter` (8.5in), rest → `a4` (210mm)
3. Format today's date as: `May 7, 2026` (long format, no abbreviations)
4. Build HTML:
   - Recipient block: populate or leave blank if unknown
   - Body: wrap each paragraph in `<p>` tags
   - Closing line: the final confident sentence from the letter
5. Inject all content into `templates/cover-letter-template.html` replacing placeholders
6. Normalize `full_name` to kebab-case lowercase → `{candidate}` (e.g., "Jordan Avery" → "jordan-avery")
7. Derive `{company}` slug from company name (lowercase, hyphens)
8. Write HTML to `/tmp/cover-letter-{candidate}-{company}.html`
9. Execute:
   ```
   node generate-pdf.mjs /tmp/cover-letter-{candidate}-{company}.html output/cover-letter-{candidate}-{company}-{YYYY-MM-DD}.pdf --format={letter|a4}
   ```
10. Report: PDF path + file size

**Cover letter template placeholders:**

| Placeholder | Value |
|-------------|-------|
| `{{LANG}}` | `en` |
| `{{PAGE_WIDTH}}` | `8.5in` (letter) or `210mm` (A4) |
| `{{NAME}}` | full_name from profile.yml |
| `{{EMAIL}}` | email from profile.yml |
| `{{PHONE}}` | phone from profile.yml |
| `{{LINKEDIN_URL}}` | linkedin from profile.yml |
| `{{LINKEDIN_DISPLAY}}` | linkedin URL stripped of `https://www.` |
| `{{LOCATION}}` | location from profile.yml |
| `{{DATE}}` | today's date in long format (e.g., `May 7, 2026`) |
| `{{RECIPIENT_NAME}}` | hiring manager name + title, or empty string |
| `{{RECIPIENT_COMPANY}}` | company name, or empty string if recipient name populated |
| `{{SALUTATION}}` | `Dear [Name],` or `Dear Hiring Team,` |
| `{{BODY}}` | full body wrapped in `<p>` tags, one per paragraph |
| `{{CLOSING_LINE}}` | the final direct sentence from the letter |

---

## Rules

- **NEVER invent metrics or experience** — all quantified claims come from cv.md
- **NEVER use prohibited phrases** — read the hard ban list from _profile.md before writing
- **NEVER use double-dashes (`--`) or em-dashes (`—`) anywhere in the cover letter.** Hyphens connecting compound words are fine ("data-driven", "cross-functional", "real-time"). For separating clauses, use periods (split into two sentences), commas, semicolons, colons, or parentheses. **Before writing the PDF: scan the body text for `--` and `—` characters. If any are found, rewrite those sentences before rendering.** This rule applies to ALL outputs (markdown draft, HTML, PDF, regenerations).
- **Sensitive framing always applies** — read the rules from `modes/_profile.md`
- **One specific company or role reference per letter** — generic cover letters are rejected; anchor to something real from Block A or Block E
- **The letter is not the resume** — no bullet points, no tables; prose only
- **Closing line must be direct** — one sentence, no hedging, no "I look forward to..."
- Generate in the language of the JD (EN default)
