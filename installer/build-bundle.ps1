#requires -Version 5.1
<#
  build-bundle.ps1 — stage the fully self-contained, offline payload that the
  Inno Setup installer (trajecktory.iss) compresses into TrajecktorySetup.exe.

  Run this ONCE on a Windows build machine. It needs internet (to fetch Node and
  Chromium) but the resulting payload/ does not — everything is bundled.

  UNTESTED IN CI: this was authored without a build machine in the loop. Walk it
  the first time and adjust the pinned versions / exclusion list as needed.

  Usage:
    pwsh -ExecutionPolicy Bypass -File installer\build-bundle.ps1
#>
$ErrorActionPreference = 'Stop'

# ── Config ────────────────────────────────────────────────────────────────────
# Pin the Node runtime so the bundle never depends on (or touches) the user's
# system Node. Bump deliberately; keep it on an active LTS.
$NodeVersion = '20.18.1'
$NodeZipName = "node-v$NodeVersion-win-x64"
$NodeUrl     = "https://nodejs.org/dist/v$NodeVersion/$NodeZipName.zip"

$InstallerDir = $PSScriptRoot                                   # trajecktory\installer
$RepoRoot     = Split-Path $InstallerDir -Parent                # trajecktory
$Payload      = Join-Path $InstallerDir 'payload'
$PayloadNode  = Join-Path $Payload 'node'
$PayloadApp   = Join-Path $Payload 'trajecktory'
$BrowsersPath = Join-Path $PayloadApp 'ms-playwright'

Write-Host "Repo root : $RepoRoot"
Write-Host "Payload   : $Payload"

