# Data Contract

This document defines which files belong to the **system** (auto-updatable) and which belong to the **user** (never touched by updates).

## User Layer (NEVER auto-updated)

These files contain your personal data, customizations, and work product. Updates will NEVER modify them.

| File | Purpose |
|------|---------|
| `cv.md` | Your CV in markdown |
| `templates/cv-master.docx` | Your Word resume (the master the docx generator swaps into) |
| `templates/cv-template-slots.json` | Slot locators — verbatim lines from your master resume, so this is your data. Ships as `cv-template-slots.example.json` (fictional); the real file is generated from your CV. |
| `config/profile.yml` | Your identity, targets, comp range |
| `modes/_profile.md` | Your archetypes, narrative, negotiation scripts |
| `article-digest.md` | Your proof points from portfolio |
| `interview-prep/story-bank.md` | Your accumulated STAR+R stories |
| `portals.yml` | Your customized company list |
| `data/*` | **All of it.** Every file under `data/` is yours. The rows below name the main ones, but the rule is the directory, not the list — `.gitignore` ignores `data/*` wholesale, and a file that is not named here is still yours. |
| `data/applications.md` | Your application tracker |
| `data/pipeline.md` | Your URL inbox |
| `data/scan-history.tsv` | Your scan history |
| `data/follow-ups.md` | Your follow-up history |
| `data/status-events.tsv` | Every status change, dated. 5 columns: `app# / date / status / company / logged`. `date` is when the change HAPPENED (specifically when it was booked or notified); `logged` is when the row was written. Rows written before the date could be entered by hand have an empty `logged`, which also marks a date nobody confirmed. Legacy 4-column rows still parse. |
| `data/apply-dates.json` | When you actually applied, per app — distinct from the tracker's Date column, which is when the row was evaluated. Anchors follow-up cadence and the timing analytics. |
| `data/app-notes.json` | Your per-application notes log |
| `data/followup-snooze.json` | Deferred follow-up alerts |
| `data/followup-mute.json` | Indefinitely muted follow-ups ("done for now") |
| `data/cadence.json`, `data/cadence-log.json` | Your Today-tab weekly cadence and its completion log |
| `data/todos.json` | Your to-do list |
| `writing-samples/*` | Your personal writing samples for style calibration |
| `reports/*` | Your evaluation reports |
| `output/*` | Your generated PDFs |
| `jds/*` | Your saved job descriptions |

## System Layer (safe to auto-update)

These files contain system logic, scripts, templates, and instructions that improve with each release.

| File | Purpose |
|------|---------|
| `modes/_shared.md` | Scoring system, global rules, tools |
| `modes/oferta.md` | Evaluation mode instructions |
| `modes/pdf.md` | PDF generation instructions |
| `modes/scan.md` | Portal scanner instructions |
| `modes/batch.md` | Batch processing instructions |
| `modes/apply.md` | Application assistant instructions |
| `modes/auto-pipeline.md` | Auto-pipeline instructions |
| `modes/contacto.md` | LinkedIn outreach instructions |
| `modes/deep.md` | Research prompt instructions |
| `modes/ofertas.md` | Comparison instructions |
| `modes/pipeline.md` | Pipeline processing instructions |
| `modes/project.md` | Project evaluation instructions |
| `modes/tracker.md` | Tracker instructions |
| `modes/training.md` | Training evaluation instructions |
| `modes/patterns.md` | Pattern analysis instructions |
| `modes/followup.md` | Follow-up cadence instructions |
| `modes/de/*` | German language modes |
| `modes/fr/*` | French language modes |
| `modes/ja/*` | Japanese language modes |
| `modes/pt/*` | Portuguese language modes |
| `modes/ru/*` | Russian language modes |
| `CLAUDE.md` | Agent instructions |
| `AGENTS.md` | Codex instructions |
| `*.mjs` | Utility scripts |
| `batch/batch-prompt.md` | Batch worker prompt |
| `batch/batch-runner.sh` | Batch orchestrator |
| `dashboard-web/*` | Web dashboard (Express server + React UI) |
| `templates/*` | Base templates |
| `fonts/*` | Self-hosted fonts |
| `.claude/skills/*` | Skill definitions |
| `docs/*` | Documentation |
| `VERSION` | Current version number |
| `DATA_CONTRACT.md` | This file |

## The Rule

**If a file is in the User Layer, no update process may read, modify, or delete it.**

**If a file is in the System Layer, it can be safely replaced with the latest version from the upstream repo.**
