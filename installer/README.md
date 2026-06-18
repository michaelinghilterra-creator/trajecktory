# trajecktory Windows installer

A one-double-click installer for non-technical users. Bundles everything offline
(portable Node, installed `node_modules`, Claude Code, and Chromium) and ends at
the running dashboard on `http://localhost:3333`, ready for the Launchpad setup.

> **Status: authored, not yet built or tested.** These scripts were written
> without a Windows build machine or Inno Setup available. Walk through them once
> on a build box and a clean VM before distributing. Lines below marked TODO need
> a human decision.

## Credential model (important)
- **Evaluate / Scan** run on each user's **own Claude Pro/Max login** via the
  bundled `claude` CLI (`claude login`, one time). No API key, no cost to you.
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
   Produces `installer\Output\TrajecktorySetup.exe`.
3. **Clean-VM test** (critical): on a Windows VM with **no Node, no git, no
   Chromium, no Claude Code**, run the installer, optionally paste a test API
   key, finish, click the shortcut. Expect: browser opens to the dashboard,
   Launchpad preflight is green, `claude login` prompts once, a sample job-URL
   evaluation runs on the Pro login, and a draft uses the key.

## What gets bundled
- `payload\node\` — pinned portable Node (set `$NodeVersion` in build-bundle.ps1)
  plus the `claude` CLI installed into it.
- `payload\trajecktory\` — the repo's system layer with production `node_modules`,
  bundled Chromium under `ms-playwright\`, and example configs. **No** user CV /
  profile / tracker / reports / keys (excluded + PII-scanned).
- `launch-trajecktory.ps1`, `stop-trajecktory.ps1` — start/stop the server.

## Open items (TODO before shipping)
- **App icon:** provide `installer\assets\trajecktory.ico` and uncomment
  `SetupIconFile` in `trajecktory.iss`.
- **Code signing:** an unsigned `.exe` triggers a SmartScreen "unknown
  publisher" warning a non-technical user may not click past. Either sign it
  (cert ~$100-400/yr, or Azure Trusted Signing) and set `SignTool`, or document
  the "More info -> Run anyway" workaround in your install instructions.
- **Demo data (optional):** if you want demo mode populated out of the box, run
  the demo seed scripts during build (they now use the fictional "Jordan Avery"
  persona) and ship `data\demo\`; otherwise the dashboard defaults to live data
  and an empty tracker for new users.
- **Port 3333:** the launcher assumes it is free. Add fallback handling if you
  expect conflicts.
- **Repo history:** the repo was rebuilt with clean history, but
  `build-bundle.ps1`'s exclusion list and PII scan remain the backstop against
  staging tracked personal data into the payload. Keep both in sync with the tree.