# ── 1. Clean payload ────────────────────────────────────────────────────────
if (Test-Path $Payload) { Remove-Item $Payload -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Payload | Out-Null

# ── 2. Fetch + extract pinned portable Node ──────────────────────────────────
$zip = Join-Path $env:TEMP "$NodeZipName.zip"
Write-Host "Downloading Node $NodeVersion ..."
Invoke-WebRequest -Uri $NodeUrl -OutFile $zip
Expand-Archive -Path $zip -DestinationPath $Payload -Force
Rename-Item (Join-Path $Payload $NodeZipName) $PayloadNode
$NodeExe = Join-Path $PayloadNode 'node.exe'
$NpmCmd  = Join-Path $PayloadNode 'npm.cmd'
if (-not (Test-Path $NodeExe)) { throw "node.exe not found at $NodeExe" }

# Make the bundled Node the one used for every install step below.
$env:Path = "$PayloadNode;$env:Path"

# ── 2.5 Stage the Git for Windows installer (run silently at USER-install time) ─
# build-bundle stages a payload the Inno installer ships; running git's installer
# HERE would only touch this build box. Instead, download git's installer next to
# the .iss so trajecktory.iss can run it silently during the USER's install — that
# lands git on the user's PERSISTENT PATH. Claude Code needs a shell (Git Bash, or
# PowerShell as the fallback), and Claude Desktop (a separate app) only sees git
# when it is on the persistent PATH, not a process-scoped one.
$GitVersion   = '2.47.1'
$GitInstaller = 'Git-for-Windows-installer.exe'
$GitUrl       = "https://github.com/git-for-windows/git/releases/download/v$GitVersion.windows.1/Git-$GitVersion-64-bit.exe"
$GitOut       = Join-Path $InstallerDir $GitInstaller
Write-Host "Downloading Git for Windows $GitVersion ..."
Invoke-WebRequest -Uri $GitUrl -OutFile $GitOut
if (-not (Test-Path $GitOut)) { throw "Git installer not downloaded to $GitOut" }

# ── 3. Stage the tracked tree — exactly what the public repo ships ────────────
# Use `git archive` so ONLY committed files reach the payload. The working tree
# also holds gitignored local data (cv.md, config/profile.yml, the
# templates/cv-master.docx resume, AUDIT.md, .env, tracker, reports) — none of it
# is tracked, so none of it can leak here. .gitignore IS the ship boundary; the
# PII scan in step 7 is the backstop.
New-Item -ItemType Directory -Force -Path $PayloadApp | Out-Null
$treeZip = Join-Path $env:TEMP 'trajecktory-tree.zip'
if (Test-Path $treeZip) { Remove-Item $treeZip -Force }
git -C $RepoRoot archive --format=zip -o $treeZip HEAD
if ($LASTEXITCODE -ne 0) { throw "git archive failed with code $LASTEXITCODE" }
Expand-Archive -Path $treeZip -DestinationPath $PayloadApp -Force
Remove-Item $treeZip -Force
# The installer's own source is tracked but doesn't belong inside the shipped app.
Remove-Item (Join-Path $PayloadApp 'installer') -Recurse -Force -ErrorAction SilentlyContinue

# Recreate the empty writable dirs onboarding/Launchpad expects.
foreach ($d in 'data', 'output', 'reports') {
  New-Item -ItemType Directory -Force -Path (Join-Path $PayloadApp $d) | Out-Null
}

# Sanity: the example configs the first-run flow copies from must be present.
foreach ($f in 'config\profile.example.yml', 'templates\portals.example.yml', 'modes\_profile.template.md') {
  if (-not (Test-Path (Join-Path $PayloadApp $f))) { throw "Missing onboarding template: $f" }
}

# ── 4. Install production deps with the BUNDLED Node (matches the runtime) ─────
Write-Host "npm ci (root, omit dev) ..."
& $NpmCmd --prefix $PayloadApp ci --omit=dev
Write-Host "npm ci (dashboard-web, incl. dev for esbuild build.mjs) ..."
& $NpmCmd --prefix (Join-Path $PayloadApp 'dashboard-web') ci

# ── 5. Bundle Claude Code into the portable Node (eval/scan run on it) ─────────
# Installs claude + claude.cmd under payload\node so it is on PATH at runtime.
# The user authenticates it once with `claude login` (their own Pro account).
Write-Host "Installing Claude Code into the bundled Node ..."
$env:NPM_CONFIG_PREFIX = $PayloadNode
& $NpmCmd install -g '@anthropic-ai/claude-code'
Remove-Item Env:\NPM_CONFIG_PREFIX
if (-not (Test-Path (Join-Path $PayloadNode 'claude.cmd'))) {
  Write-Warning "claude.cmd not found in $PayloadNode — verify the global prefix install layout."
}

# ── 6. Bundle Playwright Chromium INSIDE the payload (offline) ────────────────
Write-Host "Installing Playwright Chromium into the payload ..."
$env:PLAYWRIGHT_BROWSERS_PATH = $BrowsersPath
& $NodeExe (Join-Path $PayloadApp 'node_modules\playwright\cli.js') install chromium
Remove-Item Env:\PLAYWRIGHT_BROWSERS_PATH

# ── 7. PII backstop: fail the build if any personal data slipped into payload ─
# Mirrors the repo PII scrub. Add patterns if the candidate identity changes.
Write-Host "Scanning payload for residual PII ..."
# Generic secret prefix + the owner's identity read from the SOURCE profile.yml
# (the payload excludes profile.yml). Never hardcoded, so this script ships clean
# and the scan adapts to whoever is building.
$piiPatterns = @('sk-ant-api')
$srcProfile = Join-Path $RepoRoot 'config\profile.yml'
if (Test-Path $srcProfile) {
  $prof = Get-Content $srcProfile -Raw
  foreach ($k in 'full_name', 'email', 'phone') {
    $rx = '(?m)^\s*' + $k + ':\s*["'']?([^"''\r\n#]+)'
    if ($prof -match $rx) { $piiPatterns += $Matches[1].Trim() }
  }
}
# Files where the maintainer's name/email legitimately appear (attribution +
# contact). Mirrors the allowlist in test-all.mjs; matched by file name.
$piiAllow = @(
  'README.md', 'LICENSE', 'CITATION.cff', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md',
  'SECURITY.md', 'SUPPORT.md', 'NOTICE.md', 'AGENTS.md', 'CLAUDE.md', 'package.json'
)
# -SimpleMatch: treat patterns as literals. The phone begins with "+", which is
# not a valid regex quantifier and would otherwise crash Select-String.
$hits = Get-ChildItem $Payload -Recurse -File |
  Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\ms-playwright\\' -and
    ($piiAllow -notcontains $_.Name)
  } |
  Select-String -Pattern $piiPatterns -SimpleMatch -List -ErrorAction SilentlyContinue
if ($hits) {
  $hits | ForEach-Object { Write-Warning "PII in payload: $($_.Path)" }
  throw "Refusing to build: personal data found in payload (see warnings above)."
}

# ── 8. Report ─────────────────────────────────────────────────────────────────
$sizeMB = [math]::Round((Get-ChildItem $Payload -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host "`nPayload staged at $Payload ($sizeMB MB)."
Write-Host "Next: compile installer\trajecktory.iss with Inno Setup to produce TrajecktorySetup.exe."
