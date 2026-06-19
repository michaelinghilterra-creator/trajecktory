# trajecktory Windows installer

A one-double-click installer for non-technical users. Bundles everything offline
(portable Node, installed `node_modules`, Claude Code, and Chromium) and ends at
the running dashboard on `http://localhost:3333`, ready for the Launchpad setup.

> **Status: built and smoke-tested.** `TrajecktorySetup-v1.7.1.exe` compiles with
> Inno Setup 6 and installs cleanly (silent + interactive); a fresh install boots
> the dashboard with healthy API endpoints. Remaining verification is the
> end-to-end launch flow on a clean VM (the Code-mode "Start the live dashboard"
> path and Claude sign-in reuse) — see the Clean-VM test below.

## Credential model (important)
- **Evaluate / Scan** run on each user's **own Claude Pro/Max login** via the
  bundled `claude` CLI. The launcher REUSES the sign-in created by the Claude
  Desktop app (shared per-user credentials under `%USERPROFILE%\.claude\`): if
  those exist, no separate sign-in happens. Only if the user is not signed in
  anywhere does the launcher do a one-time interactive `claude login`. No API key,
  no cost to you. (Shared-sign-in reuse is the v1.7.1 behavior; the clean-VM test
  confirms the bundled CLI actually sees the Desktop creds.)
- **Resume / cover-letter / outreach drafts** use the user's **own Anthropic API
  key**, prompted (optionally) during install and written to
  `trajecktory\dashboard-web\.env`. They can skip it and add it later; draft
  endpoints return a clear "add your key" message until they do.
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
   Produces `installer\Output\TrajecktorySetup-v<version>.exe` (versioned from the
   `.iss` AppVersion / `VERSION`, e.g. `TrajecktorySetup-v1.7.1.exe`).
3. **Clean-VM test** (critical): on a Windows VM with **no Node, no git, no
   Chromium, no Claude Code**, run the installer, optionally paste a test API key,
   and finish. Then the PRIMARY launch path: open the Claude Desktop app in Code
   mode at the installed app folder (`%LOCALAPPDATA%\trajecktory\trajecktory`) and
   type **"Start the live dashboard."** Expect: bundled Node builds + starts the
   server, the dashboard opens in the bundled Chromium app window (not Edge), the
   Launchpad lets you walk setup (engine-ready gates; missing CV/profile/portals
   are to-dos, not blockers), Evaluate/Scan run on the reused Claude sign-in, and a
   draft uses the key. The Start Menu / desktop shortcut is a fallback that runs
   the same `launch-trajecktory.ps1`.

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
