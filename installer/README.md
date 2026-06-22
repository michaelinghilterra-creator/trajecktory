# trajecktory Windows installer

A one-double-click installer for non-technical users. Bundles everything offline
(portable Node, installed `node_modules`, Claude Code, and Chromium) and ends at
the running dashboard on `http://localhost:3333`, ready for the Launchpad setup.

> **Status: built and smoke-tested.** `trajecktory-setup-v1.7.16.exe` compiles with
> Inno Setup 6 and installs cleanly (silent + interactive); a fresh install boots
> the dashboard with healthy API endpoints. v1.7.16 closes two gaps from the v1.7.14
> VM run. First, the **Launchpad now shows profile data that was set up in Claude
> Desktop without a manual browser reload**: when you tab back, fields the CV-setup
> agent just wrote (name, email, location) now appear, because the focus-refresh
> merges fresh server values into the forms instead of keeping whatever was loaded
> first (it still preserves any field you're mid-edit on). Previously only the
> section checkboxes updated and the field values needed a reload. Second, the
> **setup handoff prompts now ask with the interactive option picker**: the Location,
> Evaluation, and talk-it-through-CV prompts explicitly tell the agent to use the
> AskUserQuestion tool (clickable multiple-choice) for known-answer questions
> (remote/hybrid/on-site, etc.) instead of asking in prose, so testers get the
> "little pop-up box" consistently rather than having to type answers. v1.7.15 makes the **left sidebar fit any
> Windows monitor** (1080p through 4K) without the janky whole-rail scrollbar: the
> brand pins to the top and the totals pin to the bottom while only the middle (nav +
> workflow) scrolls if a monitor is genuinely too short, and a height media query
> tightens the rail on 1080p-and-shorter displays so it fits with no scroll at all
> (verified filling the viewport at 1080p and 4K; no mobile/tablet breakpoints, desktop
> Windows only by design). v1.7.14: the topbar "synced N ago" is now
> a **live timestamp** (updates each second, tied to the last data sync); **Agent Scan
> auto-adds** discovered companies with a Greenhouse/Ashby/Lever board to
> `portals.yml` `tracked_companies` (merge-only) so the free API Scan catches them next
> time instead of paying Claude to re-discover them; and **Merge/Verify/Health are
> disabled with a "waiting on Evaluate" note** while Evaluate Pipeline is still running,
> so clicking ahead no longer shows a confusing "0 to review". v1.7.13 makes the dashboard **auto-refresh
> instead of needing a manual browser reload**: the applications list and the "Signed
> in to Claude" status now re-sync when you tab back to the dashboard (after editing
> config/CV in Claude Code or signing in), and the Workflow steps (Evaluate, Merge)
> re-sync the data the instant they finish, so evaluated jobs appear in the Pipeline
> and drawer with no reload. v1.7.12 added a TEMPORARY TEST CAP so
> test builds don't burn the whole Claude quota: `TJK_TEST_LIMIT` (set to 5 in the
> launcher) caps how many postings the scan adds and the Evaluate Pipeline scores.
> Remove that line in `launch-trajecktory.ps1` (and any `TJK_TEST_LIMIT` in `.env`)
> before a public release. Also: the spawned `claude -p` no longer waits on stdin
> ("no stdin data in 3 seconds" gone), the CV setup prompt no longer tells the user
> to hand-edit profile.yml (those fields are GUI-editable), and the scan funnel
> labels in-run duplicates as "duplicates" rather than "already tracked". v1.7.11
> fixed a batch of FRESH-INSTALL
> crashes found on a clean VM: the workflow scripts threw ENOENT on a brand-new
> install that has no data/pipeline.md, data/applications.md, or reports/ yet.
> `scan.mjs` (and `discover.mjs`) now create pipeline.md instead of crashing when the
> first scan finds offers; `gate-pipeline.mjs`, `verify-actionable.mjs`, and
> `verify-reports.mjs` exit cleanly with a "nothing to do" message; `merge-tracker.mjs`
> now CREATES data/applications.md (header only) and merges into it instead of bailing
> with "No applications.md found" (which previously dropped every evaluated result).
> Each fix was proven on a simulated fresh tree. Also renamed the sidebar "Morning
> Workflow" to "Workflow". v1.7.10 fixed two scanner dedup
> false-negatives that produced duplicate tracker/pipeline rows: `normalizeUrl` now
> strips a trailing `/apply` (Lever) as well as `/application`, and `loadSeenUrls`
> now reads the dominant `- [x] #NNN | URL | ...` pipeline.md format (the old regex
> only caught a URL immediately after the checkbox, missing ~93% of rows). v1.7.9
> removed the last bundling (the
> Job Search page no longer has a "Run full workflow" chain — every phase runs on
> its own) and fixes two scanner bugs that wrongly suppressed real postings: the
> title filter matched negative keywords as substrings (so "hr" dropped "Anthropic"
> and "Threat Intelligence", "java" dropped "JavaScript") — now whole-token only;
> and scan-history never aged out "skipped_dup" entries, permanently blocking real
> repostings — now aged like "added". (Note: a separate auth issue can surface as a
> 401 if the user's `claude login` token has expired; re-run `claude login`.) v1.7.8
> **un-bundled the workflow**: every
> left-sidebar command (Expand Coverage, API Scan, Agent Scan, Liveness Gate, Evaluate
> Pipeline, Merge Tracker, Verify, Health) now runs exactly one thing, so the user runs
> each individually and a failure is visible and isolated. "Evaluate Pipeline" no longer
> chains a gate + merge + verify + health around the eval (that bundling hid where the
> pipeline broke and multiplied Claude usage). The confusing in-dashboard **First
> Evaluation step is removed** from Setup, and **Sign in to Claude** moved to the sidebar
> next to the commands that use it. v1.7.7 made the **API Scan show its full funnel**
> instead of just the new count, so a scan that adds 0 new offers reads as "14,338 found,
> 14,264 below your title filter, 28 already tracked" rather than looking broken. v1.7.6
> fixed the run-6 VM feedback: the "Claude usage or limit
> pressure" warning now fires only on a real rate-limit or overload signal (HTTP
> 429/529, `overloaded_error`) instead of any job description that merely mentions
> "rate limiting", and the dashboard Evaluate and Scan runs are now inline and headless
> (no parallel subagents, which were tripping the single subscription's usage limits)
> and write their tracker rows deterministically so a first evaluation actually lands
> in the pipeline. v1.7.5 made the **First Evaluation run in the dashboard** (one click:
> fetch JD, score, report, tracker via the real pipeline on the signed-in CLI, with
> live progress, no paste-a-prompt), hardened the Launchpad against a malformed-config
> crash, surfaced what each step configured, prompts for location preferences, and added
> auto-refresh on focus. v1.7.4 (one CV paste sets up the whole profile, shortcut icon,
> stable AppId for in-place upgrades) carries forward. Remaining verification is the VM
> round: run a First Evaluation (lands a row, no false-alarm warning) and an API Scan
> (funnel visible).

## Credential model (important)
- **Evaluate / Scan** run on each user's **own Claude Pro/Max login** via the
  bundled `claude` CLI. CONFIRMED on the v1.7.1 VM test: the bundled CLI does NOT
  inherit the Claude Desktop sign-in (separate credential stores), so eval/scan
  need a one-time bundled `claude login`. The launcher no longer attempts an
  interactive login (it hung when run hidden); the dashboard and all data views
  start fine without it. The Launchpad's First Evaluation step has a **"Sign in to
  Claude"** button that opens a console running the bundled `claude login`. No API
  key, no cost to you.
- **Resume / cover-letter / outreach drafts** use the user's **own Anthropic API
  key**, prompted (optionally) during install and written to
  `trajecktory\dashboard-web\.env`. They can skip it and add it later via the
  Launchpad's **"AI draft key (optional)"** field (saves to `.env` and takes effect
  without a restart); draft endpoints return a clear "add your key" message until
  they do.
