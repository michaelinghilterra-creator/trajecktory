# trajecktory -- AI Job Search Pipeline

## Origin

This system was built and used by [santifer](https://santifer.io) to evaluate 740+ job offers, generate 100+ tailored CVs, and land a Head of Applied AI role. The archetypes, scoring logic, negotiation scripts, and proof point structure all reflect his specific career search in AI/automation roles.

**It will work out of the box, but it's designed to be made yours.** If the archetypes don't match your career, the modes are in the wrong language, or the scoring doesn't fit your priorities -- just ask. You (AI Agent) can edit the user's files. The user says "change the archetypes to data engineering roles" and you do it. That's the whole point.

## Data Contract (CRITICAL)

There are two layers. Read `DATA_CONTRACT.md` for the full list.

**User Layer (NEVER auto-updated, personalization goes HERE):**
- `cv.md`, `config/profile.yml`, `modes/_profile.md`, `article-digest.md`, `portals.yml`
- `data/*`, `reports/*`, `output/*`, `interview-prep/*`

**System Layer (auto-updatable, DON'T put user data here):**
- `modes/_shared.md`, `modes/oferta.md`, all other modes
- `AGENTS.md`, `CLAUDE.md`, `*.mjs` scripts, `dashboard/*`, `templates/*`, `batch/*`

**THE RULE: When the user asks to customize anything (archetypes, narrative, negotiation scripts, proof points, location policy, comp targets), ALWAYS write to `modes/_profile.md` or `config/profile.yml`. NEVER edit `modes/_shared.md` for user-specific content.** This ensures system updates don't overwrite their customizations.

## Update Check

On the first message of each session, run the update checker silently:

```bash
node update-system.mjs check
```

Parse the JSON output:
- `{"status": "update-available", "local": "1.0.0", "remote": "1.1.0", "changelog": "..."}` → tell the user:
  > "trajecktory update available (v{local} → v{remote}). Your data (CV, profile, tracker, reports) will NOT be touched. Want me to update?"
  If yes → run `node update-system.mjs apply`. If no → run `node update-system.mjs dismiss`.
- `{"status": "up-to-date"}` → say nothing
- `{"status": "dismissed"}` → say nothing
- `{"status": "offline"}` → say nothing
- `{"status": "no-remote-version"}` → say nothing (checker reached GitHub but neither VERSION nor the latest release tag parsed as semver — treat as a silent non-failure, same as offline)

The user can also say "check for updates" or "update trajecktory" at any time to force a check.
To rollback: `node update-system.mjs rollback`

## Starting the live dashboard

When the user says "start the live dashboard" (or "start the dashboard" / "launch
trajecktory"), do NOT open a browser tab yourself. Start it like this:

- **Installed bundle** (a `launch-trajecktory.ps1` sits one folder up from this one): run
  `powershell -ExecutionPolicy Bypass -File ..\launch-trajecktory.ps1`. It uses the bundled
  Node, builds the UI, starts the server on a free port, and opens the dashboard in your
  default browser.
- **Dev checkout** (no bundled launcher present): run `npm start` from `dashboard-web` for
  live data (use `npm run dev:demo` only when the user explicitly asks for demo data).

## What is trajecktory

AI-powered, CLI-agnostic job search automation: pipeline tracking, offer evaluation, CV generation, portal scanning, batch processing. Runs on any AI coding CLI that follows the [open agent skill standard](https://agentskills.io) (Claude Code, Codex, Gemini, OpenCode, Qwen, Copilot, Kimi).

### Main Files

| File | Function |
|------|----------|
| `data/applications.md` | Application tracker |
| `data/pipeline.md` | Inbox of pending URLs |
| `data/scan-history.tsv` | Scanner dedup history |
| `portals.yml` | Query and company config |
| `templates/cv-master.docx` | **CV master template (default).** The user's Word resume. Tailored CVs are produced by copying this file and surgically swapping the top four slots (title, 3-keyword subtitle, summary, areas of expertise) in `word/document.xml`. Every other byte is preserved exactly. To update the master, edit it in Word and resync `cv.md`. |
| `templates/cv-template-slots.json` | Slot definitions: locators, baseline character counts, and which slots are page-break-sensitive (drift more than ±15% blocks output). **User-layer (gitignored):** the `locator` values are verbatim lines from the user's own `cv-master.docx`, so this file is personal data. The tracked default is `templates/cv-template-slots.example.json` (fictional locators); the generator falls back to it, and the docx mode regenerates the real file from the user's CV. |
| `generate-docx-from-template.mjs` | **Default CV generator.** Copies `cv-master.docx`, swaps slots per a JSON swaps file, writes to output. Pure Node + adm-zip. No external tools required. |
| `templates/cv-template.html` | HTML template for CVs (legacy PDF path) |
| `templates/cv-template.tex` | LaTeX/Overleaf template for CVs (legacy PDF path) |
| `generate-pdf.mjs` | Playwright: HTML to PDF (legacy) |
| `generate-latex.mjs` | LaTeX CV validator + pdflatex compiler (legacy) |
| `article-digest.md` | Compact proof points from portfolio (optional) |
| `interview-prep/story-bank.md` | Accumulated STAR+R stories across evaluations (shared; stays at the top level) |
| `interview-prep/{Company}/` | One folder per company holding that company's interview intel report and per-round cheat sheets, e.g. `interview-prep/Example Co/example-co-round-2-hiring-manager.md`. Create the folder from the company display name (strip legal suffixes and illegal path chars: "Example Co, Inc." → `Example Co`). See `modes/interview-prep.md` and `modes/cheat-sheet.md`. |
| `organize-interview-prep.mjs` | Retrofits pre-existing FLAT interview-prep files into per-company folders (dry run by default; `--apply` to move). Idempotent, never overwrites, leaves `story-bank.md` at the top level. |
| `verify-interview-prep.mjs` | Validates cheat-sheet section headings; recurses into the company subfolders. `--json` for machine-readable output. Skips `*.run.md`. |
| `interview-prep/{Company}/{slug}-round-N-{descriptor}.run.md` | **Run sheet.** A compiled sidecar beside the prose prep file: JSON frontmatter (the live click-a-cue board) + a narrative debrief body. Spec: `templates/runsheet-schema-v1.md`. Written by `modes/runsheet.md`, NEVER by hand. The prose prep file is durable research; the run sheet is a performance script and is safe to overwrite wholesale. A round without one simply has no board. |
| `render-runsheet.mjs` | Compiles a `.run.md` into the standalone HTML board (`node render-runsheet.mjs <file>.run.md [-o out.html]`). Also exports `parseRunsheet`/`derive` — the dashboard imports `derive()` from here, so there is exactly ONE collision engine. |
| `verify-runsheets.mjs` | Validates run-sheet frontmatter: schema string, required fields, cue/answer resolution, story ids against the bank, one panic section, no derivable facts in `tag`. |
| `analyze-patterns.mjs` | Pattern analysis script (JSON output) |
| `followup-cadence.mjs` | Follow-up cadence calculator (JSON output) |
| `data/follow-ups.md` | Follow-up history tracker |
| `scan.mjs` | Zero-token portal scanner — hits Greenhouse/Ashby/Lever APIs directly, zero LLM cost |
| `check-liveness.mjs` | Job posting liveness checker |
| `liveness-core.mjs` | Shared liveness logic (expired signals win over generic Apply text) |
| `reports/` | Evaluation reports (format: `{###}-{company-slug}-{YYYY-MM-DD}.md`). Blocks A-F + G (Posting Legitimacy). Header includes `**Legitimacy:** {tier}`. |

### First Run — Onboarding (IMPORTANT)

**Before doing ANYTHING else, check if the system is set up.** Run these checks silently every time a session starts:

1. Does `cv.md` exist?
2. Does `config/profile.yml` exist (not just profile.example.yml)?
3. Does `modes/_profile.md` exist (not just _profile.template.md)?
4. Does `portals.yml` exist (not just templates/portals.example.yml)?

If `modes/_profile.md` is missing, copy from `modes/_profile.template.md` silently. This is the user's customization file — it will never be overwritten by updates.

**If ANY of these is missing, enter onboarding mode.** Do NOT proceed with evaluations, scans, or any other mode until the basics are in place. Guide the user step by step:

#### Step 1: CV (required)
If `cv.md` is missing, ask:
> "I don't have your CV yet. You can either:
> 1. Paste your CV here and I'll convert it to markdown
> 2. Paste your LinkedIn URL and I'll extract the key info
> 3. Tell me about your experience and I'll draft a CV for you
>
> Which do you prefer?"

Create `cv.md` from whatever they provide. Make it clean markdown with standard sections (Summary, Experience, Projects, Education, Skills).

#### Step 2: Profile (required)
If `config/profile.yml` is missing, copy from `config/profile.example.yml` and then ask:
> "I need a few details to personalize the system:
> - Your full name and email
> - Your location and timezone
> - What roles are you targeting? (e.g., 'Senior Backend Engineer', 'AI Product Manager')
> - Your salary target range
>
> I'll set everything up for you."

Fill in `config/profile.yml` with their answers. For archetypes and targeting narrative, store the user-specific mapping in `modes/_profile.md` or `config/profile.yml` rather than editing `modes/_shared.md`.

#### Step 3: Portals (recommended)
If `portals.yml` is missing:
> "I'll set up the job scanner with a broad starter list of 123 employers across 15 industries. It's a starting point, not a list picked for you. Want me to customize the search keywords for your target roles?"

Copy `templates/portals.example.yml` → `portals.yml`. If they gave target roles in Step 2, update `title_filter.positive` to match.

#### Step 4: Tracker
If `data/applications.md` doesn't exist, create it:
```markdown
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |
|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|
```

URL is last, so every earlier column keeps its position and 9- and 10-column
rows written before it existed still parse. `TRACKER_HEADER` and
`TRACKER_SEPARATOR` in `lib/tracker.mjs` are the source of truth — import them
instead of retyping the pipes. To populate the cell on rows that predate the
column, run `node backfill-tracker-urls.mjs` (dry run) then `--apply`.

#### Step 5: Get to know the user (important for quality)

After the basics are set up, proactively ask for more context. The more you know, the better your evaluations will be:

> "The basics are ready. But the system works much better when it knows you well. Can you tell me more about:
> - What makes you unique? What's your 'superpower' that other candidates don't have?
> - What kind of work excites you? What drains you?
> - Any deal-breakers? (e.g., no on-site, no startups under 20 people, no Java shops)
> - Your best professional achievement — the one you'd lead with in an interview
> - Any projects, articles, or case studies you've published?
>
> The more context you give me, the better I filter. Think of it as onboarding a recruiter — the first week I need to learn about you, then I become invaluable."

Store any insights the user shares in `config/profile.yml` (under narrative), `modes/_profile.md`, or in `article-digest.md` if they share proof points. Do not put user-specific archetypes or framing into `modes/_shared.md`.

**After every evaluation, learn.** If the user says "this score is too high, I wouldn't apply here" or "you missed that I have experience in X", update your understanding in `modes/_profile.md`, `config/profile.yml`, or `article-digest.md`. The system should get smarter with every interaction without putting personalization into system-layer files.

#### Step 6: Ready
Once all files exist, confirm:
> "You're all set! You can now:
> - Paste a job URL to evaluate it
> - Run `/trajecktory scan` (or `/trajecktory-scan` if using OpenCode) to search portals
> - Run `/trajecktory` to see all commands
>
> Everything is customizable — just ask me to change anything."

Then suggest automation:
> "Want me to scan for new offers automatically? I can set up a recurring scan every few days so you don't miss anything. Just say 'scan every 3 days' and I'll configure it."

If the user accepts, use the `/loop` or `/schedule` skill (if available) to set up a recurring `/trajecktory scan` (or `/trajecktory-scan` if using OpenCode). If those aren't available, suggest adding a cron job or remind them to run `/trajecktory scan` (or `/trajecktory-scan` if using OpenCode) periodically.

### Launchpad — Visual Onboarding (dashboard)

The dashboard (`dashboard-web`) has a **Launchpad** tab that is the visual front
door for the same first-run flow described above. It exists so a new user sees a
deliberate, guided setup with a readiness meter instead of discovering missing
files by trial.

Division of labor:
- The dashboard does **deterministic** work only: it reads config-file state
  (`/api/setup/state`), saves structured scalar fields (contact info,
  compensation, location, output folders) straight into `config/profile.yml`,
  runs preflight (`node doctor.mjs --json`) and the verify scripts, and stages a
  first-eval URL into `data/pipeline.md`. It never calls an LLM.
- **Generative** steps (parse CV → `cv.md` and `templates/cv-master.docx`, draft
  narrative, suggest adjacent roles, detect certifications, geocode location,
  suggest + resolve companies, merge `portals.yml`) are handed off as a
  copy-paste prompt the user runs in **their own** Claude Code. Those prompts
  mirror the Steps above, so a dashboard-invoked agent produces the same
  artifacts as a conversational one.
- When the dashboard is not running, the conversational First-Run flow above is
  the fallback — both paths write the same user-layer files and honor the data
  contract (never touch `applications.md`, `reports/`, or scan history).

`config/profile.yml` schema additions used by the Launchpad: `credentials.certifications`
(name + issuer) and an `outputs` block (`resume_dir`, `interview_prep_dir`;
reports stay in `reports/`). `modes/_profile.md` gains an "Evaluation Tuning"
section (priorities + deal-breakers).

### Personalization

This system is designed to be customized by YOU (AI Agent). When the user asks you to change archetypes, translate modes, adjust scoring, add companies, or modify negotiation scripts -- do it directly. You read the same files you use, so you know exactly what to edit.

**Common customization requests:**
- "Change the archetypes to [backend/frontend/data/devops] roles" → edit `modes/_profile.md` or `config/profile.yml`
- "Translate the modes to English" → edit all files in `modes/`
- "Add these companies to my portals" → edit `portals.yml`
- "Update my profile" → edit `config/profile.yml`
- "Change the CV template design" → edit `templates/cv-template.html`
- "Adjust the scoring weights" → edit `modes/_profile.md` for user-specific weighting, or edit `modes/_shared.md` and `batch/batch-prompt.md` only when changing the shared system defaults for everyone

### Language Modes

Default modes are in `modes/` (English). Additional language-specific modes are available:

- **German (DACH market):** `modes/de/` — native German translations with DACH-specific vocabulary (13. Monatsgehalt, Probezeit, Kündigungsfrist, AGG, Tarifvertrag, etc.). Includes `_shared.md`, `angebot.md` (evaluation), `bewerben.md` (apply), `pipeline.md`.
- **French (Francophone market):** `modes/fr/` — native French translations with France/Belgium/Switzerland/Luxembourg-specific vocabulary (CDI/CDD, convention collective SYNTEC, RTT, mutuelle, prévoyance, 13e mois, intéressement/participation, titres-restaurant, CSE, portage salarial, etc.). Includes `_shared.md`, `offre.md` (evaluation), `postuler.md` (apply), `pipeline.md`.
- **Japanese (Japan market):** `modes/ja/` — native Japanese translations with Japan-specific vocabulary (正社員, 業務委託, 賞与, 退職金, みなし残業, 年俸制, 36協定, 通勤手当, 住宅手当, etc.). Includes `_shared.md`, `kyujin.md` (evaluation), `oubo.md` (apply), `pipeline.md`.

**When to use German modes:** If the user is targeting German-language job postings, lives in DACH, or asks for German output. Either:
1. User says "use German modes" → read from `modes/de/` instead of `modes/`
2. User sets `language.modes_dir: modes/de` in `config/profile.yml` → always use German modes
3. You detect a German JD → suggest switching to German modes

**When to use French modes:** If the user is targeting French-language job postings, lives in France/Belgium/Switzerland/Luxembourg/Quebec, or asks for French output. Either:
1. User says "use French modes" → read from `modes/fr/` instead of `modes/`
2. User sets `language.modes_dir: modes/fr` in `config/profile.yml` → always use French modes
3. You detect a French JD → suggest switching to French modes

**When to use Japanese modes:** If the user is targeting Japanese-language job postings, lives in Japan, or asks for Japanese output. Either:
1. User says "use Japanese modes" → read from `modes/ja/` instead of `modes/`
2. User sets `language.modes_dir: modes/ja` in `config/profile.yml` → always use Japanese modes
3. You detect a Japanese JD → suggest switching to Japanese modes

**When NOT to:** If the user applies to English-language roles, even at French, German, or Japanese companies, use the default English modes.

### Skill Modes

| If the user... | Mode |
|----------------|------|
| Pastes JD or URL | auto-pipeline (evaluate + report + PDF + tracker) |
| Asks to evaluate offer | `oferta` |
| Asks to compare offers | `ofertas` |
| Wants LinkedIn outreach | `contacto` |
| Asks for company research | `deep` |
| Preps for interview at specific company | `interview-prep` |
| Wants the live click-a-cue board for a round ("make me a run sheet", "compile the board") | `runsheet` |
| Wants to generate a tailored Word resume (full tailor: title, summary, AoE, bullets reordered, keywords injected) | `docx` |
| Wants a light-tailored Word resume (title + 3 keywords + summary + AoE only, bullets untouched) | `docx-light` |
| Wants the old HTML/PDF flow (deprecated) | `pdf` |
| Evaluates a course/cert | `training` |
| Evaluates portfolio project | `project` |
| Asks about application status | `tracker` |
| Fills out application form | `apply` |
| Searches for new offers | `scan` |
| Processes pending URLs | `pipeline` |
| Batch processes offers | `batch` |
| Asks about rejection patterns or wants to improve targeting | `patterns` |
| Asks about follow-ups or application cadence | `followup` |

### CV Source of Truth

- `cv.md` in project root is the canonical CV
- `article-digest.md` has detailed proof points (optional)
- **NEVER hardcode metrics** -- read them from these files at evaluation time

---

## Ethical Use -- CRITICAL

**This system is designed for quality, not quantity.** The goal is to help the user find and apply to roles where there is a genuine match -- not to spam companies with mass applications.

- **NEVER submit an application without the user reviewing it first.** Fill forms, draft answers, generate PDFs -- but always STOP before clicking Submit/Send/Apply. The user makes the final call.
- **Strongly discourage low-fit applications.** If a score is below 4.0/5, explicitly recommend against applying. The user's time and the recruiter's time are both valuable. Only proceed if the user has a specific reason to override the score.
- **Quality over speed.** A well-targeted application to 5 companies beats a generic blast to 50. Guide the user toward fewer, better applications.
- **Respect recruiters' time.** Every application a human reads costs someone's attention. Only send what's worth reading.

---

## Offer Verification -- MANDATORY

**NEVER trust WebSearch/WebFetch to verify if an offer is still active.** ALWAYS use Playwright:
1. `browser_navigate` to the URL
2. `browser_snapshot` to read content
3. Only footer/navbar without JD = closed. Title + description + Apply = active.

**Exception for batch workers (headless mode):** Playwright is not available in headless pipe mode. Use WebFetch as fallback and mark the report header with `**Verification:** unconfirmed (batch mode)`. The user can verify manually later.

---

## CI/CD and Quality

- **GitHub Actions** run on every PR: `test-all.mjs` (97 checks), CodeQL, dependency review,
  auto-labeler (risk-based: 🔴 core-architecture, ⚠️ agent-behavior, 📄 docs), welcome bot for
  first-time contributors
- **`main` is protected** by the `main-guard` ruleset, which enforces four rules:
  a pull request is **required** (0 approvals, because a solo maintainer cannot approve their own
  PR and requiring one would deadlock every merge); the `test`, `dependency-review`, `CodeQL` and
  `conventional-title` checks must pass; no force-push; no deletion. **The bypass list is empty**,
  so there is no admin override — an emergency direct push means disabling the ruleset
  deliberately, which is visible, rather than quietly using a standing exemption.
  `conventional-title` is required rather than advisory for the same reason it exists: feature PRs
  are squash-merged, so the PR title becomes the commit message, and a title Release Please cannot
  parse costs a version bump and a changelog line while every other check stays green. An advisory
  check does not stop a merge, and this failure is invisible without one.
- **Dependabot** security updates are on. Routine version-bump PRs are deliberately off, so
  Dependabot opens a PR for a *vulnerability*, not for every release.
- **Contributing process**: issue first → discussion → PR with linked issue → CI passes → merge

> Keep this section true. It described protection the repo did not have — status checks that were
> not required and an admin bypass that did not exist — which is worse than describing none,
> because it invites trusting a guard that is not there.

## Versioning & Releases

Versioning is automated with **Release Please** (`.github/workflows/release.yml`,
config in `release-please-config.json` + `.release-please-manifest.json`). It uses the
`simple` strategy and writes the canonical **`VERSION`** file in place; it also keeps
`package.json`, `package-lock.json`, and the installer's `#define AppVersion`
(`installer/trajecktory.iss`, marked with `x-release-please-start/end` annotations) in
sync. The `VERSION` file is the single source of truth the app, updater, and installer read.

**The version is NOT bumped per commit.** Release Please reads every commit landed on
`main`, accumulates them into a standing "release PR", and only bumps + tags + writes the
changelog when that PR is **merged**. The bump size comes from
[Conventional Commit](https://www.conventionalcommits.org/) prefixes:

- `fix:` → patch (1.7.32 → 1.7.33)
- `feat:` → minor (1.7.32 → 1.8.0)
- `feat!:` / `fix!:` / a `BREAKING CHANGE:` footer → major
- `chore:` / `ci:` / `docs:` / `refactor:` / `test:` → no release on their own, and **absent from the
  changelog**. `release-please-config.json` sets no `changelog-sections`, so the default applies and
  only `feat` and `fix` are rendered. These commits ride along in the release, not in its notes.
  Worked example: the `docs:` commit that landed just before v1.16.0 is nowhere in that release's
  changelog. If you want one of these types to show up, give it a `feat:` or `fix:` prefix honestly,
  or add `changelog-sections` to the config — do not mislabel a docs change as a fix to make it
  visible.

**RULE: write Conventional Commit messages.** A commit without a recognized type prefix is
ignored by Release Please — it will neither bump the version nor appear in the changelog.
Tags are clean `vMAJOR.MINOR.PATCH` (e.g. `v1.7.33`); the baseline `v1.7.32` tag anchors history.

### How to merge a PR (RULE)

**Feature PRs: squash.** `gh pr merge <n> --squash`. The squash commit's subject is the
**PR title**, so the PR title MUST itself be a Conventional Commit (`fix: ...`, `feat: ...`).
A vague PR title is not a cosmetic problem here: it becomes the changelog line, permanently.

**Release PRs: merge commit, never squash.** `gh pr merge <n> --merge`. A squash would take
the PR title (`chore(main): release X.Y.Z`) as the commit message, which Release Please then
re-reads on the next cycle. Full release checklist: `docs/RELEASING.md`.

**The PR title's TYPE must match the largest change inside it.** Squashing discards every
individual commit message, so a branch carrying `feat:` commits under a `fix:` PR title
releases as a patch and the features never reach the changelog. This is not the same hazard
as a vague title, and it is easy to miss precisely because the branch's own history looks
correct: PR #75 held two `feat:` commits under a `fix:` title and cut 1.21.1 instead of
1.22.0. Before merging, ask what the largest change in the branch is, not what the headline
bug was. The recovery is `Release-As: X.Y.Z` in a later commit — and under squash that
footer has to go in the **PR body**, since that is what becomes the commit body.

Why the split, since merge commits used to be the default for everything: GitHub writes the
PR title into a merge commit's BODY while the subject stays `Merge pull request #n from ...`.
Release Please unwraps merge commits by reading that body, so it counts the same
Conventional Commit twice, once on the real commit and once on the merge commit. Release
1.17.3 shipped with a duplicated changelog line for exactly this reason. Squashing produces
one commit per PR and nothing to double count. Release PRs are immune because their commit
is a `chore:`, which generates no changelog entry either way.

Repo settings back this up: squash commits take `PR_TITLE` as the subject and `PR_BODY` as
the body. Both merge methods stay enabled because both are needed. `pr-title.yml` fails any
PR whose title is not a Conventional Commit, because under squash that title IS the commit
message: a bad one silently bumps nothing and leaves the changelog empty, with a green build.

> **A squash commit's body is the PR description, and squashing happens on GitHub's side.**
> It therefore never passes through `.githooks/commit-msg` or `verify-no-pii.mjs --messages`,
> which only see commits made locally. The "describe the shape, never the value" rule in
> *Commit messages are published* applies in full to PR descriptions. Personal data written
> into a PR body reaches `main` with every local gate bypassed.

> **Release authentication is configured.** `RELEASE_PLEASE_TOKEN` is a fine-grained PAT scoped to
> this repo with Contents + Pull-requests write, and `release.yml` reads
> `secrets.RELEASE_PLEASE_TOKEN || secrets.GITHUB_TOKEN`.
>
> **Do NOT "fix" this by enabling Settings → Actions → "Allow GitHub Actions to create and approve
> pull requests".** That grants every workflow in the repo standing authority to open and approve
> PRs, and it does not actually work here: a PR opened by `GITHUB_TOKEN` does not trigger other
> workflows, so the required `test` / `dependency-review` / `CodeQL` checks never run and the
> release PR can never satisfy `main-guard`. The PAT avoids both problems — its PRs do trigger
> checks, and no ambient permission is granted. That checkbox is deliberately left OFF.
>
> The token expires. When it does, releases fail with an auth error rather than an obvious
> "expired" message, so re-issue it with the same name and scopes.

## Community and Governance

- **Code of Conduct**: Contributor Covenant 2.1 with enforcement actions (see `CODE_OF_CONDUCT.md`)
- **Security**: private vulnerability reporting via email (see `SECURITY.md`)
- **Support**: help questions go to GitHub Discussions, not issues (see `SUPPORT.md`)

## Headless / Batch Mode

When spawning headless workers for batch processing, use the appropriate command for your CLI:

| CLI | Command |
|-----|---------|
| Claude Code | `claude -p "prompt"` |
| Gemini CLI | `gemini -p "prompt"` |
| Copilot CLI | `copilot -p "prompt"` |
| Codex | `codex exec "prompt"` |
| OpenCode | `opencode run "prompt"` |
| Qwen | `qwen -p "prompt"` |

## Stack and Conventions

- Node.js (mjs modules), Playwright (PDF + scraping), YAML (config), HTML/CSS (template), Markdown (data), Canva MCP (optional visual CV)
- Scripts in `.mjs`, configuration in YAML
- Output in `output/` (gitignored), Reports in `reports/`
- JDs in `jds/` (referenced as `local:jds/{file}` in pipeline.md)
- Batch in `batch/` (gitignored except scripts and prompt)
- Report numbering: obtain the number from the persistent counter — run `node next-jd.mjs` (prints the next number; `--pad` for 3-digit zero-padded). NEVER compute "max existing + 1" by hand: report files get pruned, so a hand-computed max reuses numbers across different companies and drifts away from the tracker id. The counter is monotonic, never reused, and keeps the report number == the tracker id.
- **RULE: BEFORE every batch run, run `node gate-pipeline.mjs`** to liveness-check every pending URL in `data/pipeline.md`. Dead URLs get flipped from `- [ ]` to `- [!]` with a closure reason, so the batch agent skips them entirely. This is the most important step — without it, you spend Claude tokens evaluating dead postings (a 60-URL batch can be 80%+ dead from WebSearch index staleness). The gate runs Playwright in the parent process where it works correctly (sub-agents cannot use Playwright).
- **RULE: After each batch of evaluations, run `node merge-tracker.mjs`** to merge tracker additions and avoid duplications.
- **RULE: After every batch merge, run `node verify-actionable.mjs --apply`** as a safety net to catch any dead URLs that slipped past the pre-batch gate (e.g., postings that closed between gate-time and apply-time). Auto-flips Evaluated→Discarded for any URL that no longer accepts applications.

**The one true batch workflow:**

```bash
# 1. (Optional) Scan portals for new candidates
node scan.mjs

# 2. REQUIRED: liveness-gate the pipeline BEFORE spending LLM tokens
node gate-pipeline.mjs

# 3. Run the batch (only "- [ ]" items get evaluated; "- [!]" are skipped)
#    via /trajecktory pipeline in your CLI

# 3b. Derive each new report's headline score from its dimension ratings (code
#     computes it, the model does not author it). Safety net: stamps any report
#     whose worker could not run compute-scores itself. Legacy reports (no keyed
#     dimensions) are left untouched — verified: --all touches zero of them.
node compute-scores.mjs --all --apply

# 4. Merge results into applications.md
node merge-tracker.mjs

# 5. Safety net — catch anything that closed mid-batch
node verify-actionable.mjs --apply

# 6. Health check the dashboard data — MANDATORY, read output before declaring done
node verify-reports.mjs
```

**RULE: `node verify-reports.mjs` MUST show ✅ before the batch is declared complete.** If it shows ⚠️ or reports with drift, the drawer will be broken for those entries — fix before moving on. Root cause is always format drift: reports written with `## Block A —` or `## A.` instead of the required `## A)` format.

- **RULE: NEVER create new entries in applications.md if company+role already exists.** Update the existing entry.

### Commit messages are published (RULE)

`verify-no-pii.mjs` scans **files**. A commit message is not a file, and it is published
exactly as surely as one. Writing about a leak tempts you to quote it, and that is how a
real compensation band, a real walk-away, and real interview counterparties reached commit
messages in this repo — every one of them written by an agent documenting the fix for that
exact class of problem, and every one passing a green test run.

When a commit message needs to describe personal data, **describe the shape, never the
value**:

| Don't | Do |
|---|---|
| Quote the figures (`it declared <band> while the leak was <low>/<high>/<walkaway>`) | `a hardcoded default and a declared range can be different numbers` |
| Name the company (``turned up `interview-prep/<a real company>/` ``) | `turned up real companies in interview-prep example paths` |
| Itemise what leaked (`a zip of the CV, a recruiter's work email`) | `shipped personal data past every gate` |

The left column is deliberately written with placeholders. The first draft of this table
used the real values as its examples, in this tracked file, and the gate flagged it. Even
a rule against quoting a leak will quote the leak if you let it.

Enforced two ways:
- `node verify-no-pii.mjs --messages` over the unpushed commits, wired into `test-all.mjs`.
- `.githooks/commit-msg`, which blocks the commit while the message is still a scratch
  file. **Enable it once per clone:** `git config core.hooksPath .githooks` (git will not
  run a hook out of a tracked directory by itself). Bypass with `--no-verify`.

### TSV Format for Tracker Additions

Write one TSV file per evaluation to `batch/tracker-additions/{num}-{company-slug}.tsv`. Single line, 9 tab-separated columns:

```
{num}\t{date}\t{company}\t{role}\t{status}\t{score}/5\t{pdf_emoji}\t[{num}](reports/{num}-{slug}-{date}.md)\t{note}
```

**Column order (IMPORTANT -- status BEFORE score):**
1. `num` -- sequential number (integer)
2. `date` -- YYYY-MM-DD
3. `company` -- short company name
4. `role` -- job title
5. `status` -- canonical status (e.g., `Evaluated`)
6. `score` -- format `X.X/5` (e.g., `4.2/5`)
7. `pdf` -- `✅` or `❌`
8. `report` -- markdown link `[num](reports/...)`
9. `notes` -- one-line summary

**Note:** In applications.md, score comes BEFORE status. The merge script handles this column swap automatically.

### Pipeline Integrity

1. **NEVER edit applications.md to ADD new entries** -- Write TSV in `batch/tracker-additions/` and `merge-tracker.mjs` handles the merge.
2. **YES you can edit applications.md to UPDATE status/notes of existing entries.**
3. All reports MUST include `**URL:**` in the header (between Score and PDF). Include `**Legitimacy:** {tier}` (see Block G in `modes/oferta.md`).
4. All statuses MUST be canonical (see `templates/states.yml`).
5. Health check: `node verify-pipeline.mjs`
6. Normalize statuses: `node normalize-statuses.mjs`
7. Dedup: `node dedup-tracker.mjs`
8. **NEVER hand-roll a tracker row.** Read rows with `parseTrackerLine`, write them
   with `formatTrackerLine`, both from `lib/tracker.mjs`. Never `line.split('|')`
   with literal indices, and never build a row from a template literal.

### Never re-add a tracked company (RULE)

A company that changes ATS keeps its name and gets a new board slug. Match it on
the slug alone and it looks brand new, so discovery appends a second
`tracked_companies` row pointing at the old board — which now 404s and will scan
forever, returning nothing. This happened on 2026-07-15 to **EliseAI**
(Greenhouse `meetelise` → Ashby `eliseai`) and **Grow Therapy** (Greenhouse
`growtherapy` → Ashby `grow-therapy`). Grow Therapy's surviving row even
documented the migration in its `notes` — but notes are prose, and no code reads
prose.

**Use `lib/portals.mjs`, never a bare slug comparison.** `buildCompanyIndex()`
keys every company by its name *and* every slug it is known by;
`findKnownCompany()` reports whether the hit came from the slug or the name.
That distinction matters, so do not collapse it:

| matchedOn | Meaning | Do |
|---|---|---|
| `slug` | Already tracked, same board | Skip silently — routine |
| `name` | Same name, different board | Skip the append, but **print it** |

A name match is either a migration (correctly skipped) or two real companies
sharing a name — Greenhouse `fetch` is Fetch pet insurance and Lever
`fetchpackage` is Fetch Package delivery, both live, both worth scanning. Only a
human can tell those apart, so surface every one instead of dropping it. When
two entries really are different companies, give them distinguishable names.

**When you prune a migrated entry, leave a tombstone** rather than deleting the
row: `enabled: false` plus a note saying where the company went. The index
deliberately includes disabled entries, so the tombstone is what stops the dead
slug from being rediscovered from a stale pipeline URL that no longer resolves
to a name. See the "Legacy-slug tombstones" block in `portals.yml`.

This applies to the agent-driven merge path too (the Launchpad "companies" step
in `dashboard-web/server/lib/setup.mjs`), not just `discover.mjs`. Guarded by
`tests/portals.test.mjs`.

### Posting identity is the canonical URL (RULE)

Company + role **cannot** distinguish two requisitions. A single employer can post
three openings with byte-identical titles, different URLs, and different comp, and
they are three different jobs. This is a routine shape at scaling startups, and it
has silently eaten evaluations twice: a title-guessing deduper deleted rows, and a
merge path skipped an addition, wrote no row, then filed its TSV under `merged/`
exactly as though it had landed. Both were invisible, because a tracker with a
missing row is still a perfectly valid tracker.

`lib/identity.mjs` is the **only** place that decides whether two things are the
same posting. Do not write a second one.

| Question | Use | Never |
|---|---|---|
| Same posting? | `canonicalUrl(a) === canonicalUrl(b)` | comparing raw URL strings |
| Same employer? | `normalizeCompany` | `toLowerCase()` and hoping |
| Same role, no URL available? | `sameRole` | any home-grown title matcher |
| Already evaluated? | `buildDecidedIndex` / `findDecided` | grepping `applications.md` |

Three rules follow from it, and each one is load-bearing:

1. **A differing canonical URL VETOES a role match.** If both sides resolve to a
   trustworthy URL and those URLs differ, they are different postings, whatever
   the titles say.
2. **`sameRole` is a fallback, not evidence.** It applies only when a URL cannot
   be resolved at all, and it may **never** justify *deleting* a row.
3. **An ambiguous canonical is treated as unresolvable.** One URL mapping to
   several employers with no posting-specific id is not identity, so it neither
   merges nor vetoes. Guards fail toward doing nothing: a missed suppression
   costs a check, a wrong one hides a live job.

Anything suppressed or dropped must stay **auditable** — a collapsed count in the
UI, a line in `data/merge-drops.tsv`, a file under `tracker-additions/dropped/`.
A suppression the user cannot inspect is the same failure being fixed here.

Guarded by `tests/identity.test.mjs` and the row-count assertions in
`tests/merge-tracker.test.mjs`. Those assert on **counts**, deliberately: the
failure mode is a MISSING row, and content assertions do not notice one.
`node audit-orphan-reports.mjs` reports evaluations that have no row.

### Never hand-roll a tracker row (RULE)

`data/applications.md` looks like a table you can slice with `split('|')`. Twice now
that assumption has rotted silently, because a wrong row is still a syntactically
valid row: nothing throws, nothing fails a test, and the damage only shows up later
as a column that quietly holds the wrong thing.

**On the read side**, five hand-rolled parsers disagreed about the layout. They split
on `|` without dropping the empty cells the outer pipes create, so on the 10-column
schema they read Resume as Report and Report as Notes. `analyze-patterns` could not
open a single report file, and every archetype fell back to "Unknown" for months.
That is why `lib/tracker.mjs` exists.

**On the write side**, the same drift happened again in the scripts that rewrite
rows. They were written for the legacy 9-column schema, so once a Resume column was
added between PDF and Report, index 9 stopped being Notes. `auto-discard-low` then
read a markdown link where it expected notes, which meant the `[self-sourced]`
exemption could never match and a JD the user picked themselves was auto-discarded
on score alone. Separately, notes are free text: a `|` typed into a note, or left
behind when a source tag was stripped, added a cell and shifted every field after it.

So the rule is not stylistic. Both engines exist because both halves of this file
have already been gotten wrong in production:

| Doing | Use | Why |
|---|---|---|
| Reading a row | `parseTrackerLine(line)` | Knows the current layout, returns `null` for headers, separators and non-rows, and still reads legacy 9-column rows correctly |
| Writing a row | `formatTrackerLine(fields)` | Neutralizes `\|`, newlines and tabs, so output always parses back as exactly 10 cells |
| Changing one cell | `formatTrackerLine({ ...row, status: 'Applied' })` | Spread the parsed row, override the field by NAME, never by index |

Adding or removing a column should mean editing `lib/tracker.mjs` and nothing else.
If you find yourself counting pipes, you are writing the next instance of this bug.
Guarded by `tests/tracker.test.mjs` and `tests/tracker-writers.test.mjs`.

### Canonical States (applications.md)

**Source of truth:** `templates/states.yml`

| State | When to use |
|-------|-------------|
| `Evaluated` | Report completed, pending decision |
| `Applied` | Application sent |
| `Responded` | Company replied / recruiter reached out, no screen booked yet |
| `Phone Screen` | TA / recruiter phone screen |
| `1st Interview` | First interview round |
| `2nd Interview` | Second interview round |
| `3rd Interview` | Third interview round |
| `4th Interview` | Fourth interview round (final loop) |
| `Offer` | Offer received |
| `Rejected` | Rejected by company |
| `Discarded` | Discarded by candidate or offer closed |
| `SKIP` | Doesn't fit, don't apply |
| `Closed` | Job posting closed before you could act (distinct from Discarded; excluded from analytics denominators) |
| `Not a Fit` | Role evaluated and determined a poor fit (signal noise, wrong level, wrong domain) |

**RULES:**
- No markdown bold (`**`) in status field
- No dates in status field (use the date column)
- No extra text (use the notes column)
