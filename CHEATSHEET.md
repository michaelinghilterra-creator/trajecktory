# trajecktory Cheat Sheet
*Last updated: May 2026*

---

## The Two Ways to Run Commands

| Type | Where | When to use |
|------|-------|-------------|
| `/trajecktory ...` | In Claude Code chat | When you need Claude's brain (evaluation, writing, analysis) |
| `node ....mjs` | PowerShell terminal | Automated tasks that don't need Claude (free, fast) |

---

## Claude Commands (type these in chat)

### Finding & Evaluating Jobs

| Command | ELI5 |
|---------|------|
| `/trajecktory` | Show the full command menu |
| `/trajecktory {paste JD or URL}` | **The big one.** Paste a job description or URL and Claude evaluates it, scores it, writes the report, generates a tailored CV PDF, and adds it to your tracker — all in one shot |
| `/trajecktory oferta` | Same evaluation as above but no auto-PDF. Use when you just want the score and report first |
| `/trajecktory ofertas` | Compare two or more job offers side by side and rank them |
| `/trajecktory pipeline` | Process everything sitting in your `data/pipeline.md` inbox (URLs that the scanner found) |
| `/trajecktory batch` | Evaluate a big pile of jobs in parallel using background workers |
| `/trajecktory scan` | Have Claude search job boards (Greenhouse, Ashby, Lever, Remotive, etc.) for new roles matching your profile. Uses WebSearch + covers companies that can't be API-scanned |

### Applying & Prepping

| Command | ELI5 |
|---------|------|
| `/trajecktory apply` | You open the application form in Chrome, Claude reads it, loads your report for that company, and writes tailored answers for every field |
| `/trajecktory cover-letter` | Generates a full cover letter for a specific company using your report + CV. Under 350 words, no fluff |
| `/trajecktory cheat-sheet` | Makes a 1-2 page cram doc for a company: proof points, STAR stories, red flag Q&As, comp anchor. For the 15 minutes before your interview |
| `/trajecktory interview-prep` | Deep interview prep (longer than cheat sheet) — full story bank, likely questions, company intel |
| `/trajecktory contacto` | Finds the right person at a company on LinkedIn and drafts an outreach message for after you apply |

### Research & Analysis

| Command | ELI5 |
|---------|------|
| `/trajecktory deep` | Deep research on a specific company — culture, funding, team, red flags |
| `/trajecktory tracker` | Shows your application status overview — what's applied, in interview, pending, etc. |
| `/trajecktory patterns` | Looks at your rejection history and tells you what's working and what isn't |
| `/trajecktory followup` | Checks which applications are overdue for a follow-up and drafts the messages |

### Other

| Command | ELI5 |
|---------|------|
| `/trajecktory pdf` | Regenerate your CV PDF without evaluating anything |
| `/trajecktory training` | Evaluate whether a course or certification is worth your time for your target roles |
| `/trajecktory project` | Evaluate a portfolio project idea — will it actually help your job search? |

---

## PowerShell Commands (run in terminal, no Claude needed)

All commands run from your trajecktory project folder (the directory that contains `scan.mjs`).

### The Scanner (run this first, it's free)

```powershell
node scan.mjs                        # Scan all companies via API — adds new roles to pipeline.md
node scan.mjs --dry-run              # Preview what would be found without saving anything
node scan.mjs --company "Cohere"     # Scan just one specific company
node scan.mjs --max-age-days 30      # Only return jobs posted in the last 30 days
node scan.mjs --no-age-filter        # Return all jobs regardless of age
```

### Tracker Maintenance

```powershell
node merge-tracker.mjs               # Merge any batch evaluation results into applications.md
node dedup-tracker.mjs               # Remove duplicate entries from the tracker
node normalize-statuses.mjs          # Fix any non-standard status values in the tracker
node verify-pipeline.mjs             # Health check — finds broken links, missing fields, etc.
```

### Utilities

```powershell
node doctor.mjs                      # Full system health check — tells you if anything is broken
node check-liveness.mjs              # Check if job postings in your pipeline are still active
node analyze-patterns.mjs            # Pattern analysis (same as /trajecktory patterns but raw JSON)
node followup-cadence.mjs            # Follow-up calculator (same as /trajecktory followup but raw JSON)
```

### System Updates

```powershell
node update-system.mjs check         # Check if a trajecktory update is available
node update-system.mjs apply         # Apply the update (your data is never touched)
node update-system.mjs rollback      # Undo the last update
```

### PDF Generation

```powershell
# Generate a CV PDF from an HTML file
node generate-pdf.mjs input.html output/cv-name.pdf --format=letter

# Override the 2-page guardrail (for non-CV documents)
$env:ALLOW_PAGE_OVERFLOW=1; node generate-pdf.mjs input.html output/name.pdf
```

---

## The Recommended Scan Workflow

```
1. node scan.mjs              ← Free. Hits Greenhouse/Ashby/Lever APIs directly.
2. /trajecktory scan           ← Claude + WebSearch. Covers companies scan.mjs can't reach.
3. /trajecktory pipeline       ← Evaluate everything that landed in pipeline.md.
```

Always run `node scan.mjs` before `/trajecktory scan` — free before paid.

---

## Dashboards

### Live Web Dashboard (new)
A browser-based dashboard showing your tracker, pipeline, and stats.

```powershell
cd <your-trajecktory-folder>\dashboard-web
npm start
```
Then open your browser and go to the URL shown in the terminal (typically `http://localhost:3333`).

---

## Key Files to Know

| File | What it is |
|------|-----------|
| `data/applications.md` | Your master tracker — every job you've evaluated or applied to |
| `data/pipeline.md` | The inbox — URLs waiting to be evaluated |
| `portals.yml` | Which companies and job boards to scan |
| `config/profile.yml` | Your personal info, target roles, comp targets, location policy |
| `modes/_profile.md` | Your voice, proof points, negotiation scripts, cover letter rules |
| `cv.md` | Your canonical CV (source of truth for all CV generation) |
| `reports/` | All evaluation reports (A-F scoring blocks + Block G legitimacy) |
| `output/` | Generated CVs and cover letters (docx default; PDF legacy) |
| `interview-prep/` | Cheat sheets and prep docs |

---

## Quick Reference: Status Values

| Status | Meaning |
|--------|---------|
| `Evaluated` | Report done, haven't decided yet |
| `Applied` | Application submitted |
| `Responded` | Company got back to you |
| `Interview` | In the interview process |
| `Offer` | Offer received |
| `Rejected` | They said no |
| `Discarded` | You said no (or posting closed) |
| `SKIP` | Doesn't fit — don't apply |