- None of your keys ship. `build-bundle.ps1` excludes `.env` and scans the staged
  payload for personal data, failing the build if any is found.

## Build steps (on a Windows build machine)
1. **Stage the payload** (needs internet, downloads Node + Chromium, ~300-500 MB):
   ```powershell
   pwsh -ExecutionPolicy Bypass -File installer\build-bundle.ps1
   ```
   Produces `installer\payload\` (gitignored).
2. **Compile the installer** with Inno Setup 6:
   ```powershell
   & "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\trajecktory.iss
   ```
   Produces `installer\Output\trajecktory-setup-v<version>.exe` (versioned from the
   `.iss` AppVersion / `VERSION`, e.g. `trajecktory-setup-v1.7.3.exe`).
3. **Clean-VM test** (critical): on a Windows VM with **no Node, no git, no
   Chromium, no Claude Code**, run the installer, optionally paste a test API key,
   and finish. Then the PRIMARY launch path: open the Claude Desktop app in Code
   mode at the installed app folder (`%USERPROFILE%\trajecktory\trajecktory`) and
   type **"Start the live dashboard."** Expect: bundled Node builds + starts the
   server, the dashboard opens in your DEFAULT browser (set Chrome as default to
   avoid Edge), the Launchpad lets you walk setup (engine-ready gates; missing
   CV/profile/portals are to-dos, not blockers), and a draft uses the key.
   Evaluate / Scan need the one-time bundled `claude login` (see Credential model).
   The Start Menu / desktop shortcut is a fallback that runs the same
   `launch-trajecktory.ps1`.

## What gets bundled
- `payload\node\` — pinned portable Node (set `$NodeVersion` in build-bundle.ps1)
  plus the `claude` CLI installed into it.
- `payload\trajecktory\` — the repo's system layer with production `node_modules`,
  bundled Chromium under `ms-playwright\`, and example configs. **No** user CV /
  profile / tracker / reports / keys (excluded + PII-scanned).
- `launch-trajecktory.ps1`, `stop-trajecktory.ps1` — start/stop the server.

## Open items (TODO before shipping)
- **App icon:** done. `installer\assets\trajecktory.ico` (multi-resolution
  256/64/48/32/16, generated from the brand favicon) is wired up via
  `SetupIconFile` in `trajecktory.iss`.
- **Code signing:** an unsigned `.exe` triggers a SmartScreen "unknown
  publisher" warning a non-technical user may not click past. Either sign it
  (cert ~$100-400/yr, or Azure Trusted Signing) and set `SignTool`, or document
  the "More info -> Run anyway" workaround in your install instructions.
- **Demo data (optional):** if you want demo mode populated out of the box, run
  the demo seed scripts during build (they now use the fictional "Jordan Avery"
  persona) and ship `data\demo\`; otherwise the dashboard defaults to live data
  and an empty tracker for new users.
- **Port 3333:** handled. The launcher prefers 3333 but falls back to a free
  OS-assigned port if it's taken, passes it to the server via `PORT`, opens the
  right URL, and records the port + PID so `stop-trajecktory.ps1` finds the
  server wherever it landed.
- **Repo history:** the repo was rebuilt with clean history, but
  `build-bundle.ps1`'s exclusion list and PII scan remain the backstop against
  staging tracked personal data into the payload. Keep both in sync with the tree.
